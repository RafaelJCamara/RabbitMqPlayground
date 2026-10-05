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

  describe('when the broker refuses a step that the scenario expects it to refuse', () => {
    const missing = {
      level: 'channel',
      code: 404,
      text: "NOT_FOUND - no exchange 'nope' in vhost 'fake-vhost'",
    } as const;
    const publishToNowhere: Step = { op: 'basic.publish', exchange: 'nope', key: 'k', body: 'm1', refused: true };

    it('records the refusal at its step, and carries on with the steps after it', async () => {
      const session = new FakeSession();
      session.refusals.set('publish m1', missing);
      session.ready['q'] = [{ body: 'm2', redelivered: false }];

      const observed = await runScenario(
        session,
        routing(
          { op: 'exchange.declare', name: 'e', type: 'fanout' },
          { op: 'queue.declare', name: 'q' },
          { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'q' } },
          publishToNowhere,
          { op: 'basic.publish', exchange: 'e', body: 'm2' },
        ),
      );

      expect(observed).toEqual({
        routes: [{ body: 'm2', returned: false, queues: ['q'] }],
        refusals: [{ step: 4, level: 'channel', code: 404, text: "NOT_FOUND - no exchange 'nope' in vhost '/'" }],
      });
      expect(session.calls.slice(-5)).toEqual(['publish m1', 'settle', 'publish m2', 'settle', 'drain q']);
    });

    it('writes the vhost as "/", wherever the broker names it, so a recording does not depend on the vhost it ran in', async () => {
      const session = new FakeSession();
      session.refusals.set('publish m1', {
        level: 'channel',
        code: 404,
        text: "NOT_FOUND - in vhost 'fake-vhost' and again in vhost 'fake-vhost', but not in fake-vhost-2",
      });

      const observed = await runScenario(session, routing(publishToNowhere));

      expect(observed).toMatchObject({
        refusals: [{ text: "NOT_FOUND - in vhost '/' and again in vhost '/', but not in fake-vhost-2" }],
      });
    });

    it('records the level, so a refusal that closes the connection is told apart from one that closes a channel', async () => {
      const session = new FakeSession();
      session.refusals.set('queue.declare q', { level: 'connection', code: 541, text: 'INTERNAL_ERROR - gone' });

      const observed = await runScenario(
        session,
        routing({ op: 'queue.declare', name: 'q', durable: false, refused: true }),
      );

      expect(observed).toEqual({
        routes: [],
        refusals: [{ step: 1, level: 'connection', code: 541, text: 'INTERNAL_ERROR - gone' }],
      });
    });

    it('lists every refusal, in the order of the steps', async () => {
      const session = new FakeSession();
      session.refusals.set('publish m1', missing);
      session.refusals.set('publish m2', { ...missing, code: 403 });

      const observed = await runScenario(session, routing(publishToNowhere, { ...publishToNowhere, body: 'm2' }));

      expect(observed).toMatchObject({
        refusals: [
          { step: 1, code: 404 },
          { step: 2, code: 403 },
        ],
      });
    });

    it('does not count what a refused declaration names, so the queue is not drained and no route lists it', async () => {
      const session = new FakeSession();
      session.refusals.set('queue.declare amq.mine', {
        level: 'channel',
        code: 403,
        text: 'ACCESS_REFUSED - reserved',
      });

      await runScenario(session, routing({ op: 'queue.declare', name: 'amq.mine', durable: true, refused: true }));

      expect(session.calls).toEqual(['queue.declare amq.mine', 'settle']);
    });

    it('leaves the key out of the observation when nothing was refused', async () => {
      const observed = await runScenario(new FakeSession(), routing({ op: 'queue.declare', name: 'q' }));

      expect('refusals' in observed).toBe(false);
    });
  });

  describe('when the broker and the scenario disagree about a refusal', () => {
    it('fails, naming the step and what the broker said, when it refuses a step that was not marked', async () => {
      const session = new FakeSession();
      session.refusals.set('bind e q', {
        level: 'channel',
        code: 403,
        text: 'ACCESS_REFUSED - operation not permitted on the default exchange',
      });

      await expect(
        runScenario(
          session,
          routing(
            { op: 'exchange.declare', name: 'e', type: 'direct' },
            { op: 'queue.declare', name: 'q' },
            { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'q' } },
          ),
        ),
      ).rejects.toThrow(
        /step 3 \(bind\): the broker refused it with 403 ACCESS_REFUSED - operation not permitted on the default exchange.*mark the step as refused/s,
      );
    });

    it('fails, naming the step, when the broker accepts a step that was marked as refused', async () => {
      await expect(
        runScenario(
          new FakeSession(),
          routing({ op: 'basic.publish', exchange: '', key: 'q', body: 'm1', refused: true }),
        ),
      ).rejects.toThrow(/step 1 \(basic\.publish\): marked as refused, but the broker accepted it/);
    });

    it('does not take another kind of error for a refusal', async () => {
      const session = new FakeSession();
      session.failOn = 'publish';

      await expect(
        runScenario(session, routing({ op: 'basic.publish', exchange: '', key: 'q', body: 'm1', refused: true })),
      ).rejects.toThrow('scripted failure on publish m1');
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
