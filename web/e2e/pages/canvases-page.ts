import { expect, type Locator, type Page } from '@playwright/test';
import { EditorPage } from './editor-page';

/**
 * The workspace of several canvases (ADR-0072, ADR-0073), behind the flags `editor` and `canvases`: the strip of open canvases, the home, and the editor of the canvas that
 * is shown. Paths are relative to the base path (`/RabbitMqPlayground/`).
 */
export class CanvasesPage {
  readonly editor: EditorPage;
  readonly heading: Locator;
  readonly strip: Locator;
  readonly home: Locator;
  readonly search: Locator;
  readonly sort: Locator;
  readonly count: Locator;
  readonly dialog: Locator;
  /** The dialog that asks before something is taken away. */
  readonly confirmation: Locator;
  /** The region of the notices, which is there only while there is one. */
  readonly notices: Locator;

  constructor(readonly page: Page) {
    this.editor = new EditorPage(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.strip = page.getByRole('navigation', { name: 'Open canvases' });
    this.home = page.getByRole('main', { name: 'My canvases' });
    this.search = this.home.getByRole('searchbox', { name: 'Search canvases' });
    this.sort = this.home.getByRole('combobox', { name: 'Sort by' });
    this.count = this.home.getByTestId('home-count');
    this.dialog = page.getByRole('dialog');
    this.confirmation = page.getByRole('alertdialog');
    this.notices = page.getByRole('region', { name: 'Notices' });
  }

  /** Opens the workspace, and waits until an editor has opened a canvas and says that its changes are saved. */
  async goto(path = '?ff=editor,canvases'): Promise<void> {
    await this.page.goto(path);
    await this.heading.waitFor();
    await this.editorReady();
  }

  /** Waits for the editor of the canvas that is shown to have opened it. */
  async editorReady(): Promise<void> {
    await expect(this.editor.saveState).toHaveText('All changes saved');
  }

  /** The names of the items of the strip, the home first, in order. */
  tabs(): Promise<string[]> {
    return this.strip
      .locator('[data-testid="tab-home"], [data-testid="tab"]')
      .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ''));
  }

  /** The names of the items of the strip that mark themselves as the one that is shown. */
  current(): Promise<string[]> {
    return this.strip
      .locator('[aria-current="true"]')
      .evaluateAll((buttons) => buttons.map((button) => button.textContent?.trim() ?? ''));
  }

  /** The button of an item of the strip. */
  tab(name: string): Locator {
    return this.strip.getByRole('button', { name, exact: true });
  }

  /** Shows the home, and waits for it. */
  async showHome(): Promise<void> {
    await this.tab('My canvases').click();
    await expect(this.home).toBeVisible();
  }

  /** Shows a canvas that is in the strip, and waits for its editor. */
  async showCanvas(name: string): Promise<void> {
    await this.tab(name).click();
    await this.editorReady();
  }

  /** Makes a canvas with the button of the strip, and waits for its editor. */
  async newCanvas(): Promise<void> {
    await this.strip.getByRole('button', { name: 'New canvas' }).click();
    await this.editorReady();
  }

  /** Closes a tab. */
  async closeTab(name: string): Promise<void> {
    await this.strip.getByRole('button', { name: `Close ${name}`, exact: true }).click();
  }

  /** The card of a canvas on the home. */
  card(name: string): Locator {
    return this.home
      .getByRole('article')
      .filter({ has: this.page.getByRole('heading', { level: 3, name, exact: true }) });
  }

  /** The names of the cards that are drawn, in order. */
  cardNames(): Promise<string[]> {
    return this.home
      .getByRole('article')
      .getByRole('heading', { level: 3 })
      .evaluateAll((headings) => headings.map((heading) => heading.textContent?.trim() ?? ''));
  }

  /** A button of a card, by its word and the canvas it acts on: `Open Orders`. */
  action(name: string, word: 'Open' | 'Rename' | 'Duplicate' | 'Save as file' | 'Delete'): Locator {
    return this.card(name).getByRole('button', { name: `${word} ${name}`, exact: true });
  }

  /** Opens a canvas from its card, and waits for its editor. */
  async open(name: string): Promise<void> {
    await this.action(name, 'Open').click();
    await this.editorReady();
  }

  /** Renames a canvas from its card, in the dialog. */
  async rename(name: string, to: string): Promise<void> {
    await this.action(name, 'Rename').click();
    const field = this.dialog.getByRole('textbox', { name: 'Name' });
    await field.fill(to);
    await this.dialog.getByRole('button', { name: 'Rename', exact: true }).click();
    await expect(this.dialog).toHaveCount(0);
  }

  /** The names of the canvases that IndexedDB holds and that are not deleted, sorted, whatever the screen shows. A deleted one is a tombstone for a minute. */
  stored(): Promise<string[]> {
    return this.records().then((records) =>
      records
        .filter((record) => record.deletedAt === undefined)
        .map((record) => record.name)
        .sort(),
    );
  }

  /** The names of the canvases that are tombstones, sorted. */
  tombstones(): Promise<string[]> {
    return this.records().then((records) =>
      records
        .filter((record) => record.deletedAt !== undefined)
        .map((record) => record.name)
        .sort(),
    );
  }

  private records(): Promise<{ name: string; deletedAt?: number }[]> {
    return this.page.evaluate(
      () =>
        new Promise<{ name: string; deletedAt?: number }[]>((resolve, reject) => {
          const open = indexedDB.open('rmq-playground');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const all = database.transaction('canvases', 'readonly').objectStore('canvases').getAll();
            all.onerror = () => reject(all.error);
            all.onsuccess = () => {
              database.close();
              resolve(all.result as { name: string; deletedAt?: number }[]);
            };
          };
        }),
    );
  }

  /** The message of the notice that is there, or `undefined`. */
  noticeText(): Promise<string | undefined> {
    return this.notices
      .getByTestId('toast-message')
      .first()
      .textContent({ timeout: 2000 })
      .then((text) => text?.trim())
      .catch(() => undefined);
  }

  /** The ids the strip is kept as in IndexedDB, or `undefined`. */
  storedStrip(): Promise<string[] | undefined> {
    return this.page.evaluate(
      () =>
        new Promise<string[] | undefined>((resolve, reject) => {
          const open = indexedDB.open('rmq-playground');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const database = open.result;
            const get = database.transaction('meta', 'readonly').objectStore('meta').get('openCanvases');
            get.onerror = () => reject(get.error);
            get.onsuccess = () => {
              database.close();
              resolve(get.result as string[] | undefined);
            };
          };
        }),
    );
  }
}
