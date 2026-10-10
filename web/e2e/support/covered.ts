import type { Page } from '@playwright/test';

/** A node that something else is over, and what it is. */
export interface Covered {
  readonly node: string;
  readonly by: string;
}

/**
 * The nodes of the canvas whose middle has something over it that is not theirs (ADR-0085, WCAG 2.4.11): what the pointer would find there, going from the top, is not the node, a part of it or something that lets
 * the pointer through. A node whose middle is not on the canvas that the learner sees (it is scrolled out, or the canvas is smaller than the layout) is not asked, since nothing can be over what is not there. Each
 * answer says which element is over the node, by what a person can search for: its test id, its role, its name or its tag.
 */
export function coveredNodes(page: Page): Promise<Covered[]> {
  return page.evaluate(() => {
    const canvas = document.querySelector('main[aria-label="Canvas"]')?.getBoundingClientRect();
    if (canvas === undefined) {
      throw new Error('there is no canvas on the page');
    }
    const describe = (element: Element): string =>
      element.getAttribute('data-testid') ??
      [element.tagName.toLowerCase(), element.getAttribute('role'), element.getAttribute('aria-label')]
        .filter((part) => part !== null)
        .join(' ');
    const covered: { node: string; by: string }[] = [];
    for (const node of document.querySelectorAll('[data-node-id]')) {
      const box = node.getBoundingClientRect();
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      if (x < canvas.left || x > canvas.right || y < canvas.top || y > canvas.bottom) {
        continue;
      }
      for (const element of document.elementsFromPoint(x, y)) {
        if (node.contains(element) || element.contains(node)) {
          break;
        }
        covered.push({
          node: node.getAttribute('aria-label') ?? node.getAttribute('data-node-id') ?? '?',
          by: describe(element),
        });
        break;
      }
    }
    return covered;
  });
}

/**
 * What is over the control that has the cursor, if it is not the control (WCAG 2.4.11, ADR-0097): the middle of the element that has the focus, asked of the page as the pointer would find it. It answers `null` when
 * the focused element is the one at its own middle (or holds it), and else the test id, the role or the tag of what covers it, or `off the screen` when its middle is not on the screen at all.
 */
export function focusCoveredBy(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const focused = document.activeElement;
    if (focused === null || focused === document.body) {
      return null;
    }
    const box = focused.getBoundingClientRect();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    const top = document.elementFromPoint(x, y);
    if (top === null) {
      return 'off the screen';
    }
    if (focused.contains(top) || top.contains(focused)) {
      return null;
    }
    return top.closest('[data-testid]')?.getAttribute('data-testid') ?? top.tagName.toLowerCase();
  });
}

/** Whether the middle of an element is the element itself, or part of it, as the pointer would find it, so that a press on it reaches it. */
export function reachable(page: Page, selector: string): Promise<boolean[]> {
  return page.evaluate((query) => {
    return [...document.querySelectorAll(query)].map((element) => {
      const box = element.getBoundingClientRect();
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top !== null && (element.contains(top) || top.contains(element));
    });
  }, selector);
}
