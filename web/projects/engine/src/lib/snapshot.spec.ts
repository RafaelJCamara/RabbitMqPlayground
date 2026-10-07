import {
  bindQueue,
  CANVAS_TIMING,
  consume,
  declareExchange,
  declareQueue,
  newEngine,
  openChannel,
  producer,
  run,
  runAll,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { Engine } from './engine';
import { createEngine } from './engine';
import { SNAPSHOT_VERSION, type EngineSnapshot } from './snapshot';

/**
 * A snapshot is the whole state, as data (ADR-0052). An engine that is restored from one does what the engine that it was taken from would have
 * done, which is what lets S10 share a canvas with its messages.
 */

/** An engine that is busy everywhere: messages on their way, in queues, held, waiting and handled, producers that repeat, and a channel gone. */
function busy(): Engine {
  const engine = newEngine(CANVAS_TIMING, 7);
  runAll(
    engine,
    declareExchange('e', 'topic'),
    declareExchange('f', 'fanout', { durable: false }),
    declareQueue('jobs'),
    declareQueue('logs'),
    bindQueue('e', 'jobs', 'job.#'),
    { op: 'bind', source: 'e', destination: { kind: 'exchange', name: 'f' }, key: '#' },
    bindQueue('f', 'logs'),
    bindQueue('f', 'jobs', '', undefined),
    openChannel('slow', 1, 400),
    consume('slow', 'jobs', 'c-slow', 'manual'),
    openChannel('fast', 0, 100),
    consume('fast', 'logs', 'c-fast', 'auto'),
    openChannel('scripted', 2, null),
    consume('scripted', 'jobs', 'c-held', 'manual'),
    openChannel('gone', 1, null),
    consume('gone', 'logs', 'c-gone', 'manual'),
    producer('p1', {
      target: { kind: 'exchange', name: 'e' },
      key: 'job.new',
      payload: 'work',
      burst: 3,
      everyMs: 700,
      repeat: true,
    }),
    producer('p2', { target: { kind: 'queue', name: 'logs' }, payload: 'line', everyMs: 300, repeat: true }),
    producer('p3', { target: { kind: 'exchange', name: 'f' }, headers: [{ key: 'n', value: { t: 'integer', v: 1 } }] }),
  );
  engine.advanceTo(1900);
  run(engine, { op: 'producer.publish', producer: 'p3' });
  run(engine, { op: 'channel.close', channel: 'gone' });
  engine.advanceTo(2300);
  run(engine, { op: 'basic.cancel', consumer: 'c-slow' });
  return engine;
}

/** The same things done to two engines, which they should answer in the same way. */
function drive(engine: Engine): string {
  const said: unknown[] = [];
  said.push(engine.advanceTo(engine.now() + 450));
  said.push(run(engine, { op: 'producer.publish', producer: 'p3' }));
  said.push(run(engine, { op: 'basic.ack', consumer: 'c-held' }));
  said.push(engine.step());
  said.push(run(engine, { op: 'channel.set', channel: 'slow', prefetch: 3 }));
  said.push(engine.advanceTo(engine.now() + 3000));
  said.push(run(engine, { op: 'channel.close', channel: 'scripted' }));
  said.push(run(engine, { op: 'sim.clearMessages' }));
  said.push(engine.advanceTo(engine.now() + 2000));
  return JSON.stringify([said, engine.view(), engine.flights(), engine.nextAt()]);
}

describe('snapshot and restore', () => {
  it('is plain data that survives JSON, and says its version', () => {
    const snapshot = busy().snapshot();

    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(SNAPSHOT_VERSION).toBe(1);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('gives an engine the state that it was taken from: the same view, flights, clock and next event', () => {
    const original = busy();
    const restored = createEngine({ seed: 1, timing: { publishMs: 0, brokerMs: 0, deliverMs: 0 } });

    restored.restore(original.snapshot());

    expect(restored.view()).toEqual(original.view());
    expect(restored.flights()).toEqual(original.flights());
    expect(restored.now()).toBe(original.now());
    expect(restored.nextAt()).toBe(original.nextAt());
    expect(restored.messages('jobs')).toEqual(original.messages('jobs'));
    expect(restored.snapshot()).toEqual(original.snapshot());
  });

  it('gives an engine that does what the first would have done: the same events for the same commands and the same time', () => {
    const original = busy();
    const restored = newEngine();
    restored.restore(JSON.parse(JSON.stringify(original.snapshot())) as EngineSnapshot);

    expect(drive(restored)).toBe(drive(original));
  });

  it('keeps the stream of the generator when the seed is set again to what it was, and starts another when it is another', () => {
    const engine = newEngine();
    engine.restore({ ...engine.snapshot(), prng: 12_345 });
    const { seed, timing } = engine.view();

    run(engine, { op: 'sim.configure', seed, timing });
    expect(engine.snapshot().prng).toBe(12_345);

    run(engine, { op: 'sim.configure', seed: seed + 1, timing });
    expect([engine.snapshot().prng, engine.view().seed]).toEqual([seed + 1, seed + 1]);
  });

  it('is not changed by what the engine does afterwards, and does not change what it was restored into', () => {
    const engine = busy();
    const snapshot = engine.snapshot();
    const before = JSON.stringify(snapshot);

    drive(engine);
    const other = newEngine();
    other.restore(snapshot);
    drive(other);

    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('can be restored twice, into engines that do not share anything', () => {
    const snapshot = busy().snapshot();
    const first = newEngine();
    const second = newEngine();
    first.restore(snapshot);
    second.restore(snapshot);

    drive(first);

    expect(second.snapshot()).toEqual(snapshot);
    expect(drive(second)).toBe(drive(newEngineFrom(snapshot)));
  });

  it('replaces everything that the engine had, topology, channels and producers included', () => {
    const engine = busy();
    const empty = newEngine().snapshot();

    engine.restore(empty);

    expect(engine.view()).toEqual(newEngine().view());
    expect(engine.flights()).toEqual([]);
    expect(engine.nextAt()).toBeNull();
  });

  it('gives back the numbers that it was at, so that the events and the messages go on from there', () => {
    const original = busy();
    const lastEvent = original.advanceTo(original.now() + 10).at(-1)?.seq ?? 0;
    const restored = newEngine();

    restored.restore(original.snapshot());
    const next = run(restored, { op: 'producer.publish', producer: 'p3' })[0];

    expect(next?.seq).toBeGreaterThan(lastEvent);
    expect(next).toMatchObject({ type: 'published', message: { id: original.view().published + 1 } });
  });

  it('refuses a version that it cannot read, and says which', () => {
    const snapshot = busy().snapshot();

    expect(() => newEngine().restore({ ...snapshot, version: 2 } as unknown as EngineSnapshot)).toThrow(RangeError);
    expect(() => newEngine().restore({ ...snapshot, version: 2 } as unknown as EngineSnapshot)).toThrow(
      'This engine reads snapshots of version 1, and this one is version 2',
    );
    expect(() => newEngine().restore({} as EngineSnapshot)).toThrow('version undefined');
  });

  it('keeps the seed and what the PRNG has come to, so that a draw that a later slice makes is the same', () => {
    const original = newEngine(CANVAS_TIMING, 99);
    run(original, { op: 'sim.configure', seed: 12345, timing: CANVAS_TIMING });
    const restored = newEngine();

    restored.restore(original.snapshot());

    expect(restored.view().seed).toBe(12345);
    expect(restored.snapshot().prng).toBe(original.snapshot().prng);
  });
});

function newEngineFrom(snapshot: EngineSnapshot): Engine {
  const engine = newEngine();
  engine.restore(snapshot);
  return engine;
}
