import { EditorPage } from './pages/editor-page';
import { buildDocument, seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * Journey 2 of the plan: the editor. Add, rename, move by drag and with M, delete three ways, undo and redo, layout, zoom, fit,
 * themes. What the library reports and how it is worked around is the contract suite's (foblex-contract.spec.ts), and the inspector
 * has a spec of its own (inspector.spec.ts). Nothing here sets the app into a state: it does what a learner does.
 */

async function open(page: import('@playwright/test').Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  return editor;
}

/** Drags from one point of the page to another, with a move at the start that is over the threshold of a drag. */
async function dragBetween(
  page: import('@playwright/test').Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

/**
 * Whether every node is inside the canvas, all of it, as the page paints it, with `room` pixels to spare on each side (a pixel less is
 * allowed for a node that is painted between two pixels).
 */
async function allNodesInside(page: import('@playwright/test').Page, editor: EditorPage, room = 0): Promise<boolean> {
  const flow = (await editor.flow.boundingBox())!;
  const boxes = await page.locator('[data-node-id]').evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  return (
    boxes.length > 0 &&
    boxes.every(
      (box) =>
        box.x >= flow.x + room - 1 &&
        box.y >= flow.y + room - 1 &&
        box.x + box.width <= flow.x + flow.width - room + 1 &&
        box.y + box.height <= flow.y + flow.height - room + 1,
    )
  );
}

test.describe('journey 2: adding to the canvas', () => {
  test('adds each kind of node with a click, names it by its kind and a number, and selects the last', async ({
    page,
  }) => {
    const editor = await open(page);

    await editor.add('Producer');
    await editor.add('Direct exchange');
    await editor.add('Queue');
    await editor.add('Consumer');

    for (const label of ['Producer producer1', 'Exchange exchange1, direct', 'Queue queue1', 'Consumer consumer1']) {
      await expect(editor.node(label)).toBeVisible();
    }
    expect(Object.keys(await editor.layout()).sort()).toEqual(['consumer1', 'exchange1', 'producer1', 'queue1']);
    await expect(page.getByTestId('inspector-title')).toHaveText('consumer');
    await expect(page.getByTestId('status-message')).toHaveText('Added consumer consumer1.');
  });

  test('numbers the second of a kind after the first, and adds an exchange of the type that was chosen', async ({
    page,
  }) => {
    const editor = await open(page);

    await editor.add('Queue');
    await editor.add('Queue');
    await editor.add('Headers exchange');

    await expect(editor.node('Queue queue2')).toBeVisible();
    await expect(editor.node('Exchange exchange1, headers')).toBeVisible();
  });

  test('puts a node where the preview of a drag from the toolbox was dropped, and selects it', async ({ page }) => {
    const editor = await open(page);
    const source = await editor.centre(page.getByRole('button', { name: 'Queue', exact: true }));
    const bounds = (await editor.flow.boundingBox())!;
    const drop = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };

    await dragBetween(page, source, drop);

    await expect(editor.node('Queue queue1')).toBeVisible();
    const at = await editor.centre(editor.node('Queue queue1'));
    expect(Math.hypot(at.x - drop.x, at.y - drop.y)).toBeLessThan(120);
    await expect(page.getByTestId('inspector-title')).toHaveText('queue');
    expect(await page.evaluate(() => window.__rmq?.intents().filter(({ type }) => type === 'drop-new').length)).toBe(1);
  });

  test('says that an empty canvas is empty, and what the keys do for what is selected', async ({ page }) => {
    const editor = await open(page);
    await expect(page.getByTestId('canvas-empty')).toBeVisible();
    await expect(editor.hints).not.toContainText('Rename');

    await editor.add('Queue');

    await expect(page.getByTestId('canvas-empty')).toHaveCount(0);
    await expect(editor.hints).toContainText('F2');
    await expect(editor.hints).toContainText('Rename');
    await expect(editor.hints).toContainText('Link to another node');
  });
});

test.describe('journey 2: renaming', () => {
  test('renames with F2, with a double click, with the context menu, and with the inspector', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.select('Queue queue1');

    // F2: the field opens over the node with the name selected, so typing replaces it.
    await editor.renameSelected('Queue queue1', 'orders');
    await expect(editor.node('Queue orders')).toBeVisible();
    await expect(editor.flow).toBeFocused();

    // A double click.
    const at = await editor.centre(editor.node('Queue orders'));
    await page.mouse.dblclick(at.x, at.y);
    await expect(page.getByRole('textbox', { name: 'Rename queue orders' })).toBeFocused();
    await page.keyboard.type('billing');
    await page.keyboard.press('Enter');
    await expect(editor.node('Queue billing')).toBeVisible();

    // The context menu.
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: /Rename/ }).click();
    await expect(page.getByRole('textbox', { name: 'Rename queue billing' })).toBeFocused();
    await page.keyboard.type('payments');
    await page.keyboard.press('Enter');
    await expect(editor.node('Queue payments')).toBeVisible();

    // The inspector.
    const name = page.getByRole('textbox', { name: 'Name' });
    await name.fill('invoices');
    await name.press('Tab');
    await expect(editor.node('Queue invoices')).toBeVisible();
    expect(Object.keys(await editor.layout())).toEqual(['invoices']);
  });

  test('drops the new name on Escape, and keeps the field open with the reason when the name is taken', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.add('Queue');
    await editor.select('Queue queue1');

    await editor.renameSelected('Queue queue1', 'queue2');

    const field = page.getByRole('textbox', { name: 'Rename queue queue1' });
    await expect(field).toBeVisible();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('refusal-message')).toContainText('queue2');

    await page.keyboard.press('Escape');
    await expect(field).toHaveCount(0);
    await expect(editor.node('Queue queue1')).toBeVisible();
    await expect(editor.node('Queue queue2')).toBeVisible();
    await expect(editor.flow).toBeFocused();
  });
});

