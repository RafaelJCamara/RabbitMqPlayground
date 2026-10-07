import { nameOf, type CanvasDocument } from '@rmq/domain';
import type { EngineEvent } from '@rmq/engine';

/**
 * What the engine said, in words (ADR-0055): the sentence that follows a step, which is the one thing that the screen says of the messages, because a sentence for
 * each message would drown everything else. A sentence is in the past tense and starts with a lower-case letter and has no full stop, so that it can be a part of
 * another. The names are the canvas's: a producer and a consumer are known to the engine by their ids.
 */

export interface Names {
  /** The name of the producer with this id, or `null` for a message that no producer sent. */
  producer(id: string | null): string | null;
  /** The name of the consumer whose channel this is. */
  consumer(channel: string): string;
}

export const namesOf = (document: CanvasDocument): Names => ({
  producer: (id) => (id === null ? null : (nameOf(document, 'producer', id) ?? id)),
  consumer: (channel) => nameOf(document, 'consumer', channel) ?? channel,
});

/** The default exchange has no name, and a sentence cannot say nothing. */
const exchangeName = (name: string): string => (name === '' ? 'the default exchange' : name);

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

const list = (items: readonly string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

export function describeEvent(event: EngineEvent, names: Names): string {
  switch (event.type) {
    case 'published':
      return `${names.producer(event.message.producer) ?? 'you'} published message ${event.message.id}`;
    case 'routed':
      return `message ${event.message} was routed to ${list(event.queues)}`;
    case 'unroutable':
      return `message ${event.message} reached ${exchangeName(event.exchange)} and found no queue to go to`;
    case 'refused':
      return `message ${event.message} was refused at ${exchangeName(event.exchange)} (${event.code} ${event.text})`;
    case 'enqueued':
      return `message ${event.message} is in ${event.queue}`;
    case 'dropped':
      return `message ${event.message} was dropped, because ${event.queue} is gone`;
    case 'delivered':
      return `${event.queue} gave message ${event.message} to ${names.consumer(event.channel)}${event.redelivered ? ' again' : ''}`;
    case 'received':
      return `${names.consumer(event.channel)} received message ${event.message}`;
    case 'processed':
      return `${names.consumer(event.channel)} finished message ${event.message}`;
    case 'acked':
      return `${names.consumer(event.channel)} acknowledged message ${event.message}`;
    case 'requeued':
      return `message ${event.message} went back to ${event.queue}`;
    case 'consumer.cancelled':
      return event.reason === 'queue-deleted'
        ? `${event.queue} was deleted, so ${names.consumer(event.channel)} stopped consuming from it`
        : `${names.consumer(event.channel)} stopped consuming from ${event.queue}`;
    case 'channel.closed':
      return `${names.consumer(event.channel)} was closed, and ${plural(event.requeued, 'message')} went back to ${event.requeued === 1 ? 'its queue' : 'their queues'}`;
    case 'queue.purged':
      return `${plural(event.count, 'message')} ${event.count === 1 ? 'was' : 'were'} purged from ${event.queue}`;
    case 'queue.deleted':
      return `${event.queue} was deleted with ${plural(event.ready + event.unacked, 'message')} in it`;
    case 'cleared':
      return 'the messages were cleared';
    case 'counters.reset':
      return 'the counters were reset';
  }
}

/** How many of the events of a step are said, before the rest are counted. */
const STEP_SAID = 3;

/** What a step did: what the first few events were, and how many more there were. A step runs one thing, which says at least one. */
export function describeStep(events: readonly EngineEvent[], names: Names): string {
  const said = events.slice(0, STEP_SAID).map((event) => describeEvent(event, names));
  const more = events.length - said.length;
  return `Stepped: ${said.join('; ')}${more > 0 ? `; and ${more} more` : ''}.`;
}
