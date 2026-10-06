import { kindOf, nameOf, type CanvasDocument, type ElementRef, type Id } from '@rmq/domain';

/**
 * The one place that goes from what the canvas talks in to what a command talks in (ADR-0031). The adapter and the stores speak
 * in ids, which the document keeps stable, and a command names an element by kind and name, because a typed line has no
 * way to know an id (ADR-0026).
 */

/** The kind and name of the element with this id, or `undefined` if the canvas has none. */
export function refOf(document: CanvasDocument, id: Id): ElementRef | undefined {
  const kind = kindOf(document, id);
  const name = kind === undefined ? undefined : nameOf(document, kind, id);
  return kind === undefined || name === undefined ? undefined : { kind, name };
}

/** The ids at the two ends of an edge, from its key (`from>to`, the key of its label), or `undefined` if it is not one. */
export function edgeEnds(key: string): { readonly from: Id; readonly to: Id } | undefined {
  const parts = key.split('>');
  const [from, to] = parts;
  return parts.length === 2 && from !== undefined && to !== undefined && from !== '' && to !== ''
    ? { from, to }
    : undefined;
}
