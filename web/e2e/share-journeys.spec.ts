import { CanvasesPage } from './pages/canvases-page';
import { EditorPage, skipWelcome } from './pages/editor-page';
import { databases, LinkFailedPage, SharedViewPage, SharePage, textOf } from './pages/share-page';
import { SimulationPage } from './pages/simulation-page';
import { goldenLink, GOLDEN_LINKS, payloadFor } from './support/links';
import { ORDERS, ORDERS_COMMANDS } from './support/orders';
import { buildDocument, seedCanvas, seedLibrary } from './support/seed';
import { expect, test } from './support/test';

/**
 * Journey 5 of the plan: sharing (ADR-0013, ADR-0078). A learner makes a link to a canvas, and someone who has nothing of theirs opens it in a browser of their own, looks at it, changes it, and keeps a copy. The
 * second browser is a `visitor`: a context of its own with nothing in its storage, which is what makes "nothing was kept" and "the canvases of the learner are untouched" things that a test can see.
 */

const ORDERS_NODES = ['Producer sender', 'Exchange orders', 'Queue billing', 'Consumer worker'];

test.describe('journey 5: a link to a canvas', () => {
  test('is made from the top bar, copied, and opened by someone who has nothing, who changes it and keeps a copy', async ({
    page,
    visitor,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await seedLibrary(page, [{ id: 'orders', name: 'Orders flow', document: ORDERS }]);
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    const share = new SharePage(page);

    await expect(share.button).toHaveAttribute('aria-haspopup', 'dialog');
    await share.open();
    const link = await share.address();

    await expect(share.dialog).toHaveAccessibleName('Share “Orders flow”');
    expect(link).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/RabbitMqPlayground\/#c=v1\.[A-Za-z0-9_-]+$/);
    await expect(share.length).toHaveText(`The link is ${link.length.toLocaleString('en-US')} characters long.`);
    await expect(share.long).toHaveCount(0);
    await expect(share.link).toHaveAttribute('readonly', '');
    await share.copy.click();
    await expect(share.said).toContainText('Link copied.');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link);
    await share.close.click();
    await expect(share.dialog).toHaveCount(0);
    await expect(share.button).toBeFocused();

    // Someone who has nothing opens it.
    const other = await visitor();
    await other.goto(link);
    const shared = new SharedViewPage(other);
    await shared.ready();
    await expect(shared.name).toHaveText('Shared canvas “Orders flow”');
    await expect(shared.banner).toContainText('You can look around, change things and play. Nothing here is saved.');
    await expect(shared.heading).toHaveText('RabbitMQ Playground');
    await expect(other.getByRole('heading', { level: 1 })).toHaveCount(1);
    for (const node of ORDERS_NODES) {
      await expect(shared.editor.node(node)).toBeVisible();
    }
    await expect(shared.saveCopy).toBeEnabled();
    await expect(shared.leave).toBeEnabled();
    // Nothing is kept: this browser has no database at all, and the link is still in the address.
    expect(await databases(other)).toEqual([]);
    expect(other.url()).toBe(link);

    // They change it here. It stays here, even after the autosave has had its turn.
    await shared.editor.add('Queue');
    await other.waitForTimeout(1_200);
    expect(await databases(other)).toEqual([]);

    // They keep a copy: the page is theirs again, with the copy open, and the link is off the address.
    await shared.saveCopy.click();
    const mine = new CanvasesPage(other);
    await mine.editorReady();
    expect(other.url()).not.toContain('#c=');
    expect(await mine.tabs()).toEqual(['My canvases', 'Orders flow (shared)']);
    expect(await mine.current()).toEqual(['Orders flow (shared)']);
    expect(await mine.stored()).toEqual(['Orders flow (shared)']);
    for (const node of ORDERS_NODES) {
      await expect(mine.editor.node(node)).toBeVisible();
    }
    const saved = await mine.editor.saved();
    expect(Object.values(saved?.queues ?? {}).map(({ name }) => name)).toHaveLength(2);
    await expect(mine.editor.saveState).toHaveText('All changes saved');
    // The learner's own canvas has not been touched by any of it.
    expect(await canvases.stored()).toEqual(['Orders flow']);
  });

  test('is made from the card of a canvas on the home, as the canvas is saved, and from the command share', async ({
    page,
    visitor,
  }) => {
    await seedLibrary(page, [
      { id: 'orders', name: 'Orders flow', document: ORDERS },
      { id: 'blank', name: 'Blank' },
    ]);
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    const share = new SharePage(page);
    await canvases.showHome();

    const card = canvases.card('Orders flow').getByRole('button', { name: 'Share Orders flow', exact: true });
    await expect(card).toHaveAttribute('aria-haspopup', 'dialog');
    await card.click();
    await share.made();
    await expect(share.dialog).toHaveAccessibleName('Share “Orders flow”');
    const fromCard = await share.address();
    await share.close.click();
    await expect(card).toBeFocused();

    await canvases.open('Blank');
    await canvases.editor.openCommandBar();
    await canvases.editor.runCommand('share');
    await share.made();
    await expect(share.dialog).toHaveAccessibleName('Share “Blank”');
    await share.close.click();

    const other = await visitor();
    await other.goto(fromCard);
    const shared = new SharedViewPage(other);
    await shared.ready();
    await expect(shared.name).toHaveText('Shared canvas “Orders flow”');
    for (const node of ORDERS_NODES) {
      await expect(shared.editor.node(node)).toBeVisible();
    }
  });

  test('can be made from the editor alone, without the strip of canvases, and is opened without it too', async ({
    page,
    visitor,
  }) => {
    await seedCanvas(page, ORDERS, 'Orders flow');
    const editor = new EditorPage(page);
    await editor.goto();
    const share = new SharePage(page);
    await share.open();
    const link = await share.address();

    const other = await visitor();
    await other.goto(link);
    const shared = new SharedViewPage(other);
    await shared.ready();

    await expect(shared.name).toHaveText('Shared canvas “Orders flow”');
    await expect(other.getByRole('navigation', { name: 'Open canvases' })).toHaveCount(0);
    await shared.saveCopy.click();
    await new EditorPage(other).saveState.filter({ hasText: 'All changes saved' }).waitFor();
    expect(other.url()).not.toContain('#c=');
    expect(await new EditorPage(other).canvasNames()).toEqual(['Orders flow (shared)']);
  });

  test('puts the copy in front of the canvases that the learner has open, shows it, and leaves theirs as they were', async ({
    visitor,
  }) => {
    // This one has canvases of their own, and is sent a link: the copy joins them, at the start of the strip (the newest first, ADR-0096), and is the one that is shown.
    const other = await visitor();
    await seedLibrary(
      other,
      [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
      ],
      { openCanvases: ['beta', 'alpha'], lastOpenCanvas: 'alpha' },
    );
    await other.goto(`#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`);
    const shared = new SharedViewPage(other);
    await shared.ready();
    await expect(other.getByRole('navigation', { name: 'Open canvases' })).toHaveCount(0);
    const mine = new CanvasesPage(other);
    expect(await mine.stored()).toEqual(['Alpha', 'Beta']);

    await shared.saveCopy.click();

    await mine.editorReady();
    expect(await mine.tabs()).toEqual(['My canvases', 'Orders flow (shared)', 'Beta', 'Alpha']);
    expect(await mine.current()).toEqual(['Orders flow (shared)']);
    expect(await mine.stored()).toEqual(['Alpha', 'Beta', 'Orders flow (shared)']);
    for (const node of ORDERS_NODES) {
      await expect(mine.editor.node(node)).toBeVisible();
    }
  });

  test('has the theme chooser in its banner, and the choice is applied to the page of the link (ADR-0103)', async ({
    visitor,
  }) => {
    const other = await visitor();
    await other.goto(`#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`);
    const shared = new SharedViewPage(other);
    await shared.ready();
    const theme = other.getByRole('combobox', { name: 'Theme' });
    await expect(other.getByRole('banner').getByRole('combobox', { name: 'Theme' })).toHaveCount(1);

    await theme.selectOption('dark');

    await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(other.locator('rmq-editor > div')).toHaveCSS('background-color', 'rgb(11, 16, 32)');
  });

  test('says what a clear came to, with the Undo that brings the canvas back, as it does for the canvases of the browser', async ({
    visitor,
  }) => {
    const other = await visitor();
    await other.goto(`#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`);
    const shared = new SharedViewPage(other);
    await shared.ready();
    await expect(shared.editor.node('Queue billing')).toBeVisible();
    const notices = other.getByRole('region', { name: 'Notices' });

    await other.getByRole('button', { name: 'Clear canvas' }).click();

    await expect(notices.getByTestId('toast-message')).toHaveText('Cleared the canvas.');
    await expect(shared.editor.node('Queue billing')).toHaveCount(0);
    await notices.getByRole('button', { name: 'Undo' }).click();

    await expect(shared.editor.node('Queue billing')).toBeVisible();
    await expect(notices).toHaveCount(0);
    expect(await databases(other)).toEqual([]);
  });

  test('leaves the link when Leave is pressed: the page is as it was before, and nothing of the canvas is kept', async ({
    visitor,
  }) => {
    const link = `#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`;
    const other = await visitor();
    await other.goto(link);
    const shared = new SharedViewPage(other);
    await shared.ready();

    await shared.leave.click();

    // The learner has nothing of their own, so the page they come back to is a first run, and asks what to start with (ADR-0082, ADR-0084).
    await skipWelcome(other);
    const mine = new CanvasesPage(other);
    await mine.editorReady();
    expect(other.url()).not.toContain('#c=');
    expect(other.url()).not.toContain('?');
    expect(await mine.stored()).toEqual(['Untitled canvas']);
    await expect(other.getByTestId('shared-banner')).toHaveCount(0);
  });

  test('opens a link that an earlier build made, with its flags in the query, as it opens any link, and leaves it for a page with no query (ADR-0084)', async ({
    visitor,
  }) => {
    const other = await visitor();

    await other.goto(`?ff=editor,share#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`);

    const shared = new SharedViewPage(other);
    await shared.ready();
    await expect(shared.name).toHaveText('Shared canvas “Orders flow”');
    await expect(shared.editor.node('Queue billing')).toBeVisible();
    await shared.leave.click();
    await skipWelcome(other);
    await new CanvasesPage(other).editorReady();
    expect(other.url()).not.toContain('?');
    expect(other.url()).not.toContain('#c=');
  });

  test('opens a link that is pasted over the one that is open as it opens the first, so that the code that opens one runs once', async ({
    visitor,
  }) => {
    const first = await payloadFor({ name: 'First', document: ORDERS });
    const second = await payloadFor({ name: 'Second', document: buildDocument(ORDERS_COMMANDS.slice(0, 4)) });
    const other = await visitor();
    await other.goto(`#c=${first}`);
    const shared = new SharedViewPage(other);
    await shared.ready();
    await expect(shared.name).toHaveText('Shared canvas “First”');

    await other.evaluate((hash) => {
      window.location.hash = hash;
    }, `#c=${second}`);

    await expect(shared.name).toHaveText('Shared canvas “Second”');
    await shared.ready();
    expect(await databases(other)).toEqual([]);
  });
});

