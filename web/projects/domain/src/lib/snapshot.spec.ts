import type { EngineSnapshot } from '@rmq/engine';
import {
  arbDocument,
  busyEngine,
  arbTypedDamage,
  bindingRecord,
  configureFastCheck,
  consumerRecord,
  documentOf,
  engineFor,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
  snapshotAfter,
  type Json,
} from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { readSnapshot, snapshotDisagrees } from './snapshot';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

/** What a snapshot is after a link: JSON text and back. */
const viaJson = (snapshot: EngineSnapshot): unknown => JSON.parse(JSON.stringify(snapshot));

/** A copy of a snapshot that can be changed. */
const copy = (snapshot: EngineSnapshot): Record<string, unknown> =>
  structuredClone(snapshot) as unknown as Record<string, unknown>;

describe('readSnapshot (ADR-0077)', () => {
  const document = sampleDocument();

  it.each([0, 1, 600, 1_000, 2_500])('reads the snapshot of a run at %i ms as the snapshot that it is', (until) => {
    const snapshot = snapshotAfter(document, until);

    const read = readSnapshot(viaJson(snapshot));

    expect(read.ok && read.value).toEqual(snapshot);
  });

  it('has something in each place that the reader looks at, in at least one of these runs', () => {
    const kinds = new Set<string>();
    let held = false;
    let unacked = false;
    for (const until of [0, 300, 600, 900, 1_000, 1_400, 2_500]) {
      const snapshot = snapshotAfter(document, until);
      snapshot.heap.forEach(({ task }) => kinds.add(task.kind));
      held ||= snapshot.channels.some((channel) => channel.working !== null || channel.waiting.length > 0);
      unacked ||= snapshot.tags.some((tag) => tag.unacked.length > 0);
    }
    expect(kinds.has('tick')).toBe(true);
    expect(kinds.has('arrive') || kinds.has('enqueue') || kinds.has('receive') || kinds.has('finish')).toBe(true);
    expect(held || unacked || [...kinds].length > 1).toBe(true);
  });

  it('refuses what is not an object, and a version that is not the one that the engine reads', () => {
    const snapshot = snapshotAfter(document, 600);

    for (const raw of [null, undefined, 'x', 1, [], true]) {
      expect(readSnapshot(raw).ok).toBe(false);
    }
    const other = readSnapshot({ ...copy(snapshot), version: 2 });
    expect(!other.ok && other.message).toContain('version');
  });

  it('refuses a field that it does not know, at any depth', () => {
    const snapshot = copy(snapshotAfter(document, 600));

    const top = readSnapshot({ ...snapshot, extra: 1 });
    expect(!top.ok && top.message).toMatch(/extra|unrecognized/i);

    const queues = structuredClone(snapshot['queues']) as Record<string, unknown>[];
    (queues[0] as Record<string, unknown>)['colour'] = 'red';
    const deep = readSnapshot({ ...snapshot, queues });
    expect(!deep.ok && deep.message).toContain('queues.0');
  });

  it.each([
    ['a negative count', (s: Record<string, unknown>) => (s['published'] = -1), 'published'],
    ['a count that is not whole', (s: Record<string, unknown>) => (s['now'] = 1.5), 'now'],
    ['a state of the generator that is not 32 bits', (s: Record<string, unknown>) => (s['prng'] = 2 ** 32), 'prng'],
    ['a seed beyond the range', (s: Record<string, unknown>) => (s['seed'] = 2 ** 32), 'seed'],
    [
      'a latency beyond the range',
      (s: Record<string, unknown>) => (s['timing'] = { publishMs: 1, brokerMs: 1, deliverMs: 70_000 }),
      'deliverMs',
    ],
    ['a vhost that is a number', (s: Record<string, unknown>) => (s['vhost'] = 7), 'vhost'],
    ['no list of queues', (s: Record<string, unknown>) => delete s['queues'], 'queues'],
    ['a list that is an object', (s: Record<string, unknown>) => (s['heap'] = {}), 'heap'],
    [
      'an exchange of a kind that does not exist',
      (s: Record<string, unknown>) => ((s['exchanges'] as { type: string }[])[0]!.type = 'bogus'),
      'exchanges.0.type',
    ],
  ])('refuses %s, and says where', (_what, damage, path) => {
    const snapshot = copy(snapshotAfter(document, 600));
    damage(snapshot);

    const read = readSnapshot(snapshot);

    expect(read.ok).toBe(false);
    expect(!read.ok && read.message).toContain(path);
  });

  it('refuses a header value that is an integer beyond the safe ones, and an invalid x-match', () => {
    const snapshot = copy(snapshotAfter(document, 600));
    const producers = structuredClone(snapshot['producers']) as { headers: unknown[] }[];
    (producers[0] as { headers: unknown[] }).headers = [{ key: 'n', value: { t: 'integer', v: 2 ** 60 } }];
    expect(readSnapshot({ ...snapshot, producers }).ok).toBe(false);

    const bindings = structuredClone(snapshot['bindings']) as Record<string, unknown>[];
    bindings[0] = { ...(bindings[0] as Record<string, unknown>), headers: { xMatch: 'bogus', args: [] } };
    expect(readSnapshot({ ...snapshot, bindings }).ok).toBe(false);
  });

  it('says only the first problem when there is one, and counts the others when there are several', () => {
    const snapshot = copy(snapshotAfter(document, 600));
    snapshot['published'] = -1;
    const one = readSnapshot(snapshot);
    snapshot['now'] = -1;
    const two = readSnapshot(snapshot);
    snapshot['seed'] = 2 ** 32;
    const three = readSnapshot(snapshot);

    expect(!one.ok && one.message).toMatch(/^published: [^(]*$/);
    // The first is the one that the schema lists first, which is not the one that was damaged first.
    expect(!two.ok && two.message).toMatch(/^\w+: .* \(and 1 more problem\)$/);
    expect(!three.ok && three.message).toMatch(/^\w+: .* \(and 2 more problems\)$/);
  });

  it('says that it is the snapshot that is wrong, when what is wrong is all of it', () => {
    expect(readSnapshot(42)).toEqual({ ok: false, message: expect.stringMatching(/^The snapshot: /) as string });
    expect(readSnapshot(null)).toEqual({ ok: false, message: expect.stringMatching(/^The snapshot: /) as string });
  });

  it('reads the snapshot of an engine that has consumers of both kinds, one that is cancelled and copies in every place', () => {
    const snapshot = busyEngine().snapshot();
    expect(snapshot.tags.map(({ ack }) => ack).sort()).toEqual(['auto', 'manual', 'manual']);

    const read = readSnapshot(viaJson(snapshot));

    expect(read.ok && read.value).toEqual(snapshot);
  });

  it('reads how many messages of a consumer are not counted (ADR-0089), refuses a number that is not whole, and has the engine refuse more than the queue gave out', () => {
    const snapshot = copy(busyEngine().snapshot());
    const tags = structuredClone(snapshot['tags']) as { unacked: unknown[]; uncounted?: unknown }[];

    tags[0]!.uncounted = 1;
    const read = readSnapshot({ ...snapshot, tags });
    expect(read.ok && read.value.tags[0]?.uncounted).toBe(1);

    tags[0]!.uncounted = 1000;
    const beyond = readSnapshot({ ...snapshot, tags });
    expect(!beyond.ok && beyond.message).toContain('messages that an earlier consumer of its tag held');

    tags[0]!.uncounted = 1.5;
    const fraction = readSnapshot({ ...snapshot, tags });
    expect(!fraction.ok && fraction.message).toContain('tags.0.uncounted');
  });

  it('takes the time of the next tick of a producer to be 0, as the engine can have it, and not before that', () => {
    const snapshot = copy(busyEngine().snapshot());
    const producers = (snapshot['producers'] as Record<string, unknown>[]).map((producer) => ({ ...producer }));

    producers[0]!['nextTickAt'] = 0;
    const atZero = readSnapshot({ ...snapshot, producers });
    producers[0]!['nextTickAt'] = -1;
    const before = readSnapshot({ ...snapshot, producers });

    // Zero is a time, so it gets as far as the engine, which finds that what is scheduled does not say so.
    expect(!atZero.ok && atZero.message).not.toContain('nextTickAt');
    expect(!before.ok && before.message).toContain('producers.0.nextTickAt');
  });
});

describe('readSnapshot, against what the engine trusts (ADR-0077)', () => {
  it('reads a snapshot that the engine took, at any moment of a run', () => {
    for (const until of [0, 600, 1_000, 3_000]) {
      const snapshot = snapshotAfter(sampleDocument(), until);

      expect(readSnapshot(viaJson(snapshot))).toEqual({ ok: true, value: snapshot });
    }
  });

  it('refuses what the engine would not restore, in the words of the engine, because the engine knows what it trusts', () => {
    const damaged = copy(snapshotAfter(sampleDocument(), 1_000));
    damaged['exchangeCounters'] = (damaged['exchangeCounters'] as unknown[][]).filter(([name]) => name !== '');

    expect(readSnapshot(damaged)).toEqual({ ok: false, message: 'The default exchange has no counters' });
  });

  it('refuses a snapshot that the engine refuses, however it is damaged, and one that it takes does no harm', () => {
    fc.assert(
      fc.property(arbDocument, fc.nat(4_000), arbTypedDamage(), (document, until, damage) => {
        const damaged = damage(viaJson(snapshotAfter(document, until)) as Json);

        const read = readSnapshot(damaged);

        if (read.ok) {
          const engine = engineFor(document);
          expect(() => {
            engine.restore(read.value);
            engine.advanceTo(engine.now() + 6_000);
          }).not.toThrow();
        } else {
          expect(read.message).toMatch(/^[A-Za-z]/);
        }
      }),
    );
  });
});

describe('snapshotDisagrees', () => {
  it('finds a snapshot to be of the canvas that it was taken from, whatever the run', () => {
    const document = sampleDocument();

    for (const until of [0, 300, 700, 1_500, 4_000]) {
      expect(snapshotDisagrees(document, snapshotAfter(document, until))).toBeNull();
    }
  });

  it('finds a snapshot to be of the same canvas when the engine got there another way round, with its exchanges in another order', () => {
    const document = sampleDocument();
    const snapshot = snapshotAfter(document, 700);

    const reordered = {
      ...snapshot,
      exchanges: [...snapshot.exchanges].reverse(),
      queues: [...snapshot.queues].reverse(),
    };

    expect(snapshotDisagrees(document, reordered)).toBeNull();
  });

  it('says what differs when the snapshot is of another canvas', () => {
    const document = sampleDocument();
    const other = documentOf({
      exchanges: { E1: exchangeRecord('orders', 'topic') },
      queues: { Q1: queueRecord('billing') },
    });
    const snapshot = snapshotAfter(other, 0);

    const answer = snapshotDisagrees(document, snapshot);

    expect(answer).toMatch(
      /^Its messages are not those of this canvas: they were taken from a canvas whose \w+ was not the same$/,
    );
  });

  it('finds the seed, the latencies and the vhost to be part of what a canvas is', () => {
    const document = sampleDocument();
    const snapshot = snapshotAfter(document, 0);

    expect(snapshotDisagrees(document, { ...snapshot, seed: snapshot.seed + 1 })).toContain('seed');
    expect(
      snapshotDisagrees(document, {
        ...snapshot,
        timing: { ...snapshot.timing, brokerMs: snapshot.timing.brokerMs + 1 },
      }),
    ).toContain('timing');
    expect(snapshotDisagrees(document, { ...snapshot, vhost: 'elsewhere' })).toContain('vhost');
  });

  it('finds a different queue, binding, producer and consumer to be a different canvas', () => {
    const document = sampleDocument();
    const snapshot = snapshotAfter(document, 0);

    expect(snapshotDisagrees(document, { ...snapshot, queues: snapshot.queues.slice(1) })).toContain('queues');
    expect(snapshotDisagrees(document, { ...snapshot, bindings: snapshot.bindings.slice(1) })).toContain('bindings');
    expect(snapshotDisagrees(document, { ...snapshot, producers: [] })).toContain('producers');
    expect(snapshotDisagrees(document, { ...snapshot, tags: [] })).toContain('tags');
    expect(snapshotDisagrees(document, { ...snapshot, channels: [] })).toContain('channels');
    expect(snapshotDisagrees(document, { ...snapshot, exchanges: snapshot.exchanges.slice(1) })).toContain('exchanges');
  });

  it('finds a canvas with several of everything to be of itself, whatever the order the engine keeps them in', () => {
    const document = documentOf({
      exchanges: { E1: exchangeRecord('x', 'topic'), E2: exchangeRecord('y', 'fanout') },
      queues: { Q1: queueRecord('b'), Q2: queueRecord('a') },
      bindings: {
        B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'k.*'),
        B2: bindingRecord('E1', { kind: 'queue', id: 'Q2' }, 'k.#'),
        B3: bindingRecord('E2', { kind: 'queue', id: 'Q1' }),
      },
      producers: {
        P1: producerRecord('p', { kind: 'exchange', id: 'E1' }),
        P2: producerRecord('o', { kind: 'exchange', id: 'E2' }),
      },
      consumers: { C1: consumerRecord('one', ['Q1']), C2: consumerRecord('two', ['Q1', 'Q2']) },
    });
    const snapshot = snapshotAfter(document, 1_200);

    expect(snapshot.tags).toHaveLength(3);
    expect(snapshotDisagrees(document, snapshot)).toBeNull();
    expect(
      snapshotDisagrees(document, {
        ...snapshot,
        tags: [...snapshot.tags].reverse(),
        queues: [...snapshot.queues].reverse(),
      }),
    ).toBeNull();
  });

  it('is not troubled by what only a run decides', () => {
    const document = sampleDocument();
    const snapshot = snapshotAfter(document, 700);

    const later = snapshotAfter(document, 3_000);

    expect(snapshotDisagrees(document, later)).toBeNull();
    expect(
      snapshotDisagrees(document, { ...snapshot, now: snapshot.now + 1_000, published: snapshot.published + 5 }),
    ).toBeNull();
  });
});

