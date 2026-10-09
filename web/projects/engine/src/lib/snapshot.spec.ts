import { busyEngine, CANVAS_TIMING, consume, declareQueue, newEngine, openChannel, publish, run } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { Engine } from './engine';
import { createEngine } from './engine';
import { SNAPSHOT_VERSION, type EngineSnapshot } from './snapshot';

/**
 * A snapshot is the whole state, as data (ADR-0052). An engine that is restored from one does what the engine that it was taken from would have
 * done, which is what lets S10 share a canvas with its messages.
 */

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
    const snapshot = busyEngine().snapshot();

    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(SNAPSHOT_VERSION).toBe(1);
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('gives an engine the state that it was taken from: the same view, flights, clock and next event', () => {
    const original = busyEngine();
    const restored = createEngine({ seed: 1, timing: { publishMs: 0, brokerMs: 0, deliverMs: 0 } });

    restored.restore(original.snapshot());

    expect(restored.view()).toEqual(original.view());
    expect(restored.flights()).toEqual(original.flights());
    expect(restored.now()).toBe(original.now());
    expect(restored.nextAt()).toBe(original.nextAt());
    expect(restored.messages('jobs')).toEqual(original.messages('jobs'));
    expect(restored.snapshot()).toEqual(original.snapshot());
  });

  it('keeps what is not counted of what an earlier consumer of a tag held through JSON, leaves it out when there is none, and counts the window of the new consumer as the original did (ADR-0089)', () => {
    const original = newEngine();
    run(original, declareQueue('jobs'));
    run(original, openChannel('ch', 1, null));
    run(original, consume('ch', 'jobs', 'c1', 'manual'));
    const post = (engine: Engine, body: string) => run(engine, publish('', 'jobs', body));
    post(original, 'one');
    original.advanceTo(original.now() + 1000);
    expect(JSON.stringify(original.snapshot())).not.toContain('earlier');
    run(original, { op: 'basic.cancel', consumer: 'c1' });
    run(original, consume('ch', 'jobs', 'c1', 'manual'));

    const snapshot = JSON.parse(JSON.stringify(original.snapshot())) as EngineSnapshot;
    const restored = createEngine({ seed: 1, timing: { publishMs: 0, brokerMs: 0, deliverMs: 0 } });
    restored.restore(snapshot);

    expect(snapshot.tags[0]?.uncounted).toBe(1);
    expect(restored.snapshot()).toEqual(original.snapshot());
    for (const engine of [original, restored]) {
      post(engine, 'two');
      post(engine, 'three');
      engine.advanceTo(engine.now() + 1000);
    }
    expect(restored.view()).toEqual(original.view());
    expect(original.view().queues['jobs']).toMatchObject({ ready: 1, unacked: 2 });
  });

  it('gives an engine that does what the first would have done: the same events for the same commands and the same time', () => {
    const original = busyEngine();
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
    const engine = busyEngine();
    const snapshot = engine.snapshot();
    const before = JSON.stringify(snapshot);

    drive(engine);
    const other = newEngine();
    other.restore(snapshot);
    drive(other);

    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it('can be restored twice, into engines that do not share anything', () => {
    const snapshot = busyEngine().snapshot();
    const first = newEngine();
    const second = newEngine();
    first.restore(snapshot);
    second.restore(snapshot);

    drive(first);

    expect(second.snapshot()).toEqual(snapshot);
    expect(drive(second)).toBe(drive(newEngineFrom(snapshot)));
  });

  it('replaces everything that the engine had, topology, channels and producers included', () => {
    const engine = busyEngine();
    const empty = newEngine().snapshot();

    engine.restore(empty);

    expect(engine.view()).toEqual(newEngine().view());
    expect(engine.flights()).toEqual([]);
    expect(engine.nextAt()).toBeNull();
  });

  it('gives back the numbers that it was at, so that the events and the messages go on from there', () => {
    const original = busyEngine();
    const lastEvent = original.advanceTo(original.now() + 10).at(-1)?.seq ?? 0;
    const restored = newEngine();

    restored.restore(original.snapshot());
    const next = run(restored, { op: 'producer.publish', producer: 'p3' })[0];

    expect(next?.seq).toBeGreaterThan(lastEvent);
    expect(next).toMatchObject({ type: 'published', message: { id: original.view().published + 1 } });
  });

  it('refuses a version that it cannot read, and says which', () => {
    const snapshot = busyEngine().snapshot();

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