test.describe('journey 5: a link with the messages', () => {
  test('puts them back as the sender left them, with the clock where it was and paused, and they can be played on', async ({
    page,
    visitor,
  }) => {
    const sender = await SimulationPage.open(page, ORDERS, {});
    await sender.editor.select('Producer sender');
    await page.keyboard.press('p');
    await sender.step(2);
    const left = await sender.view();
    const share = new SharePage(page);
    await share.open();

    await expect(share.canvasOnly).toBeChecked();
    await expect(share.withMessages).toBeEnabled();
    const without = await share.address();
    await share.withMessages.check();
    await expect.poll(() => share.address()).not.toBe(without);
    const link = await share.address();
    await expect(share.dialog).toContainText('Whoever opens the link sees the messages where they are now, paused');

    const other = await visitor();
    await other.goto(link);
    const shared = new SharedViewPage(other);
    await shared.ready();
    const receiver = new SimulationPage(shared.editor);
    await receiver.bar.waitFor();

    await expect.poll(async () => (await receiver.state())?.running).toBe(false);
    const arrived = await receiver.view();
    expect(arrived.now).toBe(left.now);
    expect(arrived.published).toBe(left.published);
    expect(arrived.queues).toEqual(left.queues);
    await expect(shared.notice).toHaveCount(0);
    expect(await databases(other)).toEqual([]);

    await receiver.play.click();
    await expect.poll(async () => (await receiver.view()).now, { timeout: 15_000 }).toBeGreaterThan(left.now);
  });

  test('is not offered when nothing is queued, and the panel says so', async ({ page }) => {
    const sender = await SimulationPage.open(page, ORDERS, {});
    const share = new SharePage(sender.page);

    await share.open();

    await expect(share.withMessages).toBeDisabled();
    await expect(share.noMessages).toContainText('No message is on the canvas now');
    await expect(share.canvasOnly).toBeChecked();
  });
});

