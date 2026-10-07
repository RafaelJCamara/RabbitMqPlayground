import {
  bindQueue,
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
  ZERO_TIMING,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { EngineCommand } from './command';
import type { Engine } from './engine';
import type { EngineEvent } from './events';
import { unknownDeliveryTagReply } from './refusal';
import type { Timing } from './view';

/**
 * What the engine does for one consumer, channel, queue, exchange or producer, and does not do for the others. A test of one thing alone cannot tell a command that does
 * what it should from one that does that and a little more, so each case here has a second thing near the first that must be as it was, and the arguments that a caller must
 * get right say, in words, which one was wrong.
 */

const ack = (consumer: string, message?: number): EngineCommand => ({
  op: 'basic.ack',
  consumer,
  ...(message === undefined ? {} : { message }),
});

/** What each consumer was given, in order, by the number of the message. */
function given(events: readonly EngineEvent[]): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const { consumer, message } of only(events, 'delivered')) {
    (result[consumer] ??= []).push(message);
  }
  return result;
}

/** Publishes to the queue of that name through the default exchange, and leaves the messages on their way. */
const post = (engine: Engine, queue: string, ...bodies: string[]): EngineEvent[] =>
  runAll(engine, ...bodies.map((body) => publish('', queue, body)));

/** The consumers that a channel has, by their tags. */
const consumersOf = (engine: Engine, channel: string): string[] =>
  engine.view().channels[channel]?.consumers.map(({ consumer }) => consumer) ?? [];

/** The bindings of the topology, each as the words that say where it goes. */
const bindingsOf = (engine: Engine): string[] =>
  engine.view().topology.bindings.map(({ source, destination }) => `${source} ${destination.kind} ${destination.name}`);

/** An engine with a queue `jobs`. */
function jobs(timing: Timing = ZERO_TIMING): Engine {
  const engine = newEngine(timing);
  run(engine, declareQueue('jobs'));
  return engine;
}

describe('the consumers of a queue, when one acknowledges and another was found to be full', () => {
  it('serves a consumer that has room again when it acknowledges, whichever consumer acknowledged before it', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareQueue('jobs'),
      openChannel('ch-a', 1),
      consume('ch-a', 'jobs', 'a', 'manual'),
      openChannel('ch-b', 0),
      consume('ch-b', 'jobs', 'b', 'manual'),
    );
    post(engine, 'jobs', 'm1', 'm2', 'm3');
    settle(engine);
    // a holds message 1 and is full, and was found to be so when message 3 came. b has no limit, and holds 2 and 3.
    run(engine, ack('b', 2));
    run(engine, ack('a', 1));

    post(engine, 'jobs', 'm4', 'm5');

    expect(given(settle(engine))).toEqual({ b: [4], a: [5] });
  });

  it('serves each of two consumers that were found to be full when each acknowledges, and not only the first of them', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareQueue('jobs'),
      openChannel('ch-a', 1),
      consume('ch-a', 'jobs', 'a', 'manual'),
      openChannel('ch-c', 1),
      consume('ch-c', 'jobs', 'c', 'manual'),
    );
    post(engine, 'jobs', 'm1', 'm2', 'm3');
    settle(engine);
    // a holds 1 and c holds 2, and both were found to be full when message 3 came, which a is given when it acknowledges.
    run(engine, ack('a', 1));
    run(engine, ack('c', 2));

    post(engine, 'jobs', 'm4');

    expect(given(settle(engine))).toEqual({ c: [4] });
  });

  it('counts for each queue the consumers that it can give a message to, and not one that was cancelled and still holds one', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareQueue('jobs'),
      declareQueue('other'),
      openChannel('ch-a'),
      consume('ch-a', 'jobs', 'a', 'manual'),
      consume('ch-a', 'other', 'a2', 'manual'),
      openChannel('ch-b'),
      consume('ch-b', 'jobs', 'b', 'manual'),
    );

    expect(engine.view().queues['jobs']?.consumers).toBe(2);
    expect(engine.view().queues['other']?.consumers).toBe(1);

    post(engine, 'jobs', 'm1');
    settle(engine);
    run(engine, { op: 'basic.cancel', consumer: 'a' });

    expect(engine.view().queues['jobs']).toMatchObject({ consumers: 1, unacked: 1 });
    expect(engine.view().queues['other']).toMatchObject({ consumers: 1, unacked: 0 });
  });

  it('lists what a queue holds, and not what the consumers of other queues hold', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareQueue('jobs'),
      declareQueue('other'),
      openChannel('ch-a'),
      consume('ch-a', 'jobs', 'a', 'manual'),
      openChannel('ch-b'),
      consume('ch-b', 'other', 'b', 'manual'),
    );
    post(engine, 'jobs', 'm1');
    post(engine, 'other', 'm2');
    settle(engine);

    expect(engine.messages('jobs').map(({ id, heldBy }) => [id, heldBy?.consumer])).toEqual([[1, 'a']]);
    expect(engine.messages('other').map(({ id, heldBy }) => [id, heldBy?.consumer])).toEqual([[2, 'b']]);
  });
});

