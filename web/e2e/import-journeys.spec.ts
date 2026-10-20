import { emptyDocument } from '@rmq/domain';
import { EditorPage } from './pages/editor-page';
import { ExportPage, ImportPage, textOf } from './pages/share-page';
import { fixture } from './support/links';
import { ORDERS } from './support/orders';
import { seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * Importing a RabbitMQ definitions file into the canvas that is open (ADR-0111). The file is chosen with the button of the top bar, the dialog says what it makes, what it replaces and what it leaves out, and the import
 * is one change: the canvas has what the file has, and Undo, from the notice or the keys, gives back what was there. The broker's files in `fixtures/import` were exported by RabbitMQ 4.3.6 itself.
 */

test.describe('importing a definitions file (ADR-0111)', () => {
  test('replaces the canvas with what a broker exported, for the vhost that is chosen, and says what it left out', async ({
    page,
  }) => {
    await seedCanvas(page, ORDERS, 'Orders flow');
    const editor = new EditorPage(page);
    await editor.goto();
    await expect(editor.node('Producer sender')).toBeVisible();
    const importing = new ImportPage(page);

    await expect(importing.button).toHaveAttribute('aria-haspopup', 'dialog');
    await importing.choose('broker.json', fixture('import/broker-4.3.definitions.json'));

    await expect(importing.dialog).toHaveAccessibleName('Import definitions into “Orders flow”');
    await expect(importing.vhost).toHaveValue('/');
    await expect(importing.summary).toHaveText('3 exchanges, 4 queues and 5 bindings will be on the canvas.');
    await expect(importing.replaces).toContainText('This replaces everything that is on the canvas now');
    await expect(importing.notes.first()).toHaveText(
      'Left out: The users (2), permissions (3) and policies (1) of the file are not imported: a canvas has exchanges, queues and bindings only.',
    );
    await expect(importing.notes).toHaveCount(8);

    await importing.vhost.selectOption('shop');
    await expect(importing.summary).toHaveText('1 exchange, 1 queue and 1 binding will be on the canvas.');
    await importing.vhost.selectOption('/');
    await importing.confirm.click();

    await expect(importing.dialog).toHaveCount(0);
    await expect(editor.node('Queue shipping')).toBeVisible();
    await expect(editor.node('Exchange orders', { exact: false })).toBeVisible();
    await expect(editor.node('Producer sender')).toHaveCount(0);
    const notice = page.getByRole('region', { name: 'Notices' });
    await expect(notice).toContainText('Imported 3 exchanges, 4 queues and 5 bindings from a definitions file.');
    await expect.poll(async () => Object.keys((await editor.saved())?.queues ?? {}).length).toBe(4);

    await notice.getByRole('button', { name: /^Undo/ }).click();

    await expect(editor.node('Producer sender')).toBeVisible();
    await expect(editor.node('Queue shipping')).toHaveCount(0);
  });

  test('imports the file that this app exported, and the canvas then exports the same file', async ({ page }) => {
    await seedCanvas(page, emptyDocument(), 'Empty');
    const editor = new EditorPage(page);
    await editor.goto();
    const importing = new ImportPage(page);
    const text = `${fixture('export/numbers.definitions.json')}\n`;

    await importing.choose('numbers.definitions.json', text);
    await expect(importing.replaces).toHaveCount(0);
    await expect(importing.confirm).toHaveText('Import');
    await importing.confirm.click();
    await expect(importing.dialog).toHaveCount(0);

    const exporting = new ExportPage(page);
    await exporting.open();
    await expect(exporting.vhost).toHaveValue('/numbers');
    const [download] = await Promise.all([page.waitForEvent('download'), exporting.download.click()]);
    expect((await textOf(download)).text).toBe(text);
  });

  test('says why a file cannot be imported, and changes nothing', async ({ page }) => {
    await seedCanvas(page, ORDERS, 'Orders flow');
    const editor = new EditorPage(page);
    await editor.goto();
    const importing = new ImportPage(page);

    await importing.choose('notes.txt', 'not a definitions file', 'text/plain');
    await expect(importing.error).toHaveText(
      '“notes.txt” is not a JSON file. The import takes a RabbitMQ definitions file, which is a JSON file.',
    );
    await expect(importing.confirm).toHaveCount(0);
    await importing.cancel.click();
    await expect(importing.dialog).toHaveCount(0);
    await expect(importing.button).toBeFocused();

    await importing.choose('canvas.rmq.json', '{"format": "rmq-playground/canvas", "version": 1}');
    await expect(importing.error).toHaveText(
      'This is a file of this app, not a RabbitMQ definitions file. Open a canvas file or a backup from My canvases.',
    );
    await page.keyboard.press('Escape');
    await expect(editor.node('Producer sender')).toBeVisible();
  });
});