test.describe('journey 2: the context menu', () => {
  for (const [who, release] of [
    ['macOS and Linux', 'auxclick'],
    ['macOS for a Control click', 'click'],
  ] as const) {
    test(`stays open when the button that opened it comes up, as it does on ${who}`, async ({ page }) => {
      const editor = await open(page);
      await editor.add('Queue');
      const at = await editor.centre(editor.node('Queue queue1'));

      await editor.rightClickMenuFirst(at, release);

      await expect(page.getByRole('menu', { name: 'Actions for queue queue1' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: /Rename/ })).toBeFocused();
    });
  }

  test('closes with a click outside it, whichever way it was opened, and the focus goes back to the canvas', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');
    const at = await editor.centre(editor.node('Queue queue1'));
    const empty = { x: at.x + 300, y: at.y + 200 };

    await editor.rightClickMenuFirst(at);
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(editor.flow).toBeFocused();

    // The click on the empty canvas took the selection away, and a key opens the menu for what is selected.
    await editor.select('Queue queue1');
    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByRole('menu')).toHaveCount(0);
  });
});

test.describe('journey 2: moving', () => {
  test('moves a node by dragging it, and the move is one step that undo takes back', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.add('Producer');
    const before = (await editor.layout())['queue1']!;
    const zoom = (await editor.zoomPercent()) / 100;
    const at = await editor.centre(editor.node('Queue queue1'));

    await dragBetween(page, at, { x: at.x + 90, y: at.y + 60 });

    await expect.poll(async () => (await editor.layout())['queue1']!.x).not.toBe(before.x);
    const after = (await editor.layout())['queue1']!;
    expect(Math.abs(after.x - before.x - 90 / zoom)).toBeLessThanOrEqual(2 / zoom);
    expect(Math.abs(after.y - before.y - 60 / zoom)).toBeLessThanOrEqual(2 / zoom);

    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect.poll(async () => (await editor.layout())['queue1']).toEqual(before);
  });

  test('moves a node with M and the arrow keys, ten units a step, as one step', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.select('Queue queue1');
    const before = (await editor.layout())['queue1']!;

    await page.keyboard.press('m');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('m');

    await expect.poll(async () => (await editor.layout())['queue1']).toEqual({ x: before.x + 20, y: before.y + 10 });
    await expect(page.getByRole('button', { name: /^Undo/ })).toBeEnabled();
  });

  test('moves a node with the numbers of the inspector, which is how it is moved without dragging', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');

    await page.getByRole('spinbutton', { name: 'X' }).fill('500');
    await page.getByRole('spinbutton', { name: 'Y' }).fill('-40');
    await page.getByRole('spinbutton', { name: 'Y' }).press('Tab');

    await expect.poll(async () => (await editor.layout())['queue1']).toEqual({ x: 500, y: -40 });
  });
});