describe('a consumer of two queues, when one of them goes', () => {
  /** A channel `ch` with a consumer `ca` of the queue `a` and one `cb` of the queue `b`. */
  function twoQueues() {
    const engine = newEngine();
    runAll(
      engine,
      declareQueue('a'),
      declareQueue('b'),
      openChannel('ch'),
      consume('ch', 'a', 'ca', 'manual'),
      consume('ch', 'b', 'cb', 'manual'),
    );
    return engine;
  }

  it('keeps the other when one is cancelled', () => {
    const engine = twoQueues();

    run(engine, { op: 'basic.cancel', consumer: 'ca' });

    expect(consumersOf(engine, 'ch')).toEqual(['cb']);
  });

  it('keeps the other when the queue of one is deleted', () => {
    const engine = twoQueues();

    run(engine, { op: 'queue.delete', name: 'a' });

    expect(consumersOf(engine, 'ch')).toEqual(['cb']);
  });

  it('keeps the other when a cancelled one that held a message is let go of by a clear', () => {
    const engine = twoQueues();
    post(engine, 'a', 'm1');
    settle(engine);
    run(engine, { op: 'basic.cancel', consumer: 'ca' });
    expect(consumersOf(engine, 'ch')).toEqual(['ca', 'cb']);

    run(engine, { op: 'sim.clearMessages' });

    expect(consumersOf(engine, 'ch')).toEqual(['cb']);
  });

  it('goes on with the message that its channel is handling for the other queue, and drops only what it had of the one that went', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareQueue('a'),
      declareQueue('b'),
      openChannel('ch', undefined, 1_000),
      consume('ch', 'a', 'ca', 'manual'),
      consume('ch', 'b', 'cb', 'manual'),
    );
    post(engine, 'a', 'm1');
    post(engine, 'b', 'm2');
    engine.advanceTo(0);
    expect(engine.view().channels['ch']).toMatchObject({ working: true, waiting: 1 });

    run(engine, { op: 'queue.delete', name: 'b' });

    expect(engine.view().channels['ch']).toMatchObject({ working: true, waiting: 0 });
  });
});

describe('a channel that closes, a queue or an exchange that is deleted: what is not theirs stays', () => {
  it('leaves what is on its way to another channel when a channel closes, and that channel is given what comes back', () => {
    const engine = newEngine({ publishMs: 0, brokerMs: 0, deliverMs: 100 });
    runAll(
      engine,
      declareQueue('jobs'),
      openChannel('ch-a'),
      consume('ch-a', 'jobs', 'a', 'manual'),
      openChannel('ch-b'),
      consume('ch-b', 'jobs', 'b', 'manual'),
    );
    post(engine, 'jobs', 'm1', 'm2');
    engine.advanceTo(0);

    run(engine, { op: 'channel.close', channel: 'ch-a' });

    expect(only(settle(engine), 'received').map(({ message, channel }) => [channel, message])).toEqual([
      ['ch-b', 2],
      ['ch-b', 1],
    ]);
  });

  it('takes the bindings of the queue that is deleted, and none of the others, not even one that goes to an exchange of the same name', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareExchange('x'),
      declareExchange('same'),
      declareQueue('same'),
      declareQueue('other'),
      bindQueue('x', 'same', 'k'),
      bindQueue('x', 'other', 'k'),
      { op: 'bind', source: 'x', destination: { kind: 'exchange', name: 'same' }, key: 'k' },
    );

    run(engine, { op: 'queue.delete', name: 'same' });

    expect(bindingsOf(engine)).toEqual(['x queue other', 'x exchange same']);
  });

  it('takes the bindings that start from the exchange that is deleted and those that end at it, and none of the others', () => {
    const engine = newEngine();
    const toExchange = (source: string, name: string): EngineCommand => ({
      op: 'bind',
      source,
      destination: { kind: 'exchange', name },
      key: 'k',
    });
    runAll(
      engine,
      declareExchange('x'),
      declareExchange('y'),
      declareExchange('z'),
      declareQueue('y'),
      declareQueue('q'),
      bindQueue('x', 'q', 'k'),
      bindQueue('y', 'q', 'k'),
      bindQueue('x', 'y', 'k'),
      toExchange('x', 'y'),
      toExchange('y', 'z'),
      toExchange('z', 'x'),
    );

    run(engine, { op: 'exchange.delete', name: 'y' });

    expect(bindingsOf(engine)).toEqual(['x queue q', 'x queue y', 'z exchange x']);
  });

  it('stops only the ticks of the producer that is told not to repeat', () => {
    const engine = newEngine();
    runAll(engine, declareExchange('e', 'topic'), declareQueue('q'), bindQueue('e', 'q', '#'));
    const toE = { kind: 'exchange', name: 'e' } as const;
    run(engine, producer('p1', { target: toE, everyMs: 100, repeat: true }));
    run(engine, producer('p2', { target: toE, everyMs: 100, repeat: true }));
    engine.advanceTo(0);

    run(engine, producer('p1', { target: toE, everyMs: 100, repeat: false }));

    expect(engine.view().producers['p2']).toMatchObject({ repeating: true, nextAt: 100 });
    expect(only(engine.advanceTo(100), 'published').map(({ message }) => message.producer)).toEqual(['p2']);
  });
});

