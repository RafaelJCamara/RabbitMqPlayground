import type { Page } from '@playwright/test';
import { edgeKeys } from '@rmq/domain';
import { EditorPage } from './pages/editor-page';
import { buildDocument, seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * What an edge shows and what can be done to it (ADR-0043, ADR-0044): the chips of its label and the card that lists the rest, the label that is dragged along the edge, the
 * bindings that are edited and deleted in the inspector, the warnings that are drawn as badges, the exchange to exchange binding, and the default exchange with its implicit
 * bindings. Nothing sets the app into a state: it does what a learner does, and reads what the document has.
 */

const topic = (name: string) =>
  ({
    type: 'declare-exchange',
    name,
    exchangeType: 'topic',
    durable: true,
    autoDelete: false,
    internal: false,
  }) as const;
const bind = (key: string, to = 'billing') =>
  ({ type: 'bind', source: 'orders', destination: { kind: 'queue', name: to }, key }) as const;

/** `p1` sender, `x1` orders (topic), `q1` billing with five bindings, `q2` archive with one, and a link from the producer: `x1>q1` has five keys. */
const SHOP = buildDocument([
  { type: 'add-producer', name: 'sender' },
  topic('orders'),
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'declare-queue', name: 'archive', durable: true },
  bind('a.*'),
  bind('b.*'),
  bind('c.*'),
  bind('d.*'),
  bind('e.*'),
  bind('#', 'archive'),
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
]);

async function open(page: Page, document = SHOP): Promise<EditorPage> {
  await seedCanvas(page, document);
  const editor = new EditorPage(page);
  await editor.goto();
  await page.locator('rmq-flow-canvas[data-ready]').waitFor();
  await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(edgeKeys(document).size);
  await editor.settled();
  return editor;
}

const label = (page: Page, key: string) => page.locator(`[data-label="${key}"]`);

/** A point of an edge, at a fraction of its length, on the screen. */
const onEdge = (page: Page, key: string, fraction: number): Promise<{ x: number; y: number }> =>
  page.locator(`[data-edge="${key}"] path.f-connection-path`).evaluate((path: SVGPathElement, at: number) => {
    const point = path.getPointAtLength(path.getTotalLength() * at);
    const matrix = path.getScreenCTM()!;
    return { x: point.x * matrix.a + matrix.e, y: point.y * matrix.d + matrix.f };
  }, fraction);

/**
 * Selects an edge by pressing on its line, near its target, where the edges that start from one exchange are apart and its label is not, and waits for the inspector to
 * say what it is.
 */
async function selectEdge(
  page: Page,
  key: string,
  title: 'Binding' | 'Link from a producer' | 'Implicit binding',
): Promise<void> {
  const at = await onEdge(page, key, 0.8);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('inspector-title')).toHaveText(title);
}

const labelsOf = (page: Page) =>
  page.evaluate(
    () => (window.__rmq?.document() as { layout: { labels: Record<string, { at: number }> } }).layout.labels,
  );