test.describe('journey 2: deleting', () => {
  test('deletes with the Delete key, with the context menu, and with the inspector', async ({ page }) => {
    const editor = await open(page);
    for (let i = 0; i < 3; i += 1) {
      await editor.add('Queue');
    }
    await expect(page.locator('[data-node-id]')).toHaveCount(3);

    // The key.
    await editor.select('Queue queue1');
    await page.keyboard.press('Delete');
    await expect(editor.node('Queue queue1')).toHaveCount(0);
    await expect(page.getByTestId('status-message')).toHaveText('Deleted queue queue1.');

    // The context menu.
    const at = await editor.centre(editor.node('Queue queue2'));
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menuitem', { name: /Delete/ }).click();
    await expect(editor.node('Queue queue2')).toHaveCount(0);

    // The inspector.
    await editor.select('Queue queue3');
    await page.getByRole('button', { name: 'Delete queue queue3' }).click();
    await expect(page.locator('[data-node-id]')).toHaveCount(0);
    await expect(page.getByTestId('inspector-empty')).toBeVisible();
    expect(await editor.layout()).toEqual({});
  });

  test('deletes with the key the node that was just added, which the editor selects and the library has to select as well', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.add('Queue');
    await editor.flow.focus();

    await page.keyboard.press('Delete');

    await expect(editor.node('Queue queue2')).toHaveCount(0);
    await expect(editor.node('Queue queue1')).toBeVisible();
  });

  test('opens the context menu from the keyboard, for what is selected, and deletes from it, and Escape gives the focus back', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.add('Queue');
    await editor.select('Queue queue1');

    await page.keyboard.press('Shift+F10');
    await expect(page.getByRole('menu', { name: 'Actions for queue queue1' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Rename/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(editor.flow).toBeFocused();

    await page.keyboard.press('ContextMenu');
    await expect(page.getByRole('menuitem', { name: /Rename/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /Link to…/ })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: /Delete/ })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(editor.node('Queue queue1')).toHaveCount(0);
    await expect(editor.node('Queue queue2')).toBeVisible();
    await expect(editor.flow).toBeFocused();
  });

  test('deletes an edge with the key, and a node with the edges that were on it as one step', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Fanout exchange');
    await editor.add('Queue');
    // Link them with the keyboard: select the exchange, L, Enter. A fanout ignores the key, so the binding is made at once.
    await editor.select('Exchange exchange1, fanout');
    await page.keyboard.press('l');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(1);

    await editor.select('Queue queue1');
    await page.keyboard.press('Delete');

    await expect(editor.node('Queue queue1')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(0);
    await page.getByRole('button', { name: /^Undo/ }).click();
    await expect(editor.node('Queue queue1')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(1);
  });
});

test.describe('journey 2: undo and redo', () => {
  test('take back and put back what was added and renamed, with the buttons and with the keys', async ({ page }) => {
    const editor = await open(page);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await editor.add('Queue');
    await editor.select('Queue queue1');
    await editor.renameSelected('Queue queue1', 'orders');
    await expect(editor.node('Queue orders')).toBeVisible();

    // The buttons say what they take back.
    await expect(page.getByRole('button', { name: /^Undo: renamed/ })).toBeEnabled();
    await page.getByRole('button', { name: /^Undo: renamed/ }).click();
    await expect(editor.node('Queue queue1')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Redo: renamed/ })).toBeEnabled();
    await page.getByRole('button', { name: 'Undo: added queue queue1' }).click();
    await expect(page.locator('[data-node-id]')).toHaveCount(0);

    // The keys do the same, and Ctrl+Shift+Z and Ctrl+Y are both redo.
    await page.keyboard.press('Control+Shift+z');
    await expect(editor.node('Queue queue1')).toBeVisible();
    await page.keyboard.press('Control+y');
    await expect(editor.node('Queue orders')).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(editor.node('Queue queue1')).toBeVisible();
  });
});

