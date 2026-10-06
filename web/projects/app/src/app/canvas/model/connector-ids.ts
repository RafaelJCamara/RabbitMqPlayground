import type { Id } from '@rmq/domain';

/**
 * The ids of connectors (ADR-0016, ADR-0033). Foblex joins a connection to two connectors and not to two nodes, so a node
 * that has an input and an output has two connector ids, made from its own id, and the node's id is read back from one.
 */

/** The connector that a connection ends at. A producer has none. */
export const inId = (nodeId: Id): string => `in:${nodeId}`;

/** The connector that a connection starts from. A consumer has none. */
export const outId = (nodeId: Id): string => `out:${nodeId}`;

/** The id of the node that a connector belongs to. An id does not have a `:` before its own, so the first one splits it. */
export const nodeIdOf = (connectorId: string): Id => connectorId.slice(connectorId.indexOf(':') + 1);

/**
 * Foblex reads an empty list of the connectors that a connector may be joined to as "no restriction". "Nothing may be joined"
 * has to be a list with one id that no connector has.
 */
export const NOTHING: string[] = ['rmq:none'];