test.describe('the label of an edge', () => {
  test('shows the first three keys as chips and the rest as a count, and says all of them in the name of the edge', async ({
    page,
  }) => {
    await open(page);

    const chips = label(page, 'x1>q1').locator('.rmq-chip');
    await expect(chips).toHaveText(['a.*', 'b.*', 'c.*', '+2 more']);
    await expect(page.locator('[data-edge="x1>q1"]')).toHaveAttribute(
      'aria-label',
      /a\.\*.*b\.\*.*c\.\*.*d\.\*.*e\.\*/,
    );
    await expect(label(page, 'x1>q2').locator('.rmq-chip')).toHaveText(['#']);
  });

  test('lists them all in a card while the pointer is over the label, which stays while it is on the card and goes on Escape', async ({
    page,
  }) => {
    await open(page);
    const card = page.getByTestId('label-card');

    await label(page, 'x1>q1').hover();

    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName('Bindings from exchange orders to queue billing');
    await expect(card.locator('li')).toHaveText(['a.*', 'b.*', 'c.*', 'd.*', 'e.*']);
    await card.hover();
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);

    await label(page, 'x1>q1').hover();
    await expect(card).toBeVisible();
    await page.mouse.move(300, 120);
    await expect(card).toHaveCount(0);
  });

  test('has no card when it says everything that it has', async ({ page }) => {
    await open(page);

    await label(page, 'x1>q2').hover();

    await expect(page.getByTestId('label-card')).toHaveCount(0);
  });

  test('is dragged along its edge, which the document keeps as a place, one step of undo that takes it back', async ({
    page,
  }) => {
    const editor = await open(page);
    expect(await labelsOf(page)).toEqual({});
    const viewport = await page.evaluate(() => window.__rmq?.viewport());
    const at = await editor.centre(label(page, 'x1>q1'));

    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 10, at.y + 2, { steps: 3 });
    await page.mouse.move(at.x + 50, at.y + 6, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => Object.keys(await labelsOf(page))).toEqual(['x1>q1']);
    const place = (await labelsOf(page))['x1>q1']!.at;
    expect(place).toBeGreaterThan(0);
    expect(place).toBeLessThan(1);
    expect(await page.evaluate(() => window.__rmq?.viewport()), 'a press on a label does not pan the canvas').toEqual(
      viewport,
    );
    expect(await editor.log()).toEqual([expect.stringMatching(/^move label orders -> billing at=0?\.\d+$/)]);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => labelsOf(page)).toEqual({});
  });

  test('has the place that the inspector says in percent, which a number sets, and which a text that is not a number leaves as it is', async ({
    page,
  }) => {
    await open(page);
    await selectEdge(page, 'x1>q2', 'Binding');
    const field = page.getByRole('spinbutton', { name: 'Label position (percent along the edge)' });

    await field.fill('70');
    await field.press('Tab');

    await expect.poll(async () => (await labelsOf(page))['x1>q2']?.at).toBeCloseTo(0.7, 5);
    await expect(field).toHaveValue('70');

    await field.fill('');
    await field.press('Tab');
    await expect(
      page
        .getByTestId('label-problem')
        .or(page.getByRole('complementary', { name: 'Inspector' }).getByTestId('refusal-message')),
    ).toContainText('The place of a label has to be a number from 0 to 100. It stays where it is.');
    await expect(field).toHaveValue('70');
    expect((await labelsOf(page))['x1>q2']?.at).toBeCloseTo(0.7, 5);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => labelsOf(page)).toEqual({});
  });
});

test.describe('the bindings of an edge, in the inspector', () => {
  test('are listed with their keys, which are edited in place, as one step of undo each', async ({ page }) => {
    const editor = await open(page);
    await selectEdge(page, 'x1>q1', 'Binding');
    const rows = page.getByTestId('binding-rows').getByRole('group');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(1).getByRole('textbox', { name: 'Key' })).toHaveValue('b.*');

    await rows.nth(1).getByRole('textbox', { name: 'Key' }).fill('z.#');
    await rows.nth(1).getByRole('textbox', { name: 'Key' }).press('Tab');

    await expect
      .poll(() => editor.edges())
      .toEqual(
        expect.arrayContaining(['orders -> billing key=z.#', 'orders -> billing key=a.*', 'orders -> billing key=e.*']),
      );
    expect((await editor.edges()).filter((edge) => edge.includes('key=b.*'))).toEqual([]);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(async () => (await editor.edges()).filter((edge) => edge.includes('key=b.*'))).toHaveLength(1);
  });

  test('say why a key is refused, under the field, and keep the key that they had', async ({ page }) => {
    const editor = await open(page);
    await selectEdge(page, 'x1>q1', 'Binding');
    const first = page.getByTestId('binding-rows').getByRole('textbox', { name: 'Key' }).first();

    await first.fill('#.#.#');
    await first.press('Tab');

    await expect(page.getByTestId('binding-rows').getByTestId('refusal-message')).toContainText(
      "The binding key '#.#.#'",
    );
    await expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(await editor.edges()).toContain('orders -> billing key=a.*');
  });

  test('can have another binding added, which asks for its key in the popover as the other ways do, and one deleted', async ({
    page,
  }) => {
    const editor = await open(page);
    await selectEdge(page, 'x1>q1', 'Binding');

    await page.getByRole('button', { name: 'Delete the binding with key a.*' }).click();
    await expect.poll(async () => (await editor.edges()).filter((edge) => edge.includes('billing'))).toHaveLength(4);
    await expect(page.getByTestId('binding-rows').getByRole('group')).toHaveCount(4);

    await page.getByTestId('add-binding').click();
    await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
    await page.keyboard.type('new.key');
    await page.keyboard.press('Enter');

    await expect.poll(() => editor.edges()).toContain('orders -> billing key=new.key');
    await expect(page.getByTestId('binding-rows').getByRole('group')).toHaveCount(5);
  });

  test('take the edge with them when the last one is deleted, as the edge is its bindings', async ({ page }) => {
    const editor = await open(page);
    await selectEdge(page, 'x1>q2', 'Binding');

    await page.getByRole('button', { name: 'Delete the binding with key #' }).click();

    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().includes('x1>q2'))).toBe(false);
    expect((await editor.edges()).some((edge) => edge.includes('archive'))).toBe(false);
  });

  test('of a producer, a link, can have its target changed with the picker', async ({ page }) => {
    const editor = await open(
      page,
      buildDocument([
        { type: 'add-producer', name: 'sender' },
        topic('orders'),
        topic('events'),
        { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
      ]),
    );
    await selectEdge(page, 'p1>x1', 'Link from a producer');

    await page.getByTestId('change-target').click();
    await page.getByRole('option', { name: /events/ }).click();

    await expect.poll(() => editor.edges()).toEqual(['sender -> events']);
  });
});

