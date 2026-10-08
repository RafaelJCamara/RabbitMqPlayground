import { ExplainPage } from './pages/explain-page';
import { TesterPage } from './pages/tester-page';
import { coveredNodes } from './support/covered';
import { ORDERS, TWO_WORKERS } from './support/orders';
import { expect, test } from './support/test';

/**
 * Nothing that stays on the screen is drawn over a node (ADR-0085, WCAG 2.4.11). The size of the browser is the one of every test, 1280 by 720, which with the event log open leaves the canvas a little over two
 * hundred pixels tall: the size at which a card in the corner of the canvas covered the middle of a node. Each state below is one that stays (it is there because of the simulation or the document, and is not opened by
 * the learner at a point and dismissed with Escape), and each asks of every node what is at its middle.
 */

test.describe('what stays on the screen does not cover a node', () => {
  test('has teeth: a card put over a node is found, and named', async ({ page }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    expect(await coveredNodes(page)).toEqual([]);

    await page.evaluate(() => {
      const node = document.querySelector('[data-node-id]');
      const box = node?.getBoundingClientRect();
      if (box === undefined) {
        throw new Error('there is no node');
      }
      const card = document.createElement('div');
      card.setAttribute('data-testid', 'a-card-in-the-way');
      Object.assign(card.style, {
        position: 'fixed',
        left: `${box.x - 4}px`,
        top: `${box.y - 4}px`,
        width: `${box.width + 8}px`,
        height: `${box.height + 8}px`,
        zIndex: '50',
      });
      document.body.append(card);
    });

    const covered = await coveredNodes(page);
    expect(covered).toHaveLength(1);
    expect(covered[0]?.by).toBe('a-card-in-the-way');
    expect(explain.editor.page).toBe(page);
  });

  test('has no node covered in the editor with nothing opened, with the simulation and the explanation on', async ({
    page,
  }) => {
    await ExplainPage.open(page, TWO_WORKERS);

    expect(await coveredNodes(page)).toEqual([]);
  });

  test('has no node covered by the card of Why? of the message that was routed last, with the event log open', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.publish();
    await explain.simulation.stepThrough();
    await explain.openByKey();

    await expect(explain.card).toBeVisible();
    expect(await coveredNodes(page)).toEqual([]);
  });

  test('has no node covered with a row of the log chosen, which opens its message and lights what it is about', async ({
    page,
  }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.publish();
    await explain.simulation.stepThrough();
    await explain.openByKey();
    await explain.openFromRow('routed');

    await expect(explain.message).toBeVisible();
    await expect(explain.card).toBeVisible();
    expect(await coveredNodes(page)).toEqual([]);
  });

  test('has no node covered by the card of the what-if tester that answers a message', async ({ page }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.openByKey();
    const tester = new TesterPage(explain.editor);

    await tester.ask('key=order.new');

    await expect(tester.answer).toBeVisible();
    await expect(explain.card).toBeVisible();
    expect(await coveredNodes(page)).toEqual([]);
  });

  test('has the card in the inspector, at its top, and not in the canvas, whatever it is about', async ({ page }) => {
    const explain = await ExplainPage.open(page, ORDERS);
    await explain.publish();
    await explain.simulation.stepThrough();

    await expect(explain.card).toBeVisible();
    await expect(explain.editor.inspector.getByTestId('why-card')).toBeVisible();
    await expect(explain.editor.canvas.getByTestId('why-card')).toHaveCount(0);
  });
});