test.describe('journey 5: a link that is too long to send', () => {
  test('says so and gives the canvas as a file instead, which opens again', async ({ page }) => {
    // A message of ten thousand characters of noise: nothing for the compressor to find, so the link is longer than chat apps keep.
    let seed = 12_345;
    const noise = Array.from({ length: 10_000 }, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[seed % 62];
    }).join('');
    const long = buildDocument([
      ...ORDERS_COMMANDS,
      { type: 'set', kind: 'producer', name: 'sender', changes: { payload: noise } },
    ]);
    await seedLibrary(page, [{ id: 'long', name: 'A long one', document: long }]);
    const canvases = new CanvasesPage(page);
    await canvases.goto();
    const share = new SharePage(page);

    await share.open();

    const link = await share.address();
    expect(link.length).toBeGreaterThan(8_000);
    await expect(share.long).toContainText(
      `This link is ${link.length.toLocaleString('en-US')} characters long. Some chat apps and mail clients cut a link that long`,
    );
    const [download] = await Promise.all([page.waitForEvent('download'), share.download.click()]);
    const file = await textOf(download);
    expect(file.name).toBe('a-long-one.rmq.json');
    expect(JSON.parse(file.text)).toMatchObject({ format: 'rmq-playground/canvas', name: 'A long one' });
    await share.close.click();

    await canvases.showHome();
    await canvases.choose('open-file', file.name, file.text);
    await expect(canvases.editor.saveState).toHaveText('All changes saved');
    // Two canvases may have the same name: a file always opens as a new canvas (ADR-0075).
    expect(await canvases.stored()).toEqual(['A long one', 'A long one']);
  });
});

