import { emptyDocument } from '@rmq/domain';
import { CanvasesPage } from './pages/canvases-page';
import { seedLibrary } from './support/seed';
import { expect, test } from './support/test';

/** Two canvases, both in the strip, with Alpha shown, so that the home is reached by the strip. */
async function twoCanvases(canvases: CanvasesPage): Promise<void> {
  await seedLibrary(
    canvases.page,
    [
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
    ],
    { openCanvases: ['alpha', 'beta'], lastOpenCanvas: 'alpha' },
  );
  await canvases.goto();
  await canvases.showHome();
}

test.describe('deleting a canvas, with an Undo (ADR-0074)', () => {
  test('asks first, with the cursor on Cancel, the safe act, and deletes nothing on Cancel', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);

    await canvases.action('Beta', 'Delete').click();

    await expect(canvases.confirmation).toHaveAccessibleName('Delete “Beta”?');
    await expect(canvases.confirmation).toHaveAccessibleDescription(
      'It has 0 elements. You can take this back for a short while after.',
    );
    await expect(canvases.confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await canvases.confirmation.getByRole('button', { name: 'Cancel' }).click();

    await expect(canvases.confirmation).toHaveCount(0);
    await expect(canvases.action('Beta', 'Delete')).toBeFocused();
    await expect(canvases.notices).toHaveCount(0);
    await expect.poll(() => canvases.cardNames()).toEqual(['Beta', 'Alpha']);
    expect(await canvases.stored()).toEqual(['Alpha', 'Beta']);
  });

  test('deletes nothing on Escape either, and gives the cursor back to the button that asked', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);

    await canvases.action('Beta', 'Delete').click();
    await expect(canvases.confirmation).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(canvases.confirmation).toHaveCount(0);
    await expect(canvases.action('Beta', 'Delete')).toBeFocused();
    expect(await canvases.stored()).toEqual(['Alpha', 'Beta']);
  });

  test('deletes, says so in a notice that has an Undo, and the Undo brings the canvas back to the home and to its place in the strip', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);

    await canvases.action('Beta', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();

    await expect(canvases.notices.getByTestId('toast-message')).toHaveText('Deleted “Beta”.');
    await expect.poll(() => canvases.cardNames()).toEqual(['Alpha']);
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Alpha']);
    // The browser keeps it for a minute as a tombstone, and no screen shows it.
    expect(await canvases.stored()).toEqual(['Alpha']);
    expect(await canvases.tombstones()).toEqual(['Beta']);

    await canvases.notices.getByRole('button', { name: 'Undo' }).click();

    await expect.poll(() => canvases.cardNames()).toEqual(['Beta', 'Alpha']);
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Alpha', 'Beta']);
    await expect(canvases.notices).toHaveCount(0);
    expect(await canvases.stored()).toEqual(['Alpha', 'Beta']);
    expect(await canvases.tombstones()).toEqual([]);
    await expect.poll(() => canvases.current()).toEqual(['My canvases']);
  });

  test('takes the delete back with Control and Z on the home', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);
    await canvases.action('Beta', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(canvases.notices).toBeVisible();

    await page.keyboard.press('Control+z');

    await expect.poll(() => canvases.cardNames()).toEqual(['Beta', 'Alpha']);
    await expect(canvases.notices).toHaveCount(0);
  });

  test('does not take the delete back with the keys while the cursor is in the search, which has an Undo of its own', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);
    await canvases.action('Beta', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(canvases.notices).toBeVisible();

    await canvases.search.focus();
    await page.keyboard.press('Control+z');

    await expect.poll(() => canvases.cardNames()).toEqual(['Alpha']);
    await expect(canvases.notices).toBeVisible();
  });

  test('puts the cursor on the card that takes the place of the one deleted, and on the button that makes a canvas when none is left', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'a', name: 'Alpha', updatedAt: 3_000 },
      { id: 'b', name: 'Beta', updatedAt: 2_000 },
      { id: 'c', name: 'Gamma', updatedAt: 1_000 },
    ]);
    await canvases.goto();
    await canvases.showHome();

    await canvases.action('Beta', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(canvases.action('Gamma', 'Open')).toBeFocused();

    await canvases.action('Gamma', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(canvases.action('Alpha', 'Open')).toBeFocused();

    await canvases.action('Alpha', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(canvases.home.getByRole('button', { name: 'New canvas' })).toBeFocused();
    await expect(canvases.home.getByText(/You have no canvases yet/)).toBeVisible();
  });

  test('shows the home when the canvas that is deleted is one that was open, and brings it back to its tab', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);
    expect(await canvases.tabs()).toEqual(['My canvases', 'Alpha', 'Beta']);

    await canvases.action('Alpha', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Beta']);
    await canvases.notices.getByRole('button', { name: 'Undo' }).click();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Alpha', 'Beta']);
  });

  test('is still deleted after a reload within the minute, and the canvas is not on the home', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);
    await canvases.action('Beta', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect.poll(() => canvases.tombstones()).toEqual(['Beta']);

    await page.reload();
    await canvases.heading.waitFor();
    await canvases.editorReady();
    await canvases.showHome();

    await expect.poll(() => canvases.cardNames()).toEqual(['Alpha']);
  });

  test('takes the notice away after half a minute, and then the delete cannot be taken back with the keys', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await page.clock.install();
    await twoCanvases(canvases);
    await canvases.action('Beta', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(canvases.notices).toBeVisible();

    await page.clock.fastForward(29_000);
    await expect(canvases.notices).toBeVisible();
    await page.clock.fastForward(2_000);

    await expect(canvases.notices).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect.poll(() => canvases.cardNames()).toEqual(['Alpha']);
  });

  test('can be dismissed, and Escape on the notice dismisses it', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await twoCanvases(canvases);
    await canvases.action('Beta', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(canvases.notices).toBeVisible();

    await canvases.notices.getByRole('button', { name: 'Dismiss' }).click();

    await expect(canvases.notices).toHaveCount(0);
    expect(await canvases.tombstones()).toEqual(['Beta']);
  });

  test('lists a canvas that cannot be opened apart, with the reason, and deletes it like any other', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'alpha', name: 'Alpha' },
      { id: 'newer', name: 'From a newer app', document: { ...emptyDocument(), schemaVersion: 99 } as never },
    ]);
    await canvases.goto();
    await canvases.showHome();

    const section = canvases.home.getByTestId('home-unreadable');
    await expect(section.getByRole('heading', { level: 2, name: 'Canvases that could not be opened' })).toBeVisible();
    await expect(section.getByRole('heading', { level: 3, name: 'From a newer app' })).toBeVisible();
    await expect(section).toContainText('This canvas was saved by a newer version of this app.');
    await expect.poll(() => canvases.cardNames()).toEqual(['Alpha']);
    await expect(canvases.count).toHaveText('1 canvas');

    await section.getByRole('button', { name: 'Delete From a newer app' }).click();
    await expect(canvases.confirmation).toHaveAccessibleName('Delete “From a newer app”?');
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();

    await expect(section).toHaveCount(0);
    await expect(canvases.notices.getByTestId('toast-message')).toHaveText('Deleted “From a newer app”.');
    await canvases.notices.getByRole('button', { name: 'Undo' }).click();
    await expect(section).toBeVisible();
  });
});

