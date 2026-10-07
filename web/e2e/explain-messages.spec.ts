import type { Page } from '@playwright/test';
import { ExplainPage } from './pages/explain-page';
import { HEADERS, LONG_LEG, ORDERS, TOPICS } from './support/orders';
import { Finger } from './support/touch';
import { expect, test } from './support/test';

/**
 * What a learner does with one message, in a real browser (ADR-0063): opens it from the log, from the list of a queue and from the canvas, reads what it is, where it is and the route that it took, and asks why
 * a queue did not get it. The clock moves when a test steps it, and a test that says that something did not happen waits two frames first.
 */

const twoFrames = (page: Page): Promise<void> =>
  page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );

const spoken = (page: Page) => page.locator('body > [role="status"][aria-live="polite"]');

/** Publishes from the producer and runs the first thing that happens to the message: it is routed. */
async function routed(explain: ExplainPage, steps = 1): Promise<void> {
  await explain.publish();
  await explain.simulation.step(steps);
}

test.describe('the message inspector, opened from a row of the log (ADR-0063)', () => {
  test('says what the message is, where it is, its payload and headers, in the inspector region above what is selected', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await routed(explain);
    await explain.openByKey();

    await explain.openFromRow('routed');

    await expect(explain.message).toBeVisible();
    await expect(explain.editor.inspector.getByRole('region', { name: 'Message 1' })).toBeVisible();
    await expect(explain.message.getByTestId('message-title')).toHaveText('Message 1');
    await expect(explain.message.getByTestId('message-exchange')).toHaveText('exchange logs');
    await expect(explain.message.getByTestId('message-key')).toHaveText('app.error');
    await expect(explain.message.getByTestId('message-sender')).toHaveText('sender');
    await expect(explain.message.getByTestId('message-time')).toHaveText('0.000 s');
    await expect(explain.message.getByRole('textbox', { name: 'Payload of message 1' })).toHaveValue('disk full');
    await expect(explain.message.getByTestId('message-no-headers')).toHaveText('No headers.');
    // In the broker, which is where the engine says it is, and not where the log last said something.
    await expect(explain.message.getByTestId('message-places')).toHaveText(
      'Inside the broker, on its way to the queues that it was routed to.',
    );
    await expect(spoken(page)).toContainText('Showing it on the canvas.');
    // The message comes before the part of the inspector that is about what is selected.
    const order = await explain.editor.inspector.evaluate((aside) =>
      [...aside.children].map((child) => child.tagName.toLowerCase()),
    );
    expect(order.indexOf('rmq-message-inspector')).toBeLessThan(order.indexOf('rmq-inspector'));
  });

  test('follows the message as the clock moves it, and says what a consumer holds, from the engine and not from the log', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await routed(explain);
    await explain.openByKey();
    await explain.openFromRow('routed');
    const places = explain.message.getByTestId('message-places');
    await expect(places).toHaveText('Inside the broker, on its way to the queues that it was routed to.');

    await explain.simulation.step();
    await expect(places).toHaveText('On its way from billing to worker.');

    await explain.simulation.step();
    await expect(places).toHaveText(
      'Held by worker, which has not acknowledged it: it stays in billing until it does.',
    );
    await expect(explain.message.getByTestId('message-redelivered')).toHaveText('No');
  });

  test('lays a topic key out word by word, the pattern over the key, with what each word came to, for each binding that the message met', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await routed(explain);
    await explain.openByKey();
    await explain.openFromRow('routed');

    await expect(explain.message.getByTestId('route-summary')).toHaveText('Reached errors and everything.');
    const bindings = explain.message.getByTestId('route-binding');
    await expect(bindings).toHaveCount(3);
    await expect(bindings.nth(0)).toHaveAttribute('data-verdict', 'matched');
    await expect(bindings.nth(1)).toHaveAttribute('data-verdict', 'missed');
    await expect(bindings.nth(1)).toContainText('Did not match: queue warnings');
    const table = bindings.nth(1).getByRole('table', { name: 'The pattern and the key, word by word' });
    const rows = await table
      .getByRole('row')
      .evaluateAll((all) =>
        all.map((row) =>
          [...row.querySelectorAll('th, td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim()).join(' '),
        ),
      );
    expect(rows).toEqual(['Pattern * warn', 'Key app error', 'Result matched differs']);
    // A verdict is an icon and a word, and the sentence that says why is the explanation's.
    await expect(bindings.nth(1).getByTestId('binding-text')).toContainText('error');
    await expect(bindings.nth(0).locator('rmq-icon svg').first()).toBeVisible();
  });

  test('says each condition of a headers binding, held or not, with the reason, and the headers of the message with their type', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, HEADERS);
    await routed(explain);
    await explain.openByKey();
    await explain.openFromRow('routed');

    await expect(explain.message.getByTestId('route-summary')).toHaveText('Reached documents.');
    const headers = explain.message.getByTestId('message-headers');
    await expect(headers.getByRole('row')).toHaveText([/Name\s*Type\s*Value/, /formatstring"pdf"/, /bigbooleanfalse/]);
    const conditions = explain.message.getByTestId('header-conditions');
    await expect(conditions).toHaveCount(2);
    const pdfs = conditions.nth(0).getByRole('listitem');
    await expect(pdfs).toHaveText([
      'The header format is "pdf", as the binding asks.',
      'The header big is false, and the binding asks for true.',
    ]);
    await expect(pdfs.nth(0)).toHaveAttribute('data-outcome', 'pass');
    await expect(pdfs.nth(1)).toHaveAttribute('data-outcome', 'fail');
    await expect(explain.message.getByTestId('route-binding').nth(0)).toHaveAttribute('data-verdict', 'missed');
    await expect(explain.message.getByTestId('route-binding').nth(1)).toHaveAttribute('data-verdict', 'matched');
  });

  test('lists the queues that did not get it, each with a button that opens the reasons in place, and closes them again', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await routed(explain);
    await explain.openByKey();
    await explain.openFromRow('routed');
    const queue = explain.message.getByTestId('message-unreached-queue');
    await expect(queue).toHaveCount(1);
    await expect(queue).toHaveAttribute('data-queue', 'warnings');
    const button = queue.getByRole('button', { name: 'Why didn’t it get to warnings?' });
    await expect(button).toHaveAttribute('aria-expanded', 'false');

    await button.click();

    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const reasons = queue.getByTestId('why-not-reasons');
    await expect(reasons.getByTestId('queue-why-text')).toHaveText('The queue warnings did not get the message.');
    await expect(reasons.getByTestId('reason').first()).toHaveAttribute('data-kind', 'binding-did-not-match');
    await expect(reasons.getByTestId('reason').first()).toContainText('"*.warn"');

    await button.click();

    await expect(reasons).toHaveCount(0);
    await expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('shows the Why? of the message on the canvas with its button, and closes with its button and with Escape, which give the keyboard to the canvas', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await routed(explain);
    await explain.openByKey();
    await explain.openFromRow('routed');
    await explain.card.getByRole('button', { name: 'Let go' }).click();
    await expect(explain.card).toHaveCount(0);

    await explain.message.getByRole('button', { name: 'Show it on the canvas' }).click();

    await expect(explain.card.getByTestId('why-card-title')).toHaveText('Why? Message 1');
    await expect(spoken(page)).toHaveText('Showing why message 1 went where it went on the canvas.');
    await explain.expectNodeMark('q1', 'reached');

    await explain.message.getByRole('button', { name: 'Close message 1' }).click();
    await expect(explain.message).toHaveCount(0);
    await expect(explain.editor.flow).toBeFocused();

    await explain.openFromRow('routed');
    await expect(explain.message).toBeVisible();
    await explain.message.getByRole('button', { name: 'Show it on the canvas' }).focus();
    await page.keyboard.press('Escape');
    await expect(explain.message).toHaveCount(0);
    await expect(explain.editor.flow).toBeFocused();
  });

  test('keeps the message open while a queue is selected, and the inspector of the queue says why it did not get the message, in words', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await routed(explain);
    await explain.openByKey();
    await explain.openFromRow('routed');

    await explain.editor.select('Queue warnings');

    await expect(explain.message).toBeVisible();
    const asked = page.getByTestId('queue-asked');
    await expect(asked.getByTestId('queue-asked-title')).toHaveText('Message 1 and this queue');
    await expect(asked.getByTestId('queue-why-text')).toHaveText('The queue warnings did not get the message.');
    await expect(asked.getByTestId('reason').first()).toContainText('"*.warn"');
    await expect(explain.card).toHaveAttribute('data-source', 'queue');
    await explain.expectNodeMark('q2', 'asked');

    await explain.editor.select('Queue errors');
    await expect(asked.getByTestId('queue-why-text')).toHaveText('The queue errors got a copy of the message.');
    await expect(asked.getByTestId('queue-why-path')).toBeVisible();
  });
});

