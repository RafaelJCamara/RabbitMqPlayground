import { EditorPage } from './pages/editor-page';
import { expectNoAxeViolations } from './support/axe';
import { expect, test } from './support/test';

test.describe('the editor, behind its flag (ADR-0030)', () => {
  test('is not downloaded by a visitor who does not have the flag, and is by one who does', async ({ page }) => {
    const scripts = async () =>
      page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .map((entry) => entry.name)
          .filter((name) => name.endsWith('.js')),
      );

    await page.goto('');
    await expect(page.getByText(/Under construction/)).toBeVisible();
    const without = await scripts();
    expect(await page.getByRole('complementary', { name: 'Toolbox' }).count()).toBe(0);

    await new EditorPage(page).goto();
    const withFlag = await scripts();

    expect(withFlag.length).toBeGreaterThan(without.length);
    expect(withFlag.filter((name) => !without.includes(name))).toHaveLength(withFlag.length - without.length);
  });

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
    expect(await page.evaluate(() => window.__rmq?.flags())).toEqual(['editor']);
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
