import type { Page } from '@playwright/test';
import { CanvasesPage } from './pages/canvases-page';
import { ExplainPage } from './pages/explain-page';
import { TesterPage } from './pages/tester-page';
import { coveredNodes, focusCoveredBy, reachable } from './support/covered';
import { ORDERS, TWO_WORKERS } from './support/orders';
import { holdNotices } from './support/hold-notices';
import { seedLibrary } from './support/seed';
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

/**
 * The notices float at the bottom right (ADR-0097), over the inspector in the editor and over the foot of the home, and they cover nothing that the learner needs (ADR-0085, WCAG 2.4.11): not a node, not the last
 * card of the home, and not the control that has the cursor.
 */
test.describe('what floats at the bottom right does not cover what is needed', () => {
  /** Makes three notices on the home by deleting three canvases, one after another. */
  async function threeNoticesOnTheHome(canvases: CanvasesPage, names: readonly string[]): Promise<void> {
    for (const name of names) {
      await canvases.action(name, 'Delete').click();
      await canvases.confirmation.getByRole('button', { name: 'Delete canvas' }).click();
      await expect(canvases.confirmation).toHaveCount(0);
    }
    await expect(canvases.notices.getByTestId('toast')).toHaveCount(3);
  }

  const MANY = Array.from({ length: 12 }, (_, index) => ({
    id: `c${index + 1}`,
    name: `Canvas ${String(index + 1).padStart(2, '0')}`,
    updatedAt: 100_000 - index,
  }));

  /** Three notices from the home, and then a canvas opened from its card: the notices go on floating over the editor, and a producer is there for the inspector to say something. */
  async function editorWithThreeNotices(page: Page): Promise<CanvasesPage> {
    const canvases = new CanvasesPage(page);
    await holdNotices(page);
    await seedLibrary(page, MANY);
    await canvases.goto();
    await canvases.showHome();
    await threeNoticesOnTheHome(canvases, ['Canvas 01', 'Canvas 02', 'Canvas 03']);
    await canvases.open('Canvas 04');
    await canvases.editor.add('Producer');
    await expect(canvases.notices.getByTestId('toast')).toHaveCount(3);
    return canvases;
  }

  test('has the delete of every card reachable on the home with three notices, at the foot of the page', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await holdNotices(page);
    await seedLibrary(page, MANY);
    await canvases.goto();
    await canvases.showHome();

    await threeNoticesOnTheHome(canvases, ['Canvas 01', 'Canvas 02', 'Canvas 03']);
    await canvases.home.evaluate((main) => main.scrollTo(0, main.scrollHeight));

    const stack = await canvases.notices.boundingBox();
    const home = await canvases.home.boundingBox();
    expect(stack && home).toBeTruthy();
    // At the right, 20 rem wide, and at the foot of the page.
    expect(stack!.width).toBeLessThanOrEqual(321);
    expect(stack!.x + stack!.width).toBeGreaterThan(1270);
    expect(stack!.y + stack!.height).toBeLessThanOrEqual(720);
    expect(stack!.y).toBeGreaterThan(home!.y + 100);
    const deletes = await reachable(page, '[data-testid="card-delete"]');
    const boxes = await canvases.home.getByTestId('card-delete').evaluateAll((buttons) =>
      buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right };
      }),
    );
    // The nine cards that are left: the ones at the foot of the page, which are in sight, are not under the stack.
    expect(deletes).toHaveLength(9);
    for (const [index, box] of boxes.entries()) {
      const inSight = box.bottom > home!.y && box.top < home!.y + home!.height;
      const underStack = box.bottom > stack!.y && box.right > stack!.x && box.left < stack!.x + stack!.width;
      if (inSight) {
        expect(deletes[index], `the delete of card ${index + 1}`).toBe(true);
      }
      expect(underStack, `the delete of card ${index + 1} is under the notices`).toBe(false);
    }
  });

  test('leaves the control that has the cursor in sight as the page is crossed with Tab, with three notices over its foot', async ({
    page,
  }) => {
    const canvases = new CanvasesPage(page);
    await holdNotices(page);
    await seedLibrary(page, MANY);
    await canvases.goto();
    await canvases.showHome();
    await threeNoticesOnTheHome(canvases, ['Canvas 01', 'Canvas 02', 'Canvas 03']);

    await canvases.home.getByRole('searchbox', { name: 'Search canvases' }).focus();
    let covered: string[] = [];
    for (let press = 0; press < 70; press += 1) {
      await page.keyboard.press('Tab');
      const by = await focusCoveredBy(page);
      if (by !== null) {
        covered = [...covered, `${press}: ${by}`];
      }
    }

    expect(covered).toEqual([]);
  });

  test('keeps the notices at the right of the canvas and above the bars, with no node covered, in the editor with three of them', async ({
    page,
  }) => {
    const canvases = await editorWithThreeNotices(page);
    await canvases.editor.add('Queue');

    const stack = await canvases.notices.boundingBox();
    const canvas = await canvases.editor.canvas.boundingBox();
    const inspector = await canvases.editor.inspector.boundingBox();
    const bars = await page.getByTestId('bars').boundingBox();
    expect(stack && canvas && inspector && bars).toBeTruthy();
    // Over the inspector and not over the canvas, and above the bars at the foot of the editor.
    expect(stack!.x).toBeGreaterThanOrEqual(canvas!.x + canvas!.width - 1);
    expect(stack!.x).toBeGreaterThanOrEqual(inspector!.x - 1);
    expect(stack!.y + stack!.height).toBeLessThanOrEqual(bars!.y);
    expect(await coveredNodes(page)).toEqual([]);
    expect(await reachable(page, '[data-testid="bars"] button, [data-testid="bars"] input')).not.toContain(false);
  });

  test('lets the foot of the inspector be scrolled clear of the notices, and does not cover the control that has the cursor there', async ({
    page,
  }) => {
    const canvases = await editorWithThreeNotices(page);

    await canvases.editor.inspector.evaluate((aside) => aside.scrollTo(0, aside.scrollHeight));
    const stack = await canvases.notices.boundingBox();
    const buttons = await canvases.editor.inspector.getByRole('button').evaluateAll((all) =>
      all.map((button) => {
        const box = button.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      }),
    );
    const last = buttons[buttons.length - 1]!;
    expect(last.bottom).toBeLessThanOrEqual(stack!.y);

    await canvases.editor.inspector.getByRole('button').last().focus();
    expect(await focusCoveredBy(page)).toBeNull();
    await canvases.editor.inspector.getByRole('textbox').first().focus();
    expect(await focusCoveredBy(page)).toBeNull();
  });
});
