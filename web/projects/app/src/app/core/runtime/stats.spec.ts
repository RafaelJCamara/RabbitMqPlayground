import { reconcile, type CanvasDocument } from '@rmq/domain';
import { createEngine, type Engine } from '@rmq/engine';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  runAll,
  sampleDocument,
  ZERO_TIMING,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { DEFAULT_EXCHANGE_ID } from '../state/default-exchange';
import { sameStats, statsOf, type NodeStats } from './stats';

/** The document with every leg taking no time, so that what is sent has arrived when the clock is moved by nothing. */
const instant = (document: CanvasDocument): CanvasDocument => ({
  ...document,
  settings: { ...document.settings, timing: ZERO_TIMING },
});

/** An engine that holds what the document says. */
function engineFor(document: CanvasDocument): Engine {
  const engine = createEngine({ seed: 1, timing: ZERO_TIMING, vhost: document.vhost });
  runAll(engine, ...reconcile(null, document));
  return engine;
}

/** A producer `P` that sends to a fanout exchange `E`, which has two queues, `Q` and `R`, and a consumer `C` of `Q` that acknowledges for itself. */
const fanout = (consumer = consumerRecord('worker', ['Q'], { processingMs: 100 })): CanvasDocument =>
  instant(
    documentOf({
      exchanges: { E: exchangeRecord('x', 'fanout') },
      queues: { Q: queueRecord('q'), R: queueRecord('r') },
      bindings: {
        B1: bindingRecord('E', { kind: 'queue', id: 'Q' }),
        B2: bindingRecord('E', { kind: 'queue', id: 'R' }),
      },
      producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }, { burst: 3 }) },
      consumers: { C: consumer },
    }),
  );

