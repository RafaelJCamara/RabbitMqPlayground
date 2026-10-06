import { COLUMN_X, edgeKey, lookup, ROW_HEIGHT, type CanvasDocument, type Id, type Position } from '@rmq/domain';

/**
 * The default exchange as the canvas draws it (ADR-0043). It is not in the document: a canvas cannot declare it, bind from it or to it, and the engine
 * has it built in. When the setting `showDefaultExchange` is on, the view model has a node for it and an edge from it to every queue, and these are
 * their ids. They start with `~`, which no id of a document can (`ID_PATTERN` wants a letter first), so nothing that a command makes or a file holds can be
 * taken for them, and every place that goes from an id to an element finds nothing, which is how they are refused.
 */

export const DEFAULT_EXCHANGE_ID = '~default';

/** The id of the implicit edge from the default exchange to a queue, which is also its key as an edge. */
export const implicitEdgeId = (queueId: Id): string => edgeKey(DEFAULT_EXCHANGE_ID, queueId);

/** Whether an id of a node, or the key of an edge, is the default exchange's or an edge that starts there, and not the document's. */
export const isVirtual = (id: string): boolean => id.startsWith('~');

/**
 * Where the node of the default exchange is, worked out and never kept: in the column of the exchanges, a row above the highest of them. A new node
 * goes below the lowest of its kind, so one never lands on it, and it is not in the layout, which is a record of ids that a document has.
 */
export function defaultExchangePosition(document: CanvasDocument): Position {
  const heights = Object.keys(document.exchanges).map((id) => lookup(document.layout.nodes, id)?.y ?? 0);
  // With no exchange, it is where the first one would go, and a row above that.
  const top = heights.length === 0 ? 0 : Math.min(...heights);
  return { x: COLUMN_X.exchange, y: top - ROW_HEIGHT };
}

/** The keys of the implicit edges that are drawn: one to every queue while the default exchange is shown, and none while it is not. */
export function implicitEdgeKeys(document: CanvasDocument): Set<string> {
  return new Set(document.settings.showDefaultExchange ? Object.keys(document.queues).map(implicitEdgeId) : []);
}
