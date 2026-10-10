import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor-page';
import { expect, test } from './support/test';

/**
 * Journey 4 of the plan: the command bar (ADR-0011, ADR-0045, ADR-0046). It opens with `/` and Ctrl+K, completes what the parser would accept, keeps the lines that were given,
 * suggests what to do next, helps, and says where and why a line cannot be read. A typed line goes through the door that a gesture does, so the last test types the equivalent
 * command of everything that a learner did with the pointer and the keys, in another browser that starts empty, and holds the two documents to be the same.
 */

async function open(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  return editor;
}

const completions = (page: Page) => page.getByRole('listbox', { name: 'Completions' }).getByRole('option');
const refusal = (page: Page) => page.getByTestId('command-answer');

/** Drags from one point of the page to another, with a first move that is over the threshold of a drag. */
async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

test.describe('journey 4: opening the command bar', () => {
  test('opens with / on the canvas, with the cursor in its field, and closes with Escape, which gives the canvas the cursor again', async ({
    page,
  }) => {
    const editor = await open(page);
    await expect(editor.commandBar.getByRole('button', { name: 'Commands' })).toHaveAttribute('aria-expanded', 'false');

    await editor.openCommandBar();

    await expect(editor.commandBar.getByRole('button', { name: 'Commands' })).toHaveAttribute('aria-expanded', 'true');
    await expect(editor.commandField).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(editor.commandField).toHaveCount(0);
    await expect(editor.flow).toBeFocused();
  });

  test('opens with Ctrl+K from anywhere in the editor, and from a field of text, where / is typed', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.add('Queue');

    await page.getByRole('button', { name: 'Topic exchange' }).focus();
    await page.keyboard.press('Control+k');
    await expect(editor.commandField).toBeFocused();
    await page.keyboard.press('Escape');

    await page.getByRole('textbox', { name: 'Name' }).focus();
    await page.keyboard.press('/');
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('queue1/');
    await page.keyboard.press('Control+k');
    await expect(editor.commandField).toBeFocused();
  });

  test('closes with Ctrl+K again, from the field, keeps the line that was typed, and gives the cursor to the canvas', async ({
    page,
  }) => {
    const editor = await open(page);

    await page.keyboard.press('Control+k');
    await expect(editor.commandField).toBeFocused();
    await page.keyboard.type('declare queue jobs');
    await page.keyboard.press('Control+k');

    await expect(editor.commandField).toHaveCount(0);
    await expect(editor.flow).toBeFocused();

    await page.keyboard.press('Control+k');
    await expect(editor.commandField).toBeFocused();
    await expect(editor.commandField).toHaveValue('declare queue jobs');

    await page.getByRole('button', { name: 'Run' }).focus();
    await page.keyboard.press('Control+k');
    await expect(editor.commandField).toHaveCount(0);
    await expect(editor.flow).toBeFocused();
  });

  test('opens with its button, which says what it holds when it is closed: the latest equivalent command', async ({
    page,
  }) => {
    const editor = await open(page);
    await expect(editor.commandBar).toContainText(
      'Each change you make appears here as the command that does the same.',
    );

    await editor.add('Queue');

    await expect(editor.commandBar.getByTestId('latest-command')).toContainText('declare queue queue1');
    await editor.commandBar.getByRole('button', { name: 'Commands' }).click();
    await expect(editor.commandField).toBeFocused();
  });
});

