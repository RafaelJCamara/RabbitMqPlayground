import { SimulationPage } from './pages/simulation-page';
import { EditorPage } from './pages/editor-page';
import { DIRECT_TO_QUEUE, ORDERS, TWO_WORKERS } from './support/orders';
import { seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * What a learner does with the simulation, in a real browser (ADR-0054 to ADR-0056): the controls and the keys, the commands that are the same things typed, what reduced motion
 * changes and does not, and the two things that the first simulator got wrong, which are regression tests here as they are in the engine. The clock moves when a test steps it.
 */

test.describe('the controls and the keys (ADR-0054, ADR-0056)', () => {
  test('play and pause with the button and with Space, step with the button and with the full stop, and say what each did', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.flow.focus();

    await page.keyboard.press(' ');
    await expect(simulation.statusText).toHaveText('Playing at 1×.');
    await expect(simulation.pause).toBeVisible();
    expect((await simulation.state())?.running).toBe(true);

    await page.keyboard.press(' ');
    await expect(simulation.statusText).toHaveText('Paused.');
    await expect(simulation.play).toBeVisible();

    await page.keyboard.press('.');
    await expect(simulation.statusText).toHaveText('Nothing is scheduled, so there is nothing to step.');
    await expect(simulation.stepButton).toBeDisabled();
    await expect(simulation.stepButton).toHaveAttribute(
      'title',
      'Nothing is scheduled, so there is nothing to step to',
    );

    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    await expect(simulation.stepButton).toBeEnabled();
    await page.keyboard.press('.');
    await expect(simulation.statusText).toHaveText('Stepped: message 1 was routed to billing.');
    await simulation.stepButton.click();
    await expect(simulation.statusText).toContainText('Stepped: message 1 is in billing');
  });

  test('says the speed in use, changes it with a button, and writes each thing that was done in the log, as the line that would do it', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);

    await simulation.bar.getByRole('button', { name: '4×' }).click();
    await expect(simulation.bar.getByRole('button', { name: '4×' })).toHaveAttribute('aria-pressed', 'true');
    await expect(simulation.bar.getByRole('button', { name: '1×' })).toHaveAttribute('aria-pressed', 'false');
    expect((await simulation.state())?.speed).toBe(4);
    await expect(simulation.statusText).toHaveText('Speed 4×.');
    await simulation.bar.getByRole('button', { name: '0.25×' }).click();
    expect((await simulation.state())?.speed).toBe(0.25);

    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    await simulation.step();
    await simulation.bar.getByRole('button', { name: 'Reset counters' }).click();
    await simulation.bar.getByRole('button', { name: 'Clear messages' }).click();

    expect(await simulation.editor.log()).toEqual([
      'pause',
      'speed 4',
      'speed 0.25',
      'publish sender',
      'step',
      'reset counters',
      'clear messages',
    ]);
  });

  test('runs by itself when it plays, at the speed that it was given, and stops where it was when it is paused', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.bar.getByRole('button', { name: '4×' }).click();
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');

    await simulation.play.click();

    // What is waited for is what the engine says, and not an amount of time: the message is in the queue and has been given to the consumer.
    await expect.poll(async () => (await simulation.view()).queues['billing']?.delivered, { timeout: 20_000 }).toBe(1);
    await simulation.pause.click();
    const stopped = (await simulation.view()).now;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    expect((await simulation.view()).now).toBe(stopped);
    expect(stopped).toBeGreaterThanOrEqual(800);
  });

  test('is the same when it is typed: publish, step and speed are commands, and what they do is the same', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.openCommandBar();

    await simulation.editor.runCommand('publish sender');
    await expect(simulation.statusText).toHaveText('Published 1 message from sender.');
    await simulation.editor.runCommand('step');
    await expect(simulation.statusText).toHaveText('Stepped: message 1 was routed to billing.');
    await simulation.editor.runCommand('publish orders key=order.new payload=typed');
    await expect(simulation.statusText).toHaveText('Published a message to orders.');
    await simulation.editor.runCommand('speed 2');
    expect((await simulation.state())?.speed).toBe(2);
    await simulation.editor.runCommand('publish ghost');

    // A refusal says the root cause, and does not change the simulation.
    await expect(simulation.editor.commandBar.getByTestId('refusal')).toBeVisible();
    expect((await simulation.view()).published).toBe(2);
  });

  test('has the keys in the cheat-sheet and the hint bar, and says them only with the flag', async ({ page }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.flow.focus();

    await expect(simulation.editor.hints).toContainText('Space');
    await expect(simulation.editor.hints).toContainText('Play or pause the simulation');
    await page.keyboard.press('?');
    const sheet = page.getByTestId('cheat-sheet');
    await expect(sheet.getByText('Play or pause the simulation')).toBeVisible();
    await expect(sheet.getByText('Step to the next event')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('is not there without the flag: no controls, no overlay, no numbers on the nodes, and the keys are the page’s', async ({
    page,
  }) => {
    await seedCanvas(page, ORDERS, 'Plain');
    const editor = new EditorPage(page);
    await editor.goto('?ff=editor');
    await page.waitForFunction(() => (window.__rmq?.drawnEdges().length ?? 0) >= 3);

    await expect(page.getByRole('region', { name: 'Simulation' })).toHaveCount(0);
    await expect(page.locator('rmq-message-overlay')).toHaveCount(0);
    await expect(page.locator('rmq-node-stats')).toHaveCount(0);
    await expect(editor.hints).not.toContainText('Space');
    await editor.select('Producer sender');
    await page.keyboard.press('p');
    await expect(page.getByTestId('status-message')).toHaveCount(0);
    expect(await page.evaluate(() => window.__rmq?.simulationState())).toBeNull();
    expect(await page.evaluate(() => window.__rmq?.overlayFrame())).toBeNull();
  });
});

test.describe('what reduced motion changes (ADR-0055)', () => {
  test('is only how a message is drawn: still, in the middle of its edge, and the engine says the same, step for step', async ({
    context,
    page,
  }) => {
    const normal = await SimulationPage.open(page, ORDERS);
    const viewsOfNormal: unknown[] = [];
    await normal.editor.select('Producer sender');
    await page.keyboard.press('p');
    for (let step = 0; step < 4; step += 1) {
      await normal.step();
      viewsOfNormal.push(await normal.view());
    }
    expect((await normal.settledFrame()).reducedMotion).toBe(false);

    const second = await context.newPage();
    const still = await SimulationPage.open(second, ORDERS, { reducedMotion: true });
    const viewsOfStill: unknown[] = [];
    await still.editor.select('Producer sender');
    await second.keyboard.press('p');
    expect((await still.settledFrame()).reducedMotion).toBe(true);
    const publishing = (await still.settledFrame()).markers;
    // Still, in the middle of the link, with the clock at its start.
    expect(publishing).toMatchObject([{ edge: 'p1>x1', count: 1 }]);
    const middle = await still.middleOf('p1>x1');
    expect(Math.hypot((publishing[0]?.x ?? 0) - middle.x, (publishing[0]?.y ?? 0) - middle.y)).toBeLessThan(2);
    for (let step = 0; step < 4; step += 1) {
      await still.step();
      viewsOfStill.push(await still.view());
    }

    expect(viewsOfStill).toEqual(viewsOfNormal);
    expect(await still.editor.log()).toEqual(await normal.editor.log());
  });

  test('does not slide a message after a step, which jumps to where the clock is at once', async ({ page }) => {
    const simulation = await SimulationPage.open(page, ORDERS, { reducedMotion: true });
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    await simulation.step();

    // At once, and not in a quarter of a second: the first read after the step is already the last.
    const first = JSON.stringify(await simulation.frame());
    const settled = JSON.stringify(await simulation.settledFrame());

    expect(first).toBe(settled);
    expect((await simulation.settledFrame()).markers).toMatchObject([{ edge: 'x1>q1' }]);
  });
});

test.describe('a crowd and a message that came back (ADR-0055)', () => {
  test('is one shape with its count for a burst, and the count is in its place on the engine’s numbers', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('set sender burst=20');
    await simulation.editor.runCommand('publish sender');

    const frame = await simulation.settledFrame();

    expect(frame.markers).toMatchObject([{ edge: 'p1>x1', count: 20, key: 'order.new' }]);
    expect((await simulation.view()).travelling).toBe(20);
    await expect(simulation.statsOf('p1')).toHaveText('sent 20');
    await expect(simulation.readout).toContainText('20 messages on their way');
  });

  test('has a ring when it went back to its queue because its consumer was closed, and goes to the one that is left', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, TWO_WORKERS);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('publish sender');
    await simulation.step(3);
    // The first message is with worker, which has not finished with it.
    await expect(simulation.statsOf('c1')).toHaveText('holds 1 of 1 · done 0');

    await simulation.editor.runCommand('delete worker');
    await expect(simulation.statusText).toContainText('Deleted consumer worker.');

    // What worker held went back to the queue, which gave it at once to helper: it is on the way, with the ring of a message that came back.
    const frame = await simulation.settledFrame();
    expect(frame.markers).toMatchObject([{ edge: 'q1>c2', redelivered: true }]);
    expect((await simulation.view()).channels['c1']).toBeUndefined();
  });
});

