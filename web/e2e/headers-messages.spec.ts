import { HeadersPage } from './pages/headers-page';
import {
  DIRECT_AND_HEADERS,
  DIRECT_WITH_HEADERS,
  FILES_BOUND,
  FILES_UNBOUND,
  FILES_WITH_X,
  NUMBERS,
  THROUGH_AN_EXCHANGE,
} from './support/headers';
import { expect, test } from './support/test';

/**
 * The messages half of the headers editor in a real browser (S8, ADR-0069, ADR-0070): the table of recent messages against the conditions of a binding, which is in its editor and in the popover that asks for
 * them, and the panel of the message inspector that makes a binding from the message that is open. They need the flags `editor`, `simulation` and `explain`.
 */

test.describe('the table of recent messages against the conditions of a binding (ADR-0070)', () => {
  test('says that no message has been published yet, and what to do about it', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, {});

    await headers.selectBinding('x1>q1');

    const live = headers.conditions().live;
    await expect(live.empty).toHaveText(
      'No message has been published to files yet. Publish one from a producer, and it is checked here.',
    );
    await expect(live.rows).toHaveCount(0);
  });

  test('has a row for each message, newest first, with a cell for each condition and the verdict of the binding, each in words and with an icon', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, {});
    await headers.publish();
    await headers.simulation.stepThrough();
    await headers.publish();
    await headers.simulation.stepThrough();

    await headers.selectBinding('x1>q2');

    const live = headers.conditions().live;
    await expect(live.caption).toHaveText('The 2 messages published to files, newest first.');
    await expect(live.rows).toHaveCount(2);
    // The first column is the message, with its headers, and the last is the verdict.
    await expect(live.scope.getByRole('columnheader')).toHaveText(['Message', 'format=tiff', 'dpi=300', 'Result']);
    await expect(live.rows.nth(0).getByRole('rowheader')).toContainText('#2');
    await expect(live.rows.nth(1).getByRole('rowheader')).toContainText('#1');
    await expect(live.rows.nth(0).getByRole('rowheader')).toContainText('format=pdf type=report');
    expect(await live.words(live.rows.nth(0))).toEqual(['differs', 'missing', 'Does not match']);
    // A verdict is never only a colour: every cell has an icon and a word, and the whole sentence is its title.
    for (const cell of await live.scope.getByTestId('headers-live-cell').all()) {
      await expect(cell.locator('rmq-icon svg')).toBeVisible();
      await expect(cell).toHaveAttribute('title', /\S/);
    }
    await expect(live.rows.nth(0).getByTestId('headers-live-result').locator('rmq-icon svg')).toBeVisible();
  });

  test('is read again when a message is published, with the binding still selected', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, {});
    await headers.selectBinding('x1>q1');
    const live = headers.conditions().live;
    await expect(live.empty).toBeVisible();

    // The message is sent with the command bar, so that what is selected is not changed.
    await headers.editor.openCommandBar();
    await headers.editor.runCommand('publish sender');
    await page.keyboard.press('Escape');

    await expect(live.rows).toHaveCount(1);
    expect(await live.words(live.rows.first())).toEqual(['holds', 'holds', 'Matches']);
    await expect(live.rows.first()).toHaveAttribute('data-matched', 'true');
    await expect(live.empty).toHaveCount(0);
  });

  test('keeps the last ten messages and says how many there were, and a message that is older is not there', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, {});
    await headers.editor.openCommandBar();
    await headers.editor.runCommand('set sender burst=12');
    await headers.editor.runCommand('publish sender');
    await page.keyboard.press('Escape');

    await headers.selectBinding('x1>q1');

    const live = headers.conditions().live;
    await expect(live.rows).toHaveCount(10);
    await expect(live.caption).toHaveText('The last 10 of 12 messages published to files, newest first.');
    await expect(live.rows.first().getByRole('rowheader')).toContainText('#12');
    await expect(live.rows.last().getByRole('rowheader')).toContainText('#3');
  });

  test('has the messages that were published to an exchange that leads to the exchange of the binding, and says so', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, THROUGH_AN_EXCHANGE, {});
    await headers.publish();
    await headers.simulation.stepThrough();

    await headers.selectBinding('x2>q1');

    const live = headers.conditions().live;
    await expect(live.caption).toHaveText(
      'The message published to files or to an exchange that leads to it, newest first.',
    );
    await expect(live.rows).toHaveCount(1);
    expect(await live.words(live.rows.first())).toEqual(['holds', 'Matches']);
  });

  test('is in the popover that asks for the conditions of a binding too, and follows what is typed in it', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_UNBOUND, {});
    await headers.publish();
    await headers.simulation.stepThrough();
    const { editor } = headers;

    await editor.dragLinkTo('x1', await editor.centre(editor.nodeById('q1')));
    const popover = headers.popover('exchange files', 'queue pdfs');
    await expect(popover.live.rows).toHaveCount(1);
    await popover.fill(1, 'format', 'pdf');

    expect(await popover.live.words(popover.live.rows.first())).toEqual(['holds', 'Matches']);
    await popover.value(1).fill('tiff');
    expect(await popover.live.words(popover.live.rows.first())).toEqual(['differs', 'Does not match']);
    await expect(popover.live.rows.first()).toHaveAttribute('data-matched', 'false');
  });

  test('can be scrolled with the keyboard, because it is a region that has the focus', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, {});
    await headers.publish();
    await headers.simulation.stepThrough();
    await headers.selectBinding('x1>q1');

    const region = headers.conditions().live.scope.getByRole('region', {
      name: 'Recent messages against the conditions',
    });

    await expect(region).toHaveAttribute('tabindex', '0');
    await region.focus();
    await expect(region).toBeFocused();
  });
});

