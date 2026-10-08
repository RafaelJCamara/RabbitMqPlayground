import type { ExchangeDeclare } from './command';
import { createHeap } from './heap';
import { bindingSignature } from './bindings';
import { createPrng } from './prng';
import { ReadyList } from './ready';
import type {
  ChannelState,
  ExchangeCounters,
  Held,
  ProducerState,
  QueueEntry,
  QueueState,
  Scheduled,
  State,
  TagState,
} from './state';
import type { Binding } from './topology';
import type { Timing } from './view';

/**
 * A snapshot is the whole of what decides what the engine does next, as plain data that survives JSON (ADR-0052). `restore` replaces the
 * state of an engine with it, and an engine that was restored gives the same events as the one that the snapshot was taken from, for the same
 * commands and the same advances. The share link of S10 keeps one, so its version is a promise: a change to what it holds is a new version, and a
 * migration.
 */
export const SNAPSHOT_VERSION = 1;

export interface QueueSnapshot {
  readonly name: string;
  readonly durable: boolean;
  readonly ready: readonly QueueEntry[];
  readonly turn: readonly string[];
  readonly blocked: readonly string[];
  readonly nextOrder: number;
  readonly enqueued: number;
  readonly delivered: number;
}

export interface TagSnapshot {
  readonly tag: string;
  readonly channel: string;
  readonly queue: string;
  readonly ack: 'auto' | 'manual';
  readonly unacked: readonly QueueEntry[];
  readonly cancelled: boolean;
}

export interface ChannelSnapshot {
  readonly id: string;
  readonly prefetch: number;
  readonly processingMs: number | null;
  readonly tags: readonly string[];
  readonly waiting: readonly Held[];
  readonly working: Held | null;
  readonly received: number;
  readonly consumed: number;
}

export interface EngineSnapshot {
  readonly version: typeof SNAPSHOT_VERSION;
  readonly vhost: string;
  readonly seed: number;
  /** The state of the PRNG, which continues the same stream (nothing draws from it in M1). */
  readonly prng: number;
  readonly timing: Timing;
  readonly now: number;
  readonly nextSeq: number;
  readonly nextEventSeq: number;
  readonly nextMessageId: number;
  readonly published: number;
  readonly exchanges: readonly ExchangeDeclare[];
  readonly bindings: readonly Binding[];
  readonly queues: readonly QueueSnapshot[];
  readonly channels: readonly ChannelSnapshot[];
  readonly tags: readonly TagSnapshot[];
  readonly producers: readonly ProducerState[];
  readonly exchangeCounters: readonly (readonly [string, ExchangeCounters])[];
  /** What is scheduled, in the order that it will happen. */
  readonly heap: readonly Scheduled[];
}

const copyEntry = (entry: QueueEntry): QueueEntry => ({ ...entry });

export function takeSnapshot(state: State): EngineSnapshot {
  return {
    version: SNAPSHOT_VERSION,
    vhost: state.vhost,
    seed: state.seed,
    prng: state.prng.state(),
    timing: { ...state.timing },
    now: state.now,
    nextSeq: state.nextSeq,
    nextEventSeq: state.nextEventSeq,
    nextMessageId: state.nextMessageId,
    published: state.published,
    exchanges: [...state.exchanges.values()].map((exchange) => ({ ...exchange })),
    bindings: [...state.bindings.values()],
    queues: [...state.queues.values()].map((queue) => ({
      name: queue.name,
      durable: queue.durable,
      ready: queue.ready.toArray().map(copyEntry),
      turn: [...queue.turn],
      blocked: [...queue.blocked],
      nextOrder: queue.nextOrder,
      enqueued: queue.enqueued,
      delivered: queue.delivered,
    })),
    channels: [...state.channels.values()].map((channel) => ({
      id: channel.id,
      prefetch: channel.prefetch,
      processingMs: channel.processingMs,
      tags: [...channel.tags],
      waiting: [...channel.waiting],
      working: channel.working,
      received: channel.received,
      consumed: channel.consumed,
    })),
    tags: [...state.tags.values()].map((tag) => ({ ...tag, unacked: tag.unacked.map(copyEntry) })),
    producers: [...state.producers.values()].map((producer) => ({ ...producer })),
    exchangeCounters: [...state.exchangeCounters].map(([name, counters]) => [name, { ...counters }] as const),
    heap: state.heap.sorted(),
  };
}

/** The state that a snapshot describes, made of new objects, so that the snapshot can be used again. */
export function loadSnapshot(snapshot: EngineSnapshot): State {
  const heap = createHeap<Scheduled>();
  for (const scheduled of snapshot.heap) {
    heap.push(scheduled);
  }
  const exchanges = new Map<string, ExchangeDeclare>(
    snapshot.exchanges.map((exchange) => [exchange.name, { ...exchange }]),
  );
  return {
    vhost: snapshot.vhost,
    seed: snapshot.seed,
    prng: createPrng(snapshot.prng),
    timing: { ...snapshot.timing },
    now: snapshot.now,
    nextSeq: snapshot.nextSeq,
    nextEventSeq: snapshot.nextEventSeq,
    nextMessageId: snapshot.nextMessageId,
    version: 0,
    exchanges,
    bindings: new Map(
      snapshot.bindings.map((binding) => [
        bindingSignature(
          binding.source,
          binding.destination.kind,
          binding.destination.name,
          binding.key,
          binding.headers,
        ),
        binding,
      ]),
    ),
    queues: new Map(
      snapshot.queues.map((queue): [string, QueueState] => [
        queue.name,
        {
          name: queue.name,
          durable: queue.durable,
          ready: new ReadyList(queue.ready.map(copyEntry)),
          turn: [...queue.turn],
          blocked: [...queue.blocked],
          nextOrder: queue.nextOrder,
          enqueued: queue.enqueued,
          delivered: queue.delivered,
        },
      ]),
    ),
    channels: new Map(
      snapshot.channels.map((channel): [string, ChannelState] => [
        channel.id,
        { ...channel, tags: [...channel.tags], waiting: [...channel.waiting] },
      ]),
    ),
    tags: new Map(
      snapshot.tags.map((tag): [string, TagState] => [tag.tag, { ...tag, unacked: tag.unacked.map(copyEntry) }]),
    ),
    producers: new Map(snapshot.producers.map((producer): [string, ProducerState] => [producer.id, { ...producer }])),
    heap,
    exchangeCounters: new Map(snapshot.exchangeCounters.map(([name, counters]) => [name, { ...counters }])),
    published: snapshot.published,
    topology: null,
  };
}
