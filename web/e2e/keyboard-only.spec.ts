import type { Page } from '@playwright/test';
import { EditorPage } from './pages/editor-page';
import { withoutPointer } from './support/no-pointer';
import { expect, test } from './support/test';

/**
 * Journey 12 of the plan, with the keyboard and nothing else (ADR-0017, ADR-0085): from an empty canvas to a message that was published, stepped and read, and the two rules of ADR-0017 that make
 * the single keys safe, which are that a single key does nothing in a text field (WCAG 2.1.4) and that Ctrl or Cmd with M does not pick a node up. The page that these tests are given throws on any call of the pointer
 * (`mouse`, `click`, `hover`, `tap`, `dragTo`), so a test that reaches for it fails instead of passing (no-pointer.ts).
 */

const focused = (page: Page) =>
  page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    return element?.getAttribute('aria-label') ?? element?.textContent?.trim() ?? '';
  });

/** What the page says aloud, politely: the announcements of the canvas and of the editor. */
const live = (page: Page) => page.locator('body > [role="status"][aria-live="polite"]');

/** Adds a queue with the toolbox, which is one tab stop: Tab to its first item, and the arrow keys go down it to the queue. */
async function addQueue(page: Page): Promise<void> {
  await tabTo(page, 'Producer');
  for (let press = 0; press < 5; press += 1) {
    await page.keyboard.press('ArrowDown');
  }
  await expect.poll(() => focused(page)).toBe('Queue');
  await page.keyboard.press('Enter');
}

/** Tab until the control with this name has the cursor, which also holds that it can be reached. */
async function tabTo(page: Page, name: string): Promise<void> {
  for (let press = 0; press < 40 && (await focused(page)) !== name; press += 1) {
    await page.keyboard.press('Tab');
  }
  expect(await focused(page), `Tab reaches ${name}`).toBe(name);
}

/** An arrow key goes to the nearest node or edge in its direction, so it may take a second press, over an edge that lies between, to reach a node. */
async function goTo(page: Page, editor: EditorPage, key: string, id: string): Promise<void> {
  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press(key);
    const selected = await page.evaluate(() => window.__rmq?.selection());
    if (selected?.nodes.length === 1 && selected.nodes[0] === id) {
      await editor.drawnFor(editor.nodeById(id), id);
      return;
    }
  }
  throw new Error(`the arrow keys did not reach ${id}`);
}

