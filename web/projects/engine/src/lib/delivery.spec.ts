import {
  bindQueue,
  consume,
  declareExchange,
  declareQueue,
  newEngine,
  only,
  openChannel,
  publish,
  run,
  runAll,
  settle,
  types,
  ZERO_TIMING,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { EngineCommand } from './command';
import type { Engine } from './engine';
import type { EngineEvent } from './events';
import { unknownDeliveryTagReply } from './refusal';

/**
 * Who gets a message, and what cancel, close and delete do to what a consumer holds (ADR-0053). The rules are the broker's, and the
 * fixtures are replayed in `fixtures.spec.ts`; here are the same rules read as sentences, and the cases that a broker cannot be asked about.
 */

/** What each consumer was given, in order, by the number of the message. */
function given(events: readonly EngineEvent[]): Record<string, number[]> {
  const result: Record<string, number[]> = {};
  for (const { consumer, message } of only(events, 'delivered')) {
    (result[consumer] ??= []).push(message);
  }
  return result;
}

/** An engine with a queue `jobs`, and no consumers. */
function jobs(timing = ZERO_TIMING) {
  const engine = newEngine(timing);
  run(engine, declareQueue('jobs'));
  return engine;
}

/** Opens a channel and consumes from `jobs` with it, as a consumer that is told when to ack unless it says that it handles messages by itself. */
function join(
  engine: Engine,
  name: string,
  options: { prefetch?: number; ack?: 'auto' | 'manual'; processingMs?: number | null; queue?: string } = {},
): EngineEvent[] {
  return runAll(
    engine,
    openChannel(`ch-${name}`, options.prefetch, options.processingMs ?? null),
    consume(`ch-${name}`, options.queue ?? 'jobs', name, options.ack ?? 'auto'),
  );
}

/** Publishes to the queue, and lets everything that follows happen. */
const send = (engine: Engine, ...bodies: string[]): EngineEvent[] => post(engine, ...bodies).concat(settle(engine));

/** Publishes to the queue, and leaves it on its way. */
const post = (engine: Engine, ...bodies: string[]): EngineEvent[] =>
  runAll(engine, ...bodies.map((body) => publish('', 'jobs', body)));

const ack = (consumer: string, message?: number): EngineCommand => ({
  op: 'basic.ack',
  consumer,
  ...(message === undefined ? {} : { message }),
});

describe('who gets the next message', () => {
  it('deals the messages out in turn to the consumers of a queue, the one at the head first', () => {
    const engine = jobs();
    join(engine, 'c1');
    join(engine, 'c2');

    expect(given(send(engine, 'm1', 'm2', 'm3', 'm4'))).toEqual({ c1: [1, 3], c2: [2, 4] });
  });

  it('gives a message to one consumer and not to both, the first message included (#10)', () => {
    const engine = jobs();
    join(engine, 'c1');
    join(engine, 'c2');

    const events = send(engine, 'm1');

    expect(only(events, 'delivered')).toHaveLength(1);
    expect(given(events)).toEqual({ c1: [1] });
  });

  it('adds a consumer that joins late behind the ones that are there, and carries on in turn', () => {
    const engine = jobs();
    join(engine, 'c1');
    send(engine, 'm1', 'm2');
    join(engine, 'c2');

    expect(given(send(engine, 'm3', 'm4', 'm5', 'm6'))).toEqual({ c1: [3, 5], c2: [4, 6] });
  });

  it('gives a consumer that joins a queue that has waiting messages its share at once, inside the command', () => {
    const engine = jobs();
    send(engine, 'm1', 'm2', 'm3');

    const events = join(engine, 'c1');

    expect(given(events)).toEqual({ c1: [1, 2, 3] });
  });

  it('keeps the messages of a queue that has no consumer, in order, until there is one', () => {
    const engine = jobs();
    send(engine, 'm1', 'm2');

    expect(engine.view().queues['jobs']).toMatchObject({ ready: 2, unacked: 0, delivered: 0 });
    expect(engine.messages('jobs').map(({ id }) => id)).toEqual([1, 2]);
  });

  it('gives each queue that a message reaches a copy, and each copy to one consumer of that queue', () => {
    const engine = newEngine();
    runAll(
      engine,
      declareExchange('f', 'fanout'),
      declareQueue('q1'),
      declareQueue('q2'),
      bindQueue('f', 'q1'),
      bindQueue('f', 'q2'),
    );
    join(engine, 'c1', { queue: 'q1' });
    join(engine, 'c2', { queue: 'q2' });
    join(engine, 'c3', { queue: 'q1' });

    const events = settle(engine).concat(
      runAll(engine, publish('f', '', 'm1'), publish('f', '', 'm2')),
      settle(engine),
    );

    expect(given(events)).toEqual({ c1: [1], c2: [1, 2], c3: [2] });
  });

  describe('prefetch', () => {
    it('is counted for each consumer: one that holds as many as its prefetch is not given more until it acknowledges', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 2, ack: 'manual' });
      join(engine, 'c2', { prefetch: 1, ack: 'manual' });

      expect(given(send(engine, 'm1', 'm2', 'm3', 'm4', 'm5'))).toEqual({ c1: [1, 3], c2: [2] });
      expect(engine.view().queues['jobs']).toMatchObject({ ready: 2, unacked: 3 });
      expect(given(run(engine, ack('c2')))).toEqual({ c2: [4] });
      expect(engine.view().queues['jobs']).toMatchObject({ ready: 1, unacked: 3 });
    });

    it('is not the channel’s to share: a channel that consumes from two queues has a window for each', () => {
      const engine = newEngine();
      runAll(engine, declareQueue('a'), declareQueue('b'), openChannel('ch', 1));
      runAll(engine, consume('ch', 'a', 'c1', 'manual'), consume('ch', 'b', 'c2', 'manual'));

      const events = runAll(
        engine,
        publish('', 'a', 'm1'),
        publish('', 'a', 'm2'),
        publish('', 'b', 'm3'),
        publish('', 'b', 'm4'),
      ).concat(settle(engine));

      expect(given(events)).toEqual({ c1: [1], c2: [3] });
    });

    it('is no limit when it is 0, and is ignored by a consumer that acknowledges by itself', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 0, ack: 'manual' });
      join(engine, 'c2', { prefetch: 1, ack: 'auto' });

      expect(given(send(engine, 'm1', 'm2', 'm3', 'm4', 'm5', 'm6'))).toEqual({ c1: [1, 3, 5], c2: [2, 4, 6] });
    });

    it('counts a message from the moment that the broker gives it away, and not from the moment that it arrives', () => {
      const engine = jobs({ publishMs: 0, brokerMs: 0, deliverMs: 1000 });
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });

      send(engine, 'm1', 'm2');

      expect(engine.view().queues['jobs']).toMatchObject({ ready: 1, unacked: 1 });
      expect(engine.view().channels['ch-c1']).toMatchObject({ received: 1, consumers: [{ unacked: 1 }] });
    });

    it('is found to be full only when the consumer is tried: acknowledging in another order does not change who is served first', () => {
      const engine = jobs();
      for (const name of ['c1', 'c2', 'c3']) {
        join(engine, name, { prefetch: 1, ack: 'manual' });
      }
      send(engine, 'm1', 'm2', 'm3');
      runAll(engine, ack('c3'), ack('c1'), ack('c2'));

      expect(given(send(engine, 'm4', 'm5', 'm6'))).toEqual({ c1: [4], c2: [5], c3: [6] });
    });

    it('puts a consumer that was found to be full at the back of the turn when an acknowledgement gives it room', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      join(engine, 'c2', { prefetch: 5, ack: 'manual' });
      send(engine, 'm1', 'm2', 'm3');
      run(engine, ack('c1'));

      expect(given(send(engine, 'm4', 'm5'))).toEqual({ c2: [4], c1: [5] });
    });

    it('is raised by a command, which serves the consumers that have room now, and lowered by one that takes nothing back', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1', 'm2', 'm3');

      expect(given(run(engine, { op: 'channel.set', channel: 'ch-c1', prefetch: 3 }))).toEqual({ c1: [2, 3] });
      expect(run(engine, { op: 'channel.set', channel: 'ch-c1', prefetch: 1 })).toEqual([]);
      expect(engine.view().channels['ch-c1']?.consumers[0]?.unacked).toBe(3);
      send(engine, 'm4');
      expect(engine.view().queues['jobs']?.ready).toBe(1);
      runAll(engine, ack('c1'), ack('c1'));
      expect(engine.view().queues['jobs']?.ready).toBe(1);
      expect(given(run(engine, ack('c1')))).toEqual({ c1: [4] });
    });

    it('gives nothing to a consumer that was cancelled, whatever room it has now, and serves the others', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      join(engine, 'c2', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1', 'm2', 'm3', 'm4');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });

      expect(given(run(engine, { op: 'channel.set', channel: 'ch-c1', prefetch: 5 }))).toEqual({});
      expect(engine.view().channels['ch-c1']?.consumers).toEqual([
        { consumer: 'c1', queue: 'jobs', ack: 'manual', unacked: 1, cancelled: true },
      ]);
      expect(given(run(engine, ack('c2')))).toEqual({ c2: [3] });
    });
  });
});

