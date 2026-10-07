import type { Flight, QueueMessage } from '@rmq/engine';

/**
 * Where a message is now (ADR-0063), worked out from what the engine says and not from the log: on its way to the broker, inside it, ready in a queue, on its way to a consumer, held by a consumer that has not
 * acknowledged it, or finished with. A message that went to several queues has a place for each copy. Plain data, so that a spec holds every case and the template only says it.
 */

export type Place =
  /** From its producer to the exchange. */
  | { readonly kind: 'to-the-broker' }
  /** Inside the broker, on its way from the exchange to the queues that it was routed to. */
  | { readonly kind: 'in-the-broker' }
  /** In a queue, waiting: its place among the messages that are ready, and how many are ready. */
  | { readonly kind: 'ready'; readonly queue: string; readonly place: number; readonly of: number }
  /** From a queue to a consumer. */
  | { readonly kind: 'on-its-way'; readonly queue: string; readonly channel: string }
  /** Given to a consumer that has not acknowledged it. */
  | { readonly kind: 'held'; readonly queue: string; readonly channel: string }
  /** Acknowledged, or taken from the queue: the engine does not hold it any more. */
  | { readonly kind: 'finished'; readonly queue: string }
  /** A message that no queue got, or that the broker refused: it was never in a queue. */
  | { readonly kind: 'nowhere' };

/** What the engine says of one queue: the messages that it holds, ready ones first, as `Simulation.messages` gives them. */
export type Holds = (queue: string) => readonly QueueMessage[];

/**
 * The places of a message. `queues` are the queues that it was routed to, by name, which is what the log held of it when the engine routed it; a message that is opened from the list of a queue has that queue.
 * A message that is on the move is where its flights say, and the queues that it has not got to are not looked in.
 */
export function placesOf(
  message: number,
  queues: readonly string[],
  flights: readonly Flight[],
  holds: Holds,
): Place[] {
  const places: Place[] = [];
  const moving = flights.filter((flight) => flight.message === message);
  const inFlight = new Set<string>();
  for (const flight of moving) {
    if (flight.leg === 'publish') {
      places.push({ kind: 'to-the-broker' });
    } else if (flight.leg === 'broker') {
      places.push({ kind: 'in-the-broker' });
    } else {
      inFlight.add(flight.queue);
      places.push({ kind: 'on-its-way', queue: flight.queue, channel: flight.channel });
    }
  }
  for (const queue of queues) {
    if (inFlight.has(queue)) {
      continue;
    }
    const held = holds(queue);
    const found = held.find(({ id }) => id === message);
    if (found === undefined) {
      // A copy that is not in the queue and is not on its way to the queue is finished with, unless it is still inside the broker, which has not put it there yet.
      if (!moving.some(({ leg }) => leg === 'broker')) {
        places.push({ kind: 'finished', queue });
      }
    } else if (found.heldBy !== null) {
      places.push({ kind: 'held', queue, channel: found.heldBy.channel });
    } else {
      const ready = held.filter(({ heldBy }) => heldBy === null);
      places.push({ kind: 'ready', queue, place: ready.findIndex(({ id }) => id === message) + 1, of: ready.length });
    }
  }
  return places.length === 0 ? [{ kind: 'nowhere' }] : places;
}

/** What a place says, in a sentence. The consumer that a channel belongs to is given by name, because the engine knows channels and a learner knows consumers. */
export function placeText(place: Place, consumerName: (channel: string) => string): string {
  switch (place.kind) {
    case 'to-the-broker':
      return 'On its way from its producer to the exchange.';
    case 'in-the-broker':
      return 'Inside the broker, on its way to the queues that it was routed to.';
    case 'ready':
      return `Ready in ${place.queue}, number ${place.place} of ${place.of} that are waiting for a consumer.`;
    case 'on-its-way':
      return `On its way from ${place.queue} to ${consumerName(place.channel)}.`;
    case 'held':
      return `Held by ${consumerName(place.channel)}, which has not acknowledged it: it stays in ${place.queue} until it does.`;
    case 'finished':
      return `Finished with: it was acknowledged, or taken from ${place.queue}.`;
    case 'nowhere':
      return 'In no queue: no queue got it.';
  }
}