test.describe('a binding made from a message (ADR-0070)', () => {
  test('is a section of the message inspector, shut, which opens with its button and lists the headers of the message, all ticked, with their types and values', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_UNBOUND, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;

    await expect(panel.toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.body).toHaveCount(0);
    await panel.show();

    await expect(panel.toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.ticks).toHaveCount(2);
    await expect(panel.tick('format')).toBeChecked();
    await expect(panel.tick('type')).toBeChecked();
    await expect(panel.scope.getByTestId('bind-headers').getByRole('row')).toHaveText([
      /Use\s*Name\s*Type\s*Value/,
      /formatstring"pdf"/,
      /typestring"report"/,
    ]);
    // It starts as the exchange that the message was published to, and the first queue that did not get it, with the mode all.
    await expect(panel.from).toHaveValue('files');
    await expect(panel.to.locator('option:checked')).toHaveText('queue pdfs');
    await expect(panel.mode.mode('all')).toBeChecked();
    await expect(panel.sentence).toHaveText(
      'x-match=all: a message matches when all 2 conditions hold (format and type).',
    );
    await expect(panel.line).toHaveText('bind files -> pdfs x-match=all format=pdf type=report');
    expect(await panel.live.words(panel.live.rows.first())).toEqual(['holds', 'holds', 'Matches']);
    await expect(panel.create).toBeEnabled();
  });

  test('starts with the first queue that did not get the message, and not with the first queue', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_BOUND, {});
    await headers.openLastMessage('routed');

    await headers.bind.show();

    // The message went to pdfs, which is the first queue, and not to scans.
    await expect(headers.bind.to.locator('option:checked')).toHaveText('queue scans');
    await expect(headers.bind.line).toHaveText('bind files -> scans x-match=all format=pdf type=report');
  });

  test('changes what it makes as a header is unticked, another queue is chosen and another mode is, and makes nothing until it is told to', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_UNBOUND, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;
    await panel.show();

    await panel.tick('type').uncheck();
    await expect(panel.line).toHaveText('bind files -> pdfs x-match=all format=pdf');
    await expect(panel.sentence).toHaveText('x-match=all: a message matches when its one condition holds (format).');
    await panel.to.selectOption({ label: 'queue reports' });
    await expect(panel.line).toHaveText('bind files -> reports x-match=all format=pdf');
    await panel.tick('type').check();
    await panel.mode.choose('any');
    await expect(panel.line).toHaveText('bind files -> reports x-match=any format=pdf type=report');

    expect(await headers.bindings()).toEqual([]);
  });

  test('makes the binding that it says, as one line of the log and one step of undo, selects it, and the next message that is like this one is taken', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_UNBOUND, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;
    await panel.show();
    await panel.tick('type').uncheck();
    await panel.to.selectOption({ label: 'queue reports' });

    await panel.create.click();

    await expect(headers.said).toHaveText('Bound exchange files to queue reports.');
    expect(await headers.bindings()).toEqual([
      {
        from: 'files',
        to: 'reports',
        xMatch: 'all',
        args: [{ key: 'format', value: { t: 'string', v: 'pdf' } }],
      },
    ]);
    // The edge is selected, and the inspector below the message shows the binding and its editor.
    await expect(page.getByTestId('inspector-title')).toHaveText('Binding');
    await expect(headers.conditions().scope).toBeVisible();
    await expect(headers.conditions().value(1)).toHaveValue('pdf');
    await expect(headers.chips('x1>q2')).toHaveText(['all · format=pdf']);
    expect(await headers.commands()).toContain('bind files -> reports x-match=all format=pdf');

    await headers.publish();
    await headers.simulation.stepThrough();
    expect((await headers.simulation.view()).queues['reports']?.enqueued).toBe(1);

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => headers.bindings()).toEqual([]);
  });

  test('says what is wrong with a message that has no headers, and makes nothing of it', async ({ page }) => {
    const headers = await HeadersPage.open(page, NUMBERS, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;

    await panel.show();

    await expect(panel.noHeaders).toContainText(
      'This message has no headers, so there is nothing to make a condition of.',
    );
    await expect(panel.create).toHaveCount(0);
  });

  test('says that a canvas with no headers exchange has nothing to bind from, and that an exchange that does not read headers does not', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, DIRECT_WITH_HEADERS, {});
    await headers.openLastMessage('routed');
    const panel = headers.bind;

    await panel.show();

    await expect(panel.noExchange).toHaveText(
      'There is no headers exchange on the canvas. Add one, and a binding to it can be made from here.',
    );
    await expect(panel.create).toHaveCount(0);
  });

  test('can bind from a headers exchange that the message was not published to, and says where the message went', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, DIRECT_AND_HEADERS, {});
    await headers.openLastMessage('routed');
    const panel = headers.bind;

    await panel.show();

    await expect(panel.elsewhere).toContainText(
      'This message was published to the direct exchange orders, which does not read headers.',
    );
    await expect(panel.from).toHaveValue('files');
    await expect(panel.line).toHaveText('bind files -> pdfs x-match=all format=pdf');
    await panel.create.click();
    await expect.poll(() => headers.bindings()).toHaveLength(1);
  });

  test('does not let the header called x-match be a condition, because it is the mode of a binding, and says so', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_WITH_X, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;
    await panel.show();

    await expect(panel.tick('x-match')).toBeDisabled();
    await expect(panel.tick('x-match')).not.toBeChecked();
    await expect(panel.reserved).toContainText("'x-match' is the mode of a headers binding");
    await expect(panel.tick('x-match')).toHaveAttribute('aria-describedby', (await panel.reserved.getAttribute('id'))!);
    await expect(panel.line).toHaveText('bind files -> pdfs x-match=all format=pdf x-region=eu');
  });

  test('says whether an x- header is counted by the mode, and what it makes of the binding when it is ticked', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_WITH_X, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;
    await panel.show();

    await expect(panel.notes).toContainText('The header x-region is not counted');

    await panel.mode.choose('all-with-x');

    await expect(panel.notes).toContainText('The header x-region is counted, because x-match is all-with-x.');
    await expect(panel.line).toHaveText('bind files -> pdfs x-match=all-with-x format=pdf x-region=eu');
  });

  test('says the lint of the binding that it would make: any with nothing that counts matches no message', async ({
    page,
  }) => {
    const headers = await HeadersPage.open(page, FILES_WITH_X, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;
    await panel.show();
    await panel.tick('format').uncheck();
    await expect(panel.lint).toHaveCount(0);

    await panel.mode.choose('any');

    await expect(panel.lint).toContainText('Worth a look');
    await expect(panel.lint).toContainText(
      "The binding from 'files' to 'pdfs' has x-match=any and no condition that counts, so it matches no message: with nothing to match, 'any' matches none.",
    );
  });

  test('forgets what was ticked and chosen when another message is opened, and shuts', async ({ page }) => {
    const headers = await HeadersPage.open(page, FILES_UNBOUND, {});
    await headers.openLastMessage('unroutable');
    const panel = headers.bind;
    await panel.show();
    await panel.tick('type').uncheck();
    await panel.mode.choose('any');

    await headers.publish();
    await headers.simulation.stepThrough();
    await headers.rowsOfKind('unroutable').last().click();
    await expect(headers.message.getByTestId('message-title')).toHaveText('Message 2');

    await expect(panel.toggle).toHaveAttribute('aria-expanded', 'false');
    await panel.show();
    await expect(panel.tick('type')).toBeChecked();
    await expect(panel.mode.mode('all')).toBeChecked();
  });
});
