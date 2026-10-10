import type { Page } from '@playwright/test';
import { CanvasesPage } from './pages/canvases-page';
import { EditorPage } from './pages/editor-page';
import { seedLibrary } from './support/seed';
import { expect, test } from './support/test';

/**
 * What the learner is told when the browser runs out of room to keep the canvas (ADR-0028, ADR-0036, ADR-0037). The browser is the real
 * one, with its real IndexedDB, and the app is the real app. What cannot be made to happen in a test is the refusal itself: the
 * override of the quota that the DevTools protocol has (`Storage.overrideQuotaForOrigin`) does not make a write of a canvas fail in
 * Chromium, because a canvas is a small value that is not checked against the quota, and it does not change what `estimate()`
 * says. So the refusal is made at the boundary of the browser's API, where the browser makes it: a write throws the error that
 * the browser throws, and the estimate says what the test has chosen.
 */

interface Controls {
  __failWrites?: boolean;
  __estimate?: { usage: number; quota: number };
  __persist?: boolean;
  /** Everything that was said in the assertive live region, in order, because it holds only the last of it. */
  __said?: string[];
}

/** Puts the controls in the page before the app starts. Nothing changes until a test sets one. */
async function withBrowserThatCanRefuse(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const controls = window as unknown as Controls;
    controls.__said = [];
    new MutationObserver(() => {
      for (const region of document.querySelectorAll('[role="alert"][aria-live="assertive"]')) {
        const text = region.textContent?.trim();
        if (text && controls.__said?.at(-1) !== text) {
          controls.__said?.push(text);
        }
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
    const estimate = navigator.storage.estimate.bind(navigator.storage);
    navigator.storage.estimate = async () => controls.__estimate ?? estimate();
    navigator.storage.persist = async () => controls.__persist ?? true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (controls.__failWrites === true) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return put.apply(this, args);
    };
  });
}

const control = (page: Page, controls: Controls) =>
  page.evaluate((next) => Object.assign(window, next), controls as Record<string, unknown>);

async function open(page: Page): Promise<EditorPage> {
  await withBrowserThatCanRefuse(page);
  const editor = new EditorPage(page);
  await editor.goto();
  return editor;
}

test.describe('when the browser has no room left', () => {
  test('says so in the top bar, in words that give the cause and what to do, and aloud, and keeps the work on the page', async ({
    page,
  }) => {
    const editor = await open(page);
    await control(page, { __failWrites: true, __estimate: { usage: 990, quota: 1_000 } });

    await editor.add('Queue');

    await expect(editor.saveState).toContainText('Not saved. The browser has no room left to keep this canvas.');
    await expect(editor.saveState).toContainText('Export a backup, delete canvases you no longer need');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Controls).__said ?? []))
      .toContainEqual(expect.stringContaining('Not saved. The browser has no room left to keep this canvas.'));
    // What was done is still there, so that nothing is lost by the refusal: the learner can export it.
    await expect(editor.node('Queue queue1')).toBeVisible();
  });

  test('warns that almost no room is left, with the share of it that is used, once the browser has refused', async ({
    page,
  }) => {
    const editor = await open(page);
    await control(page, { __failWrites: true, __estimate: { usage: 990, quota: 1_000 } });

    await editor.add('Queue');

    await expect(page.getByTestId('quota')).toContainText(
      'The browser has almost no room left for this app (99% of 1000 B is used).',
    );
    await expect(page.getByTestId('quota')).toContainText('Export a backup now');
  });

  test('saves again, and says so, when there is room and the learner changes something', async ({ page }) => {
    const editor = await open(page);
    await control(page, { __failWrites: true });
    await editor.add('Queue');
    await expect(editor.saveState).toContainText('Not saved.');

    await control(page, { __failWrites: false });
    await editor.add('Consumer');

    await expect(editor.saveState).toHaveText('All changes saved');
    await expect
      .poll(async () => Object.values((await editor.saved())?.queues ?? {}).map(({ name }) => name))
      .toEqual(['queue1']);
  });
});

test.describe('when the room is running out', () => {
  test('warns before it has, with the share that is used, and does not warn when there is plenty', async ({ page }) => {
    const editor = await open(page);
    await control(page, { __estimate: { usage: 100, quota: 1_000_000 } });
    await editor.add('Queue');
    await expect(editor.saveState).toHaveText('All changes saved');
    await expect(page.getByTestId('quota')).toHaveCount(0);
  });

  test('says how much of the room is used when it is over four fifths', async ({ page }) => {
    const editor = await open(page);
    await control(page, { __estimate: { usage: 850_000, quota: 1_000_000 } });

    await editor.add('Queue');

    await expect(page.getByTestId('quota')).toContainText(
      'The browser has used 85% of the room that it allows this app',
    );
    await expect(page.getByTestId('quota')).toContainText(
      'Export a backup, and delete the canvases that you no longer need',
    );
  });
});

test.describe('the note about the browser that would not promise to keep the canvases (ADR-0101)', () => {
  test('is on the home and in no editor, canvas after canvas, and the warning about room stays in each', async ({
    page,
  }) => {
    await withBrowserThatCanRefuse(page);
    await page.addInitScript(() => {
      (window as unknown as Controls).__persist = false;
      (window as unknown as Controls).__estimate = { usage: 960_000, quota: 1_000_000 };
    });
    await seedLibrary(page, [
      { id: 'alpha', name: 'Alpha', updatedAt: 200_000 },
      { id: 'beta', name: 'Beta', updatedAt: 100_000 },
    ]);
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    const note = 'The browser did not promise to keep the canvases.';

    await canvases.editor.add('Queue');
    await expect(canvases.editor.saveState).toHaveText('All changes saved');
    await expect(page.getByTestId('quota')).toBeVisible();
    await expect(page.getByTestId('persistence')).toHaveCount(0);
    await expect(page.getByLabel('Status')).not.toContainText(note);

    await canvases.showHome();
    await expect(canvases.home.getByTestId('persistence-note')).toContainText(note);

    await canvases.open('Beta');
    await canvases.editor.add('Queue');
    await expect(canvases.editor.saveState).toHaveText('All changes saved');
    await expect(page.getByTestId('quota')).toBeVisible();
    await expect(page.getByTestId('persistence')).toHaveCount(0);
    await expect(page.getByLabel('Status')).not.toContainText(note);
    await expect(page.getByRole('button', { name: 'Dismiss' })).toHaveCount(0);
  });

  test('is not shown when the browser agrees to keep them', async ({ page }) => {
    const editor = await open(page);

    await editor.add('Queue');
    await expect(editor.saveState).toHaveText('All changes saved');

    await expect(page.getByTestId('persistence')).toHaveCount(0);
  });
});
