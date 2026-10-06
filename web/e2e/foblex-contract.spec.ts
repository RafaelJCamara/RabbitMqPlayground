import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { allowedTargets, explainLink } from '@rmq/domain';
import { EditorPage } from './pages/editor-page';
import { buildDocument, seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * The Foblex contract suite (journey 13 of the plan, ADR-0016, ADR-0017, ADR-0034). Foblex Flow is pinned to an exact version, and
 * the editor works around what it does not offer in one place, the adapter. Each workaround, and each quirk of its keyboard
 * layer that the editor relies on, is a test here, and each test names the workaround it guards. This runs against the real
 * library in a real browser on every push, so that an upgrade that changes one of these behaviours fails here, loudly, and says
 * which behaviour it was.
 *
 * Nothing here is about what the editor does with the answer: the intents that the adapter reports are read from the debug handle
 * of the e2e build, and the editor's own journeys are in editor.spec.ts.
 */

const FOBLEX_VERSION = (
  JSON.parse(readFileSync(new URL('../node_modules/@foblex/flow/package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

/** A topology that has one of each kind of node, an internal exchange, and an edge of each kind. The ids are `p1`, `x1`, `x2`, `q1` and `c1`. */
const TOPOLOGY = buildDocument([
  { type: 'add-producer', name: 'sender' },
  {
    type: 'declare-exchange',
    name: 'orders',
    exchangeType: 'topic',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  {
    type: 'declare-exchange',
    name: 'hidden',
    exchangeType: 'fanout',
    durable: true,
    autoDelete: false,
    internal: true,
  },
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'add-consumer', name: 'worker' },
  { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'order.*' },
  { type: 'bind', source: 'orders', destination: { kind: 'exchange', name: 'hidden' }, key: '#' },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
  { type: 'subscribe', consumer: 'worker', queue: 'billing' },
]);
const EDGES = ['p1>x1', 'x1>q1', 'x1>x2', 'q1>c1'];
const NODES = ['p1', 'x1', 'x2', 'q1', 'c1'];

/** Opens the editor on that topology, and waits until the canvas is drawn and fitted, and every edge has been drawn. */
async function open(page: Page): Promise<EditorPage> {
  test.info().annotations.push({ type: 'foblex', description: FOBLEX_VERSION });
  await seedCanvas(page, TOPOLOGY);
  const editor = new EditorPage(page);
  await editor.goto();
  // The canvas says that it is ready once it has been drawn and fitted, which moves everything, so nothing is measured before.
  await page.locator('rmq-flow-canvas[data-ready]').waitFor();
  await expect
    .poll(() => page.evaluate(() => [...(window.__rmq?.drawnEdges() ?? [])].sort()))
    .toEqual([...EDGES].sort());
  return editor;
}

const intents = (page: Page) => page.evaluate(() => window.__rmq?.intents() ?? []);
const lastIntent = async (page: Page) => (await intents(page)).at(-1);
/**
 * The last intent, once it is the one that is expected. The library reports a gesture a moment after it is made, and by the
 * keyboard a little later than by the pointer, so this waits for it, and says what came instead if it never does.
 */
const reported = (page: Page, expected: Record<string, unknown>) =>
  expect.poll(() => lastIntent(page)).toMatchObject(expected);
const selection = (page: Page) => page.evaluate(() => window.__rmq?.selection());
const flow = (page: Page): Locator => page.locator('f-flow');
const node = (page: Page, id: string): Locator => page.locator(`[data-node-id="${id}"]`);

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('the element is not on the page');
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Selects a node by clicking it, and waits until the editor has heard of it, so that a key that follows is for that node. The
 * library has the selection at once, and the editor a moment later, and a person is slower than either.
 */
async function select(page: Page, id: string): Promise<void> {
  const at = await centre(node(page, id));
  await page.mouse.click(at.x, at.y);
  await expect.poll(() => selection(page)).toEqual({ nodes: [id], edges: [] });
}

const handle = (page: Page, id: string, which: 'in' | 'out') => node(page, id).locator(`[data-handle="${which}"]`);

/** How far the nodes are painted from where the live viewport says that they are, at most, in pixels. */
async function drift(page: Page): Promise<number> {
  return page.evaluate(() => {
    const rmq = window.__rmq;
    const viewport = rmq?.viewport();
    const document_ = rmq?.document() as { layout: { nodes: Record<string, { x: number; y: number }> } } | null;
    const host = window.document.querySelector('f-flow')?.getBoundingClientRect();
    if (!viewport || !document_ || !host) {
      return Number.POSITIVE_INFINITY;
    }
    let worst = 0;
    for (const element of window.document.querySelectorAll('[data-node-id]')) {
      const position = document_.layout.nodes[element.getAttribute('data-node-id') ?? ''];
      const painted = element.getBoundingClientRect();
      if (position) {
        worst = Math.max(
          worst,
          Math.abs(painted.x - host.x - (position.x * viewport.zoom + viewport.x)),
          Math.abs(painted.y - host.y - (position.y * viewport.zoom + viewport.y)),
        );
      }
    }
    return worst;
  });
}

const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

test.describe('Foblex contract: the live viewport (workaround 1 of ADR-0016)', () => {
  test('is where the nodes are painted, at rest', async ({ page }) => {
    await open(page);
    await nextFrame(page);

    expect(await drift(page), 'the live transform must match the painted nodes').toBeLessThanOrEqual(1);
  });

  test('follows the wheel, which zooms, as the nodes are painted', async ({ page }) => {
    await open(page);
    const before = await page.evaluate(() => window.__rmq?.viewport()?.zoom ?? 0);
    const at = await centre(flow(page));

    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -300);
    await nextFrame(page);

    const after = await page.evaluate(() => window.__rmq?.viewport()?.zoom ?? 0);
    expect(after, 'the wheel must change the zoom').not.toBe(before);
    expect(await drift(page), 'the live transform must follow the wheel').toBeLessThanOrEqual(1);
  });

  test('is current in the middle of a pan, which the documented event is not (it fires when a gesture ends)', async ({
    page,
  }) => {
    await open(page);
    await nextFrame(page);
    const before = await page.evaluate(() => window.__rmq?.viewport());
    const start = { x: (await flow(page).boundingBox())!.x + 40, y: (await flow(page).boundingBox())!.y + 500 };

    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 120, start.y + 30, { steps: 8 });
    await nextFrame(page);
    const during = await page.evaluate(() => window.__rmq?.viewport());

    expect(
      Math.round((before?.x ?? 0) - (during?.x ?? 0)),
      'the canvas moved 120 px left while the button was held',
    ).toBe(120);
    expect(await drift(page), 'the live transform must be current while the pan is still going').toBeLessThanOrEqual(1);
    await page.mouse.up();
  });
});

test.describe('Foblex contract: the list of valid targets is read when a drag starts (workaround 2 of ADR-0016)', () => {
  /** Presses the output handle of a node, moves a few pixels so that the library starts the drag, and says which handles are lit. */
  async function litWhileDragging(page: Page, id: string): Promise<string[]> {
    const from = await centre(handle(page, id, 'out'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
    const lit = await page.evaluate(() =>
      [...window.document.querySelectorAll('.f-connector-connectable')].map(
        (element) => element.getAttribute('data-f-connector-id') ?? '',
      ),
    );
    await page.mouse.up();
    return lit.sort();
  }

  const expected = (source: string) =>
    allowedTargets(TOPOLOGY, source)
      .map((id) => `in:${id}`)
      .sort();

  for (const source of ['p1', 'x1', 'q1']) {
    test(`lights exactly the targets that the rules allow, for a node that has not been selected (from ${source})`, async ({
      page,
    }) => {
      await open(page);

      expect(await litWhileDragging(page, source), `the handles that are lit while dragging from ${source}`).toEqual(
        expected(source),
      );
    });
  }

  test('does not light an internal exchange for a producer, which the broker would refuse to let it publish to', async ({
    page,
  }) => {
    await open(page);

    expect(await litWhileDragging(page, 'p1')).not.toContain('in:x2');
  });

  test('lights the same targets for a link that starts from the keyboard: the node that is selected is armed when it is selected', async ({
    page,
  }) => {
    await open(page);
    await select(page, 'x1');

    await page.keyboard.press('l');
    const lit = await page.evaluate(() =>
      [...window.document.querySelectorAll('.f-connector-connectable')].map(
        (element) => element.getAttribute('data-f-connector-id') ?? '',
      ),
    );
    await page.keyboard.press('Escape');

    expect(lit.sort()).toEqual(expected('x1'));
  });

  test('lights nothing for a handle whose node has no valid target, and does not mean "everything" (an empty list does)', async ({
    page,
  }) => {
    await seedCanvas(page, buildDocument([{ type: 'add-producer', name: 'alone' }]));
    const editor = new EditorPage(page);
    await editor.goto();

    expect(await litWhileDragging(page, 'p1')).toEqual([]);
  });
});

test.describe('Foblex contract: edges are drawn after their elements exist (workaround 3 of ADR-0016)', () => {
  test('are reported as drawn, each with a path, and are the edges of the document', async ({ page }) => {
    await open(page);

    const paths = await page.evaluate(() =>
      [...window.document.querySelectorAll('[data-edge-id] path.f-connection-path')].map(
        (path) => path.getAttribute('d') ?? '',
      ),
    );
    expect(paths).toHaveLength(EDGES.length);
    expect(paths.every((d) => d.length > 0)).toBe(true);
    await expect(page.locator('[data-edge]')).toHaveCount(EDGES.length);
  });

  test('are reported as drawn when a link adds one, and as gone when a delete takes it away', async ({ page }) => {
    await open(page);
    const from = await centre(handle(page, 'x2', 'out'));
    const to = await centre(handle(page, 'q1', 'in'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().includes('x2>q1'))).toBe(true);

    await select(page, 'q1');
    await page.keyboard.press('Delete');

    await expect
      .poll(() => page.evaluate(() => [...(window.__rmq?.drawnEdges() ?? [])].sort()))
      .toEqual(['p1>x1', 'x1>x2']);
  });
});

test.describe('Foblex contract: a drop on a node that is not valid is not a drop on nothing (workaround 4 of ADR-0016)', () => {
  /** Drags from the output handle of `source` to a point and lets go. */
  async function dragTo(page: Page, source: string, to: { x: number; y: number }): Promise<void> {
    const from = await centre(handle(page, source, 'out'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  }

  test('is a link when it is on a node that the rules allow', async ({ page }) => {
    await open(page);

    await dragTo(page, 'x2', await centre(node(page, 'q1')));

    await reported(page, { type: 'link', source: 'x2', target: 'q1', via: 'drag' });
    expect(
      await page.evaluate(
        () =>
          Object.keys(window.__rmq?.document() ? (window.__rmq.document() as { bindings: object }).bindings : {})
            .length,
      ),
    ).toBe(3);
  });

  test('is an invalid link, which is explained in the words of the rule, when it is on a node that the rules do not allow', async ({
    page,
  }) => {
    await open(page);
    const bindings = () =>
      page.evaluate(() => Object.keys((window.__rmq?.document() as { bindings: object }).bindings).length);

    await dragTo(page, 'x1', await centre(node(page, 'p1')));

    await reported(page, { type: 'link-invalid', source: 'x1', target: 'p1', via: 'drag' });
    expect(await bindings(), 'an invalid drop must not make a binding').toBe(2);
    await expect(page.getByTestId('refusal-message')).toHaveText(explainLink(TOPOLOGY, 'x1', 'p1'));
  });

  test('is a link to nothing, which says where, when it is on the empty canvas', async ({ page }) => {
    await open(page);
    const bounds = (await flow(page).boundingBox())!;
    const drop = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 40 };

    await dragTo(page, 'x1', drop);

    await reported(page, { type: 'link-to-empty' });
    const intent = (await lastIntent(page)) as {
      type: string;
      at: { x: number; y: number };
      client: { x: number; y: number };
    };
    expect(intent.type).toBe('link-to-empty');
    expect(Math.round(intent.client.x)).toBe(Math.round(drop.x));
    const viewport = await page.evaluate(() => window.__rmq?.viewport());
    expect(Math.round(intent.at.x)).toBe(Math.round((drop.x - bounds.x - (viewport?.x ?? 0)) / (viewport?.zoom ?? 1)));
  });

  test('says how the link was made: by dragging, by clicking, and from the keyboard', async ({ page }) => {
    await open(page);

    await dragTo(page, 'x2', await centre(node(page, 'q1')));
    await reported(page, { type: 'link', via: 'drag' });

    const producer = await centre(handle(page, 'p1', 'out'));
    await page.mouse.click(producer.x, producer.y);
    const target = await centre(handle(page, 'q1', 'in'));
    await page.mouse.move(target.x, target.y, { steps: 6 });
    await page.mouse.click(target.x, target.y);
    await reported(page, { type: 'link', source: 'p1', target: 'q1', via: 'click' });

    await select(page, 'x2');
    await page.keyboard.press('l');
    // Enter before the library has started the link, which it does a moment after L, is not heard.
    await expect(page.locator('body > [role="status"][aria-live="polite"]')).toHaveText(
      /^(Linking from|Target \d+ of \d+)/,
    );
    await page.keyboard.press('Enter');
    await reported(page, { type: 'link', source: 'x2', via: 'keyboard' });
  });
});

test.describe('Foblex contract: the keyboard layer (ADR-0017)', () => {
  test('is one tab stop: the nodes are not tab stops, the canvas is', async ({ page }) => {
    await open(page);

    const stops = await page.evaluate(() =>
      [...window.document.querySelectorAll('rmq-flow-canvas [tabindex]')].map(
        (element) => `${element.tagName}:${element.getAttribute('tabindex')}`,
      ),
    );
    expect(stops).toEqual(['F-FLOW:0']);

    await page.getByTestId('add-queue').focus();
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.document.activeElement?.tagName)).toBe('F-FLOW');
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => window.document.activeElement?.closest('rmq-flow-canvas'))).toBeNull();
  });

  test('moves the selection with the arrow keys, and says which item is active through aria-activedescendant', async ({
    page,
  }) => {
    await open(page);
    await select(page, 'p1');
    const before = await selection(page);

    await page.keyboard.press('ArrowRight');

    await expect.poll(() => selection(page), { message: 'an arrow key must move the selection' }).not.toEqual(before);
    await reported(page, { type: 'select' });
    const active = await flow(page).getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(
      await page.evaluate((id) => window.document.getElementById(id ?? '')?.classList.contains('f-selected'), active),
    ).toBe(true);
  });

  test('selects everything with Ctrl+A and nothing with Escape', async ({ page }) => {
    await open(page);
    await select(page, 'p1');

    await page.keyboard.press('Control+a');
    await expect.poll(async () => [...((await selection(page))?.nodes ?? [])].sort()).toEqual([...NODES].sort());

    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page)).toEqual({ nodes: [], edges: [] });
  });

  test('moves the selection with M and the arrow keys, ten units a step, as one move that says it came from a key', async ({
    page,
  }) => {
    await open(page);
    const before = await page.evaluate(
      () => (window.__rmq?.document() as { layout: { nodes: Record<string, { x: number }> } }).layout.nodes['q1']!.x,
    );
    await select(page, 'q1');

    await page.keyboard.press('m');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('m');

    await reported(page, {
      type: 'move',
      by: 'keyboard',
      moves: [{ id: 'q1', x: before + 20 }],
    });
  });

  for (const chord of ['Control+m', 'Meta+m', 'Alt+m']) {
    test(`does not pick a node up for ${chord}, which the library would take for M unless the adapter held it back (ADR-0017)`, async ({
      page,
    }) => {
      await open(page);
      const before = await page.evaluate(
        () => (window.__rmq?.document() as { layout: { nodes: Record<string, { x: number }> } }).layout.nodes['q1']!.x,
      );
      await select(page, 'q1');
      const moves = async () => (await intents(page)).filter((intent) => intent.type === 'move');

      await page.keyboard.press(chord);
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Escape');
      // M itself, which shows that the keys are being heard: one move, one step long, and so none before it for the chord.
      // (The arrows, with nothing picked up, moved the selection, and Escape cleared it, so the node is selected again.)
      await expect.poll(() => selection(page)).toEqual({ nodes: [], edges: [] });
      await select(page, 'q1');
      await page.keyboard.press('m');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('m');

      await reported(page, { type: 'move', by: 'keyboard', moves: [{ id: 'q1', x: before + 10 }] });
      expect(await moves(), `${chord} must not start a move`).toHaveLength(1);
    });
  }

  test('deletes with the Delete key, as a request that the editor carries out, and says that it came from a key', async ({
    page,
  }) => {
    await open(page);
    await select(page, 'c1');

    await page.keyboard.press('Delete');

    await reported(page, { type: 'delete', nodes: ['c1'], by: 'keyboard' });
    await expect(node(page, 'c1')).toHaveCount(0);
  });

  test('speaks in our words: the standing instructions, the item that is active, and what cannot be done', async ({
    page,
  }) => {
    await open(page);
    const polite = page.locator('body > [role="status"][aria-live="polite"]');
    const assertive = page.locator('body > [role="alert"][aria-live="assertive"]');

    await expect(flow(page)).toHaveAttribute('aria-roledescription', 'topology editor');
    const instructions = await flow(page).getAttribute('aria-describedby');
    await expect(page.locator(`#${instructions}`)).toContainText('M picks up the selection');

    await select(page, 'p1');
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(async () => (await polite.textContent()) ?? '')
      .toMatch(/, \d+ of \d+$|^Binding from |^Producer |^Exchange /);

    await page.keyboard.press('Escape');
    await page.keyboard.press('l');
    await expect(assertive).toHaveText('Select one node first, then press L to link it.');
  });
});