test.describe('journey 4: typing commands', () => {
  test('builds a topology from typed lines, as the canvas draws it, and says what each did', async ({ page }) => {
    const editor = await open(page);
    await editor.openCommandBar();

    for (const line of [
      'declare exchange orders type=direct',
      'declare queue billing',
      'add producer sender',
      'add consumer worker',
      'bind orders -> billing key=eu',
      'link sender -> orders',
      'subscribe worker billing',
    ]) {
      await editor.runCommand(line);
    }

    await expect
      .poll(() => editor.edges())
      .toEqual(['orders -> billing key=eu', 'sender -> orders', 'worker <- billing']);
    await expect(page.locator('[data-node-id]')).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(3);
    await expect(page.getByTestId('status-message')).toHaveText('Subscribed consumer worker to queue billing.');
    await expect(editor.howToLink).toHaveCount(0);
    expect(await editor.log()).toHaveLength(7);
  });

  test('is one step of undo for a line of several commands, and undo and redo are lines too', async ({ page }) => {
    const editor = await open(page);
    await editor.openCommandBar();

    await editor.runCommand(
      'declare exchange orders type=direct; declare queue billing; bind orders -> billing key=eu',
    );
    await expect.poll(() => editor.edges()).toEqual(['orders -> billing key=eu']);

    await editor.runCommand('undo');
    await expect.poll(() => editor.edges()).toEqual([]);
    await expect(page.locator('[data-node-id]')).toHaveCount(0);
    await editor.runCommand('redo');
    await expect(page.locator('[data-node-id]')).toHaveCount(2);
    expect(await editor.log()).toEqual([
      'declare exchange orders type=direct; declare queue billing; bind orders -> billing key=eu',
      'undo',
      'redo',
    ]);
  });

  test('completes what the parser would accept, with Tab, a word at a time, and says which kind each name is', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    await editor.runCommand('declare exchange orders type=direct; declare queue billing; declare queue archive');

    await page.keyboard.type('bi');
    await expect(completions(page)).toHaveText([/^bind/]);
    await expect(editor.commandField).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Tab');
    await expect(editor.commandField).toHaveValue('bind ');
    await expect(completions(page)).toHaveText([/^orders\s*exchange$/]);
    await page.keyboard.press('Tab');
    await expect(editor.commandField).toHaveValue('bind orders ');
    await page.keyboard.press('Tab');
    await expect(editor.commandField).toHaveValue('bind orders -> ');
    await expect(completions(page)).toHaveText([/^orders/, /^billing/, /^archive/]);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(editor.commandField).toHaveValue('bind orders -> billing ');
    await page.keyboard.type('ke');
    await page.keyboard.press('Tab');
    await expect(editor.commandField).toHaveValue('bind orders -> billing key=');
    await page.keyboard.type('eu');
    await page.keyboard.press('Enter');

    await expect.poll(() => editor.edges()).toEqual(['orders -> billing key=eu']);
    await expect(editor.commandField).toHaveValue('');
  });

  test('closes the list with Escape first, and the bar with the next', async ({ page }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    await page.keyboard.type('de');
    await expect(completions(page).first()).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(completions(page)).toHaveCount(0);
    await expect(editor.commandField).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(editor.commandField).toHaveCount(0);
  });

  test('suggests what to do next while the field is empty, as lines that are put in the field and not run, until the canvas is wired', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    const suggestions = page.getByRole('group', { name: 'Try one of these' });
    await expect(suggestions.getByRole('button')).toHaveText([
      'declare exchange orders type=direct',
      'declare queue billing',
      'add producer sender',
      'add consumer worker',
    ]);

    for (const line of [
      'declare exchange orders type=direct',
      'declare queue billing',
      'add producer sender',
      'add consumer worker',
    ]) {
      await suggestions.getByRole('button', { name: `Put ${line} in the field` }).click();
      await expect(editor.commandField).toHaveValue(line);
      expect(await editor.edges(), 'a suggestion is not run').toEqual([]);
      await page.keyboard.press('Enter');
    }
    await expect(suggestions.getByRole('button')).toHaveText([
      'bind orders -> billing key=billing',
      'link sender -> orders',
      'subscribe worker billing',
    ]);
    for (const line of ['bind orders -> billing key=billing', 'link sender -> orders', 'subscribe worker billing']) {
      await suggestions.getByRole('button', { name: `Put ${line} in the field` }).click();
      await page.keyboard.press('Enter');
    }

    await expect(suggestions).toHaveCount(0);
    await expect
      .poll(() => editor.edges())
      .toEqual(['orders -> billing key=billing', 'sender -> orders', 'worker <- billing']);
  });

  test('keeps the lines that were given, for the next visit too, and walks them with the arrow keys', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    await editor.runCommand('declare queue first');
    await editor.runCommand('declare queue second');

    await page.keyboard.press('ArrowUp');
    await expect(editor.commandField).toHaveValue('declare queue second');
    await page.keyboard.press('ArrowUp');
    await expect(editor.commandField).toHaveValue('declare queue first');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(editor.commandField).toHaveValue('');

    await page.reload();
    await editor.heading.waitFor();
    await editor.openCommandBar();
    await page.keyboard.press('ArrowUp');
    await expect(editor.commandField).toHaveValue('declare queue second');
  });
});

