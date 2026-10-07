import type { ExchangeDeclare } from './command';
import type { MessageInfo } from './events';
import { createHeap, type Heap, type Timed } from './heap';
import type { HeaderEntry, HeaderValue } from './headers';
import { createPrng, type Prng } from './prng';
import type { Entry } from './ready';
import { ReadyList } from './ready';
import type { RoutePath } from './route';
import type { Binding, Topology } from './topology';
import type { Timing } from './view';

/**
 * What the engine holds (ADR-0052). It is all in here, in plain data, so that a snapshot is a copy of it and a restored engine is the same
 * engine. The functions that change it are in `queues.ts`, `publishing.ts` and `commands.ts`, and the engine of `engine.ts` is these, and a clock.
 */

/** A copy of a message in a queue. */
export type QueueEntry = Entry<MessageInfo>;

/** What a queue has: the messages that it has not given away, and the consumers that it may give them to, in turn (ADR-0053). */
export interface QueueState {
  readonly name: string;
  readonly durable: boolean;
  readonly ready: ReadyList<MessageInfo>;
  /** The consumer tags that can be given a message, the one at the head first. */
  turn: string[];
  /** The consumer tags that were tried, and had no room. They come back to the end of the turn when an acknowledgement gives them room. */
  blocked: string[];
  /** The `order` of the next copy that comes in. */
  nextOrder: number;
  enqueued: number;
  delivered: number;
}

/** A consumer: one subscription of a channel to a queue. The prefetch is counted for each of these (ADR-0053). */
export interface TagState {
  readonly tag: string;
  readonly channel: string;
  readonly queue: string;
  readonly ack: 'auto' | 'manual';
  /** What it holds and has not acknowledged, the oldest first. Always empty for a consumer that acknowledges by itself. */
  unacked: QueueEntry[];
  cancelled: boolean;
}

/** A message that has been given to a consumer, as far as the consumer's channel is concerned. */
export interface Held {
  readonly queue: string;
  readonly tag: string;
  readonly ack: 'auto' | 'manual';
  readonly message: MessageInfo;
  /** The `order` of the copy in its queue, which is what the copy is told by while it is unacknowledged. */
  readonly order: number;
  readonly redelivered: boolean;
}

export interface ChannelState {
  readonly id: string;
  prefetch: number;
  processingMs: number | null;
  /** Its consumers, in the order that they were made. */
  tags: string[];
  /** What has reached it and is waiting, oldest first. */
  waiting: Held[];
  working: Held | null;
  received: number;
  consumed: number;
}

export interface ProducerTarget {
  readonly kind: 'exchange' | 'queue';
  readonly name: string;
}

export interface ProducerState {
  readonly id: string;
  target: ProducerTarget | null;
  key: string;
  payload: string;
  headers: readonly HeaderEntry<HeaderValue>[];
  burst: number;
  everyMs: number;
  repeat: boolean;
  published: number;
  /** When it last published because it repeats, or when it was made to repeat, less one interval, so that the first is now. */
  lastTickAt: number;
  /** When it publishes next, or `null` when it does not repeat. */
  nextTickAt: number | null;
}

/** What is scheduled. Plain data, so that a snapshot can hold it. */
export type Task =
  | { readonly kind: 'tick'; readonly producer: string }
  | { readonly kind: 'arrive'; readonly message: MessageInfo; readonly sentAt: number }
  | {
      readonly kind: 'enqueue';
      readonly message: MessageInfo;
      readonly paths: readonly RoutePath[];
      readonly routedAt: number;
    }
  | { readonly kind: 'receive'; readonly channel: string; readonly held: Held; readonly sentAt: number }
  | { readonly kind: 'finish'; readonly channel: string; readonly held: Held };

export interface Scheduled extends Timed {
  readonly task: Task;
}

export interface ExchangeCounters {
  routed: number;
  unroutable: number;
  refused: number;
}

export interface State {
  vhost: string;
  seed: number;
  prng: Prng;
  timing: Timing;
  now: number;
  /** The `seq` of the next thing that is scheduled, which settles a tie in time. */
  nextSeq: number;
  /** The `seq` of the next event that is said. */
  nextEventSeq: number;
  nextMessageId: number;
  /** Counts every change, so that what is worked out from the state can be kept until it changes. */
  version: number;
  exchanges: Map<string, ExchangeDeclare>;
  /** By what a broker keeps about a binding (`bindingSignature`), in the order that they were made. */
  bindings: Map<string, Binding>;
  queues: Map<string, QueueState>;
  channels: Map<string, ChannelState>;
  tags: Map<string, TagState>;
  producers: Map<string, ProducerState>;
  heap: Heap<Scheduled>;
  /** The default exchange is the name `""`. */
  exchangeCounters: Map<string, ExchangeCounters>;
  published: number;
  /** What `route()` reads, made from the above and kept until a command changes the topology. */
  topology: Topology | null;
}

export function createState(options: {
  readonly seed: number;
  readonly timing: Timing;
  readonly vhost: string;
}): State {
  return {
    vhost: options.vhost,
    seed: options.seed,
    prng: createPrng(options.seed),
    timing: options.timing,
    now: 0,
    nextSeq: 1,
    nextEventSeq: 1,
    nextMessageId: 1,
    version: 0,
    exchanges: new Map(),
    bindings: new Map(),
    queues: new Map(),
    channels: new Map(),
    tags: new Map(),
    producers: new Map(),
    heap: createHeap<Scheduled>(),
    // The default exchange is not declared, and it routes and fails to route like any other.
    exchangeCounters: new Map([['', { routed: 0, unroutable: 0, refused: 0 }]]),
    published: 0,
    topology: null,
  };
}
