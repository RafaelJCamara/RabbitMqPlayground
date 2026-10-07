import type { RoutePath } from './route';
import type { Topology } from './topology';

/**
 * What the screen reads (ADR-0052): counts that the engine keeps as it goes, the messages that are on the move, and the list of
 * what a queue holds. Plain data, and a function of the engine's state.
 */

/** The latencies of a message's journey, in virtual milliseconds (ADR-0007, ADR-0052). */
export interface Timing {
  readonly publishMs: number;
  readonly brokerMs: number;
  readonly deliverMs: number;
}

export interface QueueView {
  readonly ready: number;
  readonly unacked: number;
  /** How many copies have come into the queue since the counters were last reset. */
  readonly enqueued: number;
  /** How many times the queue has given a message to a consumer since the counters were last reset. */
  readonly delivered: number;
  /** The consumers that it can give a message to now. */
  readonly consumers: number;
}

export interface ExchangeView {
  readonly routed: number;
  readonly unroutable: number;
  readonly refused: number;
}

export interface ProducerView {
  readonly published: number;
  readonly repeating: boolean;
  /** When it publishes next, if it repeats. */
  readonly nextAt: number | null;
}

export interface ConsumerView {
  readonly consumer: string;
  readonly queue: string;
  readonly ack: 'auto' | 'manual';
  /** What it holds that is not acknowledged: the part of its prefetch that is used. */
  readonly unacked: number;
  readonly cancelled: boolean;
}

export interface ChannelView {
  /** 0 is no limit. */
  readonly prefetch: number;
  /** `null` for a channel that handles nothing by itself and is told to ack. */
  readonly processingMs: number | null;
  readonly received: number;
  /** The messages that it is done with: acknowledged, or handled by a consumer that acknowledges by itself. */
  readonly consumed: number;
  /** What has reached it and is waiting for its turn. */
  readonly waiting: number;
  /** Whether it is handling a message now. */
  readonly working: boolean;
  readonly consumers: readonly ConsumerView[];
}

export interface RuntimeView {
  readonly now: number;
  readonly seed: number;
  readonly timing: Timing;
  readonly vhost: string;
  readonly published: number;
  /** Messages on their way: to the broker, to a queue, to a consumer. */
  readonly travelling: number;
  readonly topology: Topology;
  readonly queues: Readonly<Record<string, QueueView>>;
  /** The default exchange is `""`. */
  readonly exchanges: Readonly<Record<string, ExchangeView>>;
  readonly producers: Readonly<Record<string, ProducerView>>;
  readonly channels: Readonly<Record<string, ChannelView>>;
}

/** A message that is on the move, and where. The times are virtual milliseconds. */
export type Flight =
  /** From a producer to the exchange. */
  | {
      readonly leg: 'publish';
      readonly message: number;
      readonly key: string;
      readonly producer: string | null;
      readonly exchange: string;
      readonly from: number;
      readonly to: number;
    }
  /** Inside the broker, along the hops of each path, which share the time. */
  | {
      readonly leg: 'broker';
      readonly message: number;
      readonly key: string;
      /** The producer that sent it, or `null` for a message that a command published, which has no link to wait at when the hops of its path are not drawn. */
      readonly producer: string | null;
      readonly exchange: string;
      readonly paths: readonly RoutePath[];
      readonly from: number;
      readonly to: number;
    }
  /** From a queue to a consumer. */
  | {
      readonly leg: 'deliver';
      readonly message: number;
      readonly key: string;
      readonly queue: string;
      readonly channel: string;
      readonly consumer: string;
      readonly redelivered: boolean;
      readonly from: number;
      readonly to: number;
    };

/** A message that a queue holds: ready, or given to a consumer that has not acknowledged it. */
export interface QueueMessage {
  readonly id: number;
  readonly key: string;
  readonly payload: string;
  readonly redelivered: boolean;
  /** The consumer that holds it, or `null` for a message that is ready. */
  readonly heldBy: { readonly consumer: string; readonly channel: string } | null;
}
