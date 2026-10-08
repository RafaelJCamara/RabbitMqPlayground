import { bindingSignature, createEngine, SNAPSHOT_VERSION, snapshotIssue, type EngineSnapshot } from '@rmq/engine';
import { z } from 'zod';
import { sameValue } from './commands/helpers';
import { headerArgumentsSchema, headerValueSchema, LIMITS, type CanvasDocument } from './document/schema';
import { reconcile } from './reconcile';

/**
 * The snapshot of an engine that comes from outside (ADR-0077): the messages of a share link. `engine.restore` reads the version of a
 * snapshot and trusts the rest, which is right for the one that the engine took itself and wrong for one that was written by someone
 * else, and that went through a compressor and a URL. So there is a reader, `readSnapshot`, and it is as strict as the document's: a schema that
 * names every field and refuses the ones it does not know, then the engine's own check of what it trusts (`snapshotIssue`: the names that are
 * referred to are there, the counters that say what comes next are above everything that has been given out, and so on), which is the engine's
 * because the engine knows what it trusts.
 *
 * The schema is typed as the engine's `EngineSnapshot`, in both directions, so a change to what a snapshot holds does not compile until this is changed.
 */

const whole = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/** A time on the virtual clock, in whole milliseconds. */
const time = whole;
const name = z.string();
const integerIn = ({ min, max }: { readonly min: number; readonly max: number }) => z.number().int().min(min).max(max);

const headerEntry = z.strictObject({ key: z.string(), value: headerValueSchema });

const message = z.strictObject({
  id: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  producer: name.nullable(),
  exchange: z.string(),
  key: z.string(),
  headers: z.array(headerEntry),
  payload: z.string(),
});

const queueEntry = z.strictObject({ message, order: whole, redelivered: z.boolean() });

const held = z.strictObject({
  queue: name,
  tag: name,
  ack: z.enum(['auto', 'manual']),
  message,
  order: whole,
  redelivered: z.boolean(),
});

const destination = z.strictObject({ kind: z.enum(['queue', 'exchange']), name });
const hop = z.strictObject({ from: name, binding: whole.nullable(), to: destination });
const path = z.strictObject({ queue: name, hops: z.array(hop) });

const task = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('tick'), producer: name }),
  z.strictObject({ kind: z.literal('arrive'), message, sentAt: time }),
  z.strictObject({ kind: z.literal('enqueue'), message, paths: z.array(path), routedAt: time }),
  z.strictObject({ kind: z.literal('receive'), channel: name, held, sentAt: time }),
  z.strictObject({ kind: z.literal('finish'), channel: name, held }),
]);

const timingMs = integerIn(LIMITS.timingMs);

/** The strict shape of an engine snapshot of version 1. */
export const engineSnapshotSchema = z.strictObject({
  version: z.literal(SNAPSHOT_VERSION),
  vhost: z.string(),
  seed: integerIn(LIMITS.seed),
  prng: integerIn({ min: 0, max: 0xffff_ffff }),
  timing: z.strictObject({ publishMs: timingMs, brokerMs: timingMs, deliverMs: timingMs }),
  now: time,
  nextSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  nextEventSeq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  nextMessageId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  published: whole,
  exchanges: z.array(
    z.strictObject({
      op: z.literal('exchange.declare'),
      name,
      type: z.enum(['direct', 'fanout', 'topic', 'headers']),
      durable: z.boolean(),
      autoDelete: z.boolean(),
      internal: z.boolean(),
    }),
  ),
  bindings: z.array(
    z.strictObject({
      source: name,
      destination,
      key: z.string(),
      headers: headerArgumentsSchema.optional(),
    }),
  ),
  queues: z.array(
    z.strictObject({
      name,
      durable: z.boolean(),
      ready: z.array(queueEntry),
      turn: z.array(name),
      blocked: z.array(name),
      nextOrder: whole,
      enqueued: whole,
      delivered: whole,
    }),
  ),
  channels: z.array(
    z.strictObject({
      id: name,
      prefetch: integerIn(LIMITS.prefetch),
      processingMs: integerIn(LIMITS.processingMs).nullable(),
      tags: z.array(name),
      waiting: z.array(held),
      working: held.nullable(),
      received: whole,
      consumed: whole,
    }),
  ),
  tags: z.array(
    z.strictObject({
      tag: name,
      channel: name,
      queue: name,
      ack: z.enum(['auto', 'manual']),
      unacked: z.array(queueEntry),
      cancelled: z.boolean(),
    }),
  ),
  producers: z.array(
    z.strictObject({
      id: name,
      target: z.strictObject({ kind: z.enum(['exchange', 'queue']), name }).nullable(),
      key: z.string(),
      payload: z.string(),
      headers: z.array(headerEntry),
      burst: integerIn(LIMITS.burst),
      everyMs: integerIn(LIMITS.everyMs),
      repeat: z.boolean(),
      published: whole,
      lastTickAt: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
      nextTickAt: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
    }),
  ),
  exchangeCounters: z.array(z.tuple([name, z.strictObject({ routed: whole, unroutable: whole, refused: whole })])),
  heap: z.array(z.strictObject({ at: time, seq: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), task })),
});