test.describe('journey 2: arranging and looking', () => {
  test('arranges the nodes in their places and shows all of them, however far one had been put', async ({ page }) => {
    const editor = await open(page);
    for (const item of ['Producer', 'Direct exchange', 'Queue', 'Consumer']) {
      await editor.add(item);
    }
    await page.getByRole('spinbutton', { name: 'X' }).fill('6000');
    await page.getByRole('spinbutton', { name: 'X' }).press('Tab');
    await expect.poll(async () => (await editor.layout())['consumer1']!.x).toBe(6000);

    await page.getByRole('button', { name: 'Auto-layout' }).click();

    await expect.poll(() => allNodesInside(page, editor, 39)).toBe(true);
    expect((await editor.layout())['consumer1']!.x).toBeLessThan(6000);
    await expect(page.getByRole('button', { name: 'Undo: arranged the canvas' })).toBeEnabled();
  });

  test('zooms with the buttons and with the keys, resets to 100%, and fits all of it, never closer than 100%', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Producer');
    await editor.add('Consumer');
    await editor.select('Producer producer1');
    await editor.settled();
    const start = await editor.zoomPercent();

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => editor.zoomPercent()).toBeGreaterThan(start);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await expect.poll(() => editor.zoomPercent()).toBe(start);

    await page.getByRole('button', { name: /^Reset the zoom to 100%/ }).click();
    await expect.poll(() => editor.zoomPercent()).toBe(100);

    // The keys of the library, with the canvas focused: + zooms in, 0 goes back to 100%.
    await editor.flow.focus();
    await page.keyboard.press('+');
    await expect.poll(() => editor.zoomPercent()).toBeGreaterThan(100);
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await page.keyboard.press('0');
    await expect.poll(() => editor.zoomPercent()).toBe(100);

    // Fit shows everything, and never closer than 100%: with the canvas zoomed in a long way, it zooms out.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('+');
    }
    await expect.poll(() => editor.zoomPercent()).toBeGreaterThan(120);
    await page.keyboard.press('f');
    await expect.poll(() => editor.zoomPercent()).toBeLessThanOrEqual(100);
    await expect.poll(() => allNodesInside(page, editor, 39)).toBe(true);

    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Fit' }).click();
    await expect.poll(() => editor.zoomPercent()).toBeLessThanOrEqual(100);
    await expect.poll(() => allNodesInside(page, editor, 39)).toBe(true);
  });
});

test.describe('journey 2: how far it zooms', () => {
  test('fits one small node at 100%, and does not blow it up to fill the canvas', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    // The canvas fits what it has drawn once the node is there, and a zoom that came before it would be undone by it.
    await expect(editor.node('Queue queue1')).toBeVisible();
    await editor.settled();
    await editor.flow.focus();
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('+');
    }
    await expect.poll(() => editor.zoomPercent()).toBeGreaterThan(100);

    await page.keyboard.press('f');

    await expect.poll(() => editor.zoomPercent()).toBe(100);
  });

  test('zooms out to 25% and in to 200%, and no further, with the buttons', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');

    for (let i = 0; i < 20; i += 1) {
      await page.getByRole('button', { name: 'Zoom out' }).click();
    }
    await expect.poll(() => editor.zoomPercent()).toBe(25);

    for (let i = 0; i < 30; i += 1) {
      await page.getByRole('button', { name: 'Zoom in' }).click();
    }
    await expect.poll(() => editor.zoomPercent()).toBe(200);
  });
});

