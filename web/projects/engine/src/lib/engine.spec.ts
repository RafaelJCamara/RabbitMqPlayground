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
  publish,
  run,
  runAll,
  settle,
  types,
  ZERO_TIMING,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { createEngine } from './engine';

/**
 * The clock and the road of a message (ADR-0052): what a command does at once, what is scheduled, what a step is, and what each leg takes. The
 * rules of delivery are in `delivery.spec.ts`, and what the broker refuses in `refusals.spec.ts`.
 */

/** A direct exchange `e`, bound to a queue `q` by the key `k`, and a producer `p` that sends the message `hello` to `e` with that key. */
function orders(timing = CANVAS_TIMING) {
  const engine = newEngine(timing);
  runAll(
    engine,
    declareExchange('e'),
    declareQueue('q'),
    bindQueue('e', 'q', 'k'),
    producer('p', { target: { kind: 'exchange', name: 'e' }, key: 'k', payload: 'hello' }),
  );
  return engine;
}

/** The producer sends its message now. */
const send = (engine: ReturnType<typeof newEngine>) => run(engine, { op: 'producer.publish', producer: 'p' });

describe('the clock', () => {
  it('starts at 0 with nothing scheduled', () => {
    const engine = newEngine();

    expect(engine.now()).toBe(0);
    expect(engine.nextAt()).toBeNull();
    expect(engine.advanceTo(100)).toEqual([]);
    expect(engine.now()).toBe(100);
  });

  it('floors the time that it is asked to go to, and never goes back', () => {
    const engine = newEngine();

    engine.advanceTo(10.9);
    expect(engine.now()).toBe(10);
    engine.advanceTo(3);
    expect(engine.now()).toBe(10);
  });

  it('runs what is scheduled for the time asked and before it, in order, and no more', () => {
    const engine = orders();
    send(engine);

    expect(engine.nextAt()).toBe(500);
    expect(types(engine.advanceTo(499))).toEqual([]);
    expect(engine.now()).toBe(499);
    expect(engine.nextAt()).toBe(500);
    expect(types(engine.advanceTo(500))).toEqual(['routed']);
    expect(engine.nextAt()).toBe(800);
  });

  it('puts the time of an event at the time that it happened, and not at the time that it was asked for', () => {
    const engine = orders();
    send(engine);

    const events = engine.advanceTo(10_000);

    expect(events.map(({ at }) => at)).toEqual([500, 800]);
    expect(engine.now()).toBe(10_000);
  });

  it('numbers the events from 1 over its whole life, with no gap and no repeat', () => {
    const engine = orders();
    const first = send(engine);
    const second = settle(engine);
    const third = send(engine);

    expect([...first, ...second, ...third].map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
  });

  describe('step', () => {
    it('runs the one thing that is next and moves the clock to it, so that a step is always an event', () => {
      const engine = orders();
      send(engine);

      expect(types(engine.step())).toEqual(['routed']);
      expect(engine.now()).toBe(500);
      expect(types(engine.step())).toEqual(['enqueued']);
      expect(engine.now()).toBe(800);
    });

    it('does nothing when nothing is scheduled, and leaves the clock where it is', () => {
      const engine = newEngine();
      engine.advanceTo(40);

      expect(engine.step()).toEqual([]);
      expect(engine.now()).toBe(40);
    });

    it('runs things that are scheduled for the same time one at a time, in the order that they were scheduled', () => {
      const engine = orders(ZERO_TIMING);
      run(engine, publish('e', 'k', 'm1'));
      run(engine, publish('e', 'k', 'm2'));

      expect(only(engine.step(), 'routed').map(({ message }) => message)).toEqual([1]);
      expect(only(engine.step(), 'routed').map(({ message }) => message)).toEqual([2]);
    });
  });
});

describe('a message on its way', () => {
  it('is said to be published, then routed when it reaches the broker, then enqueued when it reaches the queue', () => {
    const engine = orders();

    const published = send(engine);
    const arrived = engine.advanceTo(500);
    const queued = engine.advanceTo(800);

    expect(published).toEqual([
      {
        type: 'published',
        seq: 1,
        at: 0,
        message: { id: 1, producer: 'p', exchange: 'e', key: 'k', headers: [], payload: 'hello' },
        arrivesAt: 500,
      },
    ]);
    expect(arrived).toMatchObject([
      { type: 'routed', seq: 2, at: 500, message: 1, exchange: 'e', queues: ['q'], enqueueAt: 800 },
    ]);
    expect(queued).toEqual([{ type: 'enqueued', seq: 3, at: 800, message: 1, queue: 'q', depth: 1 }]);
  });

  it('is already at the broker when no producer sent it, and takes the time of the broker to reach the queue', () => {
    const engine = orders();

    run(engine, publish('e', 'k', 'm1'));

    expect(types(engine.advanceTo(0))).toEqual(['routed']);
    expect(engine.view().queues['q']?.ready).toBe(0);
    expect(types(engine.advanceTo(300))).toEqual(['enqueued']);
    expect(engine.view().queues['q']?.ready).toBe(1);
  });

  it('keeps the paths and the trace that route() made, so that whoever explains it has them', () => {
    const engine = orders();
    run(engine, publish('e', 'k', 'm1'));

    const [routed] = only(settle(engine), 'routed');

    expect(routed?.paths).toEqual([
      { queue: 'q', hops: [{ from: 'e', binding: 0, to: { kind: 'queue', name: 'q' } }] },
    ]);
    expect(routed?.trace.exchange).toBe('e');
    expect(routed?.trace.visits[0]?.bindings[0]).toMatchObject({ matched: true, outcome: 'queue-first-copy' });
  });

  it('is unroutable when no queue gets it, with the trace of what was tried, and costs the queues nothing', () => {
    const engine = orders();
    run(engine, publish('e', 'other', 'm1'));

    const events = settle(engine);

    expect(types(events)).toEqual(['unroutable']);
    expect(only(events, 'unroutable')[0]?.trace.visits[0]?.bindings[0]).toMatchObject({ matched: false });
    expect(engine.view().queues['q']).toMatchObject({ ready: 0, enqueued: 0 });
    expect(engine.view().exchanges['e']).toEqual({ routed: 0, unroutable: 1, refused: 0 });
  });

  it('is routed by the default exchange to the queue that its key names', () => {
    const engine = orders();
    run(engine, publish('', 'q', 'm1'));

    const events = settle(engine);

    expect(types(events)).toEqual(['routed', 'enqueued']);
    expect(only(events, 'routed')[0]).toMatchObject({ exchange: '', queues: ['q'] });
    expect(engine.view().exchanges['']).toEqual({ routed: 1, unroutable: 0, refused: 0 });
  });

  it('is routed to every queue that a fanout reaches, and each copy is told as it comes into its queue', () => {
    const engine = newEngine(CANVAS_TIMING);
    runAll(
      engine,
      declareExchange('f', 'fanout'),
      declareQueue('a'),
      declareQueue('b'),
      bindQueue('f', 'a'),
      bindQueue('f', 'b'),
    );
    run(engine, publish('f', '', 'm1'));

    const events = settle(engine);

    expect(only(events, 'routed')[0]?.queues).toEqual(['a', 'b']);
    expect(only(events, 'enqueued').map(({ queue }) => queue)).toEqual(['a', 'b']);
  });

  it('is routed with the topology that the broker has when it arrives, so a queue that is gone by then is a copy that is dropped', () => {
    const engine = orders();
    send(engine);
    engine.advanceTo(500);

    run(engine, { op: 'queue.delete', name: 'q' });
    const events = engine.advanceTo(800);

    expect(events).toMatchObject([{ type: 'dropped', message: 1, queue: 'q' }]);
  });

  it('is refused when the exchange that it was sent to is gone by the time that it arrives, with the broker’s words', () => {
    const engine = orders();
    send(engine);
    run(engine, { op: 'exchange.delete', name: 'e' });

    const events = settle(engine);

    expect(events).toMatchObject([
      { type: 'refused', message: 1, exchange: 'e', code: 404, text: "NOT_FOUND - no exchange 'e' in vhost '/'" },
    ]);
  });

  it('is refused at an internal exchange with a 403, and the exchange counts it', () => {
    const engine = newEngine();
    run(engine, declareExchange('hidden', 'fanout', { internal: true }));
    run(engine, publish('hidden', '', 'm1'));

    const events = settle(engine);

    expect(events).toMatchObject([{ type: 'refused', code: 403 }]);
    expect(engine.view().exchanges['hidden']).toEqual({ routed: 0, unroutable: 0, refused: 1 });
  });

  it('is numbered from 1 in the order of publishing, and the numbers are not used again', () => {
    const engine = orders(ZERO_TIMING);

    const ids = [1, 2, 3].map((n) => only(run(engine, publish('e', 'k', `m${n}`)), 'published')[0]?.message.id);
    run(engine, { op: 'sim.clearMessages' });
    const next = only(run(engine, publish('e', 'k', 'm4')), 'published')[0]?.message.id;

    expect(ids).toEqual([1, 2, 3]);
    expect(next).toBe(4);
  });

  it('is told with the headers that it was sent with, as typed values', () => {
    const engine = orders();
    const headers = [{ key: 'n', value: { t: 'integer' as const, v: 1 } }];

    const [published] = only(
      run(engine, { op: 'basic.publish', exchange: 'e', key: 'k', headers, body: 'x' }),
      'published',
    );

    expect(published?.message.headers).toEqual(headers);
  });

  it('sends a message with nothing but an exchange: the empty key, no headers and an empty payload', () => {
    const engine = orders();

    const [published] = only(run(engine, { op: 'basic.publish', exchange: 'e' }), 'published');

    expect(published?.message).toEqual({ id: 1, producer: null, exchange: 'e', key: '', headers: [], payload: '' });
  });

  it('throws for a message that no client could send, as route() does', () => {
    const engine = orders();

    expect(() => engine.dispatch({ op: 'basic.publish', exchange: 'e', key: 'k'.repeat(256) })).toThrow(RangeError);
    expect(() =>
      engine.dispatch({
        op: 'basic.publish',
        exchange: 'e',
        headers: [{ key: 'n', value: { t: 'integer', v: 2 ** 53 } }],
      }),
    ).toThrow(/Header "n"/);
    expect(engine.view().published).toBe(0);
  });
});

describe('what a message does on the way, as the screen reads it', () => {
  it('is a leg from the producer to the exchange, then the hops inside the broker, then the delivery to a consumer', () => {
    const engine = orders();
    runAll(engine, openChannel('ch', undefined, null), consume('ch', 'q', 'c1'));
    send(engine);

    expect(engine.flights()).toEqual([
      { leg: 'publish', message: 1, key: 'k', producer: 'p', exchange: 'e', from: 0, to: 500 },
    ]);
    engine.advanceTo(500);
    expect(engine.flights()).toMatchObject([{ leg: 'broker', message: 1, exchange: 'e', from: 500, to: 800 }]);
    engine.advanceTo(800);
    expect(engine.flights()).toEqual([
      {
        leg: 'deliver',
        message: 1,
        key: 'k',
        queue: 'q',
        channel: 'ch',
        consumer: 'c1',
        redelivered: false,
        from: 800,
        to: 1300,
      },
    ]);
    engine.advanceTo(1300);
    expect(engine.flights()).toEqual([]);
  });

  it('says which producer sent a message on its leg in the broker, and none for a message that a command published', () => {
    const engine = orders();
    send(engine);
    engine.advanceTo(400);
    run(engine, publish('e', 'k', 'by hand'));
    engine.advanceTo(500);

    expect(engine.flights()).toMatchObject([
      { leg: 'broker', message: 2, producer: null, from: 400, to: 700 },
      { leg: 'broker', message: 1, producer: 'p', from: 500, to: 800 },
    ]);
  });

  it('is the same list until something changes, and a new one after', () => {
    const engine = orders();
    send(engine);

    const first = engine.flights();

    expect(engine.flights()).toBe(first);
    send(engine);
    expect(engine.flights()).not.toBe(first);
    expect(engine.flights()).toHaveLength(2);
  });

  it('counts the messages that are on their way in the view, a copy for each queue that it is going to', () => {
    const engine = newEngine(CANVAS_TIMING);
    runAll(
      engine,
      declareExchange('f', 'fanout'),
      declareQueue('a'),
      declareQueue('b'),
      bindQueue('f', 'a'),
      bindQueue('f', 'b'),
    );
    run(engine, publish('f', '', 'm1'));

    expect(engine.view().travelling).toBe(1);
    engine.advanceTo(0);
    expect(engine.view().travelling).toBe(2);
    engine.advanceTo(300);
    expect(engine.view().travelling).toBe(0);
  });
});

describe('the view', () => {
  it('counts what a queue holds, and what it has been given since the counters were last reset', () => {
    const engine = orders();
    run(engine, publish('e', 'k', 'm1'));
    settle(engine);

    expect(engine.view().queues['q']).toEqual({ ready: 1, unacked: 0, enqueued: 1, delivered: 0, consumers: 0 });
    expect(engine.view()).toMatchObject({ now: 10_000_000 + 0, seed: 1, vhost: '/', published: 1, travelling: 0 });
  });

  it('keeps what is named by a learner apart from what every object has: a queue called __proto__ or constructor is a queue, and one that is not there is not', () => {
    const engine = newEngine(ZERO_TIMING);
    runAll(
      engine,
      declareExchange('__proto__'),
      declareQueue('__proto__'),
      declareQueue('constructor'),
      openChannel('toString', 0, null),
      producer('hasOwnProperty'),
    );

    const view = engine.view();

    expect(Object.keys(view.queues)).toEqual(['__proto__', 'constructor']);
    expect(Object.keys(view.exchanges)).toEqual(['', '__proto__']);
    expect(Object.keys(view.channels)).toEqual(['toString']);
    expect(Object.keys(view.producers)).toEqual(['hasOwnProperty']);
    expect(view.queues['valueOf']).toBeUndefined();
    expect(view.exchanges['toString']).toBeUndefined();
    expect(view.queues['constructor']).toMatchObject({ ready: 0 });
  });

  it('holds the topology that the engine has, in the form that route() reads', () => {
    const engine = orders();

    expect(engine.view().topology).toEqual({
      vhost: '/',
      exchanges: [{ name: 'e', type: 'direct', internal: false }],
      queues: ['q'],
      bindings: [{ source: 'e', destination: { kind: 'queue', name: 'q' }, key: 'k' }],
    });
  });

  it('is plain data that survives JSON', () => {
    const engine = orders();
    runAll(engine, openChannel('ch', 1, 100), consume('ch', 'q', 'c1', 'manual'), publish('e', 'k', 'm1'));
    engine.advanceTo(900);

    const view = engine.view();

    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
    expect(JSON.parse(JSON.stringify(engine.flights()))).toEqual(engine.flights());
  });

  it('uses the vhost that it was made with in what the broker says', () => {
    const engine = createEngine({ seed: 1, timing: ZERO_TIMING, vhost: 'prod' });
    run(engine, publish('nowhere'));

    expect(only(settle(engine), 'refused')[0]?.text).toBe("NOT_FOUND - no exchange 'nowhere' in vhost 'prod'");
    expect(engine.view().vhost).toBe('prod');
  });
});
