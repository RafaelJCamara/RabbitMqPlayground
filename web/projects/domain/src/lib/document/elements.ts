import type { CanvasDocument, Id } from './schema';
import type { ElementKind } from './issue';

/**
 * Finding things in a document. A document keeps its elements in records keyed by id, and a command names them by kind
 * and name (ADR-0026), so this is the one place that goes from one to the other.
 */

/** The collection of the document that holds each kind. */
export const COLLECTION = {
  exchange: 'exchanges',
  queue: 'queues',
  producer: 'producers',
  consumer: 'consumers',
} as const satisfies Record<ElementKind, keyof CanvasDocument>;

interface Named {
  readonly name: string;
}

/** The records of one kind, as a record of things that have a name. */
export const recordOf = (document: CanvasDocument, kind: ElementKind): Readonly<Record<Id, Named>> =>
  document[COLLECTION[kind]];

/**
 * The entry for an id, or `undefined`. A record is a plain object, so `record['constructor']` is a function that no
 * canvas made, and only an own property counts.
 */
export function lookup<Records extends Readonly<Record<Id, unknown>>>(
  record: Records,
  id: Id,
): Records[string] | undefined {
  return Object.hasOwn(record, id) ? (record[id] as Records[string]) : undefined;
}

/** The id of the element of this kind that has this name, or `undefined`. Names are unique within a kind. */
export function findId(document: CanvasDocument, kind: ElementKind, name: string): Id | undefined {
  for (const [id, element] of Object.entries(recordOf(document, kind))) {
    if (element.name === name) {
      return id;
    }
  }
  return undefined;
}

export function nameOf(document: CanvasDocument, kind: ElementKind, id: Id): string | undefined {
  return lookup(recordOf(document, kind), id)?.name;
}

export interface Element {
  readonly kind: ElementKind;
  readonly id: Id;
  readonly name: string;
}

/** Every element, grouped by kind in the order exchange, queue, producer, consumer, and in the order they were made. */
export function elements(document: CanvasDocument): Element[] {
  return (['exchange', 'queue', 'producer', 'consumer'] as const).flatMap((kind) =>
    Object.entries(recordOf(document, kind)).map(([id, { name }]) => ({ kind, id, name })),
  );
}

/** The kind of the element with this id, or `undefined`. Ids are unique across kinds, so there is at most one. */
export function kindOf(document: CanvasDocument, id: Id): ElementKind | undefined {
  return (['exchange', 'queue', 'producer', 'consumer'] as const).find((kind) =>
    Object.hasOwn(recordOf(document, kind), id),
  );
}