describe('a command that changes one thing', () => {
  it('leaves the prefetch of a channel alone when only the time that it takes is changed', () => {
    const engine = newEngine();
    run(engine, openChannel('ch', 3));

    run(engine, { op: 'channel.set', channel: 'ch', processingMs: 500 });

    expect(engine.view().channels['ch']).toMatchObject({ prefetch: 3, processingMs: 500 });
  });

  it('says that one message was purged, as it says that more were, and nothing for a queue that has none', () => {
    const engine = jobs();
    post(engine, 'jobs', 'm1');
    settle(engine);

    expect(run(engine, { op: 'queue.purge', name: 'jobs' })).toMatchObject([
      { type: 'queue.purged', queue: 'jobs', count: 1 },
    ]);
    expect(run(engine, { op: 'queue.purge', name: 'jobs' })).toEqual([]);
  });

  it('refuses an acknowledgement for a consumer that is not there, with or without the message, and closes no channel', () => {
    const engine = jobs();
    run(engine, openChannel('ch'));

    expect(engine.dispatch(ack('nobody', 7))).toEqual({ ok: false, ...unknownDeliveryTagReply(7), events: [] });
    expect(engine.dispatch(ack('nobody'))).toEqual({ ok: false, ...unknownDeliveryTagReply(0), events: [] });
    expect(engine.view().channels['ch']).toBeDefined();
  });
});

describe('what a clear takes out, one place at a time', () => {
  const slow: Timing = { publishMs: 100, brokerMs: 100, deliverMs: 100 };

  const cleared = (engine: Engine) => only(run(engine, { op: 'sim.clearMessages' }), 'cleared');

  it('says that it took a message that was on its way to the broker, and no other', () => {
    const engine = jobs(slow);
    post(engine, 'jobs', 'm1');

    expect(cleared(engine)).toMatchObject([{ travelling: 1, ready: 0, unacked: 0, buffered: 0 }]);
    expect(settle(engine)).toEqual([]);
  });

  it('says that it took a message that was in the broker, and no other', () => {
    const engine = jobs(slow);
    post(engine, 'jobs', 'm1');
    engine.advanceTo(0);

    expect(cleared(engine)).toMatchObject([{ travelling: 1, ready: 0, unacked: 0, buffered: 0 }]);
    expect(settle(engine)).toEqual([]);
  });

  it('says that it took a message that was ready in a queue, and no other', () => {
    const engine = jobs();
    post(engine, 'jobs', 'm1');
    settle(engine);

    expect(cleared(engine)).toMatchObject([{ travelling: 0, ready: 1, unacked: 0, buffered: 0 }]);
  });

  it('says that it took a message that a consumer holds, and takes the one that was still on its way to it', () => {
    const engine = jobs({ publishMs: 0, brokerMs: 0, deliverMs: 100 });
    runAll(engine, openChannel('ch'), consume('ch', 'jobs', 'c', 'manual'));
    post(engine, 'jobs', 'm1');
    engine.advanceTo(0);

    expect(cleared(engine)).toMatchObject([{ travelling: 0, ready: 0, unacked: 1, buffered: 0 }]);
    expect(settle(engine)).toEqual([]);
  });

  it('says that it took a message that was on its way to a consumer that acknowledges by itself, which the broker has let go of', () => {
    const engine = jobs({ publishMs: 0, brokerMs: 0, deliverMs: 100 });
    runAll(engine, openChannel('ch'), consume('ch', 'jobs', 'c', 'auto'));
    post(engine, 'jobs', 'm1');
    engine.advanceTo(0);

    expect(cleared(engine)).toMatchObject([{ travelling: 1, ready: 0, unacked: 0, buffered: 0 }]);
    expect(settle(engine)).toEqual([]);
  });

  it('takes what a consumer is handling, so that it finishes nothing afterwards', () => {
    const engine = jobs();
    runAll(engine, openChannel('ch', undefined, 500), consume('ch', 'jobs', 'c', 'manual'));
    post(engine, 'jobs', 'm1');
    engine.advanceTo(0);
    expect(engine.view().channels['ch']).toMatchObject({ working: true });

    expect(cleared(engine)).toMatchObject([{ unacked: 1 }]);

    expect(settle(engine)).toEqual([]);
    expect(engine.view().channels['ch']).toMatchObject({ working: false, consumed: 0 });
  });

  it('says nothing when there is nothing to take', () => {
    const engine = jobs();

    expect(cleared(engine)).toEqual([]);
  });
});

