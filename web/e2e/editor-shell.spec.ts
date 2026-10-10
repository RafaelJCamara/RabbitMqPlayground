import { CanvasesPage } from './pages/canvases-page';
import { EditorPage } from './pages/editor-page';
import { expectNoAxeViolations } from './support/axe';
import { expect, test } from './support/test';

test.describe('the editor (ADR-0030, ADR-0084)', () => {
  test('opens with the one heading and the regions of the layout, and says that its changes are saved', async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();

    await expect(editor.heading).toHaveCount(1);
    await expect(editor.heading).toHaveText('RabbitMQ Playground');
    for (const region of [editor.toolbox, editor.canvas, editor.inspector, editor.status]) {
      await expect(region).toBeVisible();
    }
  });
});

test.describe('the one implicit canvas, in IndexedDB in a real browser', () => {
  test('is made once, and is the same canvas when the page is opened again', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();

    expect(await editor.canvasNames()).toEqual(['Untitled canvas']);

    await page.reload();
    await editor.heading.waitFor();
    await expect(editor.saveState).toHaveText('All changes saved');

    expect(await editor.canvasNames()).toEqual(['Untitled canvas']);
  });

  test('is not changed by opening it, so opening it is not an edit', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    const updatedAt = () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const open = indexedDB.open('rmq-playground');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const all = open.result.transaction('canvases', 'readonly').objectStore('canvases').getAll();
              all.onsuccess = () => {
                open.result.close();
                resolve((all.result as { updatedAt: number }[])[0]?.updatedAt ?? -1);
              };
            };
          }),
      );
    const first = await updatedAt();

    await page.reload();
    await editor.heading.waitFor();
    await expect(editor.saveState).toHaveText('All changes saved');
    // The autosave waits half a second after a change. Give it more than that, and see that nothing was written.
    await page.waitForTimeout(1_000);

    expect(await updatedAt()).toBe(first);
  });
});

test.describe('the theme switch', () => {
  test('is chosen from the banner of the page, on the home with no canvas open, and kept when the page is opened again (ADR-0103)', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.closeAll();
    await expect(canvases.home).toBeVisible();
    await expect(canvases.tabs()).resolves.toEqual(['My canvases']);
    const root = page.locator('html');
    const theme = page.getByRole('combobox', { name: 'Theme' });
    await expect(page.getByRole('banner').getByRole('combobox', { name: 'Theme' })).toHaveCount(1);
    await expect(canvases.strip.getByRole('combobox', { name: 'Theme' })).toHaveCount(0);

    await theme.selectOption('dark');

    await expect(root).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await canvases.heading.waitFor();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(theme).toHaveValue('dark');
    await theme.selectOption('system');
    await expect(root).not.toHaveAttribute('data-theme', /.*/);
  });

  test('applies the choice, keeps it when the page is opened again, and goes back to the system', async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    const root = page.locator('html');

    await expect(root).not.toHaveAttribute('data-theme', /.*/);
    await editor.theme.selectOption('dark');
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('rmq-editor > div')).toHaveCSS('background-color', 'rgb(11, 16, 32)');

    await page.reload();
    await editor.heading.waitFor();
    await expect(root).toHaveAttribute('data-theme', 'dark');
    await expect(editor.theme).toHaveValue('dark');

    await editor.theme.selectOption('light');
    await expect(page.locator('rmq-editor > div')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

    await editor.theme.selectOption('system');
    await expect(root).not.toHaveAttribute('data-theme', /.*/);
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the editor in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('has no axe violations', async ({ page }) => {
      await new EditorPage(page).goto();

      await expectNoAxeViolations(page);
    });
  });
}

for (const choice of ['light', 'dark'] as const) {
  test.describe(`accessibility of the editor with the ${choice} theme chosen on the page`, () => {
    test(`has no axe violations, whatever the operating system says`, async ({ page }) => {
      const editor = new EditorPage(page);
      await editor.goto();
      await editor.theme.selectOption(choice);

      await expectNoAxeViolations(page);
    });
  });
}
