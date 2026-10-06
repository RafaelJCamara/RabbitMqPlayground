import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor-page';
import { seedCanvas } from './support/seed';
import { TOPOLOGY } from './support/topology';
import { expect, test } from './support/test';

/**
 * How a learner is told what to do (ADR-0010, ADR-0035, ADR-0047): the card of the first run, the cheat-sheet, the hint bar, and the whole of a link made and a node created
 * with a keyboard and nothing else. Nothing sets the app into a state: it does what a learner does.
 */

async function open(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  return editor;
}

test.describe('the card of the first run (ADR-0047)', () => {
  test('is shown under the top bar on a canvas that has no edge: the five ways to link and what the command bar does', async ({
    page,
  }) => {
    const editor = await open(page);

    await expect(editor.howToLink).toBeVisible();
    await expect(editor.howToLink.getByRole('listitem')).toHaveText([
      'Drag from the dot on the right of a node',
      'Click the dot, then click the target',
      'Press Link to… in the inspector',
      'Right-click a node and choose Link to…',
      'Select a node and press L',
    ]);
    await expect(editor.howToLink).toContainText(
      'The command bar (/) does the same with a line, for example bind orders -> billing.',
    );
    const bar = (await page.getByRole('banner').boundingBox())!;
    const card = (await editor.howToLink.boundingBox())!;
    const main = (await editor.canvas.boundingBox())!;
    expect(card.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    expect(main.y).toBeGreaterThanOrEqual(card.y + card.height - 1);
  });

  test('takes no focus, so that a learner who types or tabs is not stopped by it', async ({ page }) => {
    await open(page);

    expect(await page.evaluate(() => document.activeElement?.closest('[aria-label="How to link"]'))).toBeNull();
  });

  test('is gone for good when it is dismissed, which the browser keeps', async ({ page }) => {
    const editor = await open(page);

    await editor.howToLink.getByRole('button', { name: 'Got it' }).click();

    await expect(editor.howToLink).toHaveCount(0);
    await page.reload();
    await editor.heading.waitFor();
    await expect(editor.howToLink).toHaveCount(0);
    expect(await page.evaluate(() => window.localStorage.getItem('rmq.how-to-link'))).toBe('dismissed');
  });

  test('is gone for good when the learner makes an edge, by whatever way, and does not come back when it is undone', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.openCommandBar();
    await editor.runCommand('declare exchange orders type=fanout; declare queue billing');
    await expect(editor.howToLink).toBeVisible();

    await editor.runCommand('bind orders -> billing');
    await expect(editor.howToLink).toHaveCount(0);
    await editor.runCommand('undo');
    await expect.poll(() => editor.edges()).toEqual([]);

    await expect(editor.howToLink).toHaveCount(0);
    await page.reload();
    await editor.heading.waitFor();
    await expect(editor.howToLink).toHaveCount(0);
  });

  test('is not shown for a canvas that has an edge already, which is not a reason to dismiss it for good', async ({
    page,
  }) => {
    await seedCanvas(page, TOPOLOGY);
    const editor = await open(page);
    await expect(editor.howToLink).toHaveCount(0);

    expect(await page.evaluate(() => window.localStorage.getItem('rmq.how-to-link'))).toBeNull();
  });
});

test.describe('the cheat-sheet (ADR-0047)', () => {
  const dialog = (page: Page) => page.getByRole('dialog', { name: 'Keyboard shortcuts and commands' });

  test('opens with ? on the canvas, and lists the five ways, every key and every command', async ({ page }) => {
    const editor = await open(page);
    await editor.flow.focus();

    await page.keyboard.press('Shift+?');

    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toHaveAttribute('aria-modal', 'true');
    await expect(dialog(page).getByRole('list', { name: 'Five ways to link' }).getByRole('listitem')).toHaveCount(5);
    const keys = dialog(page).getByRole('table', { name: 'Keys' });
    await expect(keys.getByRole('row')).toHaveCount(14);
    await expect(keys).toContainText('Ctrl+K');
    await expect(keys).toContainText('Anywhere in the editor, even in a field of text');
    await expect(dialog(page).getByRole('table', { name: 'Commands' }).getByRole('row')).toHaveCount(23);
    await expect(dialog(page)).toContainText('Type help in the command bar to say more about a command.');
  });

  test('keeps the cursor inside while it is open, which Tab cannot leave, and gives it back to the canvas on Escape', async ({
    page,
  }) => {
    const editor = await open(page);
    await editor.flow.focus();
    await page.keyboard.press('Shift+?');
    await expect(dialog(page)).toBeVisible();

    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null)).toBe(true);
    }
    await page.keyboard.press('Escape');

    await expect(dialog(page)).toHaveCount(0);
    await expect(editor.flow).toBeFocused();
  });

  test('opens with the Help button of the top bar, wherever the cursor is, and gives it back to the button when it closes', async ({
    page,
  }) => {
    await open(page);
    const help = page.getByRole('button', { name: 'Help' });

    await help.click();
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Close' }).click();

    await expect(dialog(page)).toHaveCount(0);
    await expect(help).toBeFocused();
  });

  test('is not opened by a ? that is typed into a field, where it is a character', async ({ page }) => {
    const editor = await open(page);
    await editor.add('Queue');
    await page.getByRole('textbox', { name: 'Name' }).focus();

    await page.keyboard.press('Shift+?');

    await expect(dialog(page)).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('queue1?');
  });
});

