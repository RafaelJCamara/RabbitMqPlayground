import { SimulationPage } from './pages/simulation-page';
import { expectNoAxeViolations } from './support/axe';
import { ORDERS } from './support/orders';
import { expect, test } from './support/test';

/**
 * What the simulation puts on the screen besides the messages (ADR-0056), in a real browser: the parts that the inspector has for a queue, a producer and a consumer, and the numbers
 * of the nodes, which are the same numbers in both places. Every state of the screen that is new is held to axe, in both themes.
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
