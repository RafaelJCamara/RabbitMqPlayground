import { describe, expect, it } from 'vitest';
import { runScenario } from './executor';
import { FakeSession } from './fake-session';
import { ScenarioError, type Scenario, type Step } from './scenario';

const delivery = (...steps: Step[]): Scenario => ({ id: 'delivery/x', kind: 'delivery', title: 'x', steps });
const routing = (...steps: Step[]): Scenario => ({ id: 'routing/x', kind: 'routing', title: 'x', steps });
const publish = (body: string): Step => ({ op: 'basic.publish', exchange: '', key: 'q', body });

describe('runScenario', () => {
  it('plays the steps in order and settles the broker after every one of them', async () => {
    const session = new FakeSession();

    await runScenario(
      session,
      delivery(
        { op: 'queue.declare', name: 'q' },
        { op: 'channel.open', channel: 'ch', prefetch: 1 },
        { op: 'basic.consume', channel: 'ch', queue: 'q', consumer: 'c', ack: 'manual' },
        publish('m1'),
        { op: 'await.deliveries', count: 1 },
        { op: 'basic.ack', consumer: 'c' },
        { op: 'basic.cancel', consumer: 'c' },
        { op: 'channel.close', channel: 'ch' },
      ),
    );

    expect(session.calls).toEqual([
      'queue.declare q',
      'settle',
      'channel.open ch',
      'settle',
      'consume c',
      'settle',
      'publish m1',
      'settle',
      'await 1',
      'settle',
      'ack c (oldest)',
      'settle',
      'cancel c',
      'settle',
      'channel.close ch',
      'settle',
      'drain q',
    ]);
  });

  it('declares and binds exchanges, and passes an ack for a named message through', async () => {
    const session = new FakeSession();

    await runScenario(
      session,
      delivery(
        { op: 'exchange.declare', name: 'e', type: 'fanout' },
        { op: 'queue.declare', name: 'q' },
        { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'q' } },
        { op: 'channel.open', channel: 'ch' },
        { op: 'basic.consume', channel: 'ch', queue: 'q', consumer: 'c', ack: 'manual' },
        { op: 'basic.ack', consumer: 'c', body: 'm9' },
      ),
    );

    expect(session.calls.filter((call) => call !== 'settle')).toEqual([
      'exchange.declare e',
      'queue.declare q',
      'bind e q',
      'channel.open ch',
      'consume c',
      'ack c m9',
      'drain q',
    ]);
  });

  it('drains every declared queue once, after the last step, in the order they were declared', async () => {
    const session = new FakeSession();

    await runScenario(
      session,
      routing(
        { op: 'queue.declare', name: 'b' },
        { op: 'queue.declare', name: 'a' },
        { op: 'basic.publish', exchange: '', key: 'a', body: 'm1' },
      ),
    );

    expect(session.calls.slice(-3)).toEqual(['settle', 'drain b', 'drain a']);
  });

  describe('for a routing scenario', () => {
    it('lists, for each publish, whether it came back and which queues hold it', async () => {
      const session = new FakeSession();
      session.returned.add('m3');
      session.ready['first'] = [
        { body: 'm1', redelivered: false },
        { body: 'm2', redelivered: false },
      ];
      session.ready['second'] = [{ body: 'm2', redelivered: false }];

      const observed = await runScenario(
        session,
        routing(
          { op: 'queue.declare', name: 'first' },
          { op: 'queue.declare', name: 'second' },
          publish('m1'),
          publish('m2'),
          publish('m3'),
        ),
      );

      expect(observed).toEqual({
        routes: [
          { body: 'm1', returned: false, queues: ['first'] },
          { body: 'm2', returned: false, queues: ['first', 'second'] },
          { body: 'm3', returned: true, queues: [] },
        ],
      });
    });

    it('lists a queue twice when it holds two copies, so a duplicate cannot hide', async () => {
      const session = new FakeSession();
      session.ready['q'] = [
        { body: 'm1', redelivered: false },
        { body: 'm1', redelivered: false },
      ];

      const observed = await runScenario(session, routing({ op: 'queue.declare', name: 'q' }, publish('m1')));

      expect(observed).toEqual({ routes: [{ body: 'm1', returned: false, queues: ['q', 'q'] }] });
    });
  });

  describe('for a delivery scenario', () => {
    const setup: Step[] = [
      { op: 'queue.declare', name: 'q' },
      { op: 'channel.open', channel: 'ch1' },
      { op: 'channel.open', channel: 'ch2' },
      { op: 'basic.consume', channel: 'ch1', queue: 'q', consumer: 'c1', ack: 'auto' },
      { op: 'basic.consume', channel: 'ch2', queue: 'q', consumer: 'c2', ack: 'auto' },
    ];

    it('reports what each consumer received, and what was left ready', async () => {
      const session = new FakeSession();
      session.received.set('c1', [{ body: 'm1', redelivered: false }]);
      session.received.set('c2', [{ body: 'm2', redelivered: true }]);
      session.ready['q'] = [{ body: 'm3', redelivered: false }];

      const observed = await runScenario(session, delivery(...setup, publish('m1')));

      expect(observed).toEqual({
        deliveries: {
          c1: [{ body: 'm1', redelivered: false }],
          c2: [{ body: 'm2', redelivered: true }],
        },
        ready: { q: [{ body: 'm3', redelivered: false }] },
      });
    });

    it('lists a consumer that received nothing, with an empty list, so "nothing" is a recorded fact', async () => {
      const session = new FakeSession();
      session.received.set('c1', [{ body: 'm1', redelivered: false }]);

      const observed = await runScenario(session, delivery(...setup, publish('m1')));

      expect(observed).toMatchObject({ deliveries: { c1: [{ body: 'm1', redelivered: false }], c2: [] } });
      expect(Object.keys((observed as { deliveries: object }).deliveries)).toEqual(['c1', 'c2']);
    });
  });

  describe('when something is wrong', () => {
    it('refuses an invalid scenario before it touches the broker', async () => {
      const session = new FakeSession();

      await expect(runScenario(session, delivery({ op: 'basic.cancel', consumer: 'nobody' }))).rejects.toBeInstanceOf(
        ScenarioError,
      );
      expect(session.calls).toEqual([]);
    });

    it('stops at the step that failed, and does not drain', async () => {
      const session = new FakeSession();
      session.failOn = 'await';

      await expect(
        runScenario(session, delivery({ op: 'queue.declare', name: 'q' }, { op: 'await.deliveries', count: 3 })),
      ).rejects.toThrow('scripted failure on await 3');
      expect(session.calls).toEqual(['queue.declare q', 'settle', 'await 3']);
    });
  });
});