test.describe('Foblex contract: what the adapter reports from the pointer', () => {
  test('reports a context menu for a node and for an edge, and a double click on a node as a rename', async ({
    page,
  }) => {
    await open(page);
    const at = await centre(node(page, 'q1'));

    await page.mouse.click(at.x, at.y, { button: 'right' });
    await reported(page, { type: 'context-menu', target: { kind: 'node', id: 'q1' } });
    await page.keyboard.press('Escape');

    await page.mouse.dblclick(at.x, at.y);
    await reported(page, { type: 'rename', id: 'q1' });
  });

  test('does not zoom for a double click on the empty canvas, which the library would do by default', async ({
    page,
  }) => {
    await open(page);
    const before = await page.evaluate(() => window.__rmq?.viewport()?.zoom);
    const bounds = (await flow(page).boundingBox())!;

    await page.mouse.dblclick(bounds.x + bounds.width / 2, bounds.y + bounds.height - 60);
    await nextFrame(page);

    expect(await page.evaluate(() => window.__rmq?.viewport()?.zoom)).toBe(before);
  });

  test('moves a node when it is dragged, and reports the whole drag as one move that says it came from a pointer', async ({
    page,
  }) => {
    await open(page);
    const start = await page.evaluate(
      () =>
        (window.__rmq?.document() as { layout: { nodes: Record<string, { x: number; y: number }> } }).layout.nodes[
          'c1'
        ]!,
    );
    const zoom = (await page.evaluate(() => window.__rmq?.viewport()?.zoom)) ?? 1;
    const at = await centre(node(page, 'c1'));

    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 40, at.y + 60, { steps: 8 });
    await page.mouse.up();

    await reported(page, { type: 'move' });
    const moves = (await intents(page)).filter((intent) => intent.type === 'move');
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ by: 'pointer', moves: [{ id: 'c1' }] });
    const moved = (moves[0] as unknown as { moves: { x: number; y: number }[] }).moves[0]!;
    // The pointer moves by whole pixels and the node by fractions of them at a zoom that is not 100%, so one unit is allowed.
    expect(Math.abs(moved.x - start.x - 40 / zoom)).toBeLessThanOrEqual(1);
    expect(Math.abs(moved.y - start.y - 60 / zoom)).toBeLessThanOrEqual(1);
  });

  test('reports what is dropped from the toolbox, where the middle of its preview was, in the coordinates of the canvas', async ({
    page,
  }) => {
    // This is also the guard of the one thing that the toolbox does for the library: it finds the item that was pressed by the
    // attribute `fExternalItem`, which a host directive does not put on the element, so that a drag that does not start, with
    // no error, is what a missing attribute looks like.
    await open(page);
    const source = await centre(page.getByTestId('add-queue'));
    const bounds = (await flow(page).boundingBox())!;
    const drop = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 80 };

    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    await page.mouse.move(source.x + 30, source.y + 10, { steps: 4 });
    await page.mouse.move(drop.x, drop.y, { steps: 10 });
    // The editor fits the canvas to show a node that it has added out of view, so the viewport is read before the drop. The
    // preview is where it is shown: the library puts it off the pointer when the canvas is not at 100%, so it is not the pointer
    // that the report is compared with.
    const viewport = await page.evaluate(() => window.__rmq?.viewport());
    const preview = await centre(page.locator('.f-external-item-preview'));
    await page.mouse.up();

    await reported(page, { type: 'drop-new', node: { kind: 'queue' } });
    const intent = (await lastIntent(page)) as { type: string; node: { kind: string }; at: { x: number; y: number } };
    const zoom = viewport?.zoom ?? 1;
    expect(Math.abs(intent.at.x - (preview.x - bounds.x - (viewport?.x ?? 0)) / zoom)).toBeLessThanOrEqual(2);
    expect(Math.abs(intent.at.y - (preview.y - bounds.y - (viewport?.y ?? 0)) / zoom)).toBeLessThanOrEqual(2);
  });
});