describe('what a consumer holds', () => {
  it('is unacknowledged until it acks, and the message is gone from the queue when it does', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual' });
    send(engine, 'm1');

    expect(engine.messages('jobs')).toEqual([
      {
        id: 1,
        exchange: '',
        producer: null,
        key: 'jobs',
        headers: [],
        payload: 'm1',
        redelivered: false,
        heldBy: { consumer: 'c1', channel: 'ch-c1' },
      },
    ]);
    expect(run(engine, ack('c1'))).toMatchObject([
      { type: 'acked', message: 1, queue: 'jobs', consumer: 'c1', channel: 'ch-c1' },
    ]);
    expect(engine.messages('jobs')).toEqual([]);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 1, consumed: 1 });
  });

  it('says, of each copy that a queue holds, where it was published and by whom, and what headers it carries, whether it is ready or held', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual', prefetch: 1 });
    runAll(
      engine,
      {
        op: 'producer.set',
        producer: 'p',
        target: { kind: 'queue', name: 'jobs' },
        key: '',
        payload: 'from p',
        headers: [{ key: 'format', value: { t: 'string', v: 'pdf' } }],
        burst: 1,
        everyMs: 1000,
        repeat: false,
      },
      { op: 'producer.publish', producer: 'p' },
      {
        op: 'basic.publish',
        exchange: '',
        key: 'jobs',
        body: 'by hand',
        headers: [{ key: 'n', value: { t: 'integer', v: 3 } }],
      },
    );
    settle(engine);

    // The ready messages come first, and then the ones that a consumer holds.
    const [ready, held] = engine.messages('jobs');

    expect(held).toMatchObject({
      id: 1,
      exchange: '',
      producer: 'p',
      key: 'jobs',
      headers: [{ key: 'format', value: { t: 'string', v: 'pdf' } }],
      payload: 'from p',
      heldBy: { consumer: 'c1' },
    });
    expect(ready).toMatchObject({
      id: 2,
      exchange: '',
      producer: null,
      key: 'jobs',
      headers: [{ key: 'n', value: { t: 'integer', v: 3 } }],
      payload: 'by hand',
      heldBy: null,
    });
  });

  it('is gone from the queue at once for a consumer that acknowledges by itself', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'auto' });

    const [delivered] = only(send(engine, 'm1'), 'delivered');

    expect(delivered).toMatchObject({ autoAck: true, redelivered: false });
    expect(engine.view().queues['jobs']).toMatchObject({ ready: 0, unacked: 0 });
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 1, consumed: 1 });
  });

  it('is acknowledged by the number of the message when that is given, and the oldest when it is not', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual' });
    send(engine, 'm1', 'm2', 'm3');

    expect(only(run(engine, ack('c1', 2)), 'acked')[0]?.message).toBe(2);
    expect(only(run(engine, ack('c1')), 'acked')[0]?.message).toBe(1);
    expect(engine.messages('jobs').map(({ id }) => id)).toEqual([3]);
  });

  it('is refused when it is a message that the consumer does not hold: the 406 of the broker, which closes the channel', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual' });
    send(engine, 'm1');

    const result = engine.dispatch(ack('c1', 99));

    expect(result).toMatchObject({ ok: false, ...unknownDeliveryTagReply(99) });
    expect(result.ok ? [] : types(result.events)).toEqual(['channel.closed', 'requeued']);
    expect(result.ok ? undefined : result.events[0]).toMatchObject({
      reason: { kind: 'refused', code: 406, text: 'PRECONDITION_FAILED - unknown delivery tag 99' },
      requeued: 1,
    });
    expect(engine.view().channels['ch-c1']).toBeUndefined();
    expect(engine.view().queues['jobs']).toMatchObject({ ready: 1, unacked: 0 });
  });

  it('is refused for a consumer that is not there, and there is no channel to close', () => {
    const engine = jobs();

    expect(engine.dispatch(ack('nobody'))).toEqual({ ok: false, ...unknownDeliveryTagReply(0), events: [] });
  });
});

