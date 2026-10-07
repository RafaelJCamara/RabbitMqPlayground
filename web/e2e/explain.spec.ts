import type { Page } from '@playwright/test';
import { ExplainPage } from './pages/explain-page';
import { DIRECT_TO_QUEUE, ORDERS, WITH_ARCHIVE } from './support/orders';
import { expect, test } from './support/test';

/**
 * What a learner does with the explanation, in a real browser (ADR-0059 to ADR-0064): the event log, what is lit on the canvas and the card that says why. The clock moves when a test steps
 * it, and a test that says that something did not happen waits two frames first, so that it is not true only because it looked too soon.
 */

/** Waits for the page to have drawn two frames, so that what was going to change has had its turn. */
const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

/** The live region that says what the app did, which a screen reader reads. */
const spoken = (page: Page) => page.locator('body > [role="status"][aria-live="polite"]');

test.describe('the event log (ADR-0061)', () => {
  test('is shut until it is asked for, opens with its button and with E, and closes with the button, with Escape and with its own button', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await expect(explain.log).toHaveCount(0);
    await expect(explain.toggle).toHaveAttribute('aria-expanded', 'false');

    await explain.toggle.click();
    await expect(explain.log).toBeVisible();
    await expect(explain.toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(explain.toggle).toHaveAttribute('aria-controls', 'event-log');
    // Opening it gives the keyboard to its list, and the list has the row that the keys are on.
    await expect(explain.list).toBeFocused();
    await explain.toggle.click();
    await expect(explain.log).toHaveCount(0);

    await explain.openByKey();
    await expect(explain.list).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(explain.log).toHaveCount(0);
    await expect(explain.editor.flow).toBeFocused();

    await explain.openByKey();
    await explain.log.getByRole('button', { name: 'Close' }).click();
    await expect(explain.log).toHaveCount(0);
    await expect(explain.editor.flow).toBeFocused();

    // The key says what it did, once, as every key of the editor does.
    await explain.openByKey();
    await expect(spoken(page)).toHaveText('Event log shown.');
    await explain.editor.flow.focus();
    await page.keyboard.press('e');
    await expect(explain.log).toHaveCount(0);
    await expect(spoken(page)).toHaveText('Event log hidden.');
  });

  test('lists what happened in the order that it happened, a command before what it made, with the time of each and its kind as a word', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.openByKey();

    await explain.publish();
    await explain.simulation.step(2);

    expect(await explain.texts()).toEqual([
      'pause',
      'publish sender',
      'Sender published message 1 to orders with key "order.new"',
      'step',
      'Orders routed message 1 to billing',
      'step',
      'Message 1 is in billing, which has 1 ready',
      'Billing gave message 1 to worker',
    ]);
    await expect(explain.rows).toHaveCount(8);
    await expect(explain.log.getByTestId('event-log-count')).toHaveText('8 events');
    const routed = explain.rowsOfKind('routed');
    await expect(routed).toContainText('0.500 s');
    await expect(routed).toContainText('routed');
    await expect(routed).toContainText('Orders routed message 1 to billing');
    // The mark of the family is a picture of its own, in the colour of what the family is about, and the word is in the row besides: colour is not the only sign.
    await expect(routed.locator('rmq-icon svg')).toBeVisible();
    await expect(explain.rowsOfKind('command').first()).toContainText('command');
    await expect(explain.rowsOfKind('command').first()).toContainText('pause');
  });

  test('chooses a row with a click, which lights what it is about and opens nothing else, and says so aloud, once', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    await explain.publish();
    await explain.simulation.step();
    await explain.openByKey();

    await explain.rowsOfKind('published').click();

    await expect(explain.rowsOfKind('published')).toHaveAttribute('aria-selected', 'true');
    await expect(spoken(page)).toHaveText(
      'Sender published message 1 to orders with key "order.new". Showing it on the canvas.',
    );
    // A published row lights the link that the producer sent along and what it is linked to, and not what happened after: the message was routed, and this row is not about that.
    await expect(explain.card).toHaveAttribute('data-source', 'row');
    await expect(explain.card.getByTestId('why-card-title')).toHaveText(/^Event \d+$/);
    expect(await explain.edgeMark('p1>x1')).toBe('path');
    expect(await explain.nodeMark('p1')).toBe('visited');
    expect(await explain.nodeMark('x1')).toBe('visited');
    expect(await explain.nodeMark('q1')).toBeNull();
    expect(await explain.edgeMark('x1>q1')).toBeNull();
  });

  test('moves with the arrow keys and chooses with Enter, and lets go with Escape, and closes with Escape when nothing is lit', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.publish();
    await explain.simulation.step();
    await explain.openByKey();
    // The newest row is where the keys start: the routing of the message.
    await expect(explain.list).toBeFocused();
    const newest = (await explain.eventLog())?.rows.at(-1);
    await expect(explain.list).toHaveAttribute('aria-activedescendant', `rmq-log-row-${newest?.seq}`);

    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');

    // The row that is two above the routing is the `published` row of the message.
    expect(await explain.emphasis()).toMatchObject({ source: 'row', message: 1 });
    expect(await explain.nodeMark('q1')).toBeNull();
    await expect(spoken(page)).toContainText('Showing it on the canvas.');

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await explain.nodeMark('q1')).toBe('reached');

    await page.keyboard.press('Escape');
    await expect(spoken(page)).toHaveText('Let go of what the event showed.');
    await expect(explain.log).toBeVisible();
    // Escape let go of what the row lit, and of the Why? of the last message too, which comes again with the next message.
    expect(await explain.emphasis()).toBeNull();
    await expect(explain.card).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(explain.log).toHaveCount(0);
    await expect(explain.editor.flow).toBeFocused();
  });

  test('says of a row that is about no path that there is nothing to show, and lights nothing', async ({ page }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.openByKey();

    await explain.rowsOfKind('command').first().click();

    await expect(spoken(page)).toHaveText('pause. There is nothing of it to show on the canvas.');
    expect(await explain.emphasis()).toMatchObject({ source: 'row', nodes: [], edges: [] });
    await expect(explain.card).toContainText('There is nothing of it to show on the canvas.');
  });

  test('filters by the kind of event, by node, by message and by words, all together, says how many it shows, and clears them', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    await explain.publish();
    await explain.simulation.step(2);
    await explain.openByKey();
    await expect(explain.rows).toHaveCount(8);

    await explain.log.getByRole('button', { name: 'Commands' }).click();
    await expect(explain.rows).toHaveCount(4);
    await expect(explain.log.getByTestId('event-log-count')).toHaveText('Showing 4 of 8 events');
    await expect(spoken(page)).toHaveText('Showing 4 of 8 events.');
    await expect(explain.log.getByRole('button', { name: 'Commands' })).toHaveAttribute('aria-pressed', 'false');

    await explain.log.getByLabel('Node').selectOption({ label: 'Queue billing' });
    await expect(explain.rows).toHaveCount(3);
    await expect(explain.rowsOfKind('routed')).toHaveCount(1);
    await expect(explain.rowsOfKind('enqueued')).toHaveCount(1);
    await expect(explain.rowsOfKind('delivered')).toHaveCount(1);

    await explain.log.getByLabel('Search').fill('GAVE');
    await expect(explain.rows).toHaveCount(1);
    await expect(explain.rows.first()).toContainText('Billing gave message 1 to worker');
    await explain.log.getByLabel('Message').fill('2');
    await expect(explain.log.getByTestId('event-log-empty')).toHaveText(/No event matches the filters\./);

    await explain.log.getByTestId('event-log-empty').getByRole('button', { name: 'Clear filters' }).click();
    await expect(explain.rows).toHaveCount(8);
    await expect(explain.log.getByLabel('Search')).toHaveValue('');
    await expect(explain.log.getByLabel('Node')).toHaveValue('');
    await expect(explain.log.getByRole('button', { name: 'Commands' })).toHaveAttribute('aria-pressed', 'true');
    await expect(explain.log.getByTestId('event-log-clear')).toHaveCount(0);
  });

  test('keeps the last five thousand events, says how many it dropped, and draws only the rows that the scroll shows', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.editor.openCommandBar();
    await explain.editor.runCommand('set sender burst=1000');
    await page.keyboard.press('Escape');
    await explain.openByKey();

    for (let times = 0; times < 6; times += 1) {
      await explain.publish();
    }

    await expect.poll(async () => (await explain.eventLog())?.count).toBe(5000);
    const kept = await explain.eventLog();
    expect(kept?.dropped).toBeGreaterThan(1000);
    await expect(explain.log.getByTestId('event-log-count')).toHaveText('5,000 events');
    await expect(explain.log.getByTestId('event-log-dropped')).toHaveText(
      `${kept?.dropped.toLocaleString('en-US')} earlier events were dropped: the log keeps the last 5,000.`,
    );
    // Of five thousand rows, the ones that show and a few over are in the page.
    expect(await explain.rows.count()).toBeLessThan(30);
    await expect(explain.rows.last()).toContainText('published message');
    await expect(explain.list).toHaveAttribute('aria-activedescendant', /^rmq-log-row-\d+$/);
  });

  test('follows the newest event while it is scrolled to the end, and stays where it was scrolled to, and goes back with its button', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.editor.openCommandBar();
    await explain.editor.runCommand('set sender burst=200');
    await page.keyboard.press('Escape');
    await explain.openByKey();
    await explain.publish();
    const newestRow = () => explain.rows.last().getAttribute('data-seq');
    const count = async () => (await explain.eventLog())?.count ?? 0;
    await expect.poll(count).toBeGreaterThan(200);
    // The list is at its end, so the row that shows last is the newest.
    await expect.poll(async () => Number(await newestRow())).toBe(await count());

    await explain.list.evaluate((list) => {
      list.scrollTop = 0;
    });
    await expect(explain.log.getByTestId('event-log-latest')).toBeVisible();
    await expect(explain.rows.first()).toHaveAttribute('aria-posinset', '1');
    await explain.publish();
    await expect.poll(count).toBeGreaterThan(400);
    await twoFrames(page);
    // It stayed: the first row is still the first.
    await expect(explain.rows.first()).toHaveAttribute('aria-posinset', '1');

    await explain.log.getByTestId('event-log-latest').click();

    await expect.poll(async () => Number(await newestRow())).toBe(await count());
    await expect(explain.log.getByTestId('event-log-latest')).toHaveCount(0);
  });
});

