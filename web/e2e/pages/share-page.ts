import { readFile } from 'node:fs/promises';
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { EditorPage } from './editor-page';

/**
 * Sharing a canvas (ADR-0013, ADR-0078, ADR-0079), behind the flags `editor` and `share`: the panel that makes a link, the dialog that exports for a broker, and the page that a link opens.
 * Paths are relative to the base path (`/RabbitMqPlayground/`).
 */

/** The panel that makes a link to a canvas. */
export class SharePage {
  readonly button: Locator;
  readonly dialog: Locator;
  readonly link: Locator;
  readonly copy: Locator;
  readonly status: Locator;
  readonly length: Locator;
  readonly notice: Locator;
  readonly canvasOnly: Locator;
  readonly withMessages: Locator;
  readonly noMessages: Locator;
  readonly long: Locator;
  readonly error: Locator;
  readonly download: Locator;
  readonly close: Locator;
  /** What the app says aloud politely, in the region that a screen reader listens to. */
  readonly said: Locator;

  constructor(readonly page: Page) {
    this.button = page.getByRole('button', { name: 'Share…', exact: true });
    this.dialog = page.getByRole('dialog', { name: /^Share “/ });
    this.link = this.dialog.getByRole('textbox', { name: 'Link' });
    this.copy = this.dialog.getByRole('button', { name: 'Copy link' });
    this.status = this.dialog.getByTestId('share-status');
    this.length = this.dialog.getByTestId('share-length');
    this.notice = this.dialog.getByTestId('share-notice');
    this.canvasOnly = this.dialog.getByRole('radio', { name: 'The canvas', exact: true });
    this.withMessages = this.dialog.getByRole('radio', { name: /^The canvas and its \d+ messages?$/ });
    this.noMessages = this.dialog.getByTestId('share-no-messages');
    this.long = this.dialog.getByTestId('share-long');
    this.error = this.dialog.getByTestId('share-error');
    this.download = this.dialog.getByRole('button', { name: 'Download file' });
    this.close = this.dialog.getByRole('button', { name: 'Close' });
    this.said = page.locator('body > [role="status"][aria-live="polite"]');
  }

  /** Opens the panel with the button of the top bar, and waits until the link is made. */
  async open(): Promise<void> {
    await this.button.click();
    await this.made();
  }

  /** Waits until the panel is there and has made its link or said why it has none. */
  async made(): Promise<void> {
    await expect(this.dialog).toBeVisible();
    await expect(this.dialog.getByTestId('share-making')).toHaveCount(0);
  }

  /** The link that the panel made. */
  async address(): Promise<string> {
    await expect(this.link).not.toHaveValue('');
    return this.link.inputValue();
  }
}

/** The dialog that exports a canvas for a broker. */
export class ExportPage {
  readonly button: Locator;
  readonly dialog: Locator;
  readonly vhost: Locator;
  readonly summary: Locator;
  readonly empty: Locator;
  readonly warnings: Locator;
  readonly all: Locator;
  readonly never: Locator;
  readonly error: Locator;
  readonly download: Locator;
  readonly close: Locator;

  constructor(readonly page: Page) {
    this.button = page.getByRole('button', { name: 'Export…', exact: true });
    this.dialog = page.getByRole('dialog', { name: /^Export “/ });
    this.vhost = this.dialog.getByRole('textbox', { name: 'Virtual host' });
    this.summary = this.dialog.getByTestId('export-summary');
    this.empty = this.dialog.getByTestId('export-empty');
    this.warnings = this.dialog.getByTestId('export-warnings').getByRole('listitem');
    this.all = this.dialog.getByTestId('export-all');
    this.never = this.dialog.getByTestId('export-never');
    this.error = this.dialog.getByTestId('export-error');
    this.download = this.dialog.getByRole('button', { name: 'Download definitions' });
    this.close = this.dialog.getByRole('button', { name: 'Close' });
  }

  async open(): Promise<void> {
    await this.button.click();
    await expect(this.dialog).toBeVisible();
  }
}

/** The page that a link opens: the editor over a canvas that keeps nothing, with a banner. */
export class SharedViewPage {
  readonly editor: EditorPage;
  readonly heading: Locator;
  readonly banner: Locator;
  readonly name: Locator;
  readonly saveCopy: Locator;
  readonly leave: Locator;
  readonly problem: Locator;
  readonly notice: Locator;
  readonly opening: Locator;

  constructor(readonly page: Page) {
    this.editor = new EditorPage(page);
    this.heading = page.getByRole('heading', { level: 1 });
    this.banner = page.getByTestId('shared-banner');
    this.name = page.getByTestId('shared-name');
    this.saveCopy = page.getByRole('button', { name: 'Save a copy to my canvases' });
    this.leave = page.getByRole('button', { name: 'Leave', exact: true });
    this.problem = page.getByTestId('shared-problem');
    this.notice = page.getByTestId('shared-notice');
    this.opening = page.getByTestId('opening-shared');
  }

  /** Waits until the shared canvas is open: the banner, and an editor that has opened the canvas and says that nothing of it is kept. */
  async ready(): Promise<void> {
    await expect(this.banner).toBeVisible();
    await expect(this.editor.saveState).toContainText('Not kept after you close this tab.');
  }
}

/** The page that says why a link cannot be opened. */
export class LinkFailedPage {
  readonly heading: Locator;
  readonly title: Locator;
  readonly reason: Locator;
  readonly home: Locator;

  constructor(readonly page: Page) {
    this.heading = page.getByRole('heading', { level: 1 });
    this.title = page.getByRole('heading', { level: 2, name: 'This link could not be opened' });
    this.reason = page.getByTestId('link-failed');
    this.home = page.getByRole('link', { name: 'Go to the playground' });
  }
}

/** The names of the databases that this browser has for the origin of the page. A page that keeps nothing has none. */
export function databases(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await indexedDB.databases()).map(({ name }) => name ?? ''));
}

/** The text of a file that a download gave, and its name. */
export async function textOf(download: Download): Promise<{ readonly name: string; readonly text: string }> {
  return { name: download.suggestedFilename(), text: await readFile(await download.path(), 'utf8') };
}