describe('a message that a command acknowledges before the consumer is done with it', () => {
  const timing = { publishMs: 0, brokerMs: 0, deliverMs: 100 };

  it('is not handled again when the consumer finishes: there is nothing left for it to acknowledge', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'manual', processingMs: 100, prefetch: 2 });
    post(engine, 'm1', 'm2');
    engine.advanceTo(150);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 2, working: true, waiting: 1 });

    expect(types(run(engine, ack('c1', 1)))).toEqual(['acked']);
    const rest = settle(engine);

    expect(types(rest)).toEqual(['processed', 'acked']);
    expect(only(rest, 'acked')[0]?.message).toBe(2);
    expect(engine.view().channels['ch-c1']).toMatchObject({ consumed: 2, working: false, waiting: 0 });
  });

  it('never reaches the consumer when it was still on its way, and the next message is started in its place', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'manual', processingMs: 100, prefetch: 2 });
    post(engine, 'm1', 'm2');
    engine.advanceTo(0);

    expect(types(run(engine, ack('c1', 1)))).toEqual(['acked']);
    const rest = settle(engine);

    expect(only(rest, 'received').map(({ message }) => message)).toEqual([2]);
    expect(only(rest, 'acked').map(({ message }) => message)).toEqual([2]);
  });
});

describe('cancel', () => {
  it('takes the consumer out of the turn and leaves what it holds, which it can still acknowledge', () => {
    const engine = jobs();
    join(engine, 'c1', { prefetch: 1, ack: 'manual' });
    send(engine, 'm1', 'm2');

    const cancelled = run(engine, { op: 'basic.cancel', consumer: 'c1' });
    const after = send(engine, 'm3');

    expect(cancelled).toMatchObject([
      { type: 'consumer.cancelled', consumer: 'c1', channel: 'ch-c1', queue: 'jobs', reason: 'cancelled' },
    ]);
    expect(given(after)).toEqual({});
    expect(engine.view().channels['ch-c1']?.consumers).toEqual([
      { consumer: 'c1', queue: 'jobs', ack: 'manual', unacked: 1, cancelled: true },
    ]);
    expect(types(run(engine, ack('c1')))).toEqual(['acked']);
    expect(engine.view().channels['ch-c1']?.consumers).toEqual([]);
    expect(engine.view().queues['jobs']).toMatchObject({ ready: 2, unacked: 0, consumers: 0 });
  });

  it('stays for as long as the consumer holds a message, and is gone with the last one that it acknowledges', () => {
    const engine = jobs();
    join(engine, 'c1', { prefetch: 2, ack: 'manual' });
    send(engine, 'm1', 'm2');
    run(engine, { op: 'basic.cancel', consumer: 'c1' });

    run(engine, ack('c1'));
    expect(engine.view().channels['ch-c1']?.consumers).toEqual([
      { consumer: 'c1', queue: 'jobs', ack: 'manual', unacked: 1, cancelled: true },
    ]);
    run(engine, ack('c1'));

    expect(engine.view().channels['ch-c1']?.consumers).toEqual([]);
  });

  it('is accepted for a consumer that is not there, and for one that is cancelled already, and says nothing', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual' });
    send(engine, 'm1');
    run(engine, { op: 'basic.cancel', consumer: 'c1' });

    expect(run(engine, { op: 'basic.cancel', consumer: 'c1' })).toEqual([]);
    expect(run(engine, { op: 'basic.cancel', consumer: 'nobody' })).toEqual([]);
  });

  it('is gone at once for a consumer that holds nothing', () => {
    const engine = jobs();
    join(engine, 'c1');

    run(engine, { op: 'basic.cancel', consumer: 'c1' });

    expect(engine.view().channels['ch-c1']?.consumers).toEqual([]);
    expect(given(send(engine, 'm1'))).toEqual({});
  });

  it('still lets the messages that the broker had given it arrive', () => {
    const engine = jobs({ publishMs: 0, brokerMs: 0, deliverMs: 100 });
    join(engine, 'c1', { ack: 'manual' });
    post(engine, 'm1');
    engine.advanceTo(0);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 0, consumers: [{ unacked: 1 }] });

    run(engine, { op: 'basic.cancel', consumer: 'c1' });
    const arrived = engine.advanceTo(100);

    expect(types(arrived)).toEqual(['received']);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 1 });
    expect(types(run(engine, ack('c1')))).toEqual(['acked']);
  });

  describe('and then consuming again with the tag that it had (ADR-0089)', () => {
    it('starts a new consumer under the tag, when its channel asks again for the same queue in the same way: it still holds what the old one held, and its window starts at nothing', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      expect(given(send(engine, 'm2'))).toEqual({});

      const resumed = runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual'));

      // The broker gave m2 to the new consumer while m1 was still unacknowledged on the channel: recorded against RabbitMQ 4.3 in delivery/a-tag-taken-again-after-a-cancel-starts-with-an-empty-window.
      expect(given(resumed)).toEqual({ c1: [2] });
      expect(types(resumed)).not.toContain('consumer.cancelled');
      expect(engine.view().channels['ch-c1']?.consumers).toEqual([
        { consumer: 'c1', queue: 'jobs', ack: 'manual', unacked: 2, cancelled: false },
      ]);
    });

    it('takes one off the window of the new consumer for each acknowledgement of anything under the tag, what the old one held included, by order or by number', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual'));
      expect(given(send(engine, 'm2', 'm3', 'm4'))).toEqual({ c1: [2] });

      expect(given(run(engine, ack('c1')))).toEqual({ c1: [3] });
      expect(given(run(engine, ack('c1', 2)))).toEqual({ c1: [4] });
      expect(engine.view().channels['ch-c1']?.consumers).toMatchObject([{ unacked: 2 }]);
    });

    it('lets the window go below nothing, as the broker does: what the old one held is acknowledged, and the new one is given more than its prefetch', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual'));
      run(engine, ack('c1'));
      expect(engine.view().channels['ch-c1']?.consumers).toMatchObject([{ unacked: 0 }]);

      // Recorded against RabbitMQ 4.3: with a prefetch of 1 it was given the first two of the three.
      expect(given(send(engine, 'm2', 'm3', 'm4'))).toEqual({ c1: [2, 3] });
    });

    it('counts again from nothing every time that the tag is taken again, with what is held by then as what the earlier ones held', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual'));
      send(engine, 'm2');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });

      expect(given(runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual')))).toEqual({});
      expect(given(send(engine, 'm3'))).toEqual({ c1: [3] });
      expect(engine.view().channels['ch-c1']?.consumers).toMatchObject([{ unacked: 3, cancelled: false }]);
      expect(given(send(engine, 'm4'))).toEqual({});
    });

    it('is a consumer that is gone when the last of what it held is acknowledged, if it is cancelled again before that', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual'));
      run(engine, { op: 'basic.cancel', consumer: 'c1' });

      run(engine, ack('c1'));

      expect(engine.view().channels['ch-c1']?.consumers).toEqual([]);
    });

    it('gives back everything that the channel holds when it closes, what the old one held and what the new one holds, redelivered, and the other consumers are served with them', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual'));
      join(engine, 'c2', { prefetch: 5, ack: 'manual' });
      expect(given(send(engine, 'm2'))).toEqual({ c1: [2] });

      const closed = run(engine, { op: 'channel.close', channel: 'ch-c1' });

      expect(types(closed)).toEqual(['channel.closed', 'requeued', 'requeued', 'delivered', 'delivered']);
      expect(
        only(closed, 'delivered').map(({ message, consumer, redelivered }) => [message, consumer, redelivered]),
      ).toEqual([
        [1, 'c2', true],
        [2, 'c2', true],
      ]);
    });

    it('forgets what the old one held when the messages are cleared, so that the new one has its whole window', () => {
      const engine = jobs();
      join(engine, 'c1', { prefetch: 1, ack: 'manual' });
      send(engine, 'm1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      runAll(engine, consume('ch-c1', 'jobs', 'c1', 'manual'));
      send(engine, 'm2');
      run(engine, { op: 'sim.clearMessages' });

      expect(given(send(engine, 'm3', 'm4'))).toEqual({ c1: [3] });
    });

    it('is a consumer that is gone, and its tag is free for anything, when it held nothing', () => {
      const engine = jobs();
      run(engine, declareQueue('other'));
      join(engine, 'c1');
      run(engine, { op: 'basic.cancel', consumer: 'c1' });

      runAll(engine, consume('ch-c1', 'other', 'c1', 'manual'));

      expect(engine.view().channels['ch-c1']?.consumers).toEqual([
        { consumer: 'c1', queue: 'other', ack: 'manual', unacked: 0, cancelled: false },
      ]);
    });

    it('is still a mistake to ask for the tag of a consumer that is consuming, and of a cancelled one for another queue, another channel or another way of acknowledging', () => {
      const engine = jobs();
      run(engine, declareQueue('other'));
      join(engine, 'c1', { prefetch: 2, ack: 'manual' });
      send(engine, 'm1');
      const mistake = (command: EngineCommand) => () => run(engine, command);
      const consuming = 'The consumer "c1" is consuming already';

      expect(mistake(consume('ch-c1', 'jobs', 'c1', 'manual'))).toThrow(consuming);
      run(engine, { op: 'basic.cancel', consumer: 'c1' });
      run(engine, openChannel('ch-other', 2, null));

      expect(mistake(consume('ch-c1', 'other', 'c1', 'manual'))).toThrow(consuming);
      expect(mistake(consume('ch-other', 'jobs', 'c1', 'manual'))).toThrow(consuming);
      expect(mistake(consume('ch-c1', 'jobs', 'c1', 'auto'))).toThrow(consuming);
      expect(engine.view().channels['ch-c1']?.consumers).toEqual([
        { consumer: 'c1', queue: 'jobs', ack: 'manual', unacked: 1, cancelled: true },
      ]);
    });
  });
});

