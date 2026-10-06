import { expect, type Locator, type Page } from '@playwright/test';

/** The editor, behind the `editor` flag. Paths are relative to the base path (`/RabbitMqPlayground/`). */
export class EditorPage {
  readonly heading: Locator;
  readonly toolbox: Locator;
  readonly canvas: Locator;
  readonly inspector: Locator;
  readonly status: Locator;
  readonly saveState: Locator;
  readonly theme: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    this.toolbox = page.getByRole('complementary', { name: 'Toolbox' });
    this.canvas = page.getByRole('main', { name: 'Canvas' });
    this.inspector = page.getByRole('complementary', { name: 'Inspector' });
    this.status = page.getByRole('contentinfo', { name: 'Status' });
    this.saveState = page.getByTestId('save-state');
    this.theme = page.getByRole('combobox', { name: 'Theme' });
  }

  /** Opens the editor, and waits until it has opened the canvas and says that its changes are saved. */
  async goto(path = '?ff=editor'): Promise<void> {
    await this.page.goto(path);
    await this.heading.waitFor();
    await expect(this.saveState).toHaveText('All changes saved');
  }

  /** The canvases that IndexedDB holds, read the way a browser keeps them: by the names that the app gave them. */
  canvasNames(): Promise<string[]> {
    return this.page.evaluate(
      () =>
        new Promise<string[]>((resolve, reject) => {
          const open = indexedDB.open('rmq-playground');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const all = database.transaction('canvases', 'readonly').objectStore('canvases').getAll();
            all.onerror = () => reject(all.error);
            all.onsuccess = () => {
              database.close();
              resolve((all.result as { name: string }[]).map((record) => record.name));
            };
          };
        }),
    );
  }

  /** The editor's debug handle (e2e build only). */
  document(): Promise<{ queues: Record<string, { name: string }> } | null> {
    return this.page.evaluate(() => window.__rmq?.document() ?? null) as Promise<{
      queues: Record<string, { name: string }>;
    } | null>;
  }
}