// The schema and the engine's type must say the same thing: if either moves, one of these lines stops compiling.
type Parsed = z.infer<typeof engineSnapshotSchema>;
type Frozen<T> = T extends readonly [infer First, infer Second]
  ? readonly [Frozen<First>, Frozen<Second>]
  : T extends readonly (infer Item)[]
    ? readonly Frozen<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: Frozen<T[Key]> }
      : T;
type Is<Answer extends true> = Answer;
type Assignable<From, To> = [From] extends [To] ? true : false;
/** Each way is a line of its own, so that the one that stops compiling says which way the schema and the engine have drifted. Types only: nothing of it is in the program. */
export type SchemaIsSnapshot = Is<Assignable<Parsed, EngineSnapshot>>;
export type SnapshotIsSchema = Is<Assignable<EngineSnapshot, Frozen<Parsed>>>;

/** What a reader answers: the snapshot, or the first thing that is wrong with it, and how many other things are. */
export type SnapshotRead =
  { readonly ok: true; readonly value: EngineSnapshot } | { readonly ok: false; readonly message: string };

const where = (path: readonly PropertyKey[]): string =>
  path.length === 0 ? 'The snapshot' : path.map(String).join('.');

/**
 * Reads a snapshot that came from outside. It never throws, and it answers `ok` only for one that `engine.restore` takes.
 */
export function readSnapshot(raw: unknown): SnapshotRead {
  const shape = engineSnapshotSchema.safeParse(raw);
  if (!shape.success) {
    // A parse that fails has at least one issue.
    const first = shape.error.issues[0] as (typeof shape.error.issues)[number];
    const more = shape.error.issues.length - 1;
    return {
      ok: false,
      message: `${where(first.path)}: ${first.message}${more > 0 ? ` (and ${more} more problems)` : ''}`,
    };
  }
  const problem = snapshotIssue(shape.data);
  return problem === null ? { ok: true, value: shape.data } : { ok: false, message: problem };
}

/** What the document decides about an engine, and nothing that a run decides, for comparing two snapshots by it. */
function shapeOf(snapshot: EngineSnapshot): unknown {
  const byName = <T>(items: readonly T[], key: (item: T) => string): T[] =>
    [...items].sort((a, b) => key(a).localeCompare(key(b)));
  return {
    vhost: snapshot.vhost,
    seed: snapshot.seed,
    timing: snapshot.timing,
    exchanges: byName(snapshot.exchanges, (exchange) => exchange.name),
    bindings: byName(
      snapshot.bindings.map((binding) => ({
        signature: bindingSignature(
          binding.source,
          binding.destination.kind,
          binding.destination.name,
          binding.key,
          binding.headers,
        ),
        binding,
      })),
      ({ signature }) => signature,
    ),
    queues: byName(
      snapshot.queues.map(({ name: queue, durable }) => ({ name: queue, durable })),
      ({ name: queue }) => queue,
    ),
    channels: byName(
      snapshot.channels.map(({ id, prefetch, processingMs, tags }) => ({
        id,
        prefetch,
        processingMs,
        tags: [...tags].sort(),
      })),
      ({ id }) => id,
    ),
    tags: byName(
      snapshot.tags.map(({ tag, channel, queue, ack }) => ({ tag, channel, queue, ack })),
      ({ tag }) => tag,
    ),
    producers: byName(
      snapshot.producers.map(({ id, target, key, payload, headers, burst, everyMs, repeat }) => ({
        id,
        target,
        key,
        payload,
        headers,
        burst,
        everyMs,
        repeat,
      })),
      ({ id }) => id,
    ),
  };
}

/**
 * Whether the snapshot is of this canvas: an engine that is made from the document, the way that the app makes one (`reconcile`, ADR-0054), holds the same
 * exchanges, queues, bindings, channels, consumers and producers, with the same seed and latencies. What a run decides (the messages, the clock, the
 * counters) is the snapshot's own. The answer is the sentence that says what differs, or `null`.
 */
export function snapshotDisagrees(document: CanvasDocument, snapshot: EngineSnapshot): string | null {
  const fresh = createEngine({ seed: document.settings.seed, timing: document.settings.timing, vhost: document.vhost });
  for (const command of reconcile(null, document)) {
    fresh.dispatch(command);
  }
  const mine = shapeOf(fresh.snapshot()) as Record<string, unknown>;
  const theirs = shapeOf(snapshot) as Record<string, unknown>;
  const differs = Object.keys(mine).find((key) => !sameValue(mine[key], theirs[key]));
  return differs === undefined
    ? null
    : `Its messages are not those of this canvas: they were taken from a canvas whose ${differs} was not the same`;
}