describe('snapshotDisagrees, field by field', () => {
  /** Two of everything, and a consumer with a different way to acknowledge from the other's. */
  const several = () =>
    documentOf({
      exchanges: { E1: exchangeRecord('x', 'topic'), E2: exchangeRecord('y', 'fanout') },
      queues: { Q1: queueRecord('b'), Q2: queueRecord('a') },
      bindings: {
        B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'k.*'),
        B2: bindingRecord('E1', { kind: 'queue', id: 'Q2' }, 'k.#'),
        B3: bindingRecord('E2', { kind: 'queue', id: 'Q1' }),
      },
      producers: {
        P1: producerRecord('p', { kind: 'exchange', id: 'E1' }),
        P2: producerRecord('o', { kind: 'exchange', id: 'E2' }),
      },
      consumers: { C1: consumerRecord('one', ['Q1']), C2: consumerRecord('two', ['Q1', 'Q2']) },
    });

  type Damage = (s: Record<string, Record<string, unknown>[]>) => void;
  const CHANGES: readonly (readonly [string, string, Damage])[] = [
    ['the key of a binding', 'bindings', (s) => (s['bindings']![0]!['key'] = 'another')],
    ['whether a queue is durable', 'queues', (s) => (s['queues']![0]!['durable'] = !s['queues']![0]!['durable'])],
    ['the prefetch of a channel', 'channels', (s) => ((s['channels']![0]!['prefetch'] as number) += 1)],
    ['the time that a channel takes', 'channels', (s) => ((s['channels']![0]!['processingMs'] as number) += 1)],
    ['the consumers that a channel has', 'channels', (s) => (s['channels']![0]!['tags'] = [])],
    ['the channel of a consumer', 'tags', (s) => (s['tags']![0]!['channel'] = 'another')],
    ['the queue of a consumer', 'tags', (s) => (s['tags']![0]!['queue'] = 'another')],
    [
      'how a consumer acknowledges',
      'tags',
      (s) => (s['tags']![0]!['ack'] = s['tags']![0]!['ack'] === 'auto' ? 'manual' : 'auto'),
    ],
    ['where a producer sends to', 'producers', (s) => (s['producers']![0]!['target'] = null)],
    ['the key of a producer', 'producers', (s) => (s['producers']![0]!['key'] += 'x')],
    ['the payload of a producer', 'producers', (s) => (s['producers']![0]!['payload'] += 'x')],
    [
      'the headers of a producer',
      'producers',
      (s) => (s['producers']![0]!['headers'] = [{ key: 'h', value: { t: 'string', v: 'x' } }]),
    ],
    ['the burst of a producer', 'producers', (s) => ((s['producers']![0]!['burst'] as number) += 1)],
    ['the time between a producer’s sends', 'producers', (s) => ((s['producers']![0]!['everyMs'] as number) += 1)],
    [
      'whether a producer repeats',
      'producers',
      (s) => (s['producers']![0]!['repeat'] = !s['producers']![0]!['repeat']),
    ],
  ];

  it.each(CHANGES)('finds %s to be part of what a canvas is', (_what, list, damage) => {
    const document = several();
    const snapshot = structuredClone(snapshotAfter(document, 1_200)) as unknown as Record<
      string,
      Record<string, unknown>[]
    >;
    damage(snapshot);

    const answer = snapshotDisagrees(document, snapshot as unknown as EngineSnapshot);

    expect(answer).toBe(
      `Its messages are not those of this canvas: they were taken from a canvas whose ${list} was not the same`,
    );
  });
});

describe('for any canvas that commands can make', () => {
  it('reads the snapshot of a run of it as the snapshot that it is, and finds it to be of that canvas', () => {
    fc.assert(
      fc.property(arbDocument, fc.integer({ min: 0, max: 5_000 }), (document, until) => {
        const snapshot = snapshotAfter(document, until);

        const read = readSnapshot(viaJson(snapshot));

        // JSON writes -0 as 0, and a link is JSON.
        expect(read.ok && read.value).toEqual(viaJson(snapshot));
        expect(snapshotDisagrees(document, snapshot)).toBeNull();
      }),
    );
  });
});
