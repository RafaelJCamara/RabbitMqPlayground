import { SimulationPage } from './pages/simulation-page';
import { ORDERS } from './support/orders';
import { expect, test } from './support/test';

/**
 * The simulation in a real browser (ADR-0054, ADR-0055, ADR-0056). The engine, the clock, the commands and the parts of the screen are tested alone, with the frames of the page
 * given by a spec; what is here is what only a browser shows: that a message is drawn on the edge that the library drew, that the keys are the page's, and that the numbers of
 * the nodes are the engine's. The clock of the simulation moves when a test steps it, so nothing here waits for time to go by, and each test begins with the clock stopped.
 */

test.describe('a message on its way (ADR-0055)', () => {
  test('goes from the producer to the consumer one step at a time, is drawn on the edge that it is on, and is counted where the engine says it is', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.select('Producer sender');

    await page.keyboard.press('p');

    await expect(simulation.statusText).toHaveText('Published 1 message from sender.');
    let frame = await simulation.settledFrame();
    expect(frame.markers).toMatchObject([{ edge: 'p1>x1', count: 1, key: 'order.new', redelivered: false }]);
    await expect(simulation.statsOf('p1')).toHaveText('sent 1');

    // The message gets to the broker and is routed: it is on the binding now.
    await simulation.step();
    await expect(simulation.statusText).toHaveText('Stepped: message 1 was routed to billing.');
    frame = await simulation.settledFrame();
    expect(frame.markers).toMatchObject([{ edge: 'x1>q1', count: 1 }]);
    await expect(simulation.statsOf('x1')).toHaveText('routed 1 · unroutable 0');

    // It comes into the queue, and the queue gives it to the consumer: it is on the subscription.
    await simulation.step();
    await expect(simulation.statusText).toHaveText(
      'Stepped: message 1 is in billing; billing gave message 1 to worker.',
    );
    frame = await simulation.settledFrame();
    expect(frame.markers).toMatchObject([{ edge: 'q1>c1', count: 1 }]);
    await expect(simulation.statsOf('q1')).toHaveText('0 ready · 1 unacked');
    await expect(simulation.statsOf('c1')).toHaveText('holds 1 of 1 · done 0');

    // It reaches the consumer, and nothing is on the move.
    await simulation.step();
    await expect(simulation.statusText).toHaveText('Stepped: worker received message 1.');
    expect((await simulation.settledFrame()).markers).toEqual([]);

    // The consumer is done with it a second later, and acknowledges it.
    await simulation.step();
    await expect(simulation.statusText).toHaveText(
      'Stepped: worker finished message 1; worker acknowledged message 1.',
    );
    await expect(simulation.statsOf('q1')).toHaveText('0 ready · 0 unacked');
    await expect(simulation.statsOf('c1')).toHaveText('holds 0 of 1 · done 1');
    expect((await simulation.view()).now).toBe(2_300);
    await expect(simulation.stepButton).toBeDisabled();
  });
});

test.describe('what is painted (ADR-0055)', () => {
  test('is a shape on the canvas of the overlay where the frame says it is, and nothing anywhere else, and the canvas is clear when nothing is on its way', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    expect(await simulation.paintedPixels()).toBe(0);
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    const [marker] = (await simulation.settledFrame()).markers;

    expect(marker).toBeDefined();
    expect(await simulation.paintedAt({ x: marker?.x ?? 0, y: marker?.y ?? 0 })).toBe(true);
    expect(await simulation.paintedAt({ x: 3, y: 3 })).toBe(false);
    expect(await simulation.paintedPixels()).toBeGreaterThan(100);

    await simulation.stepThrough();
    await simulation.settledFrame();

    expect(await simulation.paintedPixels()).toBe(0);
  });
});

test.describe('where a message is drawn (ADR-0055)', () => {
  test('is on the path that the library drew for its edge, at every step, and follows a pan and a zoom while the clock is stopped', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    const host = await simulation.host();

    for (const edge of ['p1>x1', 'x1>q1', 'q1>c1']) {
      const frame = await simulation.settledFrame();
      expect(frame.markers).toHaveLength(1);
      const [marker] = frame.markers;
      expect(marker?.edge).toBe(edge);
      // On the path, to the pixel or two that a path made of straight pieces is off the curve.
      expect(await simulation.distanceFromEdge(edge, { x: marker?.x ?? 0, y: marker?.y ?? 0 })).toBeLessThan(2);
      // And on the canvas: inside its host.
      expect(marker?.x).toBeGreaterThan(0);
      expect(marker?.x).toBeLessThan(host.width);
      await simulation.step();
    }

    // Zoomed in, with the clock stopped, a message is drawn again where the edge is now.
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    await expect(simulation.statusText).toHaveText('Published 1 message from sender.');
    await page.getByTestId('zoom-in').click();
    await simulation.editor.settled();
    await expect
      .poll(async () => {
        const [marker] = (await simulation.frame())?.markers ?? [];
        return marker === undefined ? Number.POSITIVE_INFINITY : simulation.distanceFromEdge(marker.edge, marker);
      })
      .toBeLessThan(2);
  });

  test('follows a node that is dragged while the clock is stopped, which draws again the edges that it has', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    await simulation.step();
    const [before] = (await simulation.settledFrame()).markers;
    expect(before?.edge).toBe('x1>q1');
    // The message has just been routed, so it is at the start of the edge, which is where the exchange is.
    const exchange = await page.locator('[data-node-id="x1"]').boundingBox();
    expect(exchange).not.toBeNull();
    const [x, y] = [(exchange?.x ?? 0) + (exchange?.width ?? 0) / 2, (exchange?.y ?? 0) + (exchange?.height ?? 0) / 2];

    // The exchange is held and moved a long way, and not let go: the edge is drawn again for every step of the pointer, and the message is where the edge starts.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 20, y + 20, { steps: 3 });
    await page.mouse.move(x + 40, y + 240, { steps: 12 });

    await expect
      .poll(async () => {
        const [marker] = (await simulation.frame())?.markers ?? [];
        return marker === undefined || marker.y === before?.y
          ? Number.POSITIVE_INFINITY
          : simulation.distanceFromEdge(marker.edge, marker);
      })
      .toBeLessThan(2);
    await page.mouse.up();
  });

  test('follows a pan of the canvas while the clock is stopped, and is on its edge again when the pan is over', async ({
    page,
  }) => {
    const simulation = await SimulationPage.open(page, ORDERS);
    await simulation.editor.select('Producer sender');
    await page.keyboard.press('p');
    const before = (await simulation.settledFrame()).markers[0];
    const host = await simulation.host();

    // A drag on the empty canvas moves it, and the message goes with it.
    const start = { x: host.x + host.width - 60, y: host.y + host.height - 60 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 120, start.y - 40, { steps: 6 });
    await page.mouse.up();

    await expect
      .poll(async () => ((await simulation.frame())?.markers[0]?.x ?? 0) - (before?.x ?? 0))
      .toBeLessThan(-100);
    const after = (await simulation.settledFrame()).markers[0];
    expect(await simulation.distanceFromEdge('p1>x1', { x: after?.x ?? 0, y: after?.y ?? 0 })).toBeLessThan(2);
  });
});