test.describe('what is lit on the canvas, and the card that says why (ADR-0062)', () => {
  test('lights where the last message went while the clock is stopped, thicker and in the colour of a hit, and where it did not, dimmed and with the reason on its label', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);

    await explain.publish();
    await explain.simulation.step();

    await expect(explain.card).toBeVisible();
    await expect(explain.card.getByTestId('why-card-title')).toHaveText('Why? Message 1 (the last one routed)');
    await expect(explain.card.getByTestId('why-card-text')).toHaveText('Reached billing.');
    // What went somewhere is thick and in the colour of a hit; what was tried and did not match is dimmed and in the colour of a miss.
    await expect(page.locator('[data-edge="x1>q1"]')).toHaveAttribute('data-emphasis', 'path');
    await expect(page.locator('[data-edge="x1>q2"]')).toHaveAttribute('data-emphasis', 'missed');
    const hit = await explain.tokenColour('--rmq-explain-hit');
    const miss = await explain.tokenColour('--rmq-explain-miss');
    await expect.poll(() => explain.edgeLook('x1>q1')).toMatchObject({ stroke: hit, opacity: '1' });
    await expect.poll(async () => (await explain.edgeLook('x1>q1')).width).toBe('4px');
    await expect.poll(() => explain.edgeLook('x1>q2')).toMatchObject({ stroke: miss, opacity: '0.5', width: '2px' });
    await expect.poll(() => explain.nodeLook('q1')).toMatchObject({ stroke: hit, width: '4px' });
    await expect
      .poll(() => explain.nodeLook('q2'))
      .toMatchObject({ stroke: miss, dasharray: '2px, 3px', opacity: '0.7' });
    expect(await explain.nodeMark('x1')).toBe('visited');
    expect(await explain.nodeMark('q2')).toBe('missed');
    // The reason is words, on the label of the binding, which is hidden from a screen reader as the rest of the label is, and the same words are in the page's text elsewhere.
    expect(await explain.reasonOn('x1>q2')).toMatch(/^✗ .+/);
    expect(await explain.reasonOn('x1>q1')).toBeNull();
    expect(await explain.reasonOn('x1>q2')).toContain('order.cancelled');
  });

  test('has a transition of a tenth of a second on what is lit, only on what is lit, and none for a learner who asked for less motion', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    await explain.publish();
    await explain.simulation.step();
    await expect.poll(() => explain.edgeMark('x1>q1')).toBe('path');
    const seconds = (selector: string) =>
      page.locator(selector).evaluate((element) =>
        getComputedStyle(element)
          .transitionDuration.split(',')
          .map((value) => parseFloat(value)),
      );

    await expect.poll(() => seconds('[data-edge="x1>q1"] path.f-connection-path')).toEqual([0.1, 0.1, 0.1]);
    await expect.poll(() => seconds('[data-node-id="q1"] .rmq-node-outline')).toEqual([0.1, 0.1, 0.1]);
    // What is not lit is drawn as it always was: no transition on its stroke.
    expect(await explain.nodeMark('c1')).toBeNull();
    const unlit = await seconds('[data-node-id="c1"] .rmq-node-outline');
    expect(unlit).toEqual([0.08]);

    await page.emulateMedia({ reducedMotion: 'reduce' });

    await expect
      .poll(async () => (await seconds('[data-edge="x1>q1"] path.f-connection-path')).every((value) => value < 0.001))
      .toBe(true);
    await expect
      .poll(async () => (await seconds('[data-node-id="q1"] .rmq-node-outline')).every((value) => value < 0.001))
      .toBe(true);
    // Reduced motion changes how it is drawn and not what is lit.
    expect(await explain.edgeMark('x1>q1')).toBe('path');
    expect(await explain.nodeMark('q1')).toBe('reached');
  });

  test('lights nothing while the clock runs, however many messages are routed, and the Why? of the last one comes back when it is stopped', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.simulation.bar.getByRole('button', { name: '4×' }).click();
    await explain.publish();

    await explain.simulation.play.click();
    await expect.poll(async () => (await explain.simulation.view()).exchanges['orders']?.routed).toBe(1);
    await twoFrames(page);
    await twoFrames(page);

    expect(await explain.emphasis()).toBeNull();
    await expect(explain.card).toHaveCount(0);
    expect(await explain.nodeMark('q1')).toBeNull();

    await explain.simulation.pause.click();

    await expect(explain.card).toContainText('Why? Message 1 (the last one routed)');
    expect(await explain.nodeMark('q1')).toBe('reached');
  });

  test('is let go of with the button of the card, which stays away until the next message is routed, and then follows it', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.editor.openCommandBar();
    await explain.editor.runCommand('set sender burst=2');
    await page.keyboard.press('Escape');
    await explain.publish();
    await explain.simulation.step();
    await expect(explain.card).toBeVisible();

    await explain.card.getByRole('button', { name: 'Let go' }).click();

    await expect(explain.card).toHaveCount(0);
    await twoFrames(page);
    expect(await explain.nodeMark('q1')).toBeNull();
    expect(await explain.edgeMark('x1>q1')).toBeNull();
    expect(await explain.emphasis()).toBeNull();

    await explain.simulation.step();

    await expect(explain.card.getByTestId('why-card-title')).toHaveText('Why? Message 2 (the last one routed)');
    expect(await explain.nodeMark('q1')).toBe('reached');
  });

  test('keeps the accent of what is selected, which the look of what is lit is not allowed to hide', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.publish();
    await explain.simulation.step();
    await expect.poll(() => explain.nodeMark('x1')).toBe('visited');

    await explain.editor.select('Exchange orders, direct');

    const accent = await explain.tokenColour('--rmq-accent');
    const hit = await explain.tokenColour('--rmq-explain-hit');
    await expect.poll(() => explain.nodeLook('x1')).toMatchObject({ stroke: accent });
    expect(accent).not.toBe(hit);
    // What is not selected stays in the colour of a hit.
    await expect.poll(() => explain.nodeLook('q1')).toMatchObject({ stroke: hit });
  });

  test('does not light the implicit bindings of the default exchange with words, because there is one for every queue', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, DIRECT_TO_QUEUE);
    await explain.page.getByRole('switch', { name: 'Default exchange' }).click();
    await explain.publish();
    await explain.simulation.step();

    await expect(explain.card).toContainText('Reached billing.');

    await expect(page.locator('[data-edge="p1>q1"]')).toHaveAttribute('data-emphasis', 'path');
    expect(await explain.nodeMark('q1')).toBe('reached');
    expect(await explain.reasonOn('p1>q1')).toBeNull();
  });

  test('says in the card how many parts of what is lit are not on the canvas any more, and keeps what is still there lit', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    await explain.publish();
    await explain.simulation.step();
    await expect(explain.card).toBeVisible();
    await expect.poll(() => explain.nodeMark('q2')).toBe('missed');
    await expect(explain.card.getByTestId('why-card-gone')).toHaveCount(0);

    await explain.editor.openCommandBar();
    await explain.editor.runCommand('delete archive');
    await page.keyboard.press('Escape');

    // The queue and its binding are two parts of what was lit, and both are gone: what was lit and is still there stays lit.
    await expect(explain.card.getByTestId('why-card-gone')).toHaveText(
      '2 parts of this are not on the canvas any more.',
    );
    expect(await explain.nodeMark('q1')).toBe('reached');
    expect(await explain.edgeMark('x1>q1')).toBe('path');
  });

  test('keeps what is lit when a node that it lights is renamed, because it is found by what it is and not by what it is called', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    await explain.publish();
    await explain.simulation.step();
    await expect.poll(() => explain.nodeMark('q1')).toBe('reached');

    await explain.editor.openCommandBar();
    await explain.editor.runCommand('rename billing invoices');
    await page.keyboard.press('Escape');

    await expect(explain.editor.node('Queue invoices')).toBeVisible();
    expect(await explain.nodeMark('q1')).toBe('reached');
    expect(await explain.edgeMark('x1>q1')).toBe('path');
    await expect(explain.card.getByTestId('why-card-gone')).toHaveCount(0);
  });

  test('asks about a queue that is selected: the message that was routed last, and why that queue did not get it, with the way that stopped it', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, WITH_ARCHIVE);
    await explain.publish();
    await explain.simulation.step();

    await explain.editor.select('Queue archive');

    await expect(explain.card).toHaveAttribute('data-source', 'queue');
    await expect(explain.card.getByTestId('why-card-title')).toHaveText('Why? Message 1 and archive');
    await expect(explain.card.getByTestId('why-card-text')).toContainText('The queue archive did not get the message.');
    expect(await explain.nodeMark('q2')).toBe('asked');
    expect(await explain.edgeMark('x1>q2')).toBe('missed');
    const asked = await explain.tokenColour('--rmq-explain-asked');
    // The queue has a ring of its own, which is the colour of asking and is not the accent that its selection has.
    await expect
      .poll(() => page.locator('[data-node-id="q2"] .rmq-node-ring').evaluate((ring) => getComputedStyle(ring).stroke))
      .toBe(asked);
    expect(await explain.reasonOn('x1>q2')).toContain('order.cancelled');

    await explain.card.getByRole('button', { name: 'Stop asking' }).click();

    await expect(explain.card).toHaveCount(0);
    expect((await page.evaluate(() => window.__rmq?.selection()))?.nodes).toEqual([]);
    expect(await explain.nodeMark('q2')).toBeNull();
  });
});
