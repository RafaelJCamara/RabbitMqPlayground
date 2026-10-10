import type { Page } from '@playwright/test';
import { SimulationPage } from './pages/simulation-page';
import { expectNoAxeViolations } from './support/axe';
import { LONG_LEG, ORDERS } from './support/orders';
import { buildDocument } from './support/seed';
import { expect, test } from './support/test';

/**
 * What the simulation puts on the screen besides the messages (ADR-0056), in a real browser: the parts that the inspector has for a queue, a producer and a consumer, and the numbers
 * of the nodes, which are the same numbers in both places. Every state of the screen that is new is held to axe, in both themes.
 *
 * Every state here is a row of docs/accessibility.md (ADR-0085), and a state without a row fails tools/accessibility/accessibility.spec.ts.
 */

test.describe('the messages of a queue, in its inspector (ADR-0056)', () => {
  test('are listed with their number, key and payload, are counted as the node counts them, and are purged with a button that leaves what a consumer holds', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.openCommandBar();
    for (const payload of ['one', 'two', 'three']) {
      await simulation.editor.runCommand(`publish orders key=order.new payload=${payload}`);
    }
    // Until the first has been given to the consumer, and the others are waiting: two ready, one held.
    await simulation.step(7);
    await simulation.editor.select('Queue billing');

    const section = page.getByTestId('queue-messages');
    await expect(section.getByTestId('queue-counts')).toHaveText(
      '2 messages are ready, and 1 is held and not acknowledged.',
    );
    await expect(simulation.statsOf('q1')).toHaveText('2 ready · 1 unacked');
    await expect(section.getByTestId('queue-message')).toHaveText([
      /#2 order.new two/,
      /#3 order.new three/,
      /#1 order.new one held by worker/,
    ]);

    await section.getByRole('button', { name: 'Purge the ready messages' }).click();

    await expect(simulation.statusText).toHaveText('Purged 2 messages from billing.');
    await expect(section.getByTestId('queue-counts')).toHaveText(
      '0 messages are ready, and 1 is held and not acknowledged.',
    );
    await expect(section.getByRole('button', { name: 'Purge the ready messages' })).toBeDisabled();
    await expect(simulation.statsOf('q1')).toHaveText('0 ready · 1 unacked');
    expect(await simulation.editor.log()).toContain('purge billing');
  });
});

test.describe('the composer of a producer, in its inspector (ADR-0056)', () => {
  test('sets what it sends with the commands that set it, puts back what is refused and says why under the field, and publishes now', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.select('Producer sender');
    const composer = page.getByTestId('producer-composer');

    await composer.getByRole('textbox', { name: 'Payload' }).fill('goodbye');
    await composer.getByRole('textbox', { name: 'Payload' }).press('Tab');
    await composer.getByRole('spinbutton', { name: 'Messages at a time' }).fill('3');
    await composer.getByRole('spinbutton', { name: 'Messages at a time' }).press('Tab');

    expect(await simulation.editor.log()).toEqual(['pause', 'set sender payload=goodbye', 'set sender burst=3']);
    const refused = composer.getByRole('spinbutton', { name: 'Messages at a time' });
    await refused.fill('0');
    await refused.press('Tab');
    await expect(composer.getByTestId('refusal-message')).toContainText('burst');
    await expect(refused).toHaveValue('3');
    await expect(refused).toHaveAttribute('aria-invalid', 'true');

    await composer.getByRole('button', { name: 'Publish now' }).click();

    await expect(simulation.statusText).toHaveText('Published 3 messages from sender.');
    expect((await simulation.frame())?.markers).toMatchObject([{ edge: 'p1>x1', count: 3 }]);
  });

  test('says under the button why a producer that is linked to nothing cannot publish', async ({ page }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('unlink sender');
    await simulation.editor.select('Producer sender');

    await page.getByTestId('producer-composer').getByRole('button', { name: 'Publish now' }).click();

    await expect(page.getByTestId('publish-problem')).toContainText("The producer 'sender' is not linked to anything");
  });
});

/** A producer that publishes to the queue `billing` through the default exchange, and nothing else: the consumer is added by the test, with the commands, and keeps what a new consumer has (ADR-0104). */
const PRODUCER_AND_QUEUE = buildDocument([
  { type: 'add-producer', name: 'sender' },
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'link', producer: 'sender', target: { kind: 'queue', name: 'billing' } },
  { type: 'set', kind: 'producer', name: 'sender', changes: { payload: 'hello' } },
]);