test.describe('the hint bar (ADR-0035)', () => {
  test('says that / opens the commands and ? the shortcuts, whatever is selected, and what the keys do for what is', async ({
    page,
  }) => {
    const editor = await open(page);
    await expect(editor.hints).toContainText('/ Commands');
    await expect(editor.hints).toContainText('? Shortcuts');

    await editor.add('Queue');

    await expect(editor.hints).toContainText('/ Commands');
    await expect(editor.hints).toContainText('? Shortcuts');
    await expect(editor.hints).toContainText('F2 Rename');
  });
});

test.describe('a keyboard and nothing else (journey 3 of the plan)', () => {
  test('creates the four kinds of node and links them from end to end, with no press of a pointer', async ({
    page,
  }) => {
    // Every press of a pointer or a finger is counted, and there must be none: the keys do all of it.
    await page.addInitScript(() => {
      const presses: string[] = [];
      (window as unknown as { __presses: string[] }).__presses = presses;
      for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
        window.addEventListener(type, (event) => presses.push(`${type} on ${(event.target as Element).tagName}`), true);
      }
    });
    const editor = await open(page);
    const focused = () =>
      page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        return element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? '';
      });
    const live = page.locator('body > [role="status"][aria-live="polite"]');
    /** An arrow key goes to the nearest node or edge in its direction, so it may take a second press, over an edge that lies between, to reach a node. */
    const goTo = async (key: string, id: string) => {
      for (let press = 0; press < 4; press += 1) {
        await page.keyboard.press(key);
        const selected = await page.evaluate(() => window.__rmq?.selection());
        if (selected?.nodes.length === 1 && selected.nodes[0] === id) {
          await editor.drawnFor(editor.nodeById(id), id);
          return;
        }
      }
      throw new Error(`the arrow keys did not reach ${id}`);
    };

    // The toolbox is one tab stop, and its arrow keys go from item to item.
    for (let press = 0; press < 30 && (await focused()) !== 'Producer'; press += 1) {
      await page.keyboard.press('Tab');
    }
    expect(await focused()).toBe('Producer');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toBe('Direct exchange');
    await page.keyboard.press('Enter');
    for (let press = 0; press < 4; press += 1) {
      await page.keyboard.press('ArrowDown');
    }
    await expect.poll(focused).toBe('Queue');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focused).toBe('Consumer');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-node-id]')).toHaveCount(4);

    // On the canvas, the arrow keys go from node to node, and L starts a link, which Enter makes.
    await page.keyboard.press('Tab');
    await expect(editor.flow).toBeFocused();
    for (let press = 0; press < 3; press += 1) {
      await page.keyboard.press('ArrowLeft');
    }
    await expect(live).toHaveText(/^Producer producer1/);
    await editor.drawnFor(editor.nodeById('p1'), 'p1');
    await page.keyboard.press('l');
    await expect(live).toHaveText(/^Target 1 of 2: exchange exchange1/);
    await page.keyboard.press('Enter');
    await expect.poll(() => editor.edges()).toEqual(['producer1 -> exchange1']);

    await goTo('ArrowRight', 'x1');
    await page.keyboard.press('l');
    await page.keyboard.press('ArrowRight');
    await expect(live).toHaveText(/^Target \d+ of \d+: queue queue1/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
    await page.keyboard.type('eu');
    await page.keyboard.press('Enter');
    await expect.poll(() => editor.edges()).toEqual(['exchange1 -> queue1 key=eu', 'producer1 -> exchange1']);

    await expect(editor.flow).toBeFocused();
    await goTo('ArrowRight', 'q1');
    await page.keyboard.press('l');
    await expect(live).toHaveText(/^Target 1 of 1: consumer consumer1/);
    await page.keyboard.press('Enter');

    await expect
      .poll(() => editor.edges())
      .toEqual(['consumer1 <- queue1', 'exchange1 -> queue1 key=eu', 'producer1 -> exchange1']);
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(3);
    expect(await page.evaluate(() => (window as unknown as { __presses: string[] }).__presses)).toEqual([]);
    await expect(editor.howToLink).toHaveCount(0);
  });

  test('does the same with the command bar, from / to the last Enter', async ({ page }) => {
    await page.addInitScript(() => {
      const presses: string[] = [];
      (window as unknown as { __presses: string[] }).__presses = presses;
      for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
        window.addEventListener(type, (event) => presses.push(`${type} on ${(event.target as Element).tagName}`), true);
      }
    });
    const editor = await open(page);
    await editor.flow.focus();

    await page.keyboard.press('/');
    await expect(editor.commandField).toBeFocused();
    for (const line of [
      'declare exchange orders type=topic',
      'declare queue billing',
      'bind orders -> billing key=#',
    ]) {
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
      await expect(editor.commandField).toHaveValue('');
    }
    await page.keyboard.press('Escape');

    await expect.poll(() => editor.edges()).toEqual(['orders -> billing key=#']);
    await expect(editor.flow).toBeFocused();
    expect(await page.evaluate(() => (window as unknown as { __presses: string[] }).__presses)).toEqual([]);
  });
});
