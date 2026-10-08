import type { Locator, Page } from '@playwright/test';
import { CanvasesPage } from './pages/canvases-page';
import { seedLibrary } from './support/seed';
import { expect, test } from './support/test';

/**
 * The canvases with the keyboard alone (ADR-0072, ADR-0073, ADR-0074): every act of the strip, the home, the dialogs and the notices is reached with Tab and done with Enter or
 * Space, in an order that follows the page, and the cursor is always somewhere that can be seen. These journeys press Tab until the button that is named is the one that has the
 * cursor, and never click, focus or fill with a mouse.
 */

/** What a person would call the element that has the cursor: its label, or else its words. */
const nameOfFocus = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const element = document.activeElement;
    return element === null ? '' : (element.getAttribute('aria-label') ?? element.textContent?.trim() ?? '');
  });

/** Presses Tab, up to a hundred times, until the element that has the cursor is called `name`. It fails if it never is. */
async function tabTo(page: Page, name: string): Promise<void> {
  for (let presses = 0; presses < 100; presses += 1) {
    if ((await nameOfFocus(page)) === name) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached "${name}"; the cursor is on "${await nameOfFocus(page)}"`);
}

/** Whether the element that has the cursor shows it: the page draws an outline on it (WCAG 2.4.7, 2.4.11). */
async function focusIsShown(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.activeElement as Element);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  });
}

const blur = async (page: Page, target: Locator): Promise<void> => {
  // The cursor starts in the strip: the page is the keyboard's after a reload or a click on nothing.
  await target.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
};

test.describe('the canvases, with the keyboard alone', () => {
  test('makes a canvas, goes to the home, renames, deletes with the question, takes it back and opens it', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await blur(page, canvases.heading);

    await tabTo(page, 'New canvas');
    await page.keyboard.press('Enter');
    await canvases.editorReady();
    await expect.poll(() => canvases.current()).toEqual(['Untitled canvas 2']);

    await tabTo(page, 'My canvases');
    await page.keyboard.press('Enter');
    await expect(canvases.home).toBeVisible();

    await tabTo(page, 'Rename Untitled canvas 2');
    expect(await focusIsShown(page)).toBe(true);
    await page.keyboard.press('Enter');
    await expect(canvases.dialog).toBeVisible();
    await page.keyboard.press('Control+a');
    await page.keyboard.type('Orders');
    await page.keyboard.press('Enter');
    await expect(canvases.dialog).toHaveCount(0);
    expect(await nameOfFocus(page)).toBe('Rename Orders');

    await tabTo(page, 'Delete Orders');
    await page.keyboard.press('Space');
    await expect(canvases.confirmation).toBeVisible();
    expect(await nameOfFocus(page)).toBe('Cancel');
    await tabTo(page, 'Delete canvas');
    await page.keyboard.press('Enter');
    await expect(canvases.notices.getByTestId('toast-message')).toHaveText('Deleted “Orders”.');
    await expect.poll(() => canvases.cardNames()).toEqual(['Untitled canvas']);

    await page.keyboard.press('Control+z');
    await expect.poll(() => canvases.cardNames()).toEqual(['Orders', 'Untitled canvas']);

    await tabTo(page, 'Open Orders');
    await page.keyboard.press('Enter');
    await canvases.editorReady();
    await expect.poll(() => canvases.current()).toEqual(['Orders']);
  });

  test('shows where the cursor is on the strip, the home and the notices', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'one', name: 'One' },
      { id: 'two', name: 'Two' },
    ]);
    await canvases.goto();
    await blur(page, canvases.heading);

    for (const name of ['My canvases', 'Close Two', 'New canvas']) {
      await tabTo(page, name);
      expect(await focusIsShown(page), `the cursor on "${name}" is shown`).toBe(true);
    }
    await page.keyboard.press('Enter');
    await canvases.editorReady();
    await canvases.showHome();
    for (const name of ['Open One', 'Save as file One', 'Delete One']) {
      await tabTo(page, name);
      expect(await focusIsShown(page), `the cursor on "${name}" is shown`).toBe(true);
    }
    await page.keyboard.press('Enter');
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).focus();
    await page.keyboard.press('Enter');
    await expect(canvases.notices).toBeVisible();
    await tabTo(page, 'Undo');
    expect(await focusIsShown(page)).toBe(true);
    await tabTo(page, 'Dismiss');
    expect(await focusIsShown(page)).toBe(true);
  });

  test('closes a tab with the keyboard and the cursor goes to the tab that is shown', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(
      page,
      [
        { id: 'one', name: 'One' },
        { id: 'two', name: 'Two' },
      ],
      { openCanvases: ['one', 'two'], lastOpenCanvas: 'two' },
    );
    await canvases.goto();
    await blur(page, canvases.heading);

    await tabTo(page, 'Close Two');
    await page.keyboard.press('Enter');

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'One']);
    await expect.poll(() => nameOfFocus(page)).toBe('One');
  });

  test('dismisses a notice with Escape when the cursor is in it, and the cursor is not lost to the top of the page', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();
    await canvases.action('Untitled canvas', 'Delete').focus();
    await page.keyboard.press('Enter');
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).focus();
    await page.keyboard.press('Enter');
    await expect(canvases.notices).toBeVisible();

    await tabTo(page, 'Undo');
    await page.keyboard.press('Escape');

    await expect(canvases.notices).toHaveCount(0);
  });

  test('answers a question with Escape and keeps what was asked about', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();
    await tabTo(page, 'Delete Untitled canvas');

    await page.keyboard.press('Enter');
    await expect(canvases.confirmation).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(canvases.confirmation).toHaveCount(0);
    expect(await nameOfFocus(page)).toBe('Delete Untitled canvas');
    expect(await canvases.stored()).toEqual(['Untitled canvas']);
  });
});