describe('close', () => {
  it('gives back everything that the consumers of the channel hold, redelivered, in the places that they had (#18)', () => {
    const engine = jobs();
    join(engine, 'c1', { prefetch: 3, ack: 'manual' });
    send(engine, 'm1', 'm2', 'm3', 'm4', 'm5');
    expect(given(settle(engine))).toEqual({});

    const events = run(engine, { op: 'channel.close', channel: 'ch-c1' });

    expect(types(events)).toEqual(['channel.closed', 'requeued', 'requeued', 'requeued']);
    expect(events[0]).toMatchObject({ channel: 'ch-c1', reason: { kind: 'closed' }, requeued: 3 });
    expect(engine.messages('jobs').map(({ id, redelivered }) => [id, redelivered])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, false],
      [5, false],
    ]);
  });

  it('serves the other consumers with them at once, inside the command, before anything else (#18)', () => {
    const engine = jobs();
    join(engine, 'c1', { prefetch: 1, ack: 'manual' });
    join(engine, 'c2', { prefetch: 1, ack: 'manual' });
    send(engine, 'm1', 'm2');
    run(engine, ack('c2'));

    const events = run(engine, { op: 'channel.close', channel: 'ch-c1' });

    expect(types(events)).toEqual(['channel.closed', 'requeued', 'delivered']);
    expect(only(events, 'delivered')[0]).toMatchObject({ message: 1, consumer: 'c2', redelivered: true });
  });

  it('gives a consumer that was deleted nothing more, and the next messages go to the ones that are left (#18)', () => {
    const engine = jobs();
    join(engine, 'c1', { prefetch: 1, ack: 'manual' });
    join(engine, 'c2', { prefetch: 1, ack: 'manual' });
    send(engine, 'm1', 'm2', 'm3');
    run(engine, { op: 'channel.close', channel: 'ch-c1' });

    const events = send(engine, 'm4');
    runAll(engine, ack('c2'));

    expect(Object.keys(given(events))).not.toContain('c1');
    expect(given(run(engine, ack('c2', 1)))).toEqual({ c2: [3] });
    expect(engine.messages('jobs').map(({ id }) => id)).toEqual([4, 3]);
  });

  it('gives back what a consumer that was cancelled still held, and keeps the flag for as long as the message lives', () => {
    const engine = jobs();
    join(engine, 'c1', { prefetch: 2, ack: 'manual' });
    send(engine, 'm1', 'm2', 'm3');
    run(engine, { op: 'basic.cancel', consumer: 'c1' });
    run(engine, { op: 'channel.close', channel: 'ch-c1' });

    expect(engine.messages('jobs').map(({ id, redelivered }) => [id, redelivered])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
    join(engine, 'c2', { prefetch: 1, ack: 'manual' });
    run(engine, { op: 'channel.close', channel: 'ch-c2' });
    expect(engine.messages('jobs').map(({ id, redelivered }) => [id, redelivered])).toEqual([
      [1, true],
      [2, true],
      [3, false],
    ]);
  });

  it('calls back what was on its way to the channel, so that nothing arrives after it', () => {
    const engine = jobs({ publishMs: 0, brokerMs: 0, deliverMs: 100 });
    join(engine, 'c1', { ack: 'manual' });
    post(engine, 'm1');
    engine.advanceTo(0);
    expect(engine.flights()).toHaveLength(1);

    const events = run(engine, { op: 'channel.close', channel: 'ch-c1' });

    expect(types(events)).toEqual(['channel.closed', 'requeued']);
    expect(engine.flights()).toEqual([]);
    expect(settle(engine)).toEqual([]);
    expect(engine.messages('jobs')[0]).toMatchObject({ id: 1, redelivered: true, heldBy: null });
  });

  it('loses what a consumer that acknowledges by itself had received and not finished with, because the broker had forgotten it', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'auto', processingMs: 100 });
    post(engine, 'm1');
    engine.advanceTo(0);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 1, working: true });

    const events = run(engine, { op: 'channel.close', channel: 'ch-c1' });

    expect(types(events)).toEqual(['channel.closed']);
    expect(engine.view().queues['jobs']).toMatchObject({ ready: 0, unacked: 0 });
    expect(settle(engine)).toEqual([]);
  });

  it('throws for a channel that is not open, and for opening one that is', () => {
    const engine = jobs();
    join(engine, 'c1');

    expect(() => engine.dispatch({ op: 'channel.close', channel: 'nope' })).toThrow(RangeError);
    expect(() => engine.dispatch(openChannel('ch-c1'))).toThrow(RangeError);
    expect(() => engine.dispatch({ op: 'channel.set', channel: 'nope' })).toThrow(RangeError);
    expect(() => engine.dispatch(consume('nope', 'jobs', 'x'))).toThrow(RangeError);
    expect(() => engine.dispatch(consume('ch-c1', 'jobs', 'c1'))).toThrow(RangeError);
  });

  it('is refused, with the channel closed, for a consumer of a queue that is not there: the 404 of the broker', () => {
    const engine = jobs();
    run(engine, openChannel('ch'));

    const result = engine.dispatch(consume('ch', 'nope', 'c1'));

    expect(result).toMatchObject({
      ok: false,
      code: 404,
      text: "NOT_FOUND - no queue 'nope' in vhost '/'",
    });
    expect(result.ok ? [] : result.events).toMatchObject([
      { type: 'channel.closed', channel: 'ch', reason: { kind: 'refused', code: 404 }, requeued: 0 },
    ]);
    expect(engine.view().channels['ch']).toBeUndefined();
  });
});