test.describe('the message inspector, opened from the list of a queue (ADR-0063)', () => {
  test('has a button for each message of the list, which opens it with what the list says of it, and marks the one that is open', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await routed(explain, 2);
    await explain.editor.select('Queue errors');
    const list = page.getByTestId('queue-message-list');
    const button = list.getByTestId('open-message');
    await expect(button).toHaveCount(1);
    await expect(button).toContainText('#1 app.error disk full');

    await button.click();

    await expect(explain.message.getByTestId('message-title')).toHaveText('Message 1');
    await expect(button).toHaveAttribute('aria-current', 'true');
    await expect(explain.message.getByTestId('message-places')).toContainText('Ready in errors, number 1 of 1');
    await expect(spoken(page)).toHaveText('Message 1 is open in the inspector.');
  });

  test('says that the route of a message that the log has stopped holding is not kept, and where it would go on the canvas as it is now', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await explain.editor.openCommandBar();
    await explain.editor.runCommand('set sender burst=1000');
    await page.keyboard.press('Escape');
    for (let times = 0; times < 3; times += 1) {
      await explain.publish();
    }
    await explain.simulation.bar.getByRole('button', { name: '4×' }).click();
    await explain.simulation.play.click();
    await expect
      .poll(async () => (await explain.simulation.view()).queues['everything']?.enqueued, { timeout: 20_000 })
      .toBe(3000);
    await explain.simulation.pause.click();
    // The log holds the last 2,000 messages, so the first is not one of them, and the queue still has it, first in its list.
    await explain.editor.select('Queue everything');
    const first = page.getByTestId('queue-message-list').getByTestId('open-message').first();
    await expect(first).toContainText('#1 app.error disk full');

    await first.click();

    await expect(explain.message.getByTestId('message-title')).toHaveText('Message 1');
    await expect(explain.message.getByTestId('message-basis')).toHaveText(
      'Its route is not kept any more. This is where it would go on the canvas as it is now.',
    );
    await expect(explain.message.getByTestId('message-time')).toContainText('not known');
    await expect(explain.message.getByTestId('message-places')).toContainText('Ready in everything');
    await expect(explain.message.getByTestId('route-summary')).toHaveText('Reached errors and everything.');
    // A queue is selected, which is how its list was reached, so the card says why that queue got the message, with the route that it would take now.
    await expect(explain.card.getByTestId('why-card-title')).toHaveText('Why? Message 1 and everything');
  });
});