describe('what a reset of the counters says, when only one of them was not zero', () => {
  const slow: Timing = { publishMs: 100, brokerMs: 100, deliverMs: 100 };
  const reset = (engine: Engine): EngineEvent[] => run(engine, { op: 'sim.resetCounters' });

  /** Every counter that the view has, which a reset must have zeroed. */
  function counters(engine: Engine): number[] {
    const view = engine.view();
    return [
      view.published,
      ...Object.values(view.producers).map(({ published }) => published),
      ...Object.values(view.exchanges).flatMap(({ routed, unroutable, refused }) => [routed, unroutable, refused]),
      ...Object.values(view.queues).flatMap(({ enqueued, delivered }) => [enqueued, delivered]),
      ...Object.values(view.channels).flatMap(({ received, consumed }) => [received, consumed]),
    ];
  }

  it('says that it reset the count of what was published, and zeroes the counts of the producers too', () => {
    const engine = jobs(slow);
    run(engine, producer('p', { target: { kind: 'queue', name: 'jobs' } }));
    run(engine, { op: 'producer.publish', producer: 'p' });
    expect(engine.view().producers['p']?.published).toBe(1);

    expect(reset(engine)).toMatchObject([{ type: 'counters.reset' }]);

    expect(counters(engine).every((count) => count === 0)).toBe(true);
    expect(reset(engine)).toEqual([]);
  });

  it('says that it reset the count of a message that no queue got', () => {
    const engine = jobs(slow);
    post(engine, 'nowhere', 'm1');
    reset(engine);
    engine.advanceTo(100);
    expect(engine.view().exchanges['']).toMatchObject({ unroutable: 1, routed: 0, refused: 0 });

    expect(reset(engine)).toMatchObject([{ type: 'counters.reset' }]);

    expect(counters(engine).every((count) => count === 0)).toBe(true);
  });

  it('says that it reset the count of a message that an exchange refused', () => {
    const engine = jobs(slow);
    run(engine, declareExchange('inner', 'direct', { internal: true }));
    run(engine, publish('inner', 'k', 'm1'));
    reset(engine);
    engine.advanceTo(100);
    expect(engine.view().exchanges['inner']).toMatchObject({ refused: 1, routed: 0, unroutable: 0 });

    expect(reset(engine)).toMatchObject([{ type: 'counters.reset' }]);

    expect(counters(engine).every((count) => count === 0)).toBe(true);
  });

  it('says that it reset the count of a message that a queue was given, and the one that it gave away', () => {
    const engine = jobs(slow);
    post(engine, 'jobs', 'm1');
    engine.advanceTo(0);
    reset(engine);
    engine.advanceTo(100);
    expect(engine.view().queues['jobs']).toMatchObject({ enqueued: 1, delivered: 0 });
    expect(reset(engine)).toMatchObject([{ type: 'counters.reset' }]);

    runAll(engine, openChannel('ch'), consume('ch', 'jobs', 'c', 'manual'));
    expect(engine.view().queues['jobs']).toMatchObject({ enqueued: 0, delivered: 1 });
    expect(reset(engine)).toMatchObject([{ type: 'counters.reset' }]);

    expect(counters(engine).every((count) => count === 0)).toBe(true);
  });

  it('says that it reset the counts of a channel that received a message and finished with it by itself', () => {
    const engine = jobs({ publishMs: 0, brokerMs: 0, deliverMs: 100 });
    post(engine, 'jobs', 'm1');
    engine.advanceTo(0);
    runAll(engine, openChannel('ch'), consume('ch', 'jobs', 'c', 'auto'));
    reset(engine);
    engine.advanceTo(100);
    expect(engine.view().channels['ch']).toMatchObject({ received: 1, consumed: 1 });

    expect(reset(engine)).toMatchObject([{ type: 'counters.reset' }]);

    expect(counters(engine).every((count) => count === 0)).toBe(true);
  });
});

