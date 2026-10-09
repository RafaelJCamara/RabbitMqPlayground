import { emptyDocument } from '@rmq/domain';
import { NOT_IN_THE_FILE } from '@rmq/persistence';
import { canvasFromText } from '@rmq/testing';
import { EditorPage } from './pages/editor-page';
import { ExportPage, textOf } from './pages/share-page';
import { fixture } from './support/links';
import { seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * Journey 6 of the plan: exporting a canvas for a broker (ADR-0014, ADR-0079). The dialog says which virtual host, what goes in the file, and what does not and why, and gives the file. The files in `fixtures/export` were
 * made by the export once and then imported into a live RabbitMQ by the nightly run, which replayed publishes against what they made; here the same canvases are exported by this browser, and the bytes it gives are held to be
 * the bytes that the broker took.
 */

const GOLDEN = ['orders', 'numbers', 'warnings'] as const;

interface Report {
  readonly summary: { readonly exchanges: number; readonly queues: number; readonly bindings: number };
  readonly warnings: readonly { readonly message: string }[];
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

test.describe('journey 6: the definitions file of a canvas', () => {
  for (const name of GOLDEN) {
    test(`gives, for the canvas “${name}”, the file that a broker was shown to take, and lists what it leaves out`, async ({
      page,
    }) => {
      const commands = fixture(`export/${name}.commands`);
      const vhost = /^# export to the vhost (\S+)$/m.exec(commands)?.[1] ?? '/';
      const report = JSON.parse(fixture(`export/${name}.report.json`)) as Report;
      await seedCanvas(page, canvasFromText(commands), `Golden ${name}`);
      const editor = new EditorPage(page);
      await editor.goto();
      const exporting = new ExportPage(page);

      await expect(exporting.button).toHaveAttribute('aria-haspopup', 'dialog');
      await exporting.open();

      await expect(exporting.dialog).toHaveAccessibleName(`Export “Golden ${name}” for a broker`);
      await expect(exporting.vhost).toHaveValue('/');
      await exporting.vhost.fill(vhost);
      const { exchanges, queues, bindings } = report.summary;
      await expect(exporting.summary).toHaveText(
        `${plural(exchanges, 'exchange')}, ${plural(queues, 'queue')} and ${plural(bindings, 'binding')} are in the file.`,
      );
      if (report.warnings.length === 0) {
        await expect(exporting.all).toHaveText('Everything on the canvas is in the file.');
      } else {
        await expect(exporting.warnings).toHaveText(report.warnings.map(({ message }) => message));
      }
      await expect(exporting.never).toHaveText(NOT_IN_THE_FILE);

      const [download] = await Promise.all([page.waitForEvent('download'), exporting.download.click()]);
      const file = await textOf(download);

      expect(file.name).toBe(`golden-${name}.definitions.json`);
      expect(file.text.replace(/\n$/, '')).toBe(fixture(`export/${name}.definitions.json`));
      await expect(exporting.dialog).toHaveCount(0);
      await expect(exporting.button).toBeFocused();
    });
  }

  test('says under the field, and keeps the dialog, when the virtual host cannot be one, and gives no file', async ({
    page,
  }) => {
    await seedCanvas(page, canvasFromText(fixture('export/orders.commands')), 'Orders');
    const editor = new EditorPage(page);
    await editor.goto();
    const exporting = new ExportPage(page);
    await exporting.open();
    await exporting.vhost.fill('');
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });

    await exporting.download.click();

    await expect(exporting.error).toBeVisible();
    await expect(exporting.error).toHaveAttribute('role', 'alert');
    await expect(exporting.vhost).toHaveAttribute('aria-invalid', 'true');
    await expect(exporting.vhost).toBeFocused();
    await expect(exporting.dialog).toBeVisible();
    expect(downloaded).toBe(false);

    await exporting.vhost.fill('/orders');
    const [download] = await Promise.all([page.waitForEvent('download'), exporting.download.click()]);
    expect((await textOf(download)).name).toBe('orders.definitions.json');
  });

  test('says that there is nothing to put in a file for a canvas that has no exchange and no queue, and gives none', async ({
    page,
  }) => {
    await seedCanvas(page, emptyDocument(), 'Nothing yet');
    const editor = new EditorPage(page);
    await editor.goto();
    const exporting = new ExportPage(page);
    await exporting.open();

    await expect(exporting.empty).toBeVisible();
    await expect(exporting.summary).toHaveCount(0);
    await exporting.download.click();

    await expect(exporting.error).toBeVisible();
    await expect(exporting.dialog).toBeVisible();
  });

  test('is closed with Escape, and the cursor goes back to the button that opened it', async ({ page }) => {
    await seedCanvas(page, canvasFromText(fixture('export/orders.commands')), 'Orders');
    const editor = new EditorPage(page);
    await editor.goto();
    const exporting = new ExportPage(page);

    await exporting.button.focus();
    await page.keyboard.press('Enter');
    await expect(exporting.dialog).toBeVisible();
    await expect(exporting.vhost).toBeFocused();
    await page.keyboard.press('Escape');

    await expect(exporting.dialog).toHaveCount(0);
    await expect(exporting.button).toBeFocused();
  });
});
