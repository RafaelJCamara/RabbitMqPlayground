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
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { Engine } from './engine';
import type { EngineEvent } from './events';

/**
 * The two bugs of the original simulator that this one is a regression test for (ADR-0002, ADR-0007), as they would have happened on a canvas:
 * a producer, an exchange, a queue and two consumers, with the latencies of a new canvas, so that messages are on their way when things happen.
 * The fixtures replay the same two cases against the broker (`delivery/issue-10-…` and `delivery/issue-18-…`).
 */

/** `p` sends to `orders`, which is bound to `jobs`, which `c1` and `c2` consume from, each on a channel of its own. */
function canvas(ack: 'auto' | 'manual' = 'auto', prefetch = 0): Engine {
  const engine = newEngine(CANVAS_TIMING);
  runAll(
    engine,
    declareExchange('orders', 'direct'),
    declareQueue('jobs'),
    bindQueue('orders', 'jobs', 'job'),
    producer('p', { target: { kind: 'exchange', name: 'orders' }, key: 'job', payload: 'work' }),
    openChannel('c1', prefetch, 200),
    openChannel('c2', prefetch, 200),
    consume('c1', 'jobs', 'tag-c1', ack),
    consume('c2', 'jobs', 'tag-c2', ack),
  );
  return engine;
}

const sendOne = (engine: Engine): EngineEvent[] => run(engine, { op: 'producer.publish', producer: 'p' });

describe('issue #10: the first message went to both consumers', () => {
  it.each(['auto', 'manual'] as const)(
    'gives the first message to one consumer, and to the other none, when they acknowledge %s',
    (ack) => {
      const engine = canvas(ack);
      const events = [...sendOne(engine), ...settle(engine)];

      const delivered = only(events, 'delivered');

      expect(delivered).toHaveLength(1);
      expect(delivered[0]).toMatchObject({ message: 1, consumer: 'tag-c1' });
      expect(only(events, 'received')).toHaveLength(1);
      expect(engine.view().channels['c2']).toMatchObject({ received: 0, consumed: 0 });
      expect(engine.view().queues['jobs']?.delivered).toBe(1);
    },
  );

  it('gives each message of a burst to one consumer, in turn, so that the two together were given as many as were sent', () => {
    const engine = canvas('auto');
    run(engine, {
      op: 'producer.set',
      producer: 'p',
      target: { kind: 'exchange', name: 'orders' },
      key: 'job',
      payload: 'work',
      headers: [],
      burst: 5,
      everyMs: 1000,
      repeat: false,
    });
    const events = [...sendOne(engine), ...settle(engine)];

    const given = only(events, 'delivered').map(({ message, consumer }) => `${message}:${consumer}`);

    expect(given).toEqual(['1:tag-c1', '2:tag-c2', '3:tag-c1', '4:tag-c2', '5:tag-c1']);
    expect(new Set(given.map((entry) => entry.split(':')[0])).size).toBe(5);
  });

  it('gives a message that arrives while the second consumer is still joining to one of them only', () => {
    const engine = newEngine(CANVAS_TIMING);
    runAll(
      engine,
      declareExchange('orders', 'direct'),
      declareQueue('jobs'),
      bindQueue('orders', 'jobs', 'job'),
      producer('p', { target: { kind: 'exchange', name: 'orders' }, key: 'job' }),
      openChannel('c1'),
      consume('c1', 'jobs', 'tag-c1', 'auto'),
    );
    sendOne(engine);
    engine.advanceTo(799);

    runAll(engine, openChannel('c2'), consume('c2', 'jobs', 'tag-c2', 'auto'));
    const events = settle(engine);

    expect(only(events, 'delivered')).toHaveLength(1);
  });
});

describe('issue #18: messages kept going to a consumer that had been deleted', () => {
  it('gives a consumer that was deleted nothing more, and the messages that follow go to the one that is left', () => {
    const engine = canvas('manual', 1);
    sendOne(engine);
    engine.advanceTo(800);
    run(engine, { op: 'channel.close', channel: 'c1' });

    const events = [...sendOne(engine), ...sendOne(engine), ...settle(engine)];

    expect(only(events, 'delivered').map(({ consumer }) => consumer)).not.toContain('tag-c1');
    expect(only(events, 'received').map(({ channel }) => channel)).not.toContain('c1');
    expect(engine.view().channels['c1']).toBeUndefined();
  });

  it('calls back what was on its way to the deleted consumer, and gives it to the other one as redelivered', () => {
    const engine = canvas('manual', 1);
    sendOne(engine);
    engine.advanceTo(800);
    expect(engine.flights()).toMatchObject([{ leg: 'deliver', consumer: 'tag-c1' }]);

    const closed = run(engine, { op: 'channel.close', channel: 'c1' });
    const events = settle(engine);

    expect(closed.map(({ type }) => type)).toEqual(['channel.closed', 'requeued', 'delivered']);
    expect(only(closed, 'delivered')[0]).toMatchObject({ message: 1, consumer: 'tag-c2', redelivered: true });
    expect(only(events, 'received').map(({ message, channel }) => `${message}:${channel}`)).toEqual(['1:c2']);
  });

  it('keeps a message that had been given to it, and not yet acknowledged, in the queue until another consumer takes it, as redelivered', () => {
    const engine = canvas('manual', 1);
    sendOne(engine);
    engine.advanceTo(1400);
    expect(engine.messages('jobs')).toMatchObject([{ id: 1, heldBy: { channel: 'c1' } }]);
    run(engine, { op: 'channel.close', channel: 'c2' });

    const events = run(engine, { op: 'channel.close', channel: 'c1' });

    expect(events.map(({ type }) => type)).toEqual(['channel.closed', 'requeued']);
    expect(engine.messages('jobs')).toEqual([{ id: 1, key: 'job', payload: 'work', redelivered: true, heldBy: null }]);
  });
});