test.describe('the message inspector, opened from a message on the canvas, while the clock is stopped (ADR-0063)', () => {
  test('opens the message that a press on its shape is on, and the press is not a press on the edge that it is on', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await explain.publish();
    await expect.poll(() => explain.simulation.nextAt()).not.toBeNull();
    const at = await explain.shapeOf(1);
    expect(at.count).toBe(1);

    await page.mouse.click(at.x, at.y);

    await expect(explain.message.getByTestId('message-title')).toHaveText('Message 1');
    await expect(explain.message.getByTestId('message-places')).toHaveText(
      'On its way from its producer to the exchange.',
    );
    await expect(spoken(page)).toHaveText('Message 1 is open in the inspector.');
    // The press was the shape's: the edge under it was not selected.
    await twoFrames(page);
    expect((await page.evaluate(() => window.__rmq?.selection()))?.edges).toEqual([]);
  });

  test('says of a shape that stands for several messages that it does, and where to open one, and opens none', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await explain.editor.openCommandBar();
    await explain.editor.runCommand('set sender burst=3');
    await page.keyboard.press('Escape');
    await explain.publish();
    const at = await explain.shapeOf();
    expect(at.count).toBe(3);

    await page.mouse.click(at.x, at.y);

    await expect(spoken(page)).toHaveText(
      'This shape stands for 3 messages. Open one from the event log or from the list of a queue.',
    );
    await expect(explain.message).toHaveCount(0);
  });

  test('leaves a press on a shape to the canvas while the clock runs, which is not the time for opening a message', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, LONG_LEG);
    await explain.simulation.bar.getByRole('button', { name: '0.25×' }).click();
    await explain.publish();
    await explain.simulation.play.click();
    await expect.poll(async () => (await explain.simulation.frame())?.markers.length).toBe(1);
    const frame = await explain.simulation.frame();
    const host = await explain.simulation.host();
    const marker = frame?.markers[0];
    expect(marker).toBeDefined();

    await page.mouse.click(host.x + (marker?.x ?? 0), host.y + (marker?.y ?? 0));
    await twoFrames(page);
    await twoFrames(page);

    await expect(explain.message).toHaveCount(0);
    // The edge that the shape is on is selected, which is what a press on an edge does.
    await expect.poll(async () => (await page.evaluate(() => window.__rmq?.selection()))?.edges).toEqual(['p1>x1']);
  });
});

test.describe('the message inspector on a finger (ADR-0063)', () => {
  test.use({ hasTouch: true });

  test('opens the message that a tap on its shape is on', async ({ page }) => {
    const explain = await ExplainPage.open(page, TOPICS);
    await explain.publish();
    await expect.poll(() => explain.simulation.nextAt()).not.toBeNull();
    const at = await explain.shapeOf(1);
    const finger = await Finger.on(page);

    await finger.tap({ x: at.x, y: at.y });

    await expect(explain.message.getByTestId('message-title')).toHaveText('Message 1');
    await twoFrames(page);
    expect((await page.evaluate(() => window.__rmq?.selection()))?.edges).toEqual([]);
  });
});