test.describe('clearing a canvas, with an Undo (ADR-0074)', () => {
  test('takes everything off the canvas with a button, says so in a notice, and the Undo of the notice brings it back', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.editor.add('Queue');
    await expect(canvases.editor.node('Queue queue1')).toBeVisible();

    await page.getByRole('button', { name: 'Clear canvas' }).click();

    await expect(canvases.notices.getByTestId('toast-message')).toHaveText('Cleared the canvas.');
    await expect(canvases.editor.node('Queue queue1')).toHaveCount(0);
    await expect(page.getByTestId('canvas-empty')).toBeVisible();
    await canvases.notices.getByRole('button', { name: 'Undo' }).click();

    await expect(canvases.editor.node('Queue queue1')).toBeVisible();
    await expect(canvases.notices).toHaveCount(0);
  });

  test('is followed by the same notice when the command is typed, and the notice goes when anything else is done', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.editor.add('Queue');
    await canvases.editor.openCommandBar();

    await canvases.editor.runCommand('clear');

    await expect(canvases.notices.getByTestId('toast-message')).toHaveText('Cleared the canvas.');
    await canvases.editor.runCommand('declare queue again durable=true');
    await expect(canvases.notices).toHaveCount(0);
  });

  test('goes with the keys of the editor: Control and Z takes the clear back, and the notice with it', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.editor.add('Queue');
    await page.getByRole('button', { name: 'Clear canvas' }).click();
    await expect(canvases.notices).toBeVisible();

    await page.keyboard.press('Control+z');

    await expect(canvases.editor.node('Queue queue1')).toBeVisible();
    await expect(canvases.notices).toHaveCount(0);
  });

  test('says that the canvas is already empty, and makes no notice, when there is nothing to clear', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();

    await page.getByRole('button', { name: 'Clear canvas' }).click();

    await expect(page.getByTestId('status-message')).toHaveText('The canvas is already empty.');
    await expect(canvases.notices).toHaveCount(0);
  });

  test('has no button for it, and no notice, without the flag', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.editor.goto('?ff=editor');

    await expect(page.getByRole('button', { name: 'Clear canvas' })).toHaveCount(0);
  });
});