describe('statsOf', () => {
  it('says nothing for a canvas with nothing on it but the default exchange, which every broker has', () => {
    const document = documentOf();

    expect([...statsOf(document, engineFor(document).view())]).toEqual([
      [DEFAULT_EXCHANGE_ID, { kind: 'exchange', routed: 0, unroutable: 0, refused: 0 }],
    ]);
  });

  it('has a set of numbers for each node of the canvas, by its id, and for the default exchange', () => {
    const document = sampleDocument();

    const stats = statsOf(document, engineFor(document).view());

    expect([...stats.keys()].sort()).toEqual(['C1', 'E1', 'E2', 'E3', DEFAULT_EXCHANGE_ID, 'P1', 'Q1', 'Q2'].sort());
    expect(stats.get('P1')).toEqual({ kind: 'producer', sent: 0, repeating: true });
    expect(stats.get('E1')).toEqual({ kind: 'exchange', routed: 0, unroutable: 0, refused: 0 });
    expect(stats.get('Q1')).toEqual({ kind: 'queue', ready: 0, unacked: 0, consumers: 1 });
    expect(stats.get('Q2')).toEqual({ kind: 'queue', ready: 0, unacked: 0, consumers: 0 });
    expect(stats.get('C1')).toEqual({
      kind: 'consumer',
      holds: 0,
      limit: 3,
      acksItself: false,
      finished: 0,
      waiting: 0,
      working: false,
    });
  });

  it('counts what a producer has sent, what an exchange routed and found no queue for, and what a queue holds', () => {
    const document = fanout(consumerRecord('worker'));
    const engine = engineFor(document);
    runAll(
      engine,
      { op: 'producer.publish', producer: 'P' },
      { op: 'basic.publish', exchange: 'x' },
      { op: 'basic.publish', exchange: 'nowhere' },
    );
    engine.advanceTo(10);

    const stats = statsOf(document, engine.view());

    expect(stats.get('P')).toEqual({ kind: 'producer', sent: 3, repeating: false });
    // The exchange that is not there refuses, and the default exchange is what a message to it is told to.
    expect(stats.get('E')).toEqual({ kind: 'exchange', routed: 4, unroutable: 0, refused: 0 });
    expect(stats.get('R')).toEqual({ kind: 'queue', ready: 4, unacked: 0, consumers: 0 });
  });

  it('counts a message that no queue got, and one that the broker refused, for the exchange that it was sent to', () => {
    const document = instant(
      documentOf({ exchanges: { E: exchangeRecord('x'), H: exchangeRecord('h', 'fanout', { internal: true }) } }),
    );
    const engine = engineFor(document);
    runAll(engine, { op: 'basic.publish', exchange: 'x', key: 'k' }, { op: 'basic.publish', exchange: 'h' });
    engine.advanceTo(10);

    const stats = statsOf(document, engine.view());

    expect(stats.get('E')).toEqual({ kind: 'exchange', routed: 0, unroutable: 1, refused: 0 });
    expect(stats.get('H')).toEqual({ kind: 'exchange', routed: 0, unroutable: 0, refused: 1 });
  });

  it('has a consumer hold what it has not acknowledged, of what it may hold, and count what it has finished with and what waits for it', () => {
    const document = fanout(consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 2, processingMs: 1_000 }));
    const engine = engineFor(document);
    runAll(
      engine,
      { op: 'basic.publish', exchange: 'x' },
      { op: 'basic.publish', exchange: 'x' },
      { op: 'basic.publish', exchange: 'x' },
    );
    engine.advanceTo(0);

    expect(statsOf(document, engine.view()).get('C')).toEqual({
      kind: 'consumer',
      holds: 2,
      limit: 2,
      acksItself: false,
      finished: 0,
      waiting: 1,
      working: true,
    });

    engine.advanceTo(1_000);

    expect(statsOf(document, engine.view()).get('C')).toMatchObject({ holds: 2, finished: 1, waiting: 1 });
  });

  it('says that a consumer that acknowledges for itself has no limit that matters, and that one without a prefetch has none', () => {
    const auto = fanout(consumerRecord('worker', ['Q'], { ack: 'auto', prefetch: 5 }));
    const unlimited = fanout(consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 0 }));

    expect(statsOf(auto, engineFor(auto).view()).get('C')).toMatchObject({ acksItself: true, limit: 5 });
    expect(statsOf(unlimited, engineFor(unlimited).view()).get('C')).toMatchObject({ acksItself: false, limit: 0 });
  });

  it('may hold its prefetch for each queue that it consumes from, and a consumer that is subscribed to nothing may hold the prefetch once', () => {
    const two = fanout(consumerRecord('worker', ['Q', 'R'], { ack: 'manual', prefetch: 3 }));
    const none = fanout(consumerRecord('worker', [], { ack: 'auto', prefetch: 3 }));

    expect(statsOf(two, engineFor(two).view()).get('C')).toMatchObject({ limit: 6, acksItself: false });
    expect(statsOf(none, engineFor(none).view()).get('C')).toMatchObject({ limit: 3, acksItself: false });
  });

  it('counts a consumer that was cancelled for what it still holds and not for what it may hold', () => {
    const document = fanout(consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 2, processingMs: 1_000 }));
    const engine = engineFor(document);
    runAll(engine, { op: 'basic.publish', exchange: 'x' });
    engine.advanceTo(0);
    runAll(engine, { op: 'basic.cancel', consumer: 'C/q' });

    expect(statsOf(document, engine.view()).get('C')).toMatchObject({ holds: 1, limit: 2, acksItself: false });
    expect(statsOf(document, engine.view()).get('Q')).toMatchObject({ unacked: 1, consumers: 0 });
  });

  it('leaves out a node that the engine does not hold yet, which is a document that it has not been told of', () => {
    const document = fanout();
    const engine = createEngine({ seed: 1, timing: ZERO_TIMING, vhost: '/' });

    expect([...statsOf(document, engine.view()).keys()]).toEqual([DEFAULT_EXCHANGE_ID]);
  });

  it('counts a queue that is named like what every object has as a queue, and one that is not there as none', () => {
    const document = instant(
      documentOf({
        queues: { Q: queueRecord('constructor'), R: queueRecord('__proto__') },
        consumers: { C: consumerRecord('toString', ['Q']) },
      }),
    );
    const engine = engineFor(document);
    runAll(engine, { op: 'basic.publish', exchange: '', key: 'constructor' });
    engine.advanceTo(0);

    const stats = statsOf(document, engine.view());

    expect(stats.get('Q')).toMatchObject({ kind: 'queue', consumers: 1 });
    expect(stats.get('R')).toMatchObject({ kind: 'queue', ready: 0 });
    expect(statsOf(document, createEngine({ seed: 1, timing: ZERO_TIMING, vhost: '/' }).view()).has('Q')).toBe(false);
  });
});

describe('sameStats', () => {
  const queue: NodeStats = { kind: 'queue', ready: 1, unacked: 2, consumers: 3 };

  it('is true for the same numbers, whether they are one object or two', () => {
    expect(sameStats(queue, queue)).toBe(true);
    expect(sameStats(queue, { ...queue })).toBe(true);
    expect(sameStats(null, null)).toBe(true);
  });

  it('is false when any number differs, or when the kind of node does, or when one has none', () => {
    expect(sameStats(queue, { ...queue, ready: 0 })).toBe(false);
    expect(sameStats(queue, { ...queue, unacked: 0 })).toBe(false);
    expect(sameStats(queue, { ...queue, consumers: 0 })).toBe(false);
    expect(sameStats(queue, { kind: 'exchange', routed: 1, unroutable: 2, refused: 3 })).toBe(false);
    expect(sameStats(queue, null)).toBe(false);
    expect(sameStats(null, queue)).toBe(false);
  });

  it('tells apart two sets that have the same numbers in other places, and false from 0', () => {
    expect(
      sameStats({ kind: 'producer', sent: 0, repeating: false }, { kind: 'producer', sent: 0, repeating: true }),
    ).toBe(false);
    expect(
      sameStats(
        { kind: 'exchange', routed: 1, unroutable: 0, refused: 0 },
        { kind: 'exchange', routed: 0, unroutable: 1, refused: 0 },
      ),
    ).toBe(false);
  });
});
