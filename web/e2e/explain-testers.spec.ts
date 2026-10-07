import type { Page } from '@playwright/test';
import { ExplainPage } from './pages/explain-page';
import { TesterPage } from './pages/tester-page';
import { DIAMOND, EMPTY_KEY, HEADERS, TOPICS, UNLINKED, WITH_ARCHIVE } from './support/orders';
import { expect, test } from './support/test';

/**
 * What a learner does with the two testers of the explanation, in a real browser (ADR-0064): the what-if tester, which says where a message would go on the canvas as it is, and the topic tester, which says
 * what a binding key matches while it is being typed. They need the flag `explain` and not the simulation, so most of what is here runs with `editor,explain`, which has no strip and no log, and the journeys
 * that need events run with the three flags. A test that says that something did not happen waits two frames first, so that it is not true only because it looked too soon.
 */

/** Waits for the page to have drawn two frames, so that what was going to change has had its turn. */
const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

test.describe('the what-if tester (ADR-0064)', () => {
  test('is in the region of the inspector with the flag of the explanation alone, shut, and there is no strip and no log with it', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, WITH_ARCHIVE);

    await expect(tester.editor.inspector.getByRole('region', { name: 'What if…?' })).toBeVisible();
    await expect(tester.toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(tester.message).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Simulation' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Event log' })).toHaveCount(0);
    // The key of the log is the page's: it is not said, and it does nothing.
    await expect(tester.editor.hints).not.toContainText('event log');
    await tester.editor.flow.focus();
    await page.keyboard.press('e');
    await twoFrames(page);
    await expect(page.getByRole('region', { name: 'Event log' })).toHaveCount(0);
  });

  test('has none of it with the simulation alone, and is beside the log with both flags', async ({ page }) => {
    const alone = await TesterPage.open(page, WITH_ARCHIVE, { flags: 'editor,simulation' });
    await expect(page.getByRole('region', { name: 'Simulation' })).toBeVisible();
    await expect(alone.section).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Event log' })).toHaveCount(0);
    // The key of the log is the page's: it is not said, and the simulation has keys of its own that are.
    await expect(alone.editor.hints).toContainText('Play or pause the simulation');
    await expect(alone.editor.hints).not.toContainText('event log');

    const both = await TesterPage.open(page, WITH_ARCHIVE, { flags: 'editor,simulation,explain' });
    await expect(both.editor.hints).toContainText('Show or hide the event log');
    await expect(both.section).toBeVisible();
    await expect(page.getByRole('button', { name: 'Event log' })).toBeVisible();
  });

  test('answers where a message would go as it is typed, lights the canvas as Why? does, and says it in a card that closes with its button', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, WITH_ARCHIVE);

    await tester.ask('key=order.new', 'orders (direct)');

    await expect(tester.answer).toHaveText('Would reach billing.');
    await expect(tester.card).toHaveAttribute('data-source', 'what-if');
    await expect(tester.card.getByTestId('why-card-title')).toHaveText('What if? To orders with the key "order.new"');
    await expect(tester.card).toContainText('Would reach billing.');
    await tester.expectNodeMark('x1', 'visited');
    await tester.expectNodeMark('q1', 'reached');
    await tester.expectNodeMark('q2', 'missed');
    await tester.expectEdgeMark('x1>q1', 'path');
    await tester.expectEdgeMark('x1>q2', 'missed');
    await expect.poll(() => tester.reasonOn('x1>q2')).toMatch(/^✗ /);
    // No message was sent, so no producer sent one: what leads to the exchange is not lit.
    await tester.expectNodeMark('p1', null);
    await tester.expectEdgeMark('p1>x1', null);

    await tester.card.getByRole('button', { name: 'Close the tester' }).click();

    await expect(tester.card).toHaveCount(0);
    await expect(tester.toggle).toHaveAttribute('aria-expanded', 'false');
    await tester.expectNodeMark('q1', null);
    await tester.expectEdgeMark('x1>q1', null);
    expect(await tester.emphasis()).toBeNull();
  });

  test('says in the answer and in the card that no queue would get a message that nothing is bound for, and lights the exchange and what it tried', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, WITH_ARCHIVE);

    await tester.ask('key=nobody.wants.this', 'orders (direct)');

    await expect(tester.answer).toHaveText('No queue would get it.');
    await expect(tester.card).toContainText('No queue would get it.');
    await tester.expectNodeMark('x1', 'visited');
    await tester.expectNodeMark('q1', 'missed');
    await tester.expectNodeMark('q2', 'missed');
    // The route is there for the learner who wants the reasons, folded, and says each binding that was tried.
    await expect(tester.route).not.toHaveJSProperty('open', true);
    await tester.route.getByText('The route').click();
    await expect(tester.route.getByTestId('route-summary')).toBeVisible();
  });

  test('publishes nothing and changes nothing: not the document, the selection, the log of commands, the history or the events, and no message is sent', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    const tester = new TesterPage(explain.editor);
    await explain.editor.select('Queue billing');
    const before = {
      document: await tester.document(),
      selection: await tester.selection(),
      commands: await explain.editor.log(),
      events: await explain.texts(),
    };
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();

    await tester.ask('key=order.new header:n=1', 'orders (direct)');
    await expect(tester.answer).toBeVisible();
    await tester.exchange.selectOption({ label: 'The default exchange' });
    await tester.message.fill('key=billing');
    await expect(tester.answer).toHaveText('Would reach billing.');
    await tester.message.fill('key=');
    await twoFrames(page);

    expect(await tester.document()).toBe(before.document);
    expect(await tester.selection()).toEqual(before.selection);
    expect(await explain.editor.log()).toEqual(before.commands);
    expect(await explain.texts()).toEqual(before.events);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
    expect((await explain.simulation.view()).published).toBe(0);
  });

  test('says why a message cannot be read, the cause first and what to write instead, and answers as soon as it can', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, WITH_ARCHIVE);

    await tester.ask('keyy=order.new', 'orders (direct)');

    await expect(tester.message).toHaveAttribute('aria-invalid', 'true');
    await expect(tester.problem).toBeVisible();
    await expect(tester.problem.getByTestId('refusal-message')).toHaveText(
      "There is no option 'keyy' here. Its options are key and payload. Did you mean 'key'?",
    );
    await expect(tester.answer).toHaveCount(0);
    await expect(tester.card).toHaveCount(0);
    expect(await tester.emphasis()).toBeNull();

    await tester.message.fill('key=order.new');

    await expect(tester.message).not.toHaveAttribute('aria-invalid', 'true');
    await expect(tester.problem).toHaveCount(0);
    await expect(tester.answer).toHaveText('Would reach billing.');
  });

  test('asks about the exchange that is selected when it is opened, and lists the default exchange, which every canvas has and sends a message to the queue that its key names', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, TOPICS);
    await tester.editor.select('Exchange logs');

    await tester.show();

    expect(await tester.exchanges()).toEqual(['logs (topic)', 'The default exchange']);
    await expect(tester.exchange).toHaveValue('logs');
    await tester.message.fill('key=app.error');
    await expect(tester.answer).toHaveText('Would reach errors and everything.');

    await tester.exchange.selectOption({ label: 'The default exchange' });
    await tester.message.fill('key=warnings');

    await expect(tester.answer).toHaveText('Would reach warnings.');
    await expect(tester.card.getByTestId('why-card-title')).toHaveText(
      'What if? To the default exchange with the key "warnings"',
    );
    // With the explanation alone there is no simulation to send it to, so no line is offered.
    await expect(tester.line).toHaveCount(0);
  });

  test('says where a message with headers would go, and that a binding that asks for all of its headers is not matched by some', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, HEADERS);

    await tester.ask('header:format=pdf header:big=false', 'files (headers)');

    await expect(tester.answer).toHaveText('Would reach documents.');
    await tester.expectNodeMark('q2', 'reached');
    await tester.expectNodeMark('q1', 'missed');
    await tester.route.getByText('The route').click();
    await expect(tester.route).toContainText('big');
  });

  test('says the reason of a binding that has nothing to say as a chip, on a label of its own', async ({ page }) => {
    const tester = await TesterPage.open(page, EMPTY_KEY);

    await tester.ask('key=other', 'orders (direct)');

    await expect(tester.answer).toHaveText('No queue would get it.');
    await tester.expectEdgeMark('x1>q1', 'missed');
    await expect.poll(() => tester.reasonOn('x1>q1')).toMatch(/^✗ .+/);
    // The reason is a chip of a dashed border, in the colour of a miss, which says it in words.
    await expect(page.locator('[data-edge="x1>q1"] [data-testid="edge-reason"]')).toHaveCSS(
      'border-top-style',
      'dashed',
    );
  });

  test('lights a binding that matched and was not followed as matched, thinner than the way that the message went, and a queue that it reached with a glow', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, DIAMOND);

    await tester.ask('key=any', 'top (fanout)');

    await expect(tester.answer).toHaveText('Would reach shared.');
    await tester.expectEdgeMark('x1>x2', 'path');
    await tester.expectEdgeMark('x1>q1', 'path');
    await tester.expectEdgeMark('x2>q1', 'matched');
    const hit = await tester.tokenColour('--rmq-explain-hit');
    await expect.poll(() => tester.edgeLook('x2>q1')).toMatchObject({ stroke: hit, width: '3px', opacity: '1' });
    await expect.poll(async () => (await tester.edgeLook('x1>q1')).width).toBe('4px');
    await tester.expectNodeMark('q1', 'reached');
    await expect
      .poll(() =>
        page.locator('[data-node-id="q1"] .rmq-node-shape').evaluate((shape) => getComputedStyle(shape).filter),
      )
      .toContain('drop-shadow');
  });

  test('follows the canvas while it is open, and answers again when a binding is taken away', async ({ page }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    const tester = new TesterPage(explain.editor);
    await tester.ask('key=order.cancelled', 'orders (direct)');
    await expect(tester.answer).toHaveText('Would reach archive.');
    await tester.expectNodeMark('q2', 'reached');

    await explain.editor.openCommandBar();
    await explain.editor.runCommand('unbind orders -> archive key=order.cancelled');
    await page.keyboard.press('Escape');

    await expect(tester.answer).toHaveText('No queue would get it.');
    // A queue that the message did not get to is lit as one, whether or not a binding was tried: it is what a learner asks about.
    await tester.expectNodeMark('q2', 'missed');
    await expect(page.locator('[data-edge="x1>q2"]')).toHaveCount(0);
  });

  test('has the line that would send it for real when the simulation is on, and the line does what the tester said', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    const tester = new TesterPage(explain.editor);
    await tester.ask('key=order.new', 'orders (direct)');
    await expect(tester.answer).toHaveText('Would reach billing.');
    await expect(tester.line).toHaveText('publish orders key=order.new');
    const line = (await tester.line.textContent()) ?? '';

    await explain.editor.openCommandBar();
    await explain.editor.runCommand(line);
    await page.keyboard.press('Escape');
    await explain.simulation.step();

    await expect.poll(() => explain.texts()).toContain('Orders routed message 1 to billing');
  });

  test('is for the keyboard: opened with Enter on its button, written in with Tab and the keys, and shut with Escape, which gives the keyboard to its button', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, WITH_ARCHIVE);

    await tester.toggle.focus();
    await page.keyboard.press('Enter');
    await expect(tester.message).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(tester.exchange).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(tester.message).toBeFocused();
    await page.keyboard.type('key=order.new');
    await expect(tester.answer).toHaveText('Would reach billing.');

    await page.keyboard.press('Escape');

    await expect(tester.message).toHaveCount(0);
    await expect(tester.toggle).toBeFocused();
    await expect(tester.toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(tester.card).toHaveCount(0);
  });
});

