import { emptyDocument } from '@rmq/domain';
import { CanvasesPage } from './pages/canvases-page';
import { buildDocument, seedLibrary } from './support/seed';
import { expect, test } from './support/test';

const DAY = 24 * 60 * 60 * 1000;

/** An exchange bound to a queue, so that a canvas has something to carry through a file. */
const small = () =>
  buildDocument([
    {
      type: 'declare-exchange',
      name: 'orders',
      exchangeType: 'direct',
      durable: true,
      autoDelete: false,
      internal: false,
    },
    { type: 'declare-queue', name: 'billing', durable: true },
    { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'k' },
  ]);

const two = (number: number): string => String(number).padStart(2, '0');
/** Today as the learner counts it, which is what a backup is named by; the test and the browser are on one machine. */
const today = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
};

/** The file of a backup of canvases, as the app writes it, made by hand so that a test does not need the library that writes it. */
const backupText = (canvases: readonly { id: string; name: string; document: unknown }[]): string =>
  JSON.stringify({
    format: 'rmq-playground/backup',
    version: 1,
    exportedAt: 1_700_000_000_000,
    canvases: canvases.map(({ id, name, document }) => ({ id, name, createdAt: 1_000, updatedAt: 2_000, document })),
  });

test.describe('saving a canvas as a file and opening one (ADR-0075)', () => {
  test('gives the learner the file of the canvas, named after it, and says so in a notice', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [{ id: 'orders', name: 'Orders flow', document: small() }]);
    await canvases.goto();
    await canvases.showHome();

    const file = await canvases.downloaded(() => canvases.action('Orders flow', 'Save as file').click());

    expect(file.name).toBe('orders-flow.rmq.json');
    const parsed = JSON.parse(file.text) as {
      format: string;
      version: number;
      name: string;
      document: { queues: object };
    };
    expect(parsed).toMatchObject({ format: 'rmq-playground/canvas', version: 1, name: 'Orders flow' });
    expect(Object.keys(parsed.document.queues)).toHaveLength(1);
    await expect(canvases.notices.getByTestId('toast-message')).toHaveText(
      'Saved “Orders flow” as orders-flow.rmq.json.',
    );
  });

  test('opens a saved file as a new canvas, with the same name and what was on it, and never replaces the canvas it came from', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [{ id: 'orders', name: 'Orders flow', document: small() }]);
    await canvases.goto();
    await canvases.showHome();
    const file = await canvases.downloaded(() => canvases.action('Orders flow', 'Save as file').click());

    await canvases.choose('open-file', file.name, file.text);
    await canvases.editorReady();

    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Orders flow', 'Orders flow']);
    await expect(canvases.editor.node('Exchange orders, direct')).toBeVisible();
    await expect(canvases.editor.node('Queue billing')).toBeVisible();
    await canvases.showHome();
    await expect.poll(() => canvases.cardNames()).toEqual(['Orders flow', 'Orders flow']);
    expect(await canvases.stored()).toEqual(['Orders flow', 'Orders flow']);
  });

  test('says why a file that is not JSON cannot be opened, in a dialog, and adds nothing', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();

    await canvases.choose('open-file', 'broken.json', 'this is not JSON');

    await expect(canvases.confirmation).toHaveAccessibleName('“broken.json” could not be opened');
    await expect(canvases.confirmation).toContainText('This is not JSON, so it cannot be a canvas');
    await expect(canvases.confirmation.getByRole('button', { name: 'OK' })).toBeFocused();
    await canvases.confirmation.getByRole('button', { name: 'OK' }).click();
    await expect(canvases.confirmation).toHaveCount(0);
    expect(await canvases.stored()).toEqual(['Untitled canvas']);
  });

  test('refuses a file from a newer version of the app, and says to reload the page for the newest', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();
    const newer = JSON.stringify({
      format: 'rmq-playground/canvas',
      version: 99,
      name: 'From the future',
      document: emptyDocument(),
    });

    await canvases.choose('open-file', 'future.json', newer);

    await expect(canvases.confirmation).toContainText('saved by a newer version of this app');
    await expect(canvases.confirmation).toContainText('Reload the page to get the newest version');
    await expect(canvases.confirmation).toContainText('Nothing was loaded and nothing was changed.');
    await canvases.confirmation.getByRole('button', { name: 'OK' }).click();
    expect(await canvases.stored()).toEqual(['Untitled canvas']);
  });

  test('says that a backup is a backup, and to put it back with the other button', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();

    await canvases.choose('open-file', 'backup.json', backupText([{ id: 'x', name: 'X', document: emptyDocument() }]));

    await expect(canvases.confirmation).toContainText(
      'This is a backup of several canvases, and not the file of one canvas. Open it as a backup.',
    );
  });

  test('can choose the same file again after a refusal', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();

    await canvases.choose('open-file', 'broken.json', 'nope');
    await canvases.confirmation.getByRole('button', { name: 'OK' }).click();
    await canvases.choose('open-file', 'broken.json', 'nope');

    await expect(canvases.confirmation).toHaveAccessibleName('“broken.json” could not be opened');
  });
});