test.describe('journey 5: links that were made once and are only ever read', () => {
  for (const name of GOLDEN_LINKS) {
    test(`the golden link “${name}” of format 1 opens in this browser as the canvas that it was`, async ({
      visitor,
    }) => {
      const { payload, expected } = goldenLink(name);
      const other = await visitor();

      await other.goto(`#c=${payload}`);

      const shared = new SharedViewPage(other);
      await shared.ready();
      await expect(shared.name).toHaveText(`Shared canvas “${expected.name}”`);
      const elements = ['exchanges', 'queues', 'producers', 'consumers']
        .map((kind) => Object.keys(expected.document[kind] ?? {}).length)
        .reduce((sum, count) => sum + count, 0);
      // Every element is drawn, and the default exchange as well when the canvas says to draw it.
      await expect.poll(() => other.locator('[data-node-id]').count()).toBeGreaterThanOrEqual(elements);
      expect(await other.locator('[data-node-id]').count()).toBeLessThanOrEqual(elements + 1);
      await expect(shared.problem).toHaveCount(0);
    });
  }

  test('the golden link with messages puts them back, paused', async ({ visitor }) => {
    const { payload } = goldenLink('sample-with-messages');
    const other = await visitor();

    await other.goto(`#c=${payload}`);

    const shared = new SharedViewPage(other);
    await shared.ready();
    const simulation = new SimulationPage(shared.editor);
    await simulation.bar.waitFor();
    await expect.poll(async () => (await simulation.state())?.running).toBe(false);
    const view = await simulation.view();
    expect(view.now).toBeGreaterThan(0);
    expect(Object.values(view.queues).reduce((sum, queue) => sum + queue.ready + queue.unacked, 0)).toBeGreaterThan(0);
    await expect(shared.notice).toHaveCount(0);
  });
});

test.describe('journey 5: a link that cannot be opened', () => {
  const cases: readonly [string, (() => Promise<string>) | string, RegExp][] = [
    ['one that is not a link of this app', 'not-a-link', /This is not a link of this app/],
    ['one from a newer app', 'v2.whatever', /newer version of this app/],
    [
      'one that was cut short',
      async () => (await payloadFor({ name: 'Orders flow', document: ORDERS })).slice(0, -9),
      /cut short or was changed on the way/,
    ],
  ];

  for (const [description, payload, reason] of cases) {
    test(`has a page of its own for ${description}: the reason, that nothing was opened, and a way out`, async ({
      visitor,
    }) => {
      const other = await visitor();

      await other.goto(`#c=${typeof payload === 'string' ? payload : await payload()}`);

      const failed = new LinkFailedPage(other);
      await expect(failed.title).toBeVisible();
      await expect(failed.reason).toHaveText(reason);
      await expect(failed.reason).toContainText('nothing was changed');
      await expect(failed.reason).toHaveAttribute('role', 'alert');
      await expect(failed.heading).toHaveText('RabbitMQ Playground');
      await expect(other.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(other.getByRole('complementary', { name: 'Toolbox' })).toHaveCount(0);
      expect(await databases(other)).toEqual([]);
    });
  }

  test('goes back to the playground with the link off the address and no query, when its link is followed', async ({
    visitor,
  }) => {
    const other = await visitor();
    await other.goto('#c=not-a-link');
    const failed = new LinkFailedPage(other);
    await expect(failed.home).toHaveAttribute('href', /\/RabbitMqPlayground\/$/);

    await failed.home.click();

    await skipWelcome(other);
    const mine = new CanvasesPage(other);
    await mine.editorReady();
    expect(other.url()).not.toContain('#c=');
    expect(other.url()).not.toContain('?');
    await expect(failed.title).toHaveCount(0);
  });
});