test.describe('the warnings of the canvas, drawn where they are about', () => {
  test('are a badge on an exchange that nothing is bound from, said in its name and in the inspector', async ({
    page,
  }) => {
    const editor = await open(
      page,
      buildDocument([topic('orders'), { type: 'declare-queue', name: 'billing', durable: true }]),
    );

    const node = editor.node('Exchange orders, topic, 1 warning');
    await expect(node).toBeVisible();
    await expect(node.locator('.rmq-lint')).toBeVisible();
    await editor.select('Exchange orders, topic, 1 warning');
    await expect(page.getByTestId('inspector-warnings')).toContainText("Nothing is bound from the exchange 'orders'");

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await page.keyboard.type('a.b');
    await page.keyboard.press('Enter');
    await expect(editor.node('Exchange orders, topic')).toBeVisible();
    await expect(editor.nodeById('x1').locator('.rmq-lint')).toHaveCount(0);
  });

  test('are a badge on the label of a headers binding that matches nothing', async ({ page }) => {
    await open(
      page,
      buildDocument([
        {
          type: 'declare-exchange',
          name: 'docs',
          exchangeType: 'headers',
          durable: true,
          autoDelete: false,
          internal: false,
        },
        { type: 'declare-queue', name: 'billing', durable: true },
        {
          type: 'bind',
          source: 'docs',
          destination: { kind: 'queue', name: 'billing' },
          key: '',
          headers: { xMatch: 'any', args: [] },
        },
      ]),
    );

    await expect(page.locator('[data-label="x1>q1"]').getByTestId('edge-lint')).toBeVisible();
    await selectEdge(page, 'x1>q1', 'Binding');
    await expect(page.getByTestId('inspector-warnings')).toContainText('matches no message');
  });
});