test.describe('the default exchange (ADR-0043, ADR-0055)', () => {
  test('is an edge that a message goes along when it is drawn, and a place that it waits at the end of a link when it is not', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, DIRECT_TO_QUEUE);
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    await simulation.step();

    // Not drawn: the message waits at the end of the link that it came along, which is where the broker takes it.
    let frame = await simulation.settledFrame();
    expect(frame.markers).toMatchObject([{ edge: 'p1>q1' }]);
    const end = await simulation.middleOf('p1>q1');
    expect(frame.markers[0]?.x).toBeGreaterThan(end.x);

    await page.getByRole('switch', { name: 'Default exchange' }).click();
    await simulation.editor.settled();
    await expect(page.locator('[data-edge="~default>q1"]')).toHaveCount(1);
    await page.waitForFunction(() => window.__rmq?.drawnEdges().includes('~default>q1') === true);
    frame = await simulation.settledFrame();

    expect(frame.markers).toMatchObject([{ edge: '~default>q1' }]);
    expect(await simulation.distanceFromEdge('~default>q1', frame.markers[0] ?? { x: 0, y: 0 })).toBeLessThan(2);
  });
});

test.describe('the two things that the first simulator got wrong', () => {
  /** Steps through everything that is scheduled, and answers what each consumer was given, by the name of its channel. */
  async function received(simulation: SimulationPage): Promise<Record<string, number>> {
    await simulation.stepThrough();
    const { channels } = await simulation.view();
    return Object.fromEntries(Object.entries(channels).map(([id, channel]) => [id, channel.received]));
  }

  test('regression #10: the first message goes to one consumer, and not to both', async ({ page }) => {
    const simulation = await SimulationPage.open(page, TWO_WORKERS);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('publish sender');

    expect(await received(simulation)).toEqual({ c1: 1, c2: 0 });
  });

  test('deals the next messages out in turn, and every message is given once', async ({ page }) => {
    const simulation = await SimulationPage.open(page, TWO_WORKERS);
    await simulation.editor.openCommandBar();
    for (let message = 0; message < 3; message += 1) {
      await simulation.editor.runCommand('publish sender');
    }

    const given = await received(simulation);

    expect(given).toEqual({ c1: 2, c2: 1 });
    expect((await simulation.view()).published).toBe(3);
    await expect(simulation.statsOf('q1')).toHaveText('0 ready · 0 unacked');
  });

  test('regression #18: a consumer that was deleted is given nothing more, and what it held goes to the one that is left', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, TWO_WORKERS);
    await simulation.editor.openCommandBar();
    await simulation.editor.runCommand('publish sender');
    await simulation.editor.runCommand('publish sender');
    // Until each consumer holds one: the messages are on their way, and then at the consumers.
    await simulation.step(6);
    await expect(simulation.statsOf('c1')).toHaveText('holds 1 of 1 · done 0');
    await expect(simulation.statsOf('c2')).toHaveText('holds 1 of 1 · done 0');

    await simulation.editor.runCommand('delete worker');
    await simulation.editor.runCommand('publish sender');
    await simulation.editor.runCommand('publish sender');
    await simulation.stepThrough();

    const view = await simulation.view();
    // The consumer that was deleted is gone from the engine, and nothing was given to it after that: the one that is left did everything.
    expect(view.channels['c1']).toBeUndefined();
    expect(Object.keys(view.channels)).toEqual(['c2']);
    expect(view.channels['c2']).toMatchObject({ consumed: 4, waiting: 0 });
    expect(view.queues['billing']).toMatchObject({ ready: 0, unacked: 0, consumers: 1 });
    await expect(simulation.statsOf('c2')).toHaveText('holds 0 of 1 · done 4');
  });
});