test.describe('backing up and putting a backup back (ADR-0075)', () => {
  test('gives the learner one file of every canvas that can be read, named by the day, and says what it came to', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'one', name: 'One', document: small() },
      { id: 'two', name: 'Two' },
      { id: 'three', name: 'Three' },
    ]);
    await canvases.goto();
    await canvases.showHome();

    const file = await canvases.downloaded(() =>
      canvases.home.getByRole('button', { name: 'Back up everything' }).click(),
    );

    expect(file.name).toBe(`rmq-playground-backup-${today()}.json`);
    const parsed = JSON.parse(file.text) as { format: string; canvases: { id: string; name: string }[] };
    expect(parsed.format).toBe('rmq-playground/backup');
    expect(parsed.canvases.map(({ id }) => id).sort()).toEqual(['one', 'three', 'two']);
    await expect(canvases.notices.getByTestId('toast-message')).toHaveText(
      `Backed up 3 canvases to ${file.name}. Keep the file somewhere other than this device too: a backup beside the canvases is lost with them.`,
    );
  });

  test('leaves out a canvas that cannot be opened, and says how many', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'one', name: 'One' },
      { id: 'newer', name: 'From a newer app', document: { ...emptyDocument(), schemaVersion: 99 } as never },
    ]);
    await canvases.goto();
    await canvases.showHome();

    const file = await canvases.downloaded(() =>
      canvases.home.getByRole('button', { name: 'Back up everything' }).click(),
    );

    expect((JSON.parse(file.text) as { canvases: unknown[] }).canvases).toHaveLength(1);
    await expect(canvases.notices.getByTestId('toast-message')).toContainText(
      '1 canvas could not be opened and is not in the file.',
    );
  });

  test('says that there is nothing to back up when there is no canvas that can be read, and makes no file', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();
    await canvases.action('Untitled canvas', 'Delete').click();
    await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
    await expect.poll(() => canvases.cardNames()).toEqual([]);

    await canvases.home.getByRole('button', { name: 'Back up everything' }).click();

    await expect(canvases.home.getByTestId('home-problem')).toHaveText(
      /There is nothing to back up: no canvas here can be opened\./,
    );
  });

  test('puts a backup back after everything was deleted, with the ids and the work as they were, and a second time makes nothing new', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'one', name: 'One', document: small() },
      { id: 'two', name: 'Two' },
    ]);
    await canvases.goto();
    await canvases.showHome();
    const backup = await canvases.downloaded(() =>
      canvases.home.getByRole('button', { name: 'Back up everything' }).click(),
    );

    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();
    await canvases.confirmation.getByRole('button', { name: 'Delete all 2 canvases' }).click();
    await expect(canvases.home.getByText(/You have no canvases yet/)).toBeVisible();
    await canvases.choose('restore-file', backup.name, backup.text);

    const report = page.getByRole('dialog', { name: 'Backup restored' });
    await expect(report).toContainText('Put back 2 canvases.');
    await report.getByRole('button', { name: 'OK' }).click();
    await expect.poll(() => canvases.cardNames()).toEqual(['Two', 'One']);
    await expect(canvases.card('One')).toContainText('2 elements');

    await canvases.choose('restore-file', backup.name, backup.text);
    const again = page.getByRole('dialog', { name: 'Nothing was put back' });
    await expect(again).toContainText('2 canvases were already here, and were left as they are.');
    await again.getByRole('button', { name: 'OK' }).click();
    await expect.poll(() => canvases.cardNames()).toEqual(['Two', 'One']);
  });

  test('adds a canvas as a copy when its id is taken by another, and leaves the one that is there', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [{ id: 'one', name: 'One' }]);
    await canvases.goto();
    await canvases.showHome();

    await canvases.choose('restore-file', 'backup.json', backupText([{ id: 'one', name: 'One', document: small() }]));

    const report = page.getByRole('dialog', { name: 'Backup restored' });
    await expect(report).toContainText(
      '1 canvas has the id of a canvas that is here and is different, so it was added as a new canvas: “One (restored)”.',
    );
    await report.getByRole('button', { name: 'OK' }).click();
    await expect.poll(() => canvases.cardNames().then((names) => [...names].sort())).toEqual(['One', 'One (restored)']);
    await expect(canvases.card('One')).toContainText('0 elements');
    await expect(canvases.card('One (restored)')).toContainText('2 elements');
  });

  test('lists a canvas of the file that cannot be read, with its place and its reason, and goes on with the others', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();
    const text = JSON.stringify({
      format: 'rmq-playground/backup',
      version: 1,
      exportedAt: 1,
      canvases: [
        { id: 'fine', name: 'Fine', createdAt: 1, updatedAt: 2, document: emptyDocument() },
        {
          id: 'newer',
          name: 'Broken',
          createdAt: 1,
          updatedAt: 2,
          document: { ...emptyDocument(), schemaVersion: 99 },
        },
      ],
    });

    await canvases.choose('restore-file', 'backup.json', text);

    const report = page.getByRole('dialog', { name: 'Backup restored' });
    await expect(report).toContainText('Put back 1 canvas.');
    await expect(report.getByRole('heading', { level: 3, name: 'What could not be put back' })).toBeVisible();
    await expect(report.getByRole('listitem')).toHaveCount(1);
    await expect(report.getByRole('listitem')).toContainText('Canvas 2 “Broken” could not be read.');
  });

  test('says that the file of one canvas is not a backup, in a dialog', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();
    const one = JSON.stringify({ format: 'rmq-playground/canvas', version: 1, name: 'One', document: emptyDocument() });

    await canvases.choose('restore-file', 'one.json', one);

    await expect(canvases.confirmation).toHaveAccessibleName('“one.json” could not be put back');
    await expect(canvases.confirmation).toContainText(
      'This is the file of one canvas, and not a backup of several. Open it as a canvas.',
    );
  });
});