test.describe('the topic tester (ADR-0064)', () => {
  test('is under the field of the popover that a link from a topic exchange opens, follows what is typed, and makes nothing', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, UNLINKED);

    await tester.editor.dragLinkTo('x1', await tester.editor.centre(tester.editor.nodeById('q1')));

    const popover = tester.keyPopover('exchange logs', 'queue errors');
    await expect(popover).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();
    await expect(popover.getByTestId('topic-tester-empty')).toHaveText('Type a key to see which keys it matches.');
    // The popover is taller for the tester, and it is placed where all of it can be seen.
    await expect(popover).toBeInViewport({ ratio: 1 });

    await page.keyboard.type('*.error');

    const matching = popover.getByTestId('topic-matching');
    await expect(matching.getByTestId('topic-sample')).toHaveCount(2);
    await expect(matching).toContainText('x.error');
    await expect(matching).toContainText('* took "x"');
    await expect(popover.getByTestId('topic-note')).toContainText('The * took an empty word');
    const missing = popover.getByTestId('topic-missing');
    await expect(missing).toContainText('x.errorx');
    await expect(missing).toContainText('last word is "errorx", not "error"');
    await expect(popover).toBeInViewport({ ratio: 1 });
    expect(await tester.editor.edges(), 'nothing is made while the key is typed').toEqual([]);

    await page.keyboard.press('Escape');

    await expect(popover).toHaveCount(0);
    expect(await tester.editor.edges()).toEqual([]);
  });

  test('says why a key with three hash words cannot be a binding key, in the words of the binding, which refuses it in the same words', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, UNLINKED);
    await tester.editor.dragLinkTo('x1', await tester.editor.centre(tester.editor.nodeById('q1')));
    const popover = tester.keyPopover('exchange logs', 'queue errors');
    await expect(page.getByRole('textbox', { name: 'Binding key' })).toBeFocused();

    await page.keyboard.type('a.#.b.#.c.#');

    const said = popover.getByTestId('topic-tester-refusal');
    await expect(said).toContainText("The binding key 'a.#.b.#.c.#' has 3 '#' words");
    await expect(popover.getByTestId('topic-matching')).toHaveCount(0);
    const words = (await said.textContent()) ?? '';

    await page.keyboard.press('Enter');

    await expect(popover.getByTestId('refusal-message')).toContainText(words);
    expect(await tester.editor.edges(), 'the binding was refused').toEqual([]);
  });

  test('is under the key field of a binding in the inspector while the cursor is in it, follows what is typed before the key is changed, and goes with the cursor', async ({
    page,
  }) => {
    const tester = await TesterPage.open(page, TOPICS);
    await tester.selectBinding('x1>q1');
    const row = page.getByRole('group', { name: 'Binding 1 of 1' });
    const key = row.getByRole('textbox', { name: 'Key' });
    await expect(tester.topicTester).toHaveCount(0);

    await key.click();

    await expect(row.getByRole('group', { name: 'What this key matches' })).toBeVisible();
    await expect(row.getByTestId('topic-matching')).toContainText('x.error');
    await key.fill('*.error.#');
    await expect(row.getByTestId('topic-matching')).toContainText('x.error.y');
    expect(await tester.editor.edges(), 'the key is changed when the field is left').toContain(
      'logs -> errors key=*.error',
    );

    await key.press('Tab');

    await expect(tester.topicTester).toHaveCount(0);
    await expect.poll(() => tester.editor.edges()).toContain('logs -> errors key=*.error.#');

    // A field that is left with nothing changed gives up its tester too: there is no new key to draw the row again.
    const again = page.getByRole('group', { name: 'Binding 1 of 1' }).getByRole('textbox', { name: 'Key' });
    await again.click();
    await expect(tester.topicTester).toBeVisible();
    await again.press('Tab');
    await expect(tester.topicTester).toHaveCount(0);
  });

  test('is not offered for a direct exchange, which has no wildcards, or without the flag of the explanation', async ({
    page,
  }) => {
    const direct = await TesterPage.open(page, WITH_ARCHIVE);
    await direct.selectBinding('x1>q1');
    await page.getByRole('group', { name: 'Binding 1 of 1' }).getByRole('textbox', { name: 'Key' }).click();
    await twoFrames(page);
    await expect(direct.topicTester).toHaveCount(0);

    const without = await TesterPage.open(page, TOPICS, { flags: 'editor,simulation' });
    await without.selectBinding('x1>q1');
    await page.getByRole('group', { name: 'Binding 1 of 1' }).getByRole('textbox', { name: 'Key' }).click();
    await twoFrames(page);
    await expect(without.topicTester).toHaveCount(0);

    const unlinked = await TesterPage.open(page, UNLINKED, { flags: 'editor,simulation' });
    await unlinked.editor.dragLinkTo('x1', await unlinked.editor.centre(unlinked.editor.nodeById('q1')));
    await expect(unlinked.keyPopover('exchange logs', 'queue errors')).toBeVisible();
    await twoFrames(page);
    await expect(unlinked.topicTester).toHaveCount(0);
  });

  test('is not in the popover of a direct exchange', async ({ page }) => {
    const tester = await TesterPage.open(page, UNLINKED);

    await tester.editor.dragLinkTo('x2', await tester.editor.centre(tester.editor.nodeById('q1')));

    await expect(tester.keyPopover('exchange jobs', 'queue errors')).toBeVisible();
    await twoFrames(page);
    await expect(tester.topicTester).toHaveCount(0);
  });
});
