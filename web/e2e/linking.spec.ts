import type { Page } from '@playwright/test';
import { allowedTargets, explainLink } from '@rmq/domain';
import { EditorPage } from './pages/editor-page';
import { buildDocument, seedCanvas } from './support/seed';
import { Finger } from './support/touch';
import { expect, test } from './support/test';

/**
 * Journey 3 of the plan: linking (ADR-0041, ADR-0042). A link is made five ways, by dragging from the dot of a node, by clicking the dot and then the target, by the "Link to…"
 * of the inspector, by the "Link to…" of the context menu and by the key `L`, and by touch, and each ends in the same command with the same refusals. What the library
 * reports of a drag is the contract suite's (foblex-contract.spec.ts); what the editor does with it, and what the learner is shown, is here. Nothing sets the app into a
 * state: it does what a learner does, and reads what the document has.
 */

/** A canvas with a producer, two exchanges, two queues and a consumer, and nothing joined: `p1`, `x1` (direct), `x2` (topic), `q1`, `q2` and `c1`. */
const SHOP = buildDocument([
  { type: 'add-producer', name: 'sender' },
  {
    type: 'declare-exchange',
    name: 'orders',
    exchangeType: 'direct',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  {
    type: 'declare-exchange',
    name: 'events',
    exchangeType: 'topic',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'declare-queue', name: 'archive', durable: true },
  { type: 'add-consumer', name: 'worker' },
]);

async function open(page: Page, document = SHOP): Promise<EditorPage> {
  await seedCanvas(page, document);
  const editor = new EditorPage(page);
  await editor.goto();
  // The canvas says that it is ready once it has been drawn and fitted, which moves everything, so nothing is measured before.
  await page.locator('rmq-flow-canvas[data-ready]').waitFor();
  await editor.settled();
  return editor;
}

const keyPopover = (page: Page, from: string, to: string) =>
  page.getByRole('group', { name: `Binding key from ${from} to ${to}` });
const keyField = (page: Page) => page.getByRole('textbox', { name: 'Binding key' });

/** Types a key into the popover that asks for it, which has the cursor already in it, and confirms. */
async function giveKey(page: Page, key: string): Promise<void> {
  await expect(keyField(page)).toBeFocused();
  await page.keyboard.type(key);
  await page.keyboard.press('Enter');
}

/** The bar that says what the last thing was, on the status line. */
const said = (page: Page) => page.getByTestId('status-message');

test.describe('journey 3: the five ways to link', () => {
  test('by dragging from the dot of a node to another node, which asks for the key of a direct exchange before anything is made', async ({
    page,
  }) => {
    const editor = await open(page);

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));

    await expect(keyPopover(page, 'exchange orders', 'queue billing')).toBeVisible();
    expect(await editor.edges(), 'nothing is made until Enter').toEqual([]);
    await giveKey(page, 'eu');
    await expect.poll(() => editor.edges()).toEqual(['orders -> billing key=eu']);
    await expect(said(page)).toHaveText('Bound exchange orders to queue billing.');
    expect(await editor.log()).toEqual(['bind orders -> billing key=eu']);
  });

  test('by clicking the dot of a node and then its target, which a producer does with no question at all', async ({
    page,
  }) => {
    const editor = await open(page);

    const from = await editor.centre(editor.handle('p1', 'out'));
    await page.mouse.click(from.x, from.y);
    const to = await editor.centre(editor.handle('x1', 'in'));
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.click(to.x, to.y);

    await expect.poll(() => editor.edges()).toEqual(['sender -> orders']);
    expect(await editor.log()).toEqual(['link sender -> orders']);
  });

  test('by "Link to…" in the inspector, which lists the targets that the rules allow and finds one by what is typed', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.select('Exchange orders, direct');

    await page.getByRole('button', { name: 'Link exchange orders to…' }).click();

    const search = page.getByRole('combobox', { name: 'Search the targets' });
    await expect(search).toBeFocused();
    const options = page.getByRole('dialog', { name: 'Link exchange orders to…' }).getByRole('option');
    await expect(options).toHaveCount(4);
    await page.keyboard.type('bill');
    await expect(options).toHaveCount(1);
    await page.keyboard.press('Enter');
    await giveKey(page, 'eu');

    await expect.poll(() => editor.edges()).toEqual(['orders -> billing key=eu']);
  });

  test('by "Link to…" in the menu of a node, in the order that macOS and Linux send a right click', async ({
    page,
  }) => {
    const editor = await open(page);

    await editor.rightClickMenuFirst(await editor.centre(editor.nodeById('x2')));
    await page.getByRole('menuitem', { name: /Link to…/ }).click();
    await page.getByRole('option', { name: /archive/ }).click();
    await giveKey(page, 'order.*');

    await expect.poll(() => editor.edges()).toEqual(['events -> archive key=order.*']);
  });

  test('by "Link to…" in the menu of a node, in the order that Windows sends a right click', async ({ page }) => {
    const editor = await open(page);

    const at = await editor.centre(editor.nodeById('x2'));
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: /Link to…/ }).click();
    await page.getByRole('option', { name: /archive/ }).click();
    await giveKey(page, 'order.*');

    await expect.poll(() => editor.edges()).toEqual(['events -> archive key=order.*']);
  });

  test('by the key L, which the library takes: the arrow keys choose a target and Enter links', async ({ page }) => {
    const editor = await open(page);
    await editor.select('Producer sender');
    const live = page.locator('body > [role="status"][aria-live="polite"]');

    await page.keyboard.press('l');
    await expect(live).toHaveText(/^(Linking from producer sender\.|Target \d+ of \d+)/);
    // The library starts at the first target, the exchange orders, and the arrow keys go to the nearest one in that direction: down is the exchange under it.
    await expect(live).toHaveText(/^Target 1 of 4: exchange orders/);
    await page.keyboard.press('ArrowDown');
    await expect(live).toHaveText(/^Target 2 of 4: exchange events/);
    await page.keyboard.press('Enter');

    await expect.poll(() => editor.edges()).toEqual(['sender -> events']);
    expect(await editor.log()).toEqual(['link sender -> events']);
  });

  test.describe('by touch', () => {
    test.use({ hasTouch: true });

    test('by dragging a finger from the dot of a node to another node', async ({ page }) => {
      const editor = await open(page);
      const finger = await Finger.on(page);

      await finger.drag(await editor.centre(editor.handle('x2', 'out')), await editor.centre(editor.nodeById('q2')));

      await expect(keyPopover(page, 'exchange events', 'queue archive')).toBeVisible();
      await giveKey(page, 'order.#');
      await expect.poll(() => editor.edges()).toEqual(['events -> archive key=order.#']);
    });

    test('by a finger from the dot of a producer, which has no key to ask for', async ({ page }) => {
      const editor = await open(page);
      const finger = await Finger.on(page);

      await finger.drag(await editor.centre(editor.handle('p1', 'out')), await editor.centre(editor.nodeById('x1')));

      await expect.poll(() => editor.edges()).toEqual(['sender -> orders']);
    });
  });

  test('every way ends in the same line of the log, which is what a learner would type for it', async ({ page }) => {
    const editor = await open(page);

    await editor.dragLinkTo('p1', await editor.centre(editor.nodeById('x1')));
    await expect.poll(() => editor.edges()).toEqual(['sender -> orders']);
    await editor.select('Queue billing');
    await page.getByRole('button', { name: 'Link queue billing to…' }).click();
    await page.getByRole('option', { name: /worker/ }).click();
    await expect.poll(() => editor.edges()).toEqual(['sender -> orders', 'worker <- billing']);

    expect(await editor.log()).toEqual(['link sender -> orders', 'subscribe worker billing']);
  });
});

