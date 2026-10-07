import { edgeKey, type CanvasDocument, type Id } from '@rmq/domain';
import type { Flight } from '@rmq/engine';
import { implicitEdgeId } from '../../core/state/default-exchange';

/**
 * Where a message is on the canvas (ADR-0055), worked out from what the engine says is on the move and the clock, with nothing remembered. A message is on the
 * edge that it is going along, at the fraction of the way that its time says: the link of its producer while it goes to the broker, the bindings that its path
 * has while it is in the broker, which share the time that the broker takes, and the subscription of its consumer while it goes to it. The edges are told by
 * the ids of the nodes, which are what the engine's names are of the canvas's, as the view model of the canvas keys its edges.
 */

/** One message on one edge. */
export interface Marker {
  readonly message: number;
  /** The routing key, which gives it its colour. */
  readonly key: string;
  /** The key of the edge that it is on. */
  readonly edge: string;
  /** How far along the edge it is, from 0 to 1. */
  readonly at: number;
  readonly redelivered: boolean;
}

/** What of the canvas is needed to say where a flight is: what the engine knows by a name, and what a producer is linked to. */
export interface Places {
  readonly exchanges: ReadonlyMap<string, Id>;
  readonly queues: ReadonlyMap<string, Id>;
  /** The id of what each producer is linked to. */
  readonly links: ReadonlyMap<Id, Id>;
  /** Whether the default exchange is drawn, and so the implicit edges are, which are what a hop of the default exchange goes along. */
  readonly showsDefault: boolean;
}

export function placesOf(document: CanvasDocument): Places {
  return {
    exchanges: new Map(Object.entries(document.exchanges).map(([id, { name }]) => [name, id])),
    queues: new Map(Object.entries(document.queues).map(([id, { name }]) => [name, id])),
    links: new Map(
      Object.entries(document.producers).flatMap(([id, { target }]) =>
        target === null ? [] : [[id, target.id] as const],
      ),
    ),
    showsDefault: document.settings.showDefaultExchange,
  };
}

/** How far through its leg a flight is at this time, from 0 to 1. A leg that takes no time is done. */
const progress = (from: number, to: number, time: number): number =>
  to <= from ? 1 : Math.min(1, Math.max(0, (time - from) / (to - from)));

/** The markers of what is on the move at this time. A message that is on a part of the canvas that is not drawn is not on any edge, and is left out. */
export function markersOf(flights: readonly Flight[], places: Places, time: number): Marker[] {
  const markers: Marker[] = [];
  for (const flight of flights) {
    const through = progress(flight.from, flight.to, time);
    switch (flight.leg) {
      case 'publish': {
        const target = flight.producer === null ? undefined : places.links.get(flight.producer);
        if (flight.producer !== null && target !== undefined) {
          markers.push({
            message: flight.message,
            key: flight.key,
            edge: edgeKey(flight.producer, target),
            at: through,
            redelivered: false,
          });
        }
        break;
      }
      case 'broker': {
        const seen = new Set<string>();
        for (const { hops } of flight.paths) {
          const hop = hops[Math.min(hops.length - 1, Math.floor(through * hops.length))];
          if (hop === undefined) {
            continue;
          }
          const destination = (hop.to.kind === 'queue' ? places.queues : places.exchanges).get(hop.to.name);
          let edge: string | undefined;
          let at = through * hops.length - Math.min(hops.length - 1, Math.floor(through * hops.length));
          if (hop.from === '') {
            if (places.showsDefault && destination !== undefined) {
              edge = implicitEdgeId(destination);
            } else if (flight.producer !== null && destination !== undefined) {
              // The default exchange is not drawn, so the message waits where it came to, at the end of the link that it went along.
              edge = edgeKey(flight.producer, destination);
              at = 1;
            }
          } else {
            const source = places.exchanges.get(hop.from);
            edge = source === undefined || destination === undefined ? undefined : edgeKey(source, destination);
          }
          // Two paths can go along the same edge at the same time, and it is one message there.
          if (edge !== undefined && !seen.has(`${edge}|${at}`)) {
            seen.add(`${edge}|${at}`);
            markers.push({ message: flight.message, key: flight.key, edge, at, redelivered: false });
          }
        }
        break;
      }
      case 'deliver': {
        const queue = places.queues.get(flight.queue);
        if (queue !== undefined) {
          markers.push({
            message: flight.message,
            key: flight.key,
            edge: edgeKey(queue, flight.channel),
            at: through,
            redelivered: flight.redelivered,
          });
        }
        break;
      }
    }
  }
  return markers;
}