describe('the arguments that a caller must get right', () => {
  const timing = (changes: Partial<Timing>): Timing => ({ ...ZERO_TIMING, ...changes });
  const configure = (changes: Partial<Timing>): EngineCommand => ({
    op: 'sim.configure',
    seed: 1,
    timing: timing(changes),
  });

  /** The engine has a channel `ch` that consumes from `jobs` as `c`, which most of these need. */
  function consuming(): Engine {
    const engine = jobs();
    runAll(engine, openChannel('ch'), consume('ch', 'jobs', 'c', 'manual'));
    return engine;
  }

  const cases: readonly [string, (engine: Engine) => unknown, string][] = [
    [
      'a time to the broker that is negative',
      (e) => e.dispatch(configure({ publishMs: -1 })),
      'publishMs must be a whole number of at least 0, and -1 is not',
    ],
    [
      'a time in the broker that is not whole',
      (e) => e.dispatch(configure({ brokerMs: 1.5 })),
      'brokerMs must be a whole number of at least 0, and 1.5 is not',
    ],
    [
      'a time to a consumer that is not a number',
      (e) => e.dispatch(configure({ deliverMs: Number.NaN })),
      'deliverMs must be a whole number of at least 0, and NaN is not',
    ],
    [
      'a prefetch that is negative',
      (e) => e.dispatch(openChannel('x', -1)),
      'prefetch must be a whole number of at least 0, and -1 is not',
    ],
    [
      'a time to handle a message that is not whole',
      (e) => e.dispatch(openChannel('x', undefined, 0.5)),
      'processingMs must be a whole number of at least 0, and 0.5 is not',
    ],
    [
      'a prefetch that is set to a negative one',
      (e) => e.dispatch({ op: 'channel.set', channel: 'ch', prefetch: -2 }),
      'prefetch must be a whole number of at least 0, and -2 is not',
    ],
    [
      'a time to handle a message that is set to a negative one',
      (e) => e.dispatch({ op: 'channel.set', channel: 'ch', processingMs: -3 }),
      'processingMs must be a whole number of at least 0, and -3 is not',
    ],
    ['a channel that is open already', (e) => e.dispatch(openChannel('ch')), 'The channel "ch" is open already'],
    [
      'a channel that is not open, to close',
      (e) => e.dispatch({ op: 'channel.close', channel: 'nope' }),
      'There is no open channel "nope"',
    ],
    [
      'a channel that is not open, to consume with',
      (e) => e.dispatch(consume('nope', 'jobs', 'd')),
      'There is no open channel "nope"',
    ],
    [
      'a consumer that is consuming already',
      (e) => e.dispatch(consume('ch', 'jobs', 'c')),
      'The consumer "c" is consuming already',
    ],
    [
      'a queue with no name',
      (e) => e.dispatch(declareQueue('')),
      'A queue needs a name: the simulator does not name queues for a client',
    ],
    [
      'a burst of none',
      (e) => e.dispatch(producer('p', { burst: 0 })),
      'burst must be a whole number of at least 1, and 0 is not',
    ],
    [
      'an interval of none',
      (e) => e.dispatch(producer('p', { everyMs: 0 })),
      'everyMs must be a whole number of at least 1, and 0 is not',
    ],
    [
      'a producer that is not there, to publish from',
      (e) => e.dispatch({ op: 'producer.publish', producer: 'ghost' }),
      'There is no producer "ghost"',
    ],
  ];

  it.each(cases)('throws for %s, and says which', (_what, act, message) => {
    expect(() => act(consuming())).toThrow(new RangeError(message));
  });

  it('takes the least that is allowed: no limit, no time, and an interval of a millisecond', () => {
    const engine = consuming();

    expect(() => engine.dispatch(openChannel('free', 0, 0))).not.toThrow();
    expect(() =>
      engine.dispatch({ op: 'channel.set', channel: 'free', prefetch: 0, processingMs: null }),
    ).not.toThrow();
    expect(() => engine.dispatch(configure({}))).not.toThrow();
    run(engine, producer('p', { target: { kind: 'queue', name: 'jobs' }, burst: 1, everyMs: 1, repeat: true }));
    expect(engine.view().producers['p']).toMatchObject({ repeating: true, nextAt: 0 });
  });
});
