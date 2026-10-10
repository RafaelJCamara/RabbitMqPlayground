import type { Locator } from '@playwright/test';
import { CanvasesPage } from './pages/canvases-page';
import { seedLibrary, type SeededCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * The strip of open canvases (ADR-0096): one row however many canvases are open, the newest tab first, a close inside the box of each tab, arrows for the tabs that are out of sight,
 * Close all, and the name of the product, which shows My canvases. The viewport is the one of the other end-to-end tests, 1280 by 720.
 */

/** `Canvas 01` to `Canvas 15`, the oldest first, as they are made. */
const canvasesOf = (count: number): SeededCanvas[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `c${index + 1}`,
    name: `Canvas ${String(index + 1).padStart(2, '0')}`,
  }));

/** The strip as the app keeps it for these canvases when the newest was opened last: the newest first. */
const stripOf = (all: readonly SeededCanvas[]) => ({
  openCanvases: [...all].reverse().map(({ id }) => id),
  lastOpenCanvas: all[all.length - 1]!.id,
});

/** Presses an arrow until it is not there, which is when there is nothing more on its side: the tabs scroll gently, so the arrow may go while the press is being made. */
async function pressUntilGone(arrow: Locator): Promise<void> {
  for (let press = 0; press < 20 && (await arrow.count()) > 0; press += 1) {
    await arrow.click({ timeout: 1500 }).catch(() => undefined);
    await arrow.page().waitForTimeout(300);
  }
}