test.describe('journey 3: the key of a binding', () => {
  test('opens by the node that the link goes to with the cursor in it, and says in a sentence what the key is for', async ({
    page,
  }) => {
    const editor = await open(page);

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));

    const popover = keyPopover(page, 'exchange orders', 'queue billing');
    await expect(keyField(page)).toBeFocused();
    await expect(popover).toContainText('A message is routed to this queue when its routing key is exactly this key.');
    const box = (await popover.boundingBox())!;
    const flowBox = (await editor.flow.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(flowBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(flowBox.x + flowBox.width);
    expect(box.y + box.height).toBeLessThanOrEqual(flowBox.y + flowBox.height);
  });

  test('gives up with Escape, which makes nothing and gives the cursor back to the canvas', async ({ page }) => {
    const editor = await open(page);
    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await expect(keyField(page)).toBeFocused();

    await page.keyboard.press('Escape');

    await expect(keyField(page)).toHaveCount(0);
    expect(await editor.edges()).toEqual([]);
    await expect(said(page)).toHaveText('Link cancelled.');
    await expect(editor.flow).toBeFocused();
  });

  test('gives up with its button, and when the cursor goes somewhere else', async ({ page }) => {
    const editor = await open(page);
    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(keyField(page)).toHaveCount(0);

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await expect(keyField(page)).toBeFocused();
    await page.getByRole('textbox', { name: 'Name' }).click();

    await expect(keyField(page)).toHaveCount(0);
    expect(await editor.edges()).toEqual([]);
  });

  test('says why a key is refused, under the field, in the words of the rule, and stays open until it is mended', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.dragLinkTo('x2', await editor.centre(editor.nodeById('q1')));
    // A topic key with more than two # words is refused by RabbitMQ (ADR-0022).
    await giveKey(page, '#.#.#');

    const popover = keyPopover(page, 'exchange events', 'queue billing');
    await expect(popover.getByTestId('refusal-message')).toContainText("The binding key '#.#.#' has 3 '#' words");
    await expect(popover.getByTestId('refusal-reply')).toBeVisible();
    await expect(keyField(page)).toHaveAttribute('aria-invalid', 'true');
    expect(await editor.edges()).toEqual([]);
    // The reason is under the field, so it is not also on the status line.
    await expect(page.getByRole('contentinfo', { name: 'Status' }).getByTestId('refusal')).toHaveCount(0);

    await keyField(page).fill('order.created');
    await page.keyboard.press('Enter');
    await expect(keyField(page)).toHaveCount(0);

    await expect.poll(() => editor.edges()).toEqual(['events -> billing key=order.created']);
  });

  test('is not asked for a fanout exchange, which does not read it', async ({ page }) => {
    await seedCanvas(
      page,
      buildDocument([
        {
          type: 'declare-exchange',
          name: 'broadcast',
          exchangeType: 'fanout',
          durable: true,
          autoDelete: false,
          internal: false,
        },
        { type: 'declare-queue', name: 'billing', durable: true },
      ]),
    );
    const editor = new EditorPage(page);
    await editor.goto();
    await page.locator('rmq-flow-canvas[data-ready]').waitFor();
    await editor.settled();

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));

    await expect.poll(() => editor.edges()).toEqual(['broadcast -> billing key=']);
    await expect(keyField(page)).toHaveCount(0);
  });

  test('says that a binding is there already, and makes nothing, when the same key is given twice', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await giveKey(page, 'eu');
    await expect.poll(() => editor.edges()).toEqual(['orders -> billing key=eu']);

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await giveKey(page, 'eu');

    await expect(said(page)).toHaveText('Already bound with that key.');
    expect(await editor.edges()).toEqual(['orders -> billing key=eu']);
    expect(await editor.log()).toEqual(['bind orders -> billing key=eu']);
  });
});

