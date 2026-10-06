import type { Issue } from './issue';
import { LIMITS, type CanvasDocument } from './schema';

/**
 * How much a canvas holds, and what is said when there is no room for more (ADR-0029). The numbers are `LIMITS`, and they are
 * the ones that `loadCanvas` of `@rmq/persistence` refuses above (ADR-0027). A command that would take a canvas over one
 * refuses, so that a canvas that commands made always saves and opens again.
 */

/** Exchanges, queues, producers and consumers together. */
export const elementCount = (document: CanvasDocument): number =>
  Object.keys(document.exchanges).length +
  Object.keys(document.queues).length +
  Object.keys(document.producers).length +
  Object.keys(document.consumers).length;

/** Bindings, producer links and consumer subscriptions together. A binding is one edge each, even between the same two ends. */
export function edgeCount(document: CanvasDocument): number {
  let links = 0;
  for (const { target } of Object.values(document.producers)) {
    if (target !== null) {
      links += 1;
    }
  }
  let subscriptions = 0;
  for (const { queues } of Object.values(document.consumers)) {
    subscriptions += queues.length;
  }
  return Object.keys(document.bindings).length + links + subscriptions;
}

/** A whole number with a comma between the thousands, the same in every locale. */
export const thousands = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const WHAT = {
  elements: 'elements (exchanges, queues, producers and consumers)',
  edges: 'connections (bindings, producer links and consumer subscriptions)',
} as const;

/** There is no room for another element or another edge, or a document has more than there is room for. */
export function canvasFullIssue(what: keyof typeof WHAT, count: number): Issue {
  return {
    kind: 'canvas-full',
    message: `The canvas is full: a canvas holds at most ${thousands(LIMITS[what])} ${WHAT[what]}, so that it can always be saved and opened again, and this one has ${thousands(count)}. Delete something you no longer need to make room.`,
  };
}

/** Why no element can be added, or `null` when the canvas has room for one more. */
export function noRoomForElement(document: CanvasDocument): Issue | null {
  const count = elementCount(document);
  return count >= LIMITS.elements ? canvasFullIssue('elements', count) : null;
}

/** Why no edge can be added, or `null` when the canvas has room for one more. */
export function noRoomForEdge(document: CanvasDocument): Issue | null {
  const count = edgeCount(document);
  return count >= LIMITS.edges ? canvasFullIssue('edges', count) : null;
}

/** Why `payload` is too long to keep, or `null` when it is not. */
export function payloadIssue(payload: string): Issue | null {
  return payload.length > LIMITS.textLength
    ? {
        kind: 'invalid-value',
        message: `A payload is at most ${thousands(LIMITS.textLength)} characters, and this one has ${thousands(payload.length)}. Shorten it.`,
      }
    : null;
}
