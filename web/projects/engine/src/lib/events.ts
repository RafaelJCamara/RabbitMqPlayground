import type { HeaderEntry, HeaderValue } from './headers';
import type { RefusalCode } from './refusal';
import type { RoutePath, RouteTrace } from './route';

/**
 * What the engine says (ADR-0007, ADR-0052). Everything here is plain data that survives JSON, so that it can be logged, compared,
 * sent to a worker and replayed. `seq` counts the events of one engine from 1, and `at` is the virtual time at which each happened.
 */

/** A message, as a client sent it. The engine numbers them from 1, in the order of publishing. */
export interface MessageInfo {
  readonly id: number;
  /** The producer that sent it, or `null` for a message that a command published with no producer. */
  readonly producer: string | null;
  /** `""` is the default exchange. */
  readonly exchange: string;
  readonly key: string;
  readonly headers: readonly HeaderEntry<HeaderValue>[];
  readonly payload: string;
}

interface Base {
  readonly seq: number;
  readonly at: number;
}

/** A message leaves its producer, or is published by a command. It reaches the broker at `arrivesAt`. */
export interface Published extends Base {
  readonly type: 'published';
  readonly message: MessageInfo;
  readonly arrivesAt: number;
}

/** The message arrived and reached at least one queue. Its copies arrive in the queues at `enqueueAt`. */
export interface Routed extends Base {
  readonly type: 'routed';
  readonly message: number;
  readonly exchange: string;
  readonly queues: readonly string[];
  readonly paths: readonly RoutePath[];
  readonly trace: RouteTrace;
  readonly enqueueAt: number;
}

/** The message arrived and reached no queue. It is dropped (ADR-0008, rule 10). */
export interface Unroutable extends Base {
  readonly type: 'unroutable';
  readonly message: number;
  readonly exchange: string;
  readonly trace: RouteTrace;
}

/** The message arrived at an exchange that is not there, or that is internal: the broker's `403` or `404`. */
export interface MessageRefused extends Base {
  readonly type: 'refused';
  readonly message: number;
  readonly exchange: string;
  readonly code: 403 | 404;
  readonly text: string;
}

/** A copy of the message is in a queue, which now holds `depth` ready messages. */
export interface Enqueued extends Base {
  readonly type: 'enqueued';
  readonly message: number;
  readonly queue: string;
  readonly depth: number;
}

/** A copy arrived at a queue that is not there any more. */
export interface Dropped extends Base {
  readonly type: 'dropped';
  readonly message: number;
  readonly queue: string;
}

/** A queue gave a message to a consumer. For a consumer that acknowledges by itself it is gone from the queue now. */
export interface Delivered extends Base {
  readonly type: 'delivered';
  readonly message: number;
  readonly queue: string;
  readonly consumer: string;
  readonly channel: string;
  readonly redelivered: boolean;
  readonly autoAck: boolean;
  readonly arrivesAt: number;
}

interface Handled extends Base {
  readonly message: number;
  readonly queue: string;
  readonly consumer: string;
  readonly channel: string;
}

/** The message reached the consumer. */
export interface Received extends Handled {
  readonly type: 'received';
}

/** A consumer that takes time has finished with the message. */
export interface Processed extends Handled {
  readonly type: 'processed';
}

/** The message is acknowledged, by the consumer when it was done or by a command. It is gone from the queue. */
export interface Acked extends Handled {
  readonly type: 'acked';
}

/** An unacknowledged message went back to its queue, as redelivered, because its channel was closed. */
export interface Requeued extends Handled {
  readonly type: 'requeued';
}

export interface ConsumerCancelled extends Base {
  readonly type: 'consumer.cancelled';
  readonly consumer: string;
  readonly channel: string;
  readonly queue: string;
  readonly reason: 'cancelled' | 'queue-deleted';
}

/** Why a channel was closed (ADR-0050): the client asked, or the broker refused something that it did. */
export type CloseReason =
  { readonly kind: 'closed' } | { readonly kind: 'refused'; readonly code: RefusalCode; readonly text: string };

export interface ChannelClosed extends Base {
  readonly type: 'channel.closed';
  readonly channel: string;
  readonly reason: CloseReason;
  /** How many unacknowledged messages went back to their queues. */
  readonly requeued: number;
}

export interface QueuePurged extends Base {
  readonly type: 'queue.purged';
  readonly queue: string;
  readonly count: number;
}

/** A queue went, with the messages that it held. */
export interface QueueDeleted extends Base {
  readonly type: 'queue.deleted';
  readonly queue: string;
  readonly ready: number;
  readonly unacked: number;
}

/** Every message was taken out of the simulation. The numbers say from where. */
export interface Cleared extends Base {
  readonly type: 'cleared';
  /** Copies that were on their way: to the broker, to a queue or to a consumer. */
  readonly travelling: number;
  readonly ready: number;
  readonly unacked: number;
  /** What consumers that acknowledge by themselves held and had not finished with. */
  readonly buffered: number;
}

export interface CountersReset extends Base {
  readonly type: 'counters.reset';
}

export type EngineEvent =
  | Published
  | Routed
  | Unroutable
  | MessageRefused
  | Enqueued
  | Dropped
  | Delivered
  | Received
  | Processed
  | Acked
  | Requeued
  | ConsumerCancelled
  | ChannelClosed
  | QueuePurged
  | QueueDeleted
  | Cleared
  | CountersReset;

/** The type of an event with this `type`, for code that makes one. */
export type EventOf<Type extends EngineEvent['type']> = Extract<EngineEvent, { readonly type: Type }>;