test.describe('journey 3: a drop that is not valid, and a drop on nothing', () => {
  test('explains in the words of the rule why a link cannot be made, and makes nothing', async ({ page }) => {
    const editor = await open(page);

    await editor.dragLinkTo('q1', await editor.centre(editor.nodeById('p1')));

    await expect(page.getByTestId('refusal-message')).toHaveText(explainLink(SHOP, 'q1', 'p1'));
    expect(await editor.edges()).toEqual([]);
    expect(await editor.log()).toEqual([]);
  });

  test('lights only the targets that the rules allow while a link is being dragged', async ({ page }) => {
    const editor = await open(page);
    const from = await editor.centre(editor.handle('p1', 'out'));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });

    const lit = await page.evaluate(() =>
      [...window.document.querySelectorAll('.f-connector-connectable')].map(
        (element) => element.getAttribute('data-f-connector-id') ?? '',
      ),
    );
    await page.mouse.up();

    expect(lit.sort()).toEqual(
      allowedTargets(SHOP, 'p1')
        .map((id) => `in:${id}`)
        .sort(),
    );
  });

  test('opens a menu of what could be made where a link was let go on nothing, which makes the node and the link as one step', async ({
    page,
  }) => {
    const editor = await open(page);
    const flowBox = (await editor.flow.boundingBox())!;
    const drop = { x: flowBox.x + flowBox.width / 2, y: flowBox.y + flowBox.height - 60 };

    await editor.dragLinkTo('x1', drop);

    const menu = page.getByRole('menu', { name: /Create and link from exchange orders/ });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([
      'New direct exchange',
      'New fanout exchange',
      'New topic exchange',
      'New headers exchange',
      'New queue',
    ]);
    await menu.getByRole('menuitem', { name: 'New queue' }).click();
    await giveKey(page, 'eu');

    await expect.poll(() => editor.edges()).toEqual(['orders -> queue1 key=eu']);
    const placed = (await editor.layout())['queue1']!;
    expect(placed).toBeDefined();
    expect(await editor.log()).toEqual([
      expect.stringMatching(/^declare queue queue1; move queue1 x=-?\d+ y=-?\d+; bind orders -> queue1 key=eu$/),
    ]);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(() => editor.edges()).toEqual([]);
    await expect(editor.nodeById('q3')).toHaveCount(0);
  });

  test('offers a producer only what a producer can be linked to', async ({ page }) => {
    const editor = await open(page);
    const flowBox = (await editor.flow.boundingBox())!;

    await editor.dragLinkTo('p1', { x: flowBox.x + flowBox.width / 2, y: flowBox.y + flowBox.height - 60 });

    const menu = page.getByRole('menu', { name: /Create and link from producer sender/ });
    await expect(menu.getByRole('menuitem')).toHaveText([
      'New direct exchange',
      'New fanout exchange',
      'New topic exchange',
      'New headers exchange',
      'New queue',
    ]);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect(await editor.edges()).toEqual([]);
  });
});