test.describe('the strip of open canvases (ADR-0096)', () => {
  test('keeps twelve open canvases in one row, the newest first, and the editor keeps its room', async ({ page }) => {
    const all = canvasesOf(12);
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, all, stripOf(all));

    await canvases.goto();

    expect((await canvases.tabs()).slice(0, 4)).toEqual(['My canvases', 'Canvas 12', 'Canvas 11', 'Canvas 10']);
    expect(await canvases.tabs()).toHaveLength(13);
    const tops = await canvases.tabList
      .locator('li')
      .evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
    const header = await canvases.strip.locator('xpath=ancestor::header').boundingBox();
    expect(header?.height).toBeLessThan(72);
    // The theme chooser is at the right end of the same row (ADR-0103), after the strip and outside it.
    const picker = await page.getByRole('combobox', { name: 'Theme' }).boundingBox();
    const stripBox = await canvases.strip.boundingBox();
    expect(picker).not.toBeNull();
    expect(picker!.x).toBeGreaterThanOrEqual((stripBox?.x ?? 0) + (stripBox?.width ?? 0) - 1);
    expect(picker!.y).toBeGreaterThanOrEqual(header?.y ?? 0);
    expect(picker!.y + picker!.height).toBeLessThanOrEqual((header?.y ?? 0) + (header?.height ?? 0));
    expect(picker!.x + picker!.width).toBeLessThanOrEqual(1280);
    const editor = await canvases.editor.flow.boundingBox();
    expect(editor?.height).toBeGreaterThan(300);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await canvases.closeAll();
    const afterwards = await canvases.strip.locator('xpath=ancestor::header').boundingBox();
    expect(afterwards?.height).toBe(header?.height);
  });

  test('puts a canvas that is made first, and keeps it first after a reload', async ({ page }) => {
    const all = canvasesOf(2);
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, all, stripOf(all));
    await canvases.goto();

    await canvases.newCanvas();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Untitled canvas', 'Canvas 02', 'Canvas 01']);
    await expect.poll(() => canvases.storedStrip()).toHaveLength(3);
    await page.reload();
    await canvases.heading.waitFor();
    await canvases.editorReady();
    expect(await canvases.tabs()).toEqual(['My canvases', 'Untitled canvas', 'Canvas 02', 'Canvas 01']);
    await expect.poll(() => canvases.current()).toEqual(['Untitled canvas']);
  });

  test('does not move a tab that is shown again, and shows it without moving the others', async ({ page }) => {
    const all = canvasesOf(3);
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, all, stripOf(all));
    await canvases.goto();

    await canvases.showHome();
    await canvases.open('Canvas 01');

    expect(await canvases.tabs()).toEqual(['My canvases', 'Canvas 03', 'Canvas 02', 'Canvas 01']);
    await expect.poll(() => canvases.current()).toEqual(['Canvas 01']);
  });

  test('has the close inside the box of its tab, at the right end of it, and the name before it', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    const box = await canvases.tabList.locator('li').first().boundingBox();
    const name = await canvases.tab('Untitled canvas').boundingBox();
    const close = await canvases.strip.getByRole('button', { name: 'Close Untitled canvas' }).boundingBox();

    expect(box && name && close).toBeTruthy();
    expect(close!.x).toBeGreaterThanOrEqual(box!.x);
    expect(close!.x + close!.width).toBeLessThanOrEqual(box!.x + box!.width);
    expect(close!.y).toBeGreaterThanOrEqual(box!.y);
    expect(close!.y + close!.height).toBeLessThanOrEqual(box!.y + box!.height);
    expect(close!.x).toBeGreaterThanOrEqual(name!.x + name!.width - 1);
    // Beside the right edge of the box, with only its padding after it.
    expect(box!.x + box!.width - (close!.x + close!.width)).toBeLessThan(12);
    expect(close!.width).toBeGreaterThanOrEqual(24);
    expect(close!.height).toBeGreaterThanOrEqual(24);

    await canvases.closeTab('Untitled canvas');
    await expect(canvases.home).toBeVisible();
    expect(await canvases.tabs()).toEqual(['My canvases']);
  });

  test('shows an arrow for the tabs that are out of sight, which reveal the older ones and the newer ones', async ({
    page,
  }) => {
    const all = canvasesOf(15);
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, all, stripOf(all));
    await canvases.goto();

    await expect(canvases.tab('Canvas 15')).toBeInViewport();
    await expect(canvases.tab('Canvas 01')).not.toBeInViewport();
    await expect(canvases.newerTabs).toHaveCount(0);
    await expect(canvases.olderTabs).toBeVisible();
    const box = await canvases.olderTabs.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);

    await pressUntilGone(canvases.olderTabs);

    await expect(canvases.olderTabs).toHaveCount(0);
    await expect(canvases.tab('Canvas 01')).toBeInViewport();
    await expect(canvases.tab('Canvas 15')).not.toBeInViewport();
    await expect(canvases.newerTabs).toBeVisible();

    await pressUntilGone(canvases.newerTabs);

    await expect(canvases.newerTabs).toHaveCount(0);
    await expect(canvases.tab('Canvas 15')).toBeInViewport();
    await expect(canvases.olderTabs).toBeVisible();
  });

  test('keeps the arrow that was pressed in reach of the keyboard, and gives the cursor to the last tab when it is gone', async ({
    page,
  }) => {
    const all = canvasesOf(15);
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, all, stripOf(all));
    await canvases.goto();

    await canvases.olderTabs.focus();
    for (let press = 0; press < 20 && (await canvases.olderTabs.count()) > 0; press += 1) {
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
    }

    await expect(canvases.olderTabs).toHaveCount(0);
    await expect(canvases.tab('Canvas 01')).toBeFocused();
  });

  test('is crossed with the keyboard, every tab reached with Tab, and the one that has the cursor is in sight', async ({
    page,
  }) => {
    const all = canvasesOf(15);
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, all, stripOf(all));
    await canvases.goto();
    await expect(canvases.tab('Canvas 01')).not.toBeInViewport();

    await canvases.tab('Canvas 15').focus();
    for (let press = 0; press < 28; press += 1) {
      await page.keyboard.press('Tab');
    }

    await expect(canvases.tab('Canvas 01')).toBeFocused();
    await expect(canvases.tab('Canvas 01')).toBeInViewport();
  });

  test('closes every tab with Close all, which asks nothing and has no Undo, deletes no canvas, and puts the cursor on My canvases', async ({
    page,
  }) => {
    const all = canvasesOf(4);
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, all, stripOf(all));
    await canvases.goto();
    await expect(canvases.closeAllButton).toBeVisible();

    await canvases.closeAllButton.click();

    await expect(canvases.home).toBeVisible();
    expect(await canvases.tabs()).toEqual(['My canvases']);
    await expect(canvases.tab('My canvases')).toBeFocused();
    await expect(canvases.closeAllButton).toHaveCount(0);
    await expect(canvases.dialog).toHaveCount(0);
    await expect(canvases.confirmation).toHaveCount(0);
    await expect(canvases.notices).toHaveCount(0);
    expect(await canvases.cardNames()).toHaveLength(4);
    expect(await canvases.stored()).toHaveLength(4);
    await expect.poll(() => canvases.storedStrip()).toEqual([]);

    await canvases.open('Canvas 02');
    expect(await canvases.tabs()).toEqual(['My canvases', 'Canvas 02']);
  });

  test('goes to My canvases when the name of the product is pressed, from a canvas, and stays there', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await expect(canvases.heading).toHaveCount(1);

    await canvases.brand.click();

    await expect(canvases.home).toBeVisible();
    await expect.poll(() => canvases.current()).toEqual(['My canvases']);
    await expect(canvases.heading).toHaveCount(1);
    await expect(canvases.heading).toHaveText(/RabbitMQ Playground/);

    await canvases.brand.click();
    await expect(canvases.home).toBeVisible();
    expect(await canvases.tabs()).toEqual(['My canvases', 'Untitled canvas']);
  });
});
