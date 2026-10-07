import type { Binding, Topology } from '@rmq/engine';
import { lookup } from './elements';
import type { CanvasDocument, Id } from './schema';

/** The bindings that name two things that are on the canvas, with their ids, in the order they were made. A valid document has no other. */
function presentBindings(document: CanvasDocument): { readonly id: Id; readonly binding: Binding }[] {
  const bindings: { readonly id: Id; readonly binding: Binding }[] = [];
  for (const [id, { source, dest, key, headers }] of Object.entries(document.bindings)) {
    const from = lookup(document.exchanges, source);
    const to = lookup(dest.kind === 'queue' ? document.queues : document.exchanges, dest.id);
    if (from !== undefined && to !== undefined) {
      bindings.push({
        id,
        binding: {
          source: from.name,
          destination: { kind: dest.kind, name: to.name },
          key,
          ...(headers ? { headers } : {}),
        },
      });
    }
  }
  return bindings;
}

/**
 * The document as the engine sees it (ADR-0007, ADR-0018): the names of the exchanges and queues, and the bindings between
 * them, in the order they were made. It is what `route()` reads, so the what-if tester and the Why? overlay route through
 * the topology of the canvas, and the simulation will route through the same one. The default exchange is not a part of
 * it, because it is not a part of the canvas: it is implicitly bound to every queue.
 *
 * A binding that names something that is not there is left out. A valid document has none, and `validateDocument` is
 * what says that one does.
 */
export function toTopology(document: CanvasDocument): Topology {
  return {
    vhost: document.vhost,
    exchanges: Object.values(document.exchanges).map(({ name, type, internal }) => ({ name, type, internal })),
    queues: Object.values(document.queues).map(({ name }) => name),
    bindings: presentBindings(document).map(({ binding }) => binding),
  };
}

/**
 * The ids of the bindings, in the order of `toTopology(document).bindings` (ADR-0060): an index in a trace is a binding of the canvas, and a binding of the canvas is an edge. The two are made from
 * the same list, so they never go out of step.
 */
export const bindingIds = (document: CanvasDocument): Id[] => presentBindings(document).map(({ id }) => id);

/**
 * The exchanges that a message can come to `exchange` from through bindings (ADR-0070): the exchange itself, every exchange that is bound to it, every exchange that is bound to one of those, and so on. A
 * binding on the way may stop a message, so this is where a message could have come from, and not where it did. It is the set of exchanges that a message published to is worth showing to a binding of `exchange`.
 */
export function exchangesLeadingTo(topology: Topology, exchange: string): Set<string> {
  const sourcesOf = new Map<string, string[]>();
  for (const { source, destination } of topology.bindings) {
    if (destination.kind === 'exchange') {
      sourcesOf.set(destination.name, [...(sourcesOf.get(destination.name) ?? []), source]);
    }
  }
  const leading = new Set<string>([exchange]);
  // An array that grows while it is walked is walked to its end, which is a breadth-first search.
  const pending = [exchange];
  for (const to of pending) {
    for (const source of sourcesOf.get(to) ?? []) {
      if (!leading.has(source)) {
        leading.add(source);
        pending.push(source);
      }
    }
  }
  return leading;
}

/** The key of the edge from one element to another, which is also the key of its label in the layout. */
export const edgeKey = (from: Id, to: Id): string => `${from}>${to}`;

/**
 * Every edge of the canvas, by key: a binding goes from its exchange to its queue or exchange, a producer's link goes
 * from the producer to its target, and a subscription goes from the queue to the consumer. Several bindings between the
 * same two elements are one edge, which is how they are drawn (ADR-0011).
 */
export function edgeKeys(document: CanvasDocument): Set<string> {
  const keys = new Set<string>();
  for (const { source, dest } of Object.values(document.bindings)) {
    keys.add(edgeKey(source, dest.id));
  }
  for (const [id, { target }] of Object.entries(document.producers)) {
    if (target !== null) {
      keys.add(edgeKey(id, target.id));
    }
  }
  for (const [id, { queues }] of Object.entries(document.consumers)) {
    for (const queue of queues) {
      keys.add(edgeKey(queue, id));
    }
  }
  return keys;
}