test.describe('journey 12: a keyboard and nothing else (ADR-0017, ADR-0085)', () => {
  test('creates, links with L and the arrows, binds, publishes with P, steps, and reads what was said, and the page is never touched with a pointer', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    const release = withoutPointer(page);
    try {
      // The toolbox is one tab stop, and its arrow keys go from item to item.
      await tabTo(page, 'Producer');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => focused(page)).toBe('Direct exchange');
      await page.keyboard.press('Enter');
      for (let press = 0; press < 4; press += 1) {
        await page.keyboard.press('ArrowDown');
      }
      await expect.poll(() => focused(page)).toBe('Queue');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => focused(page)).toBe('Consumer');
      await page.keyboard.press('Enter');
      await expect(page.locator('[data-node-id]')).toHaveCount(4);

      // On the canvas the arrow keys go from node to node, and L starts a link, which Enter makes.
      await page.keyboard.press('Tab');
      await expect(editor.flow).toBeFocused();
      for (let press = 0; press < 3; press += 1) {
        await page.keyboard.press('ArrowLeft');
      }
      await expect(live(page)).toHaveText(/^Producer producer1/);
      await editor.drawnFor(editor.nodeById('p1'), 'p1');
      await page.keyboard.press('l');
      await expect(live(page)).toHaveText(/^Target 1 of 2: exchange exchange1/);
      await page.keyboard.press('Enter');
      await expect.poll(() => editor.edges()).toEqual(['producer1 -> exchange1']);

      await goTo(page, editor, 'ArrowRight', 'x1');
      await page.keyboard.press('l');
      await page.keyboard.press('ArrowRight');
      await expect(live(page)).toHaveText(/^Target \d+ of \d+: queue queue1/);
      await page.keyboard.press('Enter');
      // A binding asks for its key first, in a popover that has the cursor, and nothing is made until Enter.
      await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
      await page.keyboard.type('eu');
      await page.keyboard.press('Enter');
      await expect.poll(() => editor.edges()).toEqual(['exchange1 -> queue1 key=eu', 'producer1 -> exchange1']);

      await expect(editor.flow).toBeFocused();
      await goTo(page, editor, 'ArrowRight', 'q1');
      await page.keyboard.press('l');
      await expect(live(page)).toHaveText(/^Target 1 of 1: consumer consumer1/);
      await page.keyboard.press('Enter');
      await expect
        .poll(() => editor.edges())
        .toEqual(['consumer1 <- queue1', 'exchange1 -> queue1 key=eu', 'producer1 -> exchange1']);

      // The clock is stopped, so that a message waits for the step that is asked for, and the producer sends the message that it has with P.
      await page.keyboard.press('Space');
      await expect(page.getByTestId('status-message')).toHaveText('Paused.');
      await goTo(page, editor, 'ArrowLeft', 'p1');
      // The producer sends nothing to a key that the exchange does not bind, so the message it has is given the key of the binding.
      await page.keyboard.press('p');
      await expect(page.getByTestId('status-message')).toHaveText(/^Published /);
      await page.keyboard.press('.');
      await expect(page.getByTestId('status-message')).not.toHaveText(/^Published /);

      // What was said is on the page, in the log that E opens, and nothing of it needed a pointer.
      await page.keyboard.press('e');
      await expect(page.getByRole('region', { name: 'Event log' })).toBeVisible();
      await expect(page.getByTestId('event-log-row').first()).toBeVisible();
    } finally {
      release();
    }
  });

  test('does nothing for a single key in a text field: the name of a node, the command bar and a field of the inspector get the text and the page gets nothing', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    const release = withoutPointer(page);
    try {
      await addQueue(page);
      await expect(page.locator('[data-node-id]')).toHaveCount(1);
      const before = { edges: await editor.edges(), layout: await editor.layout(), document: await editor.document() };
      const keys = 'lmpef.?z0+-';

      // The name field of the inspector: Enter on the canvas edits the selected node there.
      await page.keyboard.press('Tab');
      await expect(editor.flow).toBeFocused();
      await page.keyboard.press('Enter');
      const name = page.getByRole('textbox', { name: 'Name', exact: true });
      await expect(name).toBeFocused();
      await page.keyboard.press('Control+a');
      await page.keyboard.type(keys);
      await expect(name).toHaveValue(keys);
      await expect(live(page)).not.toHaveText(/^Target /);
      await page.keyboard.press('Escape');

      // The field of the command bar takes them too: it is opened with the slash, which is the first of the single keys.
      await editor.flow.focus();
      await page.keyboard.press('/');
      await expect(editor.commandField).toBeFocused();
      await page.keyboard.type(keys);
      await expect(editor.commandField).toHaveValue(keys);
      await page.keyboard.press('Escape');

      expect(await editor.edges(), 'no key of the page linked anything').toEqual(before.edges);
      // The name is the text that was typed, so the node is found by where it is: the one node is where it was.
      expect(Object.values(await editor.layout()), 'no key of the page moved a node').toEqual(
        Object.values(before.layout),
      );
      expect(
        await page.evaluate(() => window.__rmq?.intents().filter((i) => (i as { type: string }).type === 'move')),
      ).toEqual([]);
    } finally {
      release();
    }
  });

  for (const chord of ['Control+m', 'Meta+m']) {
    test(`does not pick a node up for ${chord}, so the arrow keys that follow move the cursor and not the node`, async ({
      page,
    }) => {
      const editor = new EditorPage(page);
      await editor.goto();
      const release = withoutPointer(page);
      try {
        await addQueue(page);
        await page.keyboard.press('Tab');
        await expect(editor.flow).toBeFocused();
        const before = await editor.layout();

        await page.keyboard.press(chord);
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Escape');

        expect(await editor.layout(), `${chord} must not start a move`).toEqual(before);
        expect(
          await page.evaluate(() => window.__rmq?.intents().some((i) => (i as { type: string }).type === 'move')),
        ).toBe(false);
      } finally {
        release();
      }
    });
  }
});
