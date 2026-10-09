import type { HeaderArguments, HeaderEntry, HeaderValue } from './headers';
import type { Destination, ExchangeType } from './topology';
import type { Timing } from './view';

/**
 * The commands that change the topology that the engine holds (ADR-0007, ADR-0019). Their names and fields follow the
 * conformance steps (`exchange.declare`, `queue.declare`, `bind`), so that a recorded scenario and a document change are
 * the same kind of thing. Everything is plain data. A flag that a step may leave out is always written out here, so that
 * no reader has to know a default.
 *
 * These are the commands that the domain's `reconcile` makes to keep the engine in step with a canvas document, and that the engine's
 * `dispatch` applies (slice S6, ADR-0052). The rest of the vocabulary, which is about running a topology and not about building one,
 * is below: channels, consumers, publishing, producers, purging and the simulation's own commands.
 *
 * A broker cannot change an exchange or a queue that it has, and redeclaring one with other arguments is refused with
 * `406` (ADR-0008, rule 27). So a change of any flag is a delete and a declare, never a second declaration.
 */

export interface ExchangeDeclare {
  readonly op: 'exchange.declare';
  readonly name: string;
  readonly type: ExchangeType;
  readonly durable: boolean;
  readonly autoDelete: boolean;
  /** A client cannot publish to an internal exchange, but other exchanges can still route through it. */
  readonly internal: boolean;
}

/** Deleting an exchange deletes the bindings that start from it and the ones that end at it. */
export interface ExchangeDelete {
  readonly op: 'exchange.delete';
  readonly name: string;
}

export interface QueueDeclare {
  readonly op: 'queue.declare';
  readonly name: string;
  /** RabbitMQ 4.3 refuses a queue that is not durable, unless it is exclusive (ADR-0021, ADR-0024). */
  readonly durable: boolean;
  /**
   * The broker chose the name, as it does for a queue that a client declares with no name (`amq.gen-…`). A client cannot declare a name that starts with `amq.`, but a canvas can hold one that a broker
   * named (a file or a link made from one), and the simulator takes it as it is (ADR-0026).
   */
  readonly serverNamed?: boolean;
}

/** Deleting a queue deletes the bindings that end at it. */
export interface QueueDelete {
  readonly op: 'queue.delete';
  readonly name: string;
}

/** Binding the same thing twice is the same binding: a broker keeps it once. */
export interface Bind {
  readonly op: 'bind';
  readonly source: string;
  readonly destination: Destination;
  readonly key: string;
  /** The arguments of a binding. Left out, the binding has none. */
  readonly headers?: HeaderArguments;
}

export interface Unbind {
  readonly op: 'unbind';
  readonly source: string;
  readonly destination: Destination;
  readonly key: string;
  readonly headers?: HeaderArguments;
}

export type TopologyCommand = ExchangeDeclare | ExchangeDelete | QueueDeclare | QueueDelete | Bind | Unbind;

/**
 * The rest of the commands (ADR-0052). A channel, a consumer and a producer are named by strings that the caller chooses: the
 * conformance steps say `ch1` and `c1`, and the app uses the ids of the consumers and producers of the canvas.
 */

/** Takes the ready messages out of a queue. The messages that consumers hold stay with them. */
export interface QueuePurge {
  readonly op: 'queue.purge';
  readonly name: string;
}

/** Opens a channel, which is a consumer's: the unit that has a prefetch and that is closed as one (ADR-0050). */
export interface ChannelOpen {
  readonly op: 'channel.open';
  readonly channel: string;
  /** How many unacknowledged messages each of its consumers may hold. 0, or left out, is no limit. */
  readonly prefetch?: number;
  /** How long it takes to handle a message. `null`, or left out, is a channel that handles nothing by itself, and is told to `basic.ack`. */
  readonly processingMs?: number | null;
}

/** Changes the prefetch and the time of a channel that is open. What is left out stays as it is. */
export interface ChannelSet {
  readonly op: 'channel.set';
  readonly channel: string;
  readonly prefetch?: number;
  readonly processingMs?: number | null;
}

/** Closes a channel. What its consumers hold goes back to the queues, as redelivered (ADR-0008, rule 16). */
export interface ChannelClose {
  readonly op: 'channel.close';
  readonly channel: string;
}

/**
 * A consumer of a channel starts consuming from a queue. `consumer` is its tag, which names it until it is gone. A consumer that was cancelled is gone only when it holds nothing, and the same channel
 * that asks again for the same queue, in the same way, under the tag of one that still holds messages takes it up where it was (ADR-0088); a tag that is taken in any other way is refused with a `RangeError`.
 */
export interface BasicConsume {
  readonly op: 'basic.consume';
  readonly channel: string;
  readonly queue: string;
  readonly consumer: string;
  readonly ack: 'auto' | 'manual';
}

/** Stops a consumer from being given more. What it holds stays with it, and can still be acknowledged (ADR-0008, rule 16). */
export interface BasicCancel {
  readonly op: 'basic.cancel';
  readonly consumer: string;
}

/** Acknowledges a message that a consumer holds: the one with this number, or, left out, the oldest. */
export interface BasicAck {
  readonly op: 'basic.ack';
  readonly consumer: string;
  readonly message?: number;
}

/** Publishes a message with no producer. Like a conformance step, it names the message by its `body`, which is its payload. */
export interface BasicPublish {
  readonly op: 'basic.publish';
  readonly exchange: string;
  readonly key?: string;
  readonly headers?: readonly HeaderEntry<HeaderValue>[];
  readonly body?: string;
}

/** Makes a producer, or changes the one that is there. Where it publishes is a name: of an exchange, or of a queue, which it reaches through the default exchange. */
export interface ProducerSet {
  readonly op: 'producer.set';
  readonly producer: string;
  readonly target: { readonly kind: 'exchange' | 'queue'; readonly name: string } | null;
  readonly key: string;
  readonly payload: string;
  readonly headers: readonly HeaderEntry<HeaderValue>[];
  /** How many messages it sends at a time. */
  readonly burst: number;
  readonly everyMs: number;
  /** Whether it sends again and again, `everyMs` apart, starting now. */
  readonly repeat: boolean;
}

export interface ProducerRemove {
  readonly op: 'producer.remove';
  readonly producer: string;
}

/** A producer sends its message now, as many times as its burst says. It does not change when it publishes next. */
export interface ProducerPublish {
  readonly op: 'producer.publish';
  readonly producer: string;
}

/** The seed of the simulation and the latencies. A change of latency applies to what is sent after it. */
export interface SimConfigure {
  readonly op: 'sim.configure';
  readonly seed: number;
  readonly timing: Timing;
}

/** Takes every message out of the simulation, and leaves the topology, the producers and the channels as they are. */
export interface SimClearMessages {
  readonly op: 'sim.clearMessages';
}

/** Zeroes the counters, and leaves the messages. */
export interface SimResetCounters {
  readonly op: 'sim.resetCounters';
}

export type RuntimeCommand =
  | QueuePurge
  | ChannelOpen
  | ChannelSet
  | ChannelClose
  | BasicConsume
  | BasicCancel
  | BasicAck
  | BasicPublish
  | ProducerSet
  | ProducerRemove
  | ProducerPublish
  | SimConfigure
  | SimClearMessages
  | SimResetCounters;

export type EngineCommand = TopologyCommand | RuntimeCommand;