test.describe('a consumer that was just added (ADR-0104)', () => {
  test('acknowledges by hand until it is told otherwise, so that a prefetch of 1 holds one message and leaves the rest in the queue', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, PRODUCER_AND_QUEUE);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('add consumer worker');
    await simulation.editor.runCommand('subscribe worker billing');
    await simulation.editor.runCommand('set worker prefetch=1');
    for (let sent = 0; sent < 3; sent += 1) {
      await simulation.editor.runCommand('publish sender');
    }

    // Until the first has been given to the consumer and the others are waiting: two ready, one held.
    await expect
      .poll(async () => {
        await simulation.step();
        return simulation.statsOf('q1').textContent();
      })
      .toBe('2 ready · 1 unacked');

    await simulation.editor.select('Consumer worker');
    const settings = page.getByTestId('consumer-settings');
    await expect(settings.getByRole('combobox', { name: 'Acknowledges' })).toHaveValue('manual');
    await expect(settings.getByRole('spinbutton', { name: 'Prefetch' })).toHaveValue('1');
    expect(await simulation.editor.log()).toContain('add consumer worker');
  });
});

/** Steps the clock until the list of what a consumer received has a row, as far as a bound says. */
async function stepUntilReceived(simulation: SimulationPage, page: Page, rows = 1): Promise<void> {
  const row = page.getByTestId('consumer-received').getByTestId('received-row');
  for (let steps = 0; steps < 40 && (await row.count()) < rows; steps += 1) {
    await simulation.step();
  }
  await expect(row).toHaveCount(rows);
}

test.describe('what a consumer received, in its inspector (ADR-0098)', () => {
  test('says that nothing was received, and then lists the payload that the producer sent, with where the message is, as the clock moves', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.select('Producer sender');
    const composer = page.getByTestId('producer-composer');
    await composer.getByRole('textbox', { name: 'Payload' }).fill('Hello');
    await composer.getByRole('textbox', { name: 'Payload' }).press('Tab');
    await composer.getByRole('button', { name: 'Publish now' }).click();
    await simulation.editor.select('Consumer worker');
    const received = page.getByTestId('consumer-received');
    await expect(received.getByRole('heading', { name: 'Received' })).toBeVisible();
    await expect(received.getByTestId('received-empty')).toHaveText('No messages received yet.');

    await stepUntilReceived(simulation, page);

    const row = received.getByTestId('received-row');
    await expect(row).toContainText('#1');
    await expect(row).toContainText('order.new');
    await expect(row.getByTestId('received-payload')).toHaveText('Hello');
    await expect(row.getByTestId('received-state')).toHaveText('on its way');
    await expect(received.getByTestId('received-empty')).toHaveCount(0);

    await simulation.step();
    await expect(row.getByTestId('received-state')).toHaveText('received');

    await simulation.stepThrough();
    await expect(row.getByTestId('received-state')).toHaveText('acked');
    await expect(row.getByTestId('received-payload')).toHaveText('Hello');
  });

  test('lists what it received newest first, and cuts a long payload while the message inspector has the whole of it', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    const long = `${'0123456789'.repeat(9)}END`;
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('publish orders key=order.new payload=first');
    await simulation.editor.runCommand(`publish orders key=order.new payload=${long}`);
    await simulation.editor.select('Consumer worker');
    // A second for each, and the second is given when the first has been acknowledged.
    await stepUntilReceived(simulation, page, 1);
    await simulation.stepThrough();
    const received = page.getByTestId('consumer-received');
    await expect(received.getByTestId('received-row')).toHaveCount(2);
    const payloads = received.getByTestId('received-payload');
    await expect(payloads.nth(0)).toHaveText(`${long.slice(0, 79)}…`);
    await expect(payloads.nth(1)).toHaveText('first');

    await received.getByTestId('received-row').nth(0).getByRole('button').click();

    const inspector = page.getByTestId('message-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByTestId('message-payload')).toHaveValue(long);
    await expect(received.getByTestId('received-row').nth(0).getByRole('button')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  test('keeps what the consumer received while another node is looked at', async ({ page }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('publish orders key=order.new payload=kept');
    await simulation.editor.select('Consumer worker');
    await stepUntilReceived(simulation, page);

    await simulation.editor.select('Queue billing');
    await simulation.editor.select('Consumer worker');

    await expect(page.getByTestId('consumer-received').getByTestId('received-payload')).toHaveText('kept');
  });
});

/** Gives `worker` twelve messages, one after another, and steps the clock until it is done with all of them. */
async function twelveReceived(simulation: SimulationPage): Promise<void> {
  await simulation.editor.openCommandBar();
  await simulation.editor.runCommand('set sender burst=12');
  await simulation.editor.runCommand('set worker prefetch=0 processing=1');
  await simulation.editor.runCommand('publish sender');
  await simulation.stepThrough(600);
  await simulation.editor.select('Consumer worker');
}

test.describe('the list of what a consumer received, in pages and with Clear (ADR-0105)', () => {
  test('shows the newest ten, goes to the second page with Next and back with Previous, and is emptied with Clear', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await twelveReceived(simulation);
    const received = page.getByTestId('consumer-received');
    const rows = received.getByTestId('received-row');

    await expect(rows).toHaveCount(10);
    await expect(received.getByTestId('received-page')).toHaveText('Page 1 of 2 · messages 1–10 of 12');
    await expect(rows.first()).toContainText('#12');
    await expect(received.getByRole('button', { name: 'Previous' })).toBeDisabled();

    await received.getByRole('button', { name: 'Next' }).click();

    await expect(rows).toHaveCount(2);
    await expect(received.getByTestId('received-page')).toHaveText('Page 2 of 2 · messages 11–12 of 12');
    await expect(rows.first()).toContainText('#2');
    await expect(received.getByRole('button', { name: 'Previous' })).toBeFocused();
    await expect(received.getByRole('button', { name: 'Next' })).toBeDisabled();

    await received.getByRole('button', { name: 'Previous' }).click();
    await expect(rows).toHaveCount(10);

    await received.getByRole('button', { name: 'Clear' }).click();

    await expect(rows).toHaveCount(0);
    await expect(received.getByTestId('received-empty')).toHaveText('No messages received yet.');
    await expect(received.getByRole('heading', { name: 'Received' })).toBeFocused();
    await expect(received.getByRole('button', { name: 'Clear' })).toBeDisabled();
    await expect(received.getByTestId('received-pages')).toHaveCount(0);
  });

  test('is a view: Clear leaves the queue, the numbers of the nodes and the log as they were, and what comes next starts a list again', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await twelveReceived(simulation);
    const received = page.getByTestId('consumer-received');
    const log = await simulation.editor.log();
    const counts = await simulation.statsOf('c1').textContent();

    await received.getByRole('button', { name: 'Clear' }).click();
    await expect(received.getByTestId('received-row')).toHaveCount(0);

    await expect(simulation.statsOf('c1')).toHaveText(counts ?? '');
    expect(await simulation.editor.log()).toEqual(log);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('set sender burst=1');
    await simulation.editor.runCommand('publish sender');
    await simulation.stepThrough(200);
    await simulation.editor.select('Consumer worker');
    await expect(received.getByTestId('received-row')).toHaveCount(1);
  });

  test('marks what "Clear messages" took out of the simulation as cleared', async ({ page }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('publish orders key=order.new payload=gone');
    await simulation.editor.select('Consumer worker');
    await stepUntilReceived(simulation, page);
    const received = page.getByTestId('consumer-received');
    await expect(received.getByTestId('received-state')).not.toHaveText('acked');

    await simulation.bar.getByTestId('clear-messages').click();

    await expect(received.getByTestId('received-state')).toHaveText('cleared');
  });
});