test.describe('journey 4: help, and a line that cannot be read', () => {
  test('lists the commands, says what one does with its examples, and puts an example in the field', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();

    await editor.runCommand('help');
    await expect(page.getByRole('region', { name: 'Help: the commands' })).toBeVisible();
    await page.getByRole('button', { name: 'bind', exact: true }).click();

    const help = page.getByRole('region', { name: 'Help: bind' });
    await expect(help).toContainText('bind <exchange> -> <queue|exchange>');
    await help.getByRole('button', { name: /^Put bind orders -> archive key=order.# in the field$/ }).click();
    await expect(editor.commandField).toHaveValue('bind orders -> archive key=order.#');
    expect(await editor.edges()).toEqual([]);
  });

  test('keeps the text of a line that cannot be read, selects the words at fault, and says what was meant, with a button that mends it', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    await editor.runCommand('declare exchange orders type=direct; declare queue billing');

    await editor.runCommand('bnd orders -> billing key=eu');

    await expect(refusal(page).getByTestId('refusal-message')).toHaveText(
      "There is no command 'bnd'. Did you mean 'bind'?",
    );
    await expect(editor.commandField).toHaveValue('bnd orders -> billing key=eu');
    expect(
      await editor.commandField.evaluate((field: HTMLInputElement) => [field.selectionStart, field.selectionEnd]),
    ).toEqual([0, 3]);
    await expect(editor.commandField).toHaveAttribute('aria-invalid', 'true');
    // The reason is in the bar, where it was typed, and not also on the status line.
    await expect(page.getByRole('contentinfo', { name: 'Status' }).getByTestId('refusal')).toHaveCount(0);

    await page.getByRole('group', { name: 'Did you mean' }).getByRole('button', { name: 'bind' }).click();
    await expect(editor.commandField).toHaveValue('bind orders -> billing key=eu');
    await page.keyboard.press('Enter');

    await expect.poll(() => editor.edges()).toEqual(['orders -> billing key=eu']);
  });

  test('says which name was meant when one is not on the canvas, and writes a name that has a space in it as the grammar reads it', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    await editor.runCommand('declare exchange orders type=direct; declare queue "my queue"');

    await editor.runCommand('bind orders -> "my quue"');

    await expect(refusal(page).getByTestId('refusal-message')).toContainText(
      "There is no queue or exchange named 'my quue'",
    );
    await page.getByRole('group', { name: 'Did you mean' }).getByRole('button', { name: 'my queue' }).click();
    await expect(editor.commandField).toHaveValue('bind orders -> "my queue"');
  });

  test('says the root cause of a refusal first and what RabbitMQ answers after it, and changes nothing', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();

    await editor.runCommand('declare exchange amq.mine type=direct');

    const message = refusal(page).getByTestId('refusal-message');
    const reply = refusal(page).getByTestId('refusal-reply');
    await expect(message).toBeVisible();
    await expect(reply).toBeVisible();
    const order = await message.evaluate(
      (first, second) => first.compareDocumentPosition(second as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
      await reply.elementHandle(),
    );
    expect(order).toBeTruthy();
    await expect(page.locator('[data-node-id]')).toHaveCount(0);
    expect(await editor.log()).toEqual([]);
  });

  test('takes away what it said about a line when the learner types again', async ({ page }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    await editor.runCommand('frobnicate');
    await expect(refusal(page)).toBeVisible();

    await page.keyboard.type('x');

    await expect(refusal(page)).toHaveCount(0);
  });
});

