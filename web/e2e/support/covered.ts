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