describe('a queue that is deleted', () => {
  it('cancels its consumers, and takes what they held and what is on its way to them, so that nothing happens for it afterwards', () => {
    const engine = jobs({ publishMs: 0, brokerMs: 0, deliverMs: 100 });
    join(engine, 'c1', { prefetch: 2, ack: 'manual', processingMs: 50 });
    post(engine, 'm1', 'm2');
    engine.advanceTo(100);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 2, working: true, waiting: 1 });

    const events = run(engine, { op: 'queue.delete', name: 'jobs' });

    expect(types(events)).toEqual(['consumer.cancelled', 'queue.deleted']);
    expect(events[0]).toMatchObject({ reason: 'queue-deleted', consumer: 'c1' });
    expect(events[1]).toMatchObject({ ready: 0, unacked: 2 });
    expect(engine.view().channels['ch-c1']).toMatchObject({ waiting: 0, working: false, consumers: [] });
    expect(settle(engine)).toEqual([]);
  });

  it('lets a consumer that acknowledges by itself finish what it had been given', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'auto', processingMs: 50 });
    post(engine, 'm1');
    engine.advanceTo(0);

    run(engine, { op: 'queue.delete', name: 'jobs' });

    expect(types(settle(engine))).toEqual(['processed']);
    expect(engine.view().channels['ch-c1']?.consumed).toBe(1);
  });

  it('starts the next message of a channel that was busy with one of the queue’s, from another queue', () => {
    const engine = newEngine();
    runAll(engine, declareQueue('a'), declareQueue('b'), openChannel('ch', undefined, 100));
    runAll(engine, consume('ch', 'a', 'ca', 'manual'), consume('ch', 'b', 'cb', 'manual'));
    runAll(engine, publish('', 'a', 'a1'), publish('', 'b', 'b1'));
    engine.advanceTo(0);
    expect(engine.view().channels['ch']).toMatchObject({ working: true, waiting: 1 });

    run(engine, { op: 'queue.delete', name: 'a' });

    expect(engine.view().channels['ch']).toMatchObject({ working: true, waiting: 0 });
    expect(types(settle(engine))).toEqual(['processed', 'acked']);
    expect(only(settle(engine), 'processed')).toEqual([]);
  });
});