test.describe('the default exchange (ADR-0043)', () => {
  const PRODUCER_TO_QUEUE = buildDocument([
    { type: 'add-producer', name: 'sender' },
    { type: 'declare-queue', name: 'billing', durable: true },
    { type: 'declare-queue', name: 'archive', durable: true },
    { type: 'link', producer: 'sender', target: { kind: 'queue', name: 'billing' } },
  ]);
  const toggle = (page: Page) => page.getByRole('switch', { name: 'Default exchange' });
  const drawn = (page: Page) => page.evaluate(() => [...(window.__rmq?.drawnEdges() ?? [])].sort());

  test('is drawn, with the binding that RabbitMQ makes for each queue, when the switch is on, and gone when it is off', async ({
    page,
  }) => {
    const editor = await open(page, PRODUCER_TO_QUEUE);
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.getByText('Default exchange').first()).toBeVisible();
    await expect(page.locator('[data-node-id="~default"]')).toHaveCount(0);

    await toggle(page).click();

    await expect(page.locator('[data-node-id="~default"]')).toBeVisible();
    await expect.poll(() => drawn(page)).toEqual(['p1>q1', '~default>q1', '~default>q2']);
    expect(await editor.log()).toEqual(['set canvas default-exchange=true']);

    await toggle(page).click();
    await expect(page.locator('[data-node-id="~default"]')).toHaveCount(0);
    await expect.poll(() => drawn(page)).toEqual(['p1>q1']);
  });

  test('is a setting of the canvas, which is kept with it when the page is opened again', async ({ page }) => {
    const editor = await open(page, PRODUCER_TO_QUEUE);
    await toggle(page).click();
    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    // The canvas is kept a moment after a change, and a page that is opened before that has the canvas as it was.
    await expect
      .poll(
        async () =>
          ((await editor.saved()) as { settings?: { showDefaultExchange?: boolean } } | null)?.settings
            ?.showDefaultExchange,
      )
      .toBe(true);

    await page.reload();
    await page.locator('rmq-flow-canvas[data-ready]').waitFor();

    await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-node-id="~default"]')).toBeVisible();
  });

  test('is taken back by undo, like any change of the canvas', async ({ page }) => {
    await open(page, PRODUCER_TO_QUEUE);
    await toggle(page).click();
    await expect(page.locator('[data-node-id="~default"]')).toBeVisible();

    await page.getByRole('button', { name: /^Undo/ }).click();

    await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-node-id="~default"]')).toHaveCount(0);
  });

  test('explains itself when it is selected, and nothing can be changed about it, with the reason when a key tries', async ({
    page,
  }) => {
    const editor = await open(page, PRODUCER_TO_QUEUE);
    await toggle(page).click();
    await editor.select('Default exchange');

    await expect(page.getByTestId('inspector-title')).toHaveText('Default exchange');
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('Every queue is bound to it');
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveCount(0);

    await page.keyboard.press('Delete');
    await expect(page.getByTestId('refusal-message')).toHaveText(
      'RabbitMQ makes the default exchange and its bindings itself, so they cannot be deleted or changed.',
    );
    expect(await editor.edges()).toEqual(['sender -> billing']);
  });

  test('has implicit bindings that explain themselves when they are selected', async ({ page }) => {
    await open(page, PRODUCER_TO_QUEUE);
    await toggle(page).click();
    await expect.poll(() => drawn(page)).toContain('~default>q2');

    await selectEdge(page, '~default>q2', 'Implicit binding');

    await expect(page.getByTestId('inspector-title')).toHaveText('Implicit binding');
    await expect(page.getByRole('complementary', { name: 'Inspector' })).toContainText('cannot be changed or deleted');
  });

  test('is refused as a target with a sentence of its own, which says what to do', async ({ page }) => {
    const editor = await open(page, PRODUCER_TO_QUEUE);
    await toggle(page).click();

    await editor.dragLinkTo('p1', await editor.centre(editor.nodeById('~default')));

    await expect(page.getByTestId('refusal-message')).toContainText('Nothing is linked to the default exchange');
    await expect(page.getByTestId('refusal-message')).toContainText('Link the producer to the queue itself');
    expect(await editor.edges()).toEqual(['sender -> billing']);
  });
});

test.describe('an exchange bound to another exchange', () => {
  test('is made by dragging, asks for a key by the type of the exchange it starts from, and is drawn from the first to the second', async ({
    page,
  }) => {
    const editor = await open(
      page,
      buildDocument([topic('orders'), topic('events'), { type: 'declare-queue', name: 'billing', durable: true }]),
    );

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('x2')));
    await page.getByRole('textbox', { name: 'Binding key' }).fill('order.#');
    await page.keyboard.press('Enter');

    await expect.poll(() => editor.edges()).toEqual(['orders -> events key=order.#']);
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges())).toEqual(['x1>x2']);
    expect(await editor.log()).toEqual(['bind orders -> events key=order.#']);
  });

  test('may be to itself, as the broker allows', async ({ page }) => {
    const editor = await open(page, buildDocument([topic('orders')]));

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('x1')));
    await page.getByRole('textbox', { name: 'Binding key' }).fill('again.#');
    await page.keyboard.press('Enter');

    await expect.poll(() => editor.edges()).toEqual(['orders -> orders key=again.#']);
  });
});
