import { EditorPage } from './pages/editor-page';
import { seedCanvas } from './support/seed';
import { EDGES, TOPOLOGY } from './support/topology';
import { expect, test } from './support/test';

/**
 * Targets (WCAG 2.5.8, ADR-0017 section 6, ADR-0085): the handle of a node is a dot of 12 pixels in a box of 24 by 24 that the pointer finds, at 100% zoom of the canvas. Axe checks the controls of the page (its `target-size` rule
 * runs in every state of the accessibility specs), but a handle has no role, so it is measured here, in the browser, with the page as it is drawn and not with the style sheet. The shapes of the messages are targets of 24 across as
 * well: the overlay finds a shape by a press up to 12 pixels from its middle (`HIT_RADIUS`, held by overlay.spec.ts).
 */

const MINIMUM = 24;

test.describe('the handles of the nodes (WCAG 2.5.8)', () => {
  // A canvas that is wide enough to hold the whole topology at 100%, so that no handle is off the edge of it, under the inspector.
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('are 24 by 24 pixels at the scale of 100%, and the pointer finds the handle over the whole of its box, whatever is under it', async ({
    page,
  }) => {
    await seedCanvas(page, TOPOLOGY);
    const editor = new EditorPage(page);
    await editor.goto();
    await page.locator('rmq-flow-canvas[data-ready]').waitFor();
    await expect.poll(() => page.evaluate(() => window.__rmq?.drawnEdges().length)).toBe(EDGES.length);
    await editor.settled();
    await page.getByTestId('zoom-reset').click();
    await expect.poll(() => editor.zoomPercent()).toBe(100);
    await editor.settled();

    const handles = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-node-id] [data-handle]')].map((handle) => {
        const rect = handle.getBoundingClientRect();
        const points = [
          [rect.left + rect.width / 2, rect.top + rect.height / 2],
          [rect.left + 1, rect.top + 1],
          [rect.right - 1, rect.top + 1],
          [rect.left + 1, rect.bottom - 1],
          [rect.right - 1, rect.bottom - 1],
        ] as const;
        return {
          node: handle.closest('[data-node-id]')?.getAttribute('data-node-id') ?? '?',
          which: handle.getAttribute('data-handle'),
          width: rect.width,
          height: rect.height,
          // The thing that a press at each of five points of the box would land on, which has to be the handle.
          lost: points.filter(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-handle]') !== handle)
            .length,
        };
      }),
    );

    // One of each kind of node: a producer has a dot to send from, a consumer one to receive at, and the others have both (two exchanges, a queue, a producer and a consumer make eight).
    expect(handles).toHaveLength(8);
    for (const handle of handles) {
      expect(handle.width, `${handle.node} ${handle.which}: width`).toBeGreaterThanOrEqual(MINIMUM);
      expect(handle.height, `${handle.node} ${handle.which}: height`).toBeGreaterThanOrEqual(MINIMUM);
      expect(handle.lost, `${handle.node} ${handle.which}: points of its box where the press is not its own`).toBe(0);
    }
  });
});