describe('a consumer that takes time', () => {
  const timing = { publishMs: 0, brokerMs: 0, deliverMs: 50 };
  const at = (events: readonly EngineEvent[]): string[] => events.map(({ type, at: time }) => `${type}@${time}`);

  it('handles one message at a time, in the order that they arrived, and acknowledges each when it is done', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'manual', processingMs: 100, prefetch: 5 });
    post(engine, 'm1', 'm2', 'm3');

    const events = settle(engine).filter(({ type }) => type !== 'enqueued' && type !== 'routed');

    expect(at(events)).toEqual([
      'delivered@0',
      'delivered@0',
      'delivered@0',
      'received@50',
      'received@50',
      'received@50',
      'processed@150',
      'acked@150',
      'processed@250',
      'acked@250',
      'processed@350',
      'acked@350',
    ]);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 3, consumed: 3, waiting: 0, working: false });
  });

  it('shows what is waiting while it works', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'manual', processingMs: 100, prefetch: 5 });
    post(engine, 'm1', 'm2', 'm3');

    engine.advanceTo(50);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 3, waiting: 2, working: true });
    engine.advanceTo(150);
    expect(engine.view().channels['ch-c1']).toMatchObject({ consumed: 1, waiting: 1, working: true });
  });

  it('is given the next message when it acknowledges, so that a prefetch of 1 costs the time that a message takes to arrive', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'manual', processingMs: 100, prefetch: 1 });
    post(engine, 'm1', 'm2');

    const events = settle(engine).filter(({ type }) => ['delivered', 'received', 'acked'].includes(type));

    expect(at(events)).toEqual([
      'delivered@0',
      'received@50',
      'acked@150',
      'delivered@150',
      'received@200',
      'acked@300',
    ]);
  });

  it('keeps messages in its own buffer when it acknowledges by itself, however long it takes, and finishes them in turn', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'auto', processingMs: 100, prefetch: 1 });
    post(engine, 'm1', 'm2', 'm3');

    engine.advanceTo(50);
    expect(engine.view().queues['jobs']).toMatchObject({ ready: 0, unacked: 0 });
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 3, waiting: 2, working: true });
    const events = settle(engine);

    expect(at(events.filter(({ type }) => type === 'processed'))).toEqual([
      'processed@150',
      'processed@250',
      'processed@350',
    ]);
    expect(only(events, 'acked')).toEqual([]);
    expect(engine.view().channels['ch-c1']?.consumed).toBe(3);
  });

  it('is the one handler of all its consumers: messages of two queues are handled one after the other', () => {
    const engine = newEngine(timing);
    runAll(engine, declareQueue('a'), declareQueue('b'), openChannel('ch', undefined, 100));
    runAll(engine, consume('ch', 'a', 'ca', 'manual'), consume('ch', 'b', 'cb', 'manual'));
    runAll(engine, publish('', 'a', 'a1'), publish('', 'b', 'b1'));

    const done = settle(engine).filter(({ type }) => type === 'processed');

    expect(at(done)).toEqual(['processed@150', 'processed@250']);
    expect(only(done, 'processed').map(({ consumer }) => consumer)).toEqual(['ca', 'cb']);
  });

  it('changes how long it takes for the messages that it starts after the change, and not for the one that it is on', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'manual', processingMs: 100, prefetch: 5 });
    post(engine, 'm1', 'm2');
    engine.advanceTo(60);

    run(engine, { op: 'channel.set', channel: 'ch-c1', processingMs: 10 });
    const events = settle(engine).filter(({ type }) => type === 'processed');

    expect(at(events)).toEqual(['processed@150', 'processed@160']);
  });

  it('does not handle what it is given when it takes no time by itself: it holds it until it is told, and the channel can be told to', () => {
    const engine = jobs(timing);
    join(engine, 'c1', { ack: 'manual', processingMs: null });
    post(engine, 'm1');

    expect(types(settle(engine))).toEqual(['routed', 'enqueued', 'delivered', 'received']);
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 1, consumed: 0, waiting: 0, working: false });
  });
});

