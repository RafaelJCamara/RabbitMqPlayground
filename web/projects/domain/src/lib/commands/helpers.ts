import { COLLECTION, findId, lookup, recordOf } from '../document/elements';
import { ELEMENT_KINDS, KIND_LABEL, type ElementKind, type Issue } from '../document/issue';
import { ID_PATTERN, type CanvasDocument, type Id, type Position } from '../document/schema';
import { edgeKeys } from '../document/topology';
import { suggest } from '../suggest';

/**
 * What every command needs to change a document without changing it: new ids, a place for a new node, a copy of a record
 * with one entry different, and the care that a name which is not there is explained and not just refused.
 */

/** The things that get an id of their own. A binding is one, because a canvas can hold many between two exchanges. */
export type IdKind = ElementKind | 'binding';

/** What a command may ask of the world. Ids come from outside, so that applying a command is the same every time. */
export interface ApplyContext {
  /** An id for something new. It must be one that the canvas has never had, and that matches `ID_PATTERN`. */
  readonly newId: (kind: IdKind) => Id;
}

const COLLECTIONS = ['exchanges', 'queues', 'bindings', 'producers', 'consumers'] as const;

/**
 * An id for something new. A generator that gives an id that is taken, or one that is not an id, would overwrite an
 * element or write a document that does not load, so that is a bug of the caller's and not a refusal, and nothing is
 * changed.
 */
export function freshId(document: CanvasDocument, context: ApplyContext, kind: IdKind): Id {
  const id = context.newId(kind);
  const taken = COLLECTIONS.some((collection) => Object.hasOwn(document[collection], id));
  if (taken || !ID_PATTERN.test(id)) {
    throw new Error(
      `The id generator gave '${id}' for a new ${kind}, which is ${taken ? 'already used on the canvas' : 'not a valid id'}.`,
    );
  }
  return id;
}

/** The left edge of the column that each kind of node starts in, so that a new node lands where the flow says. */
export const COLUMN_X: Readonly<Record<ElementKind, number>> = {
  producer: 0,
  exchange: 320,
  queue: 640,
  consumer: 960,
};
export const ROW_HEIGHT = 120;

/** Where a new node of this kind goes: in its column, below the lowest node of its kind. */
export function defaultPosition(document: CanvasDocument, kind: ElementKind): Position {
  let lowest: number | undefined;
  for (const id of Object.keys(recordOf(document, kind))) {
    const y = lookup(document.layout.nodes, id)?.y;
    if (y !== undefined && (lowest === undefined || y > lowest)) {
      lowest = y;
    }
  }
  return { x: COLUMN_X[kind], y: lowest === undefined ? 0 : lowest + ROW_HEIGHT };
}

/** The record without the entry for `id`. */
export function without<Records extends Readonly<Record<Id, unknown>>>(record: Records, id: Id): Records {
  const rest: Record<Id, unknown> = { ...record };
  delete rest[id];
  return rest as Records;
}

/** The document with a new element in its collection and a position for it. */
export function withElement(
  document: CanvasDocument,
  kind: ElementKind,
  id: Id,
  record:
    | CanvasDocument['exchanges'][Id]
    | CanvasDocument['queues'][Id]
    | CanvasDocument['producers'][Id]
    | CanvasDocument['consumers'][Id],
): CanvasDocument {
  const collection = COLLECTION[kind];
  return {
    ...document,
    [collection]: { ...document[collection], [id]: record },
    layout: { ...document.layout, nodes: { ...document.layout.nodes, [id]: defaultPosition(document, kind) } },
  };
}

/**
 * The document without the labels of edges that are gone. A command that removes an edge, or the element at one end of
 * one, goes through this, so that the layout never keeps a label for nothing. It is the same document when no label is
 * left behind.
 */
export function withoutDanglingLabels(document: CanvasDocument): CanvasDocument {
  const labels = document.layout.labels;
  const keys = Object.keys(labels);
  if (keys.length === 0) {
    return document;
  }
  const edges = edgeKeys(document);
  const kept = keys.filter((key) => edges.has(key));
  if (kept.length === keys.length) {
    return document;
  }
  return {
    ...document,
    layout: { ...document.layout, labels: Object.fromEntries(kept.map((key) => [key, lookup(labels, key) as never])) },
  };
}

/** The names of one kind, in the order they were made. */
export const namesOf = (document: CanvasDocument, kind: ElementKind): string[] =>
  Object.values(recordOf(document, kind)).map(({ name }) => name);

/** `a`, `a or b` or `a, b or c`: the items in a sentence, with the word that goes before the last. */
export function joinList(items: readonly string[], word: 'and' | 'or'): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`;
}

/** ` Did you mean 'a', 'b' or 'c'?`, or nothing when there is nothing to suggest. */
export function didYouMean(suggestions: readonly string[]): string {
  return suggestions.length === 0
    ? ''
    : ` Did you mean ${joinList(
        suggestions.map((name) => `'${name}'`),
        'or',
      )}?`;
}

/**
 * Explains that there is no element of this kind with this name, which is more than saying so: it says when there is
 * one of another kind with that name (a binding starts at an exchange, and `orders` may be a queue), and which names
 * are close.
 */
export function missingElementIssue(document: CanvasDocument, kind: ElementKind, name: string): Issue {
  return withNameHints(
    { kind: 'missing-element', message: `There is no ${KIND_LABEL[kind]} named '${name}'.` },
    document,
    kind,
    name,
  );
}

/** Adds to an issue about a name that is not there what the canvas can say about it: other kinds with that name, and close names. */
export function withNameHints(issue: Issue, document: CanvasDocument, kind: ElementKind, name: string): Issue {
  const others = ELEMENT_KINDS.filter((other) => other !== kind && findId(document, other, name) !== undefined);
  const elsewhere =
    others.length === 0
      ? ''
      : ` There is ${joinList(
          others.map((other) => `${other === 'exchange' ? 'an' : 'a'} ${KIND_LABEL[other]}`),
          'and',
        )} with that name.`;
  const suggestions = suggest(name, namesOf(document, kind));
  return {
    ...issue,
    message: `${issue.message}${elsewhere}${didYouMean(suggestions)}`,
    ...(suggestions.length === 0 ? {} : { suggestions }),
  };
}

/**
 * Whether two pieces of plain data are the same: the same primitives, in arrays of the same length and objects with the
 * same keys, whatever order the keys were written in. A command that would leave a record as it is returns the document
 * it was given, so that "did anything change?" is a comparison of references.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) {
    return true;
  }
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  ) {
    return false;
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}

/** `next`, unless it is the same data as `current`, in which case `current` itself: a branch that did not change stays shared. */
export function keepIfSame<Value>(current: Value, next: Value): Value {
  return sameValue(current, next) ? current : next;
}
