import type { EngineEvent } from '@rmq/engine';
import type { Names } from '../runtime/sentences';
import type { LogEntry } from '../state/command-log';
import type { CommandOrigin } from '../state/origin';
import { FAMILY_IDS, familyOf, type Family } from './families';
import { logSentence } from './log-text';

/**
 * The rows of the event log (ADR-0061): plain data, made from an event or from a line of the log of commands, with the sentence that was worded when the row was added, the nodes that it concerns
 * (for the filter by node) and what choosing it lights on the canvas (its subject). A row is made without a number, which the log gives it when it puts it in its place, because the log decides the order.
 */

/** What choosing a row lights (ADR-0062). Names are the engine's: an exchange and a queue by name, a producer and a consumer by id. */
export type Subject =
  /** A message that left its producer: the producer's link. */
  | { readonly kind: 'publish'; readonly message: number }
  /** A message that was routed, or was not: the Why? of the message. */
  | { readonly kind: 'route'; readonly message: number }
  /** A copy of a message in a queue, or on its way to a queue that is gone: the way to that queue. */
  | { readonly kind: 'copy'; readonly message: number; readonly queue: string }
  /** What a queue gave a consumer and what the consumer did with it: the subscription. */
  | { readonly kind: 'delivery'; readonly queue: string; readonly channel: string }
  /** Nodes and nothing else: a queue that was purged or deleted, a consumer that was closed. */
  | { readonly kind: 'nodes'; readonly queues: readonly string[]; readonly channels: readonly string[] };

export interface LogRow {
  /** Counts from 1 for as long as the canvas is open, over the events and the lines of commands alike, and is not used twice. */
  readonly seq: number;
  /** The virtual time in milliseconds: the event's, or the clock's when a command was run. */
  readonly at: number;
  readonly family: Family;
  /** The name of the event (`routed`, `delivered`), or `command` for a line of the log of commands: the word that stands in the row beside the mark. */
  readonly kind: string;
  readonly text: string;
  /** The number of the message that it is about. */
  readonly message: number | null;
  /** The nodes that it concerns, as `exchange:orders`, `queue:billing`, `producer:<id>` and `consumer:<id>`. */
  readonly nodes: readonly string[];
  readonly subject: Subject | null;
  /** For a line of a command: what the learner used. */
  readonly origin?: CommandOrigin;
}

export type RowDraft = Omit<LogRow, 'seq'>;

/** The key of a node in a row and in the filter: an exchange and a queue by name, a producer and a consumer by id. */
export const nodeKey = (kind: 'exchange' | 'queue' | 'producer' | 'consumer', nameOrId: string): string =>
  `${kind}:${nameOrId}`;

const exchanges = (names: readonly string[]): string[] =>
  names.filter((name) => name !== '').map((name) => nodeKey('exchange', name));

/** What an event is about, apart from its sentence: its message, its nodes and what it lights. */
function aboutEvent(event: EngineEvent): Pick<RowDraft, 'message' | 'nodes' | 'subject'> {
  switch (event.type) {
    case 'published': {
      const { message } = event;
      return {
        message: message.id,
        nodes: [
          ...(message.producer === null ? [] : [nodeKey('producer', message.producer)]),
          ...exchanges([message.exchange]),
        ],
        subject: { kind: 'publish', message: message.id },
      };
    }
    case 'routed':
      return {
        message: event.message,
        nodes: [...exchanges([event.exchange]), ...event.queues.map((queue) => nodeKey('queue', queue))],
        subject: { kind: 'route', message: event.message },
      };
    case 'unroutable':
    case 'refused':
      return {
        message: event.message,
        nodes: exchanges([event.exchange]),
        subject: { kind: 'route', message: event.message },
      };
    case 'enqueued':
    case 'dropped':
      return {
        message: event.message,
        nodes: [nodeKey('queue', event.queue)],
        subject: { kind: 'copy', message: event.message, queue: event.queue },
      };
    case 'delivered':
    case 'received':
    case 'processed':
    case 'acked':
    case 'requeued':
      return {
        message: event.message,
        nodes: [nodeKey('queue', event.queue), nodeKey('consumer', event.channel)],
        subject: { kind: 'delivery', queue: event.queue, channel: event.channel },
      };
    case 'consumer.cancelled':
      return {
        message: null,
        nodes: [nodeKey('queue', event.queue), nodeKey('consumer', event.channel)],
        subject: { kind: 'delivery', queue: event.queue, channel: event.channel },
      };
    case 'channel.closed':
      return {
        message: null,
        nodes: [nodeKey('consumer', event.channel)],
        subject: { kind: 'nodes', queues: [], channels: [event.channel] },
      };
    case 'queue.purged':
    case 'queue.deleted':
      return {
        message: null,
        nodes: [nodeKey('queue', event.queue)],
        subject: { kind: 'nodes', queues: [event.queue], channels: [] },
      };
    case 'cleared':
    case 'counters.reset':
      return { message: null, nodes: [], subject: null };
  }
}

/** The row for an event, with the sentence worded with these names. */
export function draftOfEvent(event: EngineEvent, names: Names): RowDraft {
  return {
    at: event.at,
    family: familyOf(event.type),
    kind: event.type,
    text: logSentence(event, names),
    ...aboutEvent(event),
  };
}

/** The row for a line of the log of commands, at the time that the clock had when it was run. */
export function draftOfLine(line: LogEntry, at: number): RowDraft {
  return {
    at,
    family: 'commands',
    kind: 'command',
    text: line.text,
    message: null,
    nodes: [],
    subject: null,
    origin: line.origin,
  };
}

// --- the filter ----------------------------------------------------------------------------------------------------

/** What the rows that are shown have to be: of these families, about this node, about this message, and with this text in the sentence. All of it at once. */
export interface LogFilter {
  readonly families: ReadonlySet<Family>;
  /** A key of `nodeKey`, or `null` for every node. */
  readonly node: string | null;
  readonly message: number | null;
  /** A part of the sentence, in any case. */
  readonly text: string;
}

export const NO_FILTER: LogFilter = { families: new Set(FAMILY_IDS), node: null, message: null, text: '' };

/** Whether the filter leaves out anything at all. */
export const isFiltering = (filter: LogFilter): boolean =>
  filter.families.size !== FAMILY_IDS.length ||
  filter.node !== null ||
  filter.message !== null ||
  filter.text.trim() !== '';

export function matchesFilter(row: LogRow, filter: LogFilter): boolean {
  return (
    filter.families.has(row.family) &&
    (filter.node === null || row.nodes.includes(filter.node)) &&
    (filter.message === null || row.message === filter.message) &&
    (filter.text.trim() === '' || row.text.toLowerCase().includes(filter.text.trim().toLowerCase()))
  );
}