describe('the counters, and what clear and reset do', () => {
  it('counts what a queue gives, what a channel receives and finishes, and zeroes them without touching a message', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual' });
    send(engine, 'm1', 'm2');
    run(engine, ack('c1'));

    expect(engine.view().queues['jobs']).toMatchObject({ enqueued: 2, delivered: 2, ready: 0, unacked: 1 });
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 2, consumed: 1 });
    expect(types(run(engine, { op: 'sim.resetCounters' }))).toEqual(['counters.reset']);
    expect(engine.view().queues['jobs']).toMatchObject({ enqueued: 0, delivered: 0, unacked: 1 });
    expect(engine.view().channels['ch-c1']).toMatchObject({ received: 0, consumed: 0 });
    expect(engine.view().published).toBe(0);
    expect(run(engine, { op: 'sim.resetCounters' })).toEqual([]);
  });

  it('takes every message out when it is cleared, wherever it is, and says from where', () => {
    const engine = jobs({ publishMs: 0, brokerMs: 50, deliverMs: 100 });
    join(engine, 'c1', { ack: 'manual', prefetch: 1 });
    join(engine, 'c2', { ack: 'manual', prefetch: 1 });
    post(engine, 'm1', 'm2', 'm3', 'm4');
    engine.advanceTo(50);
    post(engine, 'm5');
    engine.advanceTo(50);
    post(engine, 'm6');
    expect(engine.view()).toMatchObject({ travelling: 2 + 2 });

    const events = run(engine, { op: 'sim.clearMessages' });

    expect(events).toMatchObject([{ type: 'cleared', travelling: 2, ready: 2, unacked: 2, buffered: 0 }]);
    expect(engine.view()).toMatchObject({ travelling: 0 });
    expect(engine.view().queues['jobs']).toMatchObject({ ready: 0, unacked: 0 });
    expect(engine.flights()).toEqual([]);
    expect(engine.nextAt()).toBeNull();
  });

  it('counts what an automatic consumer was holding as buffered, and leaves the producers ticking', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'auto', processingMs: 500 });
    runAll(engine, {
      op: 'producer.set',
      producer: 'p',
      target: { kind: 'queue', name: 'jobs' },
      key: '',
      payload: 'x',
      headers: [],
      burst: 3,
      everyMs: 1000,
      repeat: true,
    });
    engine.advanceTo(0);

    const events = run(engine, { op: 'sim.clearMessages' });

    expect(events).toMatchObject([{ type: 'cleared', travelling: 0, ready: 0, unacked: 0, buffered: 3 }]);
    expect(engine.view().producers['p']?.repeating).toBe(true);
    expect(engine.view().channels['ch-c1']).toMatchObject({ waiting: 0, working: false });
  });

  it('serves the consumers that were waiting for room again, because there is nothing that they hold', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual', prefetch: 1 });
    send(engine, 'm1', 'm2');
    expect(engine.view().queues['jobs']).toMatchObject({ ready: 1, unacked: 1 });

    run(engine, { op: 'sim.clearMessages' });

    expect(given(send(engine, 'm3'))).toEqual({ c1: [3] });
  });

  it('says nothing when there was nothing to clear', () => {
    expect(run(jobs(), { op: 'sim.clearMessages' })).toEqual([]);
  });

  it('forgets a consumer that was cancelled and only held what was cleared', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual', prefetch: 1 });
    send(engine, 'm1');
    run(engine, { op: 'basic.cancel', consumer: 'c1' });

    run(engine, { op: 'sim.clearMessages' });

    expect(engine.view().channels['ch-c1']?.consumers).toEqual([]);
  });
});

describe('what a queue holds, as a list', () => {
  it('has the ready messages first and then the ones that consumers hold, at most the limit', () => {
    const engine = jobs();
    join(engine, 'c1', { ack: 'manual', prefetch: 2 });
    send(engine, 'm1', 'm2', 'm3', 'm4');

    expect(engine.messages('jobs').map(({ id, heldBy }) => [id, heldBy?.consumer ?? null])).toEqual([
      [3, null],
      [4, null],
      [1, 'c1'],
      [2, 'c1'],
    ]);
    expect(engine.messages('jobs', 3).map(({ id }) => id)).toEqual([3, 4, 1]);
    expect(engine.messages('jobs', 1).map(({ id }) => id)).toEqual([3]);
    expect(engine.messages('nope')).toEqual([]);
  });
});
