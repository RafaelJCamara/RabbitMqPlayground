import {
  bindQueue,
  CANVAS_TIMING,
  consume,
  declareExchange,
  declareQueue,
  newEngine,
  only,
  openChannel,
  producer,
  run,
  runAll,
  settle,
  types,
  ZERO_TIMING,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { EngineEvent } from './events';

/**
 * Producers: what one sends and where, a burst, and one that repeats (ADR-0052). A producer that repeats is a task on the heap, so these
 * advance the clock by hand and never settle.
 */

/** An exchange `e` that is bound to a queue `q` by every key, and nothing else. */
function rig(timing = ZERO_TIMING) {
  const engine = newEngine(timing);
  runAll(engine, declareExchange('e', 'topic'), declareQueue('q'), bindQueue('e', 'q', '#'));
  return engine;
}

const toExchange = { kind: 'exchange', name: 'e' } as const;
const publishes = (events: readonly EngineEvent[]): number[] => only(events, 'published').map(({ at }) => at);

describe('a producer that sends once', () => {
  it('sends its message to its exchange with its key, headers and payload, and tells the message who sent it', () => {
    const engine = rig();
    const headers = [{ key: 'format', value: { t: 'string' as const, v: 'pdf' } }];
    run(engine, producer('p', { target: toExchange, key: 'order.created', payload: 'hello', headers }));

    const [published] = only(run(engine, { op: 'producer.publish', producer: 'p' }), 'published');

    expect(published?.message).toEqual({
      id: 1,
      producer: 'p',
      exchange: 'e',
      key: 'order.created',
      headers,
      payload: 'hello',
    });
  });

  it('sends a queue what it is linked to through the default exchange, with the name of the queue as the key', () => {
    const engine = rig();
    run(engine, producer('p', { target: { kind: 'queue', name: 'q' }, key: 'ignored' }));

    const [published] = only(run(engine, { op: 'producer.publish', producer: 'p' }), 'published');
    settle(engine);

    expect(published?.message).toMatchObject({ exchange: '', key: 'q' });
    expect(engine.view().queues['q']?.ready).toBe(1);
  });

  it('sends a burst: as many messages as it says, together, numbered one after the other', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, burst: 4 }));

    const events = run(engine, { op: 'producer.publish', producer: 'p' });

    expect(only(events, 'published').map(({ message, at }) => [message.id, at])).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
    ]);
    expect(engine.view().producers['p']?.published).toBe(4);
    expect(engine.view().published).toBe(4);
  });

  it('sends nothing, and says nothing, when it has nowhere to send to', () => {
    const engine = rig();
    run(engine, producer('p'));

    expect(run(engine, { op: 'producer.publish', producer: 'p' })).toEqual([]);
    expect(engine.view().published).toBe(0);
  });

  it('takes publishMs to reach the broker, which a message that no producer sent does not', () => {
    const engine = rig(CANVAS_TIMING);
    run(engine, producer('p', { target: toExchange }));

    const [published] = only(run(engine, { op: 'producer.publish', producer: 'p' }), 'published');

    expect(published?.arrivesAt).toBe(500);
  });

  it('throws for a producer that is not there', () => {
    expect(() => rig().dispatch({ op: 'producer.publish', producer: 'nobody' })).toThrow(RangeError);
  });

  it('throws for a message that no client could send, and for a burst or an interval that is not a whole number of at least 1', () => {
    const engine = rig();

    expect(() => engine.dispatch(producer('p', { key: 'k'.repeat(256) }))).toThrow(RangeError);
    expect(() =>
      engine.dispatch(producer('p', { headers: [{ key: 'n', value: { t: 'integer', v: 2 ** 53 } }] })),
    ).toThrow(/Header "n"/);
    expect(() => engine.dispatch(producer('p', { burst: 0 }))).toThrow(RangeError);
    expect(() => engine.dispatch(producer('p', { burst: 1.5 }))).toThrow(RangeError);
    expect(() => engine.dispatch(producer('p', { everyMs: 0 }))).toThrow(RangeError);
    expect(engine.view().producers['p']).toBeUndefined();
  });
});

