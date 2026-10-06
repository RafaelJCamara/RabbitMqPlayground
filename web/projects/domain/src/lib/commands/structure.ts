import { COLLECTION, findId, lookup } from '../document/elements';
import { fail, ok, type ElementKind, type Result } from '../document/issue';
import { nameIssue } from '../document/names';
import { duplicateNameIssue } from '../document/rules';
import type { CanvasDocument, Id } from '../document/schema';
import { missingElementIssue, sameValue, without, withoutDanglingLabels } from './helpers';
import type { Clear, Delete, Rename } from './types';

/**
 * Renaming, deleting and clearing: the commands that change what is on the canvas without adding to it. Deleting an element
 * deletes what hangs on it, the way a broker deletes the bindings of a queue that it deletes, so that no reference is left
 * pointing at nothing. Undo brings all of it back, because it keeps the whole earlier document (ADR-0019).
 */

export function applyRename(document: CanvasDocument, command: Rename): Result<CanvasDocument> {
  const { kind, name: current } = command.target;
  const id = findId(document, kind, current);
  if (id === undefined) {
    return fail(missingElementIssue(document, kind, current));
  }
  // The new name is chosen by a client, so a queue that the broker named gets no special leave to start with amq.
  const problem = nameIssue(kind, command.name);
  if (problem !== null) {
    return fail(problem);
  }
  if (command.name === current) {
    return ok(document);
  }
  if (findId(document, kind, command.name) !== undefined) {
    return fail(duplicateNameIssue(kind, command.name));
  }

  const collection = COLLECTION[kind];
  const record = lookup(document[collection], id) as CanvasDocument[typeof collection][Id];
  const renamed =
    kind === 'queue' ? { ...record, name: command.name, serverNamed: false } : { ...record, name: command.name };
  return ok({ ...document, [collection]: { ...document[collection], [id]: renamed } });
}

/** Deletes the element, its position, and every edge that it has: bindings, a producer's link and subscriptions. */
function remove(document: CanvasDocument, kind: ElementKind, id: Id): CanvasDocument {
  const collection = COLLECTION[kind];
  let next: CanvasDocument = {
    ...document,
    [collection]: without(document[collection], id),
    layout: { ...document.layout, nodes: without(document.layout.nodes, id) },
  };

  if (kind === 'exchange' || kind === 'queue') {
    const kept = Object.entries(document.bindings).filter(
      ([, { source, dest }]) => !(source === id || (dest.kind === kind && dest.id === id)),
    );
    if (kept.length !== Object.keys(document.bindings).length) {
      next = { ...next, bindings: Object.fromEntries(kept) };
    }

    const pointing = Object.entries(document.producers).filter(
      ([, { target }]) => target?.kind === kind && target.id === id,
    );
    if (pointing.length > 0) {
      next = {
        ...next,
        producers: {
          ...next.producers,
          ...Object.fromEntries(pointing.map(([key, producer]) => [key, { ...producer, target: null }])),
        },
      };
    }
  }

  if (kind === 'queue') {
    const subscribed = Object.entries(document.consumers).filter(([, { queues }]) => queues.includes(id));
    if (subscribed.length > 0) {
      next = {
        ...next,
        consumers: {
          ...next.consumers,
          ...Object.fromEntries(
            subscribed.map(([key, consumer]) => [
              key,
              { ...consumer, queues: consumer.queues.filter((queue) => queue !== id) },
            ]),
          ),
        },
      };
    }
  }

  return withoutDanglingLabels(next);
}

export function applyDelete(document: CanvasDocument, command: Delete): Result<CanvasDocument> {
  const { kind, name } = command.target;
  const id = findId(document, kind, name);
  return id === undefined ? fail(missingElementIssue(document, kind, name)) : ok(remove(document, kind, id));
}

/** Takes everything off the canvas. The vhost and the settings are the canvas's, and stay. */
export function applyClear(document: CanvasDocument, _command: Clear): Result<CanvasDocument> {
  const empty = {
    exchanges: {},
    queues: {},
    bindings: {},
    producers: {},
    consumers: {},
    layout: { nodes: {}, labels: {} },
  };
  const current = {
    exchanges: document.exchanges,
    queues: document.queues,
    bindings: document.bindings,
    producers: document.producers,
    consumers: document.consumers,
    layout: document.layout,
  };
  return ok(sameValue(current, empty) ? document : { ...document, ...empty });
}