test.describe('journey 4: gestures and typed commands are interchangeable', () => {
  test('names, in the log, what the learner used for each change, in the lines of the grammar', async ({ page }) => {
    const editor = await open(page);

    await editor.add('Queue');
    await page.getByRole('textbox', { name: 'Name' }).fill('billing');
    await page.getByRole('textbox', { name: 'Name' }).press('Tab');
    await page.keyboard.press('Escape');
    await editor.select('Queue billing');
    await editor.renameSelected('Queue billing', 'payments');
    await expect(editor.node('Queue payments')).toBeVisible();
    await page.getByRole('button', { name: /^Undo/ }).click();
    await editor.openCommandBar();
    await editor.runCommand('declare queue archive');
    const entries = page.getByTestId('command-log').getByRole('listitem');

    await expect(entries.locator('code')).toHaveText([
      /^declare queue queue1(; move queue1 x=-?\d+ y=-?\d+)?$/,
      'rename queue1 billing',
      'rename billing payments',
      'undo',
      'declare queue archive',
    ]);
    await expect(entries.getByTestId('origin')).toHaveText(['gesture', 'inspector', 'key', 'toolbar', 'typed']);
  });

  test('replays every logged equivalent command, typed in a browser that starts empty, to the same document, ids and places included', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const editor = await open(page);
    const topbar = (name: string | RegExp) => page.getByRole('button', { name });

    // What a learner does, with the pointer, the keys, the menus and the inspector, in the order that a learner would.
    await editor.add('Producer');
    await editor.add('Direct exchange');
    await editor.add('Queue');
    await editor.add('Consumer');
    await editor.select('Exchange exchange1, direct');
    await editor.renameSelected('Exchange exchange1, direct', 'orders');
    await editor.dragLinkTo('p1', await editor.centre(editor.nodeById('x1')));
    await expect.poll(() => editor.edges()).toEqual(['producer1 -> orders']);
    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
    await page.keyboard.type('eu');
    await page.keyboard.press('Enter');
    await expect.poll(() => editor.edges()).toHaveLength(2);
    await editor.select('Queue queue1');
    await page.getByRole('button', { name: 'Link queue queue1 to…' }).click();
    await page.getByRole('option', { name: /consumer1/ }).click();
    await expect.poll(() => editor.edges()).toHaveLength(3);

    // A node that is dragged, one that is dropped from the toolbox, and one that a link made where it was let go.
    await dragBetween(
      page,
      await editor.centre(editor.node('Queue queue1')),
      await editor.centre(editor.node('Queue queue1')).then(({ x, y }) => ({ x: x + 40, y: y + 70 })),
    );
    await expect.poll(async () => (await editor.layout())['queue1']!.y).toBeGreaterThan(0);
    const bounds = (await editor.flow.boundingBox())!;
    await dragBetween(page, await editor.centre(page.getByRole('button', { name: 'Queue', exact: true })), {
      x: bounds.x + bounds.width * 0.6,
      y: bounds.y + bounds.height * 0.8,
    });
    await expect(editor.node('Queue queue2')).toBeVisible();
    await editor.dragLinkTo('x1', { x: bounds.x + bounds.width * 0.3, y: bounds.y + bounds.height - 50 });
    await page.getByRole('menuitem', { name: 'New queue' }).click();
    await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
    await page.keyboard.type('us');
    await page.keyboard.press('Enter');
    await expect.poll(() => editor.edges()).toHaveLength(4);

    // A label that is dragged along its edge, the default exchange, a binding that is changed in the inspector and one that goes.
    const label = page.locator('[data-label="x1>q1"]');
    const at = await editor.centre(label);
    await dragBetween(page, at, { x: at.x + 36, y: at.y + 4 });
    await expect
      .poll(() =>
        page.evaluate(
          () => Object.keys((window.__rmq?.document() as { layout: { labels: object } }).layout.labels).length,
        ),
      )
      .toBe(1);
    await page.getByRole('switch', { name: 'Default exchange' }).click();
    await expect(page.getByRole('switch', { name: 'Default exchange' })).toHaveAttribute('aria-checked', 'true');
    await editor.select('Exchange orders, direct');
    await page.getByRole('combobox', { name: 'Type' }).selectOption('topic');
    await expect.poll(() => page.getByTestId('inspector-title').textContent()).toBeTruthy();

    // Undo and redo with the buttons, the layout of the toolbar, and a delete with the key.
    await topbar(/^Undo/).click();
    await topbar(/^Undo/).click();
    await topbar(/^Redo/).click();
    await page.getByRole('button', { name: 'Auto-layout' }).click();
    await editor.settled();
    await editor.select('Queue queue2');
    await page.keyboard.press('Delete');
    await expect(editor.node('Queue queue2')).toHaveCount(0);

    const lines = await editor.log();
    expect(lines.length, 'something was logged for each of those').toBeGreaterThanOrEqual(15);
    const original = await page.evaluate(() => window.__rmq?.document());

    // The same lines, typed into another browser, whose canvas is empty.
    const context = await browser.newContext({ baseURL });
    try {
      const other = await context.newPage();
      const replay = new EditorPage(other);
      await replay.goto();
      await replay.openCommandBar();
      const entries = other.getByTestId('command-log').getByRole('listitem');
      for (const [index, line] of lines.entries()) {
        await replay.runCommand(line);
        await expect(entries, `after ${line}`).toHaveCount(index + 1);
      }

      expect(await replay.log()).toEqual(lines);
      expect(await other.evaluate(() => window.__rmq?.document())).toEqual(original);
    } finally {
      await context.close();
    }
  });
});