test.describe('the settings of a consumer, in its inspector (ADR-0056)', () => {
  test('are the commands that set them, and say what the consumer holds, in words', async ({ page }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.select('Consumer worker');
    const settings = page.getByTestId('consumer-settings');
    await expect(settings.getByTestId('consumer-holds')).toHaveText(
      'It holds 0 of the 1 that it may hold and has not acknowledged. It has finished with 0 messages, and 0 are waiting for its turn.',
    );

    await settings.getByRole('spinbutton', { name: 'Prefetch' }).fill('5');
    await settings.getByRole('spinbutton', { name: 'Prefetch' }).press('Tab');
    await settings.getByRole('combobox', { name: 'Acknowledges' }).selectOption('auto');

    expect(await simulation.editor.log()).toEqual(['pause', 'set worker prefetch=5', 'set worker ack=auto']);
    await expect(settings.getByTestId('consumer-holds')).toContainText(
      'It acknowledges as soon as it has a message, so it holds none.',
    );
    await expect(simulation.statsOf('c1')).toHaveText('holds none · done 0');

    const prefetch = settings.getByRole('spinbutton', { name: 'Prefetch' });
    await prefetch.fill('70000');
    await prefetch.press('Tab');
    await expect(settings.getByTestId('refusal')).toBeVisible();
    await expect(prefetch).toHaveValue('5');
  });
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the simulation in the ${theme} theme (ADR-0056)`, () => {
    test('has no axe violations for the strip, the numbers on the nodes and a message on its way', async ({ page }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await simulation.editor.select('Producer sender');
      await page.keyboard.press('p');
      await simulation.step(2);
      await simulation.settledFrame();

      await expectNoAxeViolations(page);
    });

    test('has no axe violations for the strip while the clock runs, with a message on its way', async ({ page }) => {
      // The link takes a minute, so the message is on its way for as long as axe looks, with the clock running.
      const simulation = await SimulationPage.open(page, LONG_LEG, { theme, stop: false });
      await simulation.editor.select('Producer sender');
      await page.keyboard.press('p');
      await expect.poll(async () => (await simulation.frame())?.markers.length).toBe(1);
      await expect(simulation.pause).toBeVisible();

      await expectNoAxeViolations(page);
    });

    test('has no axe violations for the inspector of a queue that holds messages, of a producer and of a consumer', async ({
      page,
    }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await simulation.editor.openCommandBar();
      await simulation.editor.runCommand('publish orders key=order.new payload=one');
      await simulation.editor.runCommand('publish orders key=order.new payload=two');
      await simulation.step(5);

      for (const label of ['Queue billing', 'Producer sender', 'Consumer worker']) {
        await simulation.editor.select(label);
        await expectNoAxeViolations(page);
      }
    });

    test('has no axe violations for the inspector of a consumer that was given messages, one of them with a payload that is cut', async ({
      page,
    }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await simulation.editor.openCommandBar();
      await simulation.editor.runCommand('publish orders key=order.new payload=one');
      await simulation.editor.runCommand(`publish orders key=order.new payload=${'long-payload-'.repeat(10)}`);
      await simulation.editor.select('Consumer worker');
      await stepUntilReceived(simulation, page);
      await simulation.stepThrough();
      await expect(page.getByTestId('consumer-received').getByTestId('received-row')).toHaveCount(2);

      await expectNoAxeViolations(page);
    });

    test('has no axe violations for the list of what a consumer received, on its second page', async ({ page }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await twelveReceived(simulation);
      await page.getByTestId('consumer-received').getByRole('button', { name: 'Next' }).click();
      await expect(page.getByTestId('consumer-received').getByTestId('received-row')).toHaveCount(2);

      await expectNoAxeViolations(page);
    });

    test('has no axe violations for the list of what a consumer received, after Clear', async ({ page }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await twelveReceived(simulation);
      await page.getByTestId('consumer-received').getByRole('button', { name: 'Clear' }).click();
      await expect(page.getByTestId('consumer-received').getByTestId('received-empty')).toBeVisible();

      await expectNoAxeViolations(page);
    });

    test('has no axe violations while a producer that is linked to nothing says under its button why it cannot publish', async ({
      page,
    }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await simulation.editor.openCommandBar();
      await simulation.editor.runCommand('unlink sender');
      await simulation.editor.select('Producer sender');

      await page.getByTestId('producer-composer').getByRole('button', { name: 'Publish now' }).click();

      await expect(page.getByTestId('publish-problem')).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('has no axe violations for a queue that holds more messages than its node and its inspector draw, and a consumer that may hold more than its node draws', async ({
      page,
    }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await simulation.editor.openCommandBar();
      await simulation.editor.runCommand('set sender burst=80');
      await simulation.editor.runCommand('set worker prefetch=20 processing=600000');
      await page.keyboard.press('Escape');
      await simulation.editor.select('Producer sender');
      await page.keyboard.press('p');
      // The consumer takes twenty and is slow with them, and sixty wait: more than the eight squares of the node and the fifty rows of the inspector.
      await simulation.play.click();
      await expect(simulation.statsOf('q1')).toHaveText('60 ready · 20 unacked');
      await simulation.stop();
      await simulation.editor.select('Queue billing');
      await expect(page.getByTestId('queue-more')).toHaveText(/^and \d+ more$/);
      await expect(simulation.editor.nodeById('q1').getByTestId('stack-more')).toBeVisible();
      await expectNoAxeViolations(page);

      await simulation.editor.select('Consumer worker');
      await expect(simulation.editor.nodeById('c1').getByTestId('slots-more')).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('has no axe violations while a field says why it was refused, and while the cheat-sheet lists the keys', async ({
      page,
    }) => {
      const simulation = await SimulationPage.open(page, ORDERS, { theme });
      await simulation.editor.select('Producer sender');
      const burst = page.getByRole('spinbutton', { name: 'Messages at a time' });
      await burst.fill('0');
      await burst.press('Tab');
      await expect(page.getByTestId('refusal')).toBeVisible();
      await expectNoAxeViolations(page);

      await page.getByTestId('help').click();
      await expect(page.getByTestId('cheat-sheet').getByText('Play or pause the simulation')).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