test.describe('deleting every canvas, after a backup if the learner wants one (ADR-0074)', () => {
  async function three(canvases: CanvasesPage): Promise<void> {
    await seedLibrary(
      canvases.page,
      [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
        { id: 'gamma', name: 'Gamma' },
      ],
      { openCanvases: ['alpha', 'beta'], lastOpenCanvas: 'alpha' },
    );
    await canvases.goto();
    await canvases.showHome();
  }

  test('asks first, says how many there are and what it does, and starts with the cursor on Cancel', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await three(canvases);

    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();

    await expect(canvases.confirmation).toHaveAccessibleName('Delete all 3 canvases?');
    await expect(canvases.confirmation).toHaveAccessibleDescription(
      'This deletes every canvas in this browser: 3 that can be opened. Export a backup first, or take it back with Undo for a short while after.',
    );
    await expect(canvases.confirmation.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });

  test('deletes nothing on Cancel or Escape', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await three(canvases);

    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();
    await canvases.confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(canvases.confirmation).toHaveCount(0);
    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();
    await page.keyboard.press('Escape');

    await expect(canvases.confirmation).toHaveCount(0);
    expect(await canvases.stored()).toEqual(['Alpha', 'Beta', 'Gamma']);
    await expect(canvases.notices).toHaveCount(0);
  });

  test('saves a backup first when asked, says what it saved, and deletes nothing yet', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await three(canvases);
    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();

    const file = await canvases.downloaded(() =>
      canvases.confirmation.getByRole('button', { name: 'Export a backup first' }).click(),
    );

    expect(file.name).toBe(`rmq-playground-backup-${today()}.json`);
    expect((JSON.parse(file.text) as { canvases: unknown[] }).canvases).toHaveLength(3);
    await expect(canvases.confirmation.getByTestId('backup-status')).toContainText(
      `Backed up 3 canvases to ${file.name}.`,
    );
    await expect(canvases.confirmation).toBeVisible();
    expect(await canvases.stored()).toEqual(['Alpha', 'Beta', 'Gamma']);
    await expect(canvases.notices).toHaveCount(0);
  });

  test('deletes every canvas, closes the strip, says how many, and the Undo of the notice brings them all back with the strip', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await three(canvases);
    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();

    await canvases.confirmation.getByRole('button', { name: 'Delete all 3 canvases' }).click();

    await expect(canvases.notices.getByTestId('toast-message')).toHaveText('Deleted all 3 canvases.');
    await expect(canvases.home.getByText(/You have no canvases yet/)).toBeVisible();
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases']);
    await expect(canvases.home.getByRole('button', { name: 'New canvas' })).toBeFocused();
    await expect(canvases.home.getByRole('button', { name: 'Delete all…' })).toHaveCount(0);
    expect(await canvases.stored()).toEqual([]);
    expect(await canvases.tombstones()).toEqual(['Alpha', 'Beta', 'Gamma']);

    await canvases.notices.getByRole('button', { name: 'Undo' }).click();

    await expect
      .poll(() => canvases.cardNames().then((names) => [...names].sort()))
      .toEqual(['Alpha', 'Beta', 'Gamma']);
    await expect.poll(() => canvases.tabs()).toEqual(['My canvases', 'Alpha', 'Beta']);
    expect(await canvases.stored()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  test('takes it back with Control and Z on the home too', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await three(canvases);
    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();
    await canvases.confirmation.getByRole('button', { name: 'Delete all 3 canvases' }).click();
    await expect(canvases.notices).toBeVisible();

    await page.keyboard.press('Control+z');

    await expect.poll(() => canvases.cardNames().then((names) => names.length)).toBe(3);
  });

  test('counts the canvases that cannot be opened, and says that a backup cannot hold them', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'one', name: 'One' },
      { id: 'newer', name: 'From a newer app', document: { ...emptyDocument(), schemaVersion: 99 } as never },
    ]);
    await canvases.goto();
    await canvases.showHome();

    await canvases.home.getByRole('button', { name: 'Delete all…' }).click();

    await expect(canvases.confirmation).toHaveAccessibleName('Delete all 2 canvases?');
    await expect(canvases.confirmation).toContainText(
      '1 that can be opened, and 1 that this version of the app cannot open, which a backup cannot hold.',
    );
    await canvases.confirmation.getByRole('button', { name: 'Delete all 2 canvases' }).click();
    await expect(canvases.home.getByTestId('home-unreadable')).toHaveCount(0);
    await canvases.notices.getByRole('button', { name: 'Undo' }).click();
    await expect(canvases.home.getByTestId('home-unreadable')).toBeVisible();
  });
});