test.describe('journey 2: panning', () => {
  test('pans when the empty canvas is dragged, which is not a step of undo, and zooms with the wheel', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await editor.settled();
    const layout = await editor.layout();
    const before = await editor.centre(editor.node('Queue queue1'));
    const bounds = (await editor.flow.boundingBox())!;
    const emptySpot = { x: bounds.x + 60, y: bounds.y + bounds.height - 60 };

    await dragBetween(page, emptySpot, { x: emptySpot.x + 120, y: emptySpot.y - 40 });

    await expect
      .poll(async () => {
        const at = await editor.centre(editor.node('Queue queue1'));
        return Math.round(Math.hypot(at.x - (before.x + 120), at.y - (before.y - 40)));
      })
      .toBeLessThanOrEqual(6);
    expect(await editor.layout()).toEqual(layout);
    await expect(page.getByRole('button', { name: 'Undo: added queue queue1' })).toBeEnabled();

    const zoom = await editor.zoomPercent();
    const middle = await editor.centre(editor.flow);
    await page.mouse.move(middle.x, middle.y);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => editor.zoomPercent()).toBeGreaterThan(zoom);
  });
});

test.describe('journey 2: keeping what was done', () => {
  test('opens the same canvas, with the same names and places, when the page is opened again', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Producer');
    await editor.add('Topic exchange');
    await editor.add('Queue');
    await editor.select('Queue queue1');
    await editor.renameSelected('Queue queue1', 'orders');
    await expect(editor.node('Queue orders')).toBeVisible();
    await page.getByRole('spinbutton', { name: 'X' }).fill('420');
    await page.getByRole('spinbutton', { name: 'X' }).press('Tab');
    await expect.poll(async () => (await editor.saved())?.layout.nodes['q1']?.x).toBe(420);
    await expect(editor.saveState).toHaveText('All changes saved');

    await page.reload();
    await editor.heading.waitFor();
    await expect(editor.saveState).toHaveText('All changes saved');

    for (const label of ['Producer producer1', 'Exchange exchange1, topic', 'Queue orders']) {
      await expect(editor.node(label)).toBeVisible();
    }
    expect((await editor.layout())['orders']!.x).toBe(420);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});

test.describe('journey 2: opening what was kept', () => {
  test('shows all of a canvas when it is opened, however far apart its nodes were put', async ({ page }) => {
    await seedCanvas(
      page,
      buildDocument([
        { type: 'declare-queue', name: 'near', durable: true },
        { type: 'declare-queue', name: 'far', durable: true },
        { type: 'move', target: { kind: 'queue', name: 'near' }, x: 0, y: 0 },
        { type: 'move', target: { kind: 'queue', name: 'far' }, x: 6000, y: 3000 },
      ]),
    );
    const editor = new EditorPage(page);

    await editor.goto();
    await page.locator('rmq-flow-canvas[data-ready]').waitFor();

    await expect.poll(() => allNodesInside(page, editor, 39)).toBe(true);
    expect(await editor.zoomPercent()).toBeLessThan(100);
  });
});

test.describe('journey 2: themes', () => {
  test('draws each kind in its colour, in the theme that is chosen, and each in a shape of its own', async ({
    page,
  }) => {
    const editor = await open(page);
    for (const item of ['Producer', 'Direct exchange', 'Queue', 'Consumer']) {
      await editor.add(item);
    }
    // Nothing selected, so that every outline is in the colour of its kind and not in the accent.
    await editor.select('Queue queue1');
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => window.__rmq?.selection().nodes.length)).toBe(0);
    const stroke = (kind: string) =>
      page.locator(`[data-kind="${kind}"] .rmq-node-outline`).evaluate((element) => getComputedStyle(element).stroke);

    await editor.theme.selectOption('light');
    const light = {
      queue: await stroke('queue'),
      producer: await stroke('producer'),
      exchange: await stroke('exchange'),
    };
    await editor.theme.selectOption('dark');
    const dark = {
      queue: await stroke('queue'),
      producer: await stroke('producer'),
      exchange: await stroke('exchange'),
    };

    expect(light.queue).toBe('rgb(0, 128, 106)');
    expect(dark.queue).toBe('rgb(0, 181, 138)');
    expect(new Set([light.queue, light.producer, light.exchange]).size).toBe(3);
    expect(new Set([dark.queue, dark.producer, dark.exchange]).size).toBe(3);

    const outlines = await page
      .locator('[data-node-id] .rmq-node-outline')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('d')));
    expect(new Set(outlines).size).toBe(4);
  });
});
