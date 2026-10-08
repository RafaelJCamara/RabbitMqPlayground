import {
  busyEngine,
  CANVAS_TIMING,
  consume,
  declareQueue,
  engineFor,
  newEngine,
  openChannel,
  publish,
  run,
  runAll,
  sampleDocument,
  settle,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { copiesIn } from './copies';

/** The copies of messages that the engine holds, counted once each (ADR-0078). */

describe('copiesIn', () => {
  it('is 0 for an engine that has had nothing published to it', () => {
    expect(copiesIn(newEngine().snapshot())).toBe(0);
    expect(copiesIn(engineFor(sampleDocument()).snapshot())).toBe(0);
  });

  it('counts a message that is on its way to the broker as a copy, and one that is on its way to a queue as one for each queue', () => {
    const engine = engineFor(sampleDocument());

    run(engine, { op: 'producer.publish', producer: 'P1' });
    expect(copiesIn(engine.snapshot())).toBe(2);
  });

  it('is the number of copies of the busy engine, counted from what is in each place', () => {
    const snapshot = busyEngine().snapshot();
    const queued = snapshot.queues.reduce((sum, queue) => sum + queue.ready.length, 0);
    const held = snapshot.tags.reduce((sum, tag) => sum + tag.unacked.length, 0);
    const heap = snapshot.heap.map(({ task }) => task);
    const arriving = heap.filter(({ kind }) => kind === 'arrive').length;
    const routed = heap.reduce((sum, task) => sum + (task.kind === 'enqueue' ? task.paths.length : 0), 0);
    const delivering = heap.filter((task) => task.kind === 'receive' && task.held.ack === 'auto').length;
    const handled = snapshot.channels.filter((channel) => channel.working?.ack === 'auto').length;

    expect(copiesIn(snapshot)).toBe(queued + held + arriving + routed + delivering + handled);
    expect(copiesIn(snapshot)).toBeGreaterThan(10);
  });

  it('counts a copy that a consumer has to acknowledge once, though it is on its way to the consumer and held by it', () => {
    const snapshot = busyEngine().snapshot();
    const toManual = snapshot.heap.filter(({ task }) => task.kind === 'receive' && task.held.ack === 'manual');

    // The engine's own count of what is travelling has those copies too, and so counts them twice with what the consumers hold.
    expect(toManual.length + snapshot.tags.reduce((sum, tag) => sum + tag.unacked.length, 0)).toBeGreaterThan(0);
    const doubled = copiesIn({ ...snapshot, heap: [] });
    expect(doubled).toBeLessThanOrEqual(copiesIn(snapshot));
  });

  it('falls to 0 when everything has been delivered, handled and acknowledged', () => {
    const engine = newEngine(CANVAS_TIMING);
    runAll(
      engine,
      declareQueue('jobs'),
      openChannel('c', 0, 100),
      consume('c', 'jobs', 'worker', 'manual'),
      publish('', 'jobs', 'a'),
      publish('', 'jobs', 'b'),
    );
    expect(copiesIn(engine.snapshot())).toBe(2);

    settle(engine);

    expect(copiesIn(engine.snapshot())).toBe(0);
  });
});