test.describe('what the home says about keeping the canvases (ADR-0075)', () => {
  const old = (): {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    document: ReturnType<typeof small>;
  }[] => [
    { id: 'old', name: 'Old', createdAt: Date.now() - 20 * DAY, updatedAt: Date.now() - 20 * DAY, document: small() },
  ];

  test('reminds the learner of a backup after two weeks, and "Remind me in a week" puts it off, across a reload', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, old());
    await canvases.goto();
    await canvases.showHome();

    const reminder = canvases.home.getByRole('group', { name: 'Reminder to make a backup' });
    await expect(reminder).toContainText('You have never backed up your canvases.');
    await expect(reminder).toContainText('This browser keeps them on this device only');
    await reminder.getByRole('button', { name: 'Remind me in a week' }).click();
    await expect(reminder).toHaveCount(0);

    await page.reload();
    await canvases.heading.waitFor();
    await canvases.editorReady();
    await canvases.showHome();
    await expect(canvases.home.getByRole('group', { name: 'Reminder to make a backup' })).toHaveCount(0);
  });

  test('goes when a backup is made from it, and does not come back', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, old());
    await canvases.goto();
    await canvases.showHome();
    const reminder = canvases.home.getByRole('group', { name: 'Reminder to make a backup' });

    await canvases.downloaded(() => reminder.getByRole('button', { name: 'Back up everything' }).click());

    await expect(reminder).toHaveCount(0);
    await page.reload();
    await canvases.heading.waitFor();
    await canvases.editorReady();
    await canvases.showHome();
    await expect(reminder).toHaveCount(0);
  });

  test('does not remind a learner whose canvases are new, or empty', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await seedLibrary(page, [
      { id: 'new', name: 'New', document: small(), createdAt: Date.now(), updatedAt: Date.now() },
      { id: 'empty', name: 'Empty', createdAt: Date.now() - 30 * DAY, updatedAt: Date.now() - 30 * DAY },
    ]);
    await canvases.goto();
    await canvases.showHome();

    await expect(canvases.home.getByRole('group', { name: 'Reminder to make a backup' })).toHaveCount(0);
  });

  test('says how much room the canvases take, quietly, when the browser says', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    await canvases.showHome();

    await expect(canvases.home.getByTestId('usage')).toContainText(
      /^The canvases take .+ of the .+ that the browser allows\.$/,
    );
  });

  test('warns, in words, when the browser says the room is nearly gone', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await page.addInitScript(() => {
      navigator.storage.estimate = async () => ({ usage: 960, quota: 1_000 });
    });
    await canvases.goto();
    await canvases.showHome();

    await expect(canvases.home.getByTestId('quota')).toContainText(
      'The browser has almost no room left for this app (96% of 1000 B is used).',
    );
    await expect(canvases.home.getByTestId('usage')).toHaveCount(0);
  });

  test('says what the browser said when it did not promise to keep the canvases', async ({ page }) => {
    const canvases = new CanvasesPage(page);
    await page.addInitScript(() => {
      navigator.storage.persist = async () => false;
    });
    await canvases.goto();
    await canvases.showHome();

    await expect(canvases.home.getByTestId('persistence-note')).toContainText(
      'The browser did not promise to keep the canvases.',
    );
  });

  test('says that nothing is kept after the tab is closed when the browser keeps nothing, and the work goes on in memory', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: {
          open() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          },
        },
      });
    });
    await page.goto('?ff=editor,canvases');
    await canvases.heading.waitFor();
    await expect(canvases.editor.saveState).toContainText('Not kept after you close this tab.');
    await canvases.editor.add('Queue');
    await expect(canvases.editor.node('Queue queue1')).toBeVisible();

    await canvases.showHome();

    await expect(canvases.home.getByTestId('memory-note')).toContainText(
      'Nothing here is kept after you close this tab.',
    );
    await expect(canvases.home.getByTestId('memory-note')).toContainText(
      'Save a canvas as a file, or back up everything, to keep your work.',
    );
    await expect.poll(() => canvases.cardNames()).toEqual(['Untitled canvas']);
    await expect(canvases.card('Untitled canvas')).toContainText('1 element');
  });
});
