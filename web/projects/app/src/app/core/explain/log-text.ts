import type { EngineEvent } from '@rmq/engine';
import { describeEvent, type Names } from '../runtime/sentences';

/**
 * The sentence of an event, as the log writes it (ADR-0061): worded for a list that is read down, with the exchange and the key where they help, and with a capital letter and no full stop. It is made when the row
 * is added, from the names of the canvas that the event is about, and the row keeps it. The sentence that follows a step (`describeEvent`) is worded to be joined to others, and the rest of the
 * events are said as it says them.
 */

const exchangeName = (name: string): string => (name === '' ? 'the default exchange' : name);

/** The names of the queues that a message was routed to: `a`, `a and b`, `a, b and c`. */
const list = (items: readonly string[]): string =>
  items.length === 1 ? (items[0] as string) : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const capital = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

function sentence(event: EngineEvent, names: Names): string {
  switch (event.type) {
    case 'published': {
      const { message } = event;
      const who = names.producer(message.producer) ?? 'you';
      const key = message.key === '' ? 'with no key' : `with key ${JSON.stringify(message.key)}`;
      return `${who} published message ${message.id} to ${exchangeName(message.exchange)} ${key}`;
    }
    case 'routed':
      return `${exchangeName(event.exchange)} routed message ${event.message} to ${list(event.queues)}`;
    case 'enqueued':
      return `message ${event.message} is in ${event.queue}, which has ${event.depth} ready`;
    default:
      return describeEvent(event, names);
  }
}

export function logSentence(event: EngineEvent, names: Names): string {
  return capital(sentence(event, names));
}
