import { edgeKeys } from '@rmq/domain';
import { EditorPage } from './pages/editor-page';
import { BIG_CANVAS, BIG_EDGES, BIG_NODES } from './support/big-canvas';
import { seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * How fast a big canvas is drawn (ADR-0036, section 6 of the plan): 200 nodes and 500 edges, from the moment that the page is asked for
 * to the moment that the last edge has been drawn, in under three seconds in CI. The spike measured 349 ms for the first render, so
 * the budget is a guard against a hundredfold slowdown on a shared machine and not a benchmark, and the time is written into the report.
 * Frame rates, with the overlay of S6 running, are measured on real hardware in S12.
 */

const BUDGET_MS = 3_000;

test.describe('a canvas of 200 nodes and 500 edges', () => {
  test('is the size that the plan says', () => {
    const elements =
      Object.keys(BIG_CANVAS.producers).length +
      Object.keys(BIG_CANVAS.exchanges).length +
      Object.keys(BIG_CANVAS.queues).length +
      Object.keys(BIG_CANVAS.consumers).length;

    expect(elements).toBe(BIG_NODES);
    expect(BIG_NODES).toBe(200);
    expect(edgeKeys(BIG_CANVAS).size).toBe(BIG_EDGES);
  });

  test(`is drawn, every node and every edge, within ${BUDGET_MS} ms of the page being asked for`, async ({ page }) => {
    await seedCanvas(page, BIG_CANVAS, 'Big canvas');
    const editor = new EditorPage(page);

    await page.goto('?ff=editor');
    await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
      polling: 'raf',
      timeout: 30_000,
    });
    // The page's own clock, from the start of the navigation: it leaves out starting the browser and the round trips of the test.
    const drawnAt = Math.round(await page.evaluate(() => performance.now()));

    test
      .info()
      .annotations.push({ type: 'drawn', description: `${drawnAt} ms for ${BIG_NODES} nodes and ${BIG_EDGES} edges` });
    expect(drawnAt, `200 nodes and 500 edges took ${drawnAt} ms`).toBeLessThan(BUDGET_MS);
    await expect(page.locator('[data-node-id]')).toHaveCount(BIG_NODES);
    expect(await page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(BIG_EDGES);
    await expect(editor.saveState).toHaveText('All changes saved');
  });

  test(`is drawn within ${BUDGET_MS} ms with the simulation on too, which has the numbers of every node and the overlay of the messages in it`, async ({
    page,
  }) => {
    await seedCanvas(page, BIG_CANVAS, 'Big canvas');
    const editor = new EditorPage(page);

    await page.goto('?ff=editor,simulation');
    await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
      polling: 'raf',
      timeout: 30_000,
    });
    const drawnAt = Math.round(await page.evaluate(() => performance.now()));

    test.info().annotations.push({
      type: 'drawn',
      description: `${drawnAt} ms for ${BIG_NODES} nodes and ${BIG_EDGES} edges, with the simulation on`,
    });
    expect(drawnAt, `200 nodes and 500 edges with the simulation on took ${drawnAt} ms`).toBeLessThan(BUDGET_MS);
    await expect(page.locator('[data-node-id]')).toHaveCount(BIG_NODES);
    await expect(page.locator('rmq-node-stats')).toHaveCount(BIG_NODES);
    await expect(page.locator('rmq-message-overlay')).toHaveCount(1);
    await expect(editor.saveState).toHaveText('All changes saved');
  });

  test(`is drawn within ${BUDGET_MS} ms with the explanation on too, which has the button of the log, the card and the marks in it`, async ({
    page,
  }) => {
    await seedCanvas(page, BIG_CANVAS, 'Big canvas');
    const editor = new EditorPage(page);

    await page.goto('?ff=editor,simulation,explain');
    await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
      polling: 'raf',
      timeout: 30_000,
    });
    const drawnAt = Math.round(await page.evaluate(() => performance.now()));

    test.info().annotations.push({
      type: 'drawn',
      description: `${drawnAt} ms for ${BIG_NODES} nodes and ${BIG_EDGES} edges, with the simulation and the explanation on`,
    });
    expect(drawnAt, `200 nodes and 500 edges with the explanation on took ${drawnAt} ms`).toBeLessThan(BUDGET_MS);
    await expect(page.locator('[data-node-id]')).toHaveCount(BIG_NODES);
    await expect(page.locator('rmq-node-stats')).toHaveCount(BIG_NODES);
    await expect(page.locator('rmq-log-toggle')).toHaveCount(1);
    await expect(editor.saveState).toHaveText('All changes saved');
    // The log is shut and costs nothing, and the card and the marks are there only while something is lit.
    await expect(page.getByTestId('event-log')).toHaveCount(0);
    await expect(page.getByTestId('why-card')).toHaveCount(0);
  });

  test('keeps a burst on a big canvas cheap with the event log open: a thousand events are kept, and the rows that show are the only ones that are drawn', async ({
    page,
  }) => {
    await seedCanvas(page, BIG_CANVAS, 'Big canvas');
    const editor = new EditorPage(page);
    await editor.goto('?ff=editor,simulation,explain');
    await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
      timeout: 30_000,
    });
    await editor.settled();
    await page.getByRole('region', { name: 'Simulation' }).getByRole('button', { name: 'Pause' }).click();
    await editor.flow.focus();
    await page.keyboard.press('e');
    await expect(page.getByRole('region', { name: 'Event log' })).toBeVisible();

    await editor.openCommandBar();
    await editor.runCommand('set p1 burst=1000');
    const started = await page.evaluate(() => performance.now());
    await editor.runCommand('publish p1');
    await expect(page.getByTestId('status-message')).toHaveText('Published 1000 messages from p1.');
    // The thousand events, and the lines of the three commands that made them, are kept, and only the rows that show are in the page.
    await expect
      .poll(async () => (await page.evaluate(() => window.__rmq?.explainEventLog()))?.count)
      .toBeGreaterThanOrEqual(1_000);
    const elapsed = Math.round((await page.evaluate(() => performance.now())) - started);

    test.info().annotations.push({
      type: 'burst',
      description: `${elapsed} ms from the command to the thousandth event in the log`,
    });
    expect(elapsed, `a burst of a thousand messages took ${elapsed} ms with the log open`).toBeLessThan(BUDGET_MS);
    expect(await page.getByTestId('event-log-row').count()).toBeLessThan(30);
    expect((await page.evaluate(() => window.__rmq?.simulationState()))?.view.travelling).toBe(1_000);
  });

  test('lights what a message did on a big canvas within the budget, and says why in a card', async ({ page }) => {
    await seedCanvas(page, BIG_CANVAS, 'Big canvas');
    const editor = new EditorPage(page);
    await editor.goto('?ff=editor,simulation,explain');
    await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
      timeout: 30_000,
    });
    await editor.settled();
    await page.getByRole('region', { name: 'Simulation' }).getByRole('button', { name: 'Pause' }).click();
    await editor.openCommandBar();
    await editor.runCommand('publish p1');
    await editor.runCommand('step');
    const started = await page.evaluate(() => performance.now());

    await expect(page.getByTestId('why-card')).toBeVisible();
    await expect
      .poll(async () => (await page.evaluate(() => window.__rmq?.explainEmphasis()))?.nodes.length)
      .toBeGreaterThan(0);
    const elapsed = Math.round((await page.evaluate(() => performance.now())) - started);

    test.info().annotations.push({
      type: 'lit',
      description: `${elapsed} ms for the card and the marks of a message on a big canvas`,
    });
    expect(elapsed, `lighting a message took ${elapsed} ms`).toBeLessThan(BUDGET_MS);
  });

  test('keeps a burst on a big canvas to a few shapes: a thousand messages are grouped, and the page goes on', async ({
    page,
  }) => {
    await seedCanvas(page, BIG_CANVAS, 'Big canvas');
    const editor = new EditorPage(page);
    await editor.goto('?ff=editor,simulation');
    await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
      timeout: 30_000,
    });
    await editor.settled();
    await page.getByRole('region', { name: 'Simulation' }).getByRole('button', { name: 'Pause' }).click();

    await editor.openCommandBar();
    await editor.runCommand('set p1 burst=1000');
    await editor.runCommand('publish p1');
    await expect(page.getByTestId('status-message')).toHaveText('Published 1000 messages from p1.');

    const frame = await page.evaluate(() => window.__rmq?.overlayFrame());
    expect(frame?.markers.length).toBeLessThanOrEqual(5);
    expect(frame?.markers.reduce((sum, { count }) => sum + count, 0)).toBe(1_000);
    expect((await page.evaluate(() => window.__rmq?.simulationState()))?.view.travelling).toBe(1_000);
  });

  test('can still be worked on once it is drawn: a node is selected and its inspector is shown', async ({ page }) => {
    await seedCanvas(page, BIG_CANVAS, 'Big canvas');
    const editor = new EditorPage(page);
    await editor.goto();
    await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
      timeout: 30_000,
    });
    await editor.settled();

    await editor.flow.focus();
    await page.keyboard.press('Control+a');

    await expect(page.getByTestId('inspector-title')).toHaveText(/^[0-9]+ items selected$/);
    expect(await page.evaluate(() => window.__rmq?.selection().nodes.length)).toBe(BIG_NODES);
  });
});
