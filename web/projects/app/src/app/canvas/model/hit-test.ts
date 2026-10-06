import type { Id } from '@rmq/domain';

/** The attribute that the adapter puts on the element of every node, with the node's id. */
export const NODE_ATTRIBUTE = 'data-node-id';

/**
 * The node that is under a point (ADR-0016): the first of the elements that the page says are there, from the top, that is inside
 * the host of the canvas and inside a node. A link that ends on a node that the rules do not allow, and a link that ends on
 * nothing, both come from the library as "no target", and this is what tells them apart.
 */
export function nodeIdAt(elements: readonly Element[], host: Element): Id | null {
  for (const element of elements) {
    const id = host.contains(element) ? element.closest(`[${NODE_ATTRIBUTE}]`)?.getAttribute(NODE_ATTRIBUTE) : null;
    if (id !== null && id !== undefined) {
      return id;
    }
  }
  return null;
}

/** The node whose element this is, or contains, or `null`. Used for a double click and for a menu. */
export function nodeIdOfTarget(target: EventTarget | null): Id | null {
  return target instanceof Element
    ? (target.closest(`[${NODE_ATTRIBUTE}]`)?.getAttribute(NODE_ATTRIBUTE) ?? null)
    : null;
}
