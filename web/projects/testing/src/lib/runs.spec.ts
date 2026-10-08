import { describe, expect, it } from 'vitest';
import { documentOf, queueRecord, sampleDocument } from './documents';
import { documentHolds, engineHolds } from './held';
import { engineFor, snapshotAfter } from './runs';

/**
 * The runs that specs of what keeps an engine's state are written with. They are test code, so what they promise is small: the engine holds the document, and a run gives
 * a snapshot that has messages in it.
 */

describe('engineFor', () => {
  it('holds what the document says, and has no message yet', () => {
    const document = sampleDocument();

    const engine = engineFor(document);
    const snapshot = engine.snapshot();

    expect(engineHolds(engine)).toEqual(documentHolds(document));
    expect(snapshot.published).toBe(0);
    expect(snapshot.now).toBe(0);
  });

  it('has the seed, the latencies and the virtual host of the document', () => {
    const document = {
      ...sampleDocument(),
      vhost: '/shop',
      settings: { ...sampleDocument().settings, seed: 7, timing: { publishMs: 1, brokerMs: 2, deliverMs: 3 } },
    };

    const snapshot = engineFor(document).snapshot();

    expect(snapshot).toMatchObject({ seed: 7, timing: { publishMs: 1, brokerMs: 2, deliverMs: 3 }, vhost: '/shop' });
  });

  it('throws, saying what the engine refused, when the document is one that the engine cannot hold', () => {
    const broken = { ...documentOf({ queues: { q1: queueRecord('amq.bad') } }) };

    expect(() => engineFor(broken)).toThrow(/^The engine refused \{"op":"queue\.declare"/);
  });
});

describe('snapshotAfter', () => {
  it('has the producers publish once, and the clock run for as long as it is told', () => {
    const document = sampleDocument();

    expect(snapshotAfter(document, 0)).toMatchObject({ now: 0 });
    expect(snapshotAfter(document, 600).now).toBe(600);
    expect(snapshotAfter(document, 600).published).toBeGreaterThan(0);
  });

  it('has messages in the queues once they have arrived, and fewer once a consumer has taken them', () => {
    const document = sampleDocument();
    const inQueues = (until: number): number =>
      snapshotAfter(document, until).queues.reduce((sum, queue) => sum + queue.ready.length, 0);

    expect(inQueues(0)).toBe(0);
    expect(Math.max(...[300, 600, 900, 1_000, 1_400].map(inQueues))).toBeGreaterThan(0);
  });
});