describe('a producer that repeats', () => {
  it('sends at once and then every interval, for as long as the clock runs', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));

    expect(engine.view().producers['p']).toEqual({ published: 0, repeating: true, nextAt: 0 });
    const events = engine.advanceTo(350);

    expect(publishes(events)).toEqual([0, 100, 200, 300]);
    expect(engine.view().producers['p']).toEqual({ published: 4, repeating: true, nextAt: 400 });
  });

  it('sends a burst each time', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true, burst: 3 }));

    expect(publishes(engine.advanceTo(100))).toEqual([0, 0, 0, 100, 100, 100]);
  });

  it('stops when it is told not to repeat, or has nowhere to send to, and starts again at once when it is told to', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));
    engine.advanceTo(150);

    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: false }));
    expect(engine.view().producers['p']).toMatchObject({ repeating: false, nextAt: null });
    expect(publishes(engine.advanceTo(500))).toEqual([]);

    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));
    expect(engine.nextAt()).toBe(500);
    run(engine, producer('p', { target: null, everyMs: 100, repeat: true }));
    expect(engine.view().producers['p']?.repeating).toBe(false);
    expect(publishes(engine.advanceTo(900))).toEqual([]);
  });

  it('keeps its next time when its message or its burst changes, and does not send again for it', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));
    engine.advanceTo(130);

    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true, payload: 'new', burst: 2 }));

    expect(engine.view().producers['p']?.nextAt).toBe(200);
    const events = engine.advanceTo(200);
    expect(only(events, 'published').map(({ message }) => message.payload)).toEqual(['new', 'new']);
  });

  it('moves its next time to one interval after the last when the interval changes, and never into the past', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, everyMs: 1000, repeat: true }));
    engine.advanceTo(300);

    run(engine, producer('p', { target: toExchange, everyMs: 500, repeat: true }));
    expect(engine.view().producers['p']?.nextAt).toBe(500);

    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));
    expect(engine.view().producers['p']?.nextAt).toBe(300);
    expect(publishes(engine.advanceTo(399))).toEqual([300]);
  });

  it('does not change when it sends because of a message that it sends by hand', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));
    engine.advanceTo(0);

    run(engine, { op: 'producer.publish', producer: 'p' });

    expect(engine.view().producers['p']?.nextAt).toBe(100);
  });

  it('is gone with its ticks when it is removed, and what it sent is still on its way', () => {
    const engine = rig(CANVAS_TIMING);
    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));
    engine.advanceTo(0);

    run(engine, { op: 'producer.remove', producer: 'p' });

    expect(engine.view().producers['p']).toBeUndefined();
    expect(types(engine.advanceTo(10_000))).toEqual(['routed', 'enqueued']);
    expect(run(engine, { op: 'producer.remove', producer: 'p' })).toEqual([]);
  });

  it('sends to the exchange that it is told to by name: one that is deleted refuses what it sends, and one that is declared again takes it', () => {
    const engine = rig();
    run(engine, producer('p', { target: toExchange, everyMs: 100, repeat: true }));
    engine.advanceTo(0);
    runAll(engine, { op: 'exchange.delete', name: 'e' });

    expect(types(engine.advanceTo(100).filter(({ type }) => type !== 'published'))).toEqual(['refused']);
    runAll(engine, declareExchange('e', 'topic'), declareQueue('q2'), bindQueue('e', 'q2', '#'));
    expect(types(engine.advanceTo(200))).toContain('enqueued');
  });
});

describe('what a producer’s messages meet', () => {
  it('reach a consumer, with the legs that the timing says, one after the other', () => {
    const engine = rig(CANVAS_TIMING);
    runAll(engine, openChannel('ch'), consume('ch', 'q', 'c1'));
    run(engine, producer('p', { target: toExchange, key: 'k' }));
    run(engine, { op: 'producer.publish', producer: 'p' });

    const events = settle(engine).map(({ type, at }) => `${type}@${at}`);

    expect(events).toEqual(['routed@500', 'enqueued@800', 'delivered@800', 'received@1300']);
  });
});
