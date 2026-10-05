import { describe, expect, it } from 'vitest';
import { ScenarioError, validateScenario, type Scenario, type Step } from './scenario';
import { SCENARIOS } from './scenarios';

const routing = (...steps: Step[]): Scenario => ({ id: 'routing/x', kind: 'routing', title: 'x', steps });
const delivery = (...steps: Step[]): Scenario => ({ id: 'delivery/x', kind: 'delivery', title: 'x', steps });

const exchange: Step = { op: 'exchange.declare', name: 'e', type: 'direct' };
const queue: Step = { op: 'queue.declare', name: 'q' };
const channel: Step = { op: 'channel.open', channel: 'ch' };
const consume: Step = { op: 'basic.consume', channel: 'ch', queue: 'q', consumer: 'c', ack: 'auto' };

describe('validateScenario', () => {
  it('accepts a well-formed routing scenario and a well-formed delivery scenario', () => {
    expect(() =>
      validateScenario(
        routing(
          exchange,
          queue,
          { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'q' }, key: 'k' },
          {
            op: 'basic.publish',
            exchange: 'e',
            key: 'k',
            body: 'm1',
          },
        ),
      ),
    ).not.toThrow();
    expect(() =>
      validateScenario(
        delivery(
          queue,
          channel,
          consume,
          { op: 'basic.publish', exchange: '', key: 'q', body: 'm1' },
          { op: 'await.deliveries', count: 1 },
        ),
      ),
    ).not.toThrow();
  });

  it.each<[string, Scenario, RegExp]>([
    ['an id that does not match its kind', { ...routing(exchange), id: 'delivery/x' }, /id must be "routing\//],
    ['an id with upper case or spaces', { ...routing(exchange), id: 'routing/Bad Name' }, /id must be/],
    ['no title', { ...routing(exchange), title: '  ' }, /needs a title/],
    ['no steps', routing(), /no steps/],
    [
      'declaring a reserved amq. exchange',
      routing({ op: 'exchange.declare', name: 'amq.direct', type: 'direct' }),
      /not a name a client may declare/,
    ],
    [
      'declaring the default exchange',
      routing({ op: 'exchange.declare', name: '', type: 'direct' }),
      /not a name a client may declare/,
    ],
    ['declaring an exchange twice', routing(exchange, exchange), /declared twice/],
    ['declaring a queue twice', routing(queue, queue), /empty or declared twice/],
    [
      'binding from an undeclared exchange',
      routing(queue, { op: 'bind', source: 'nope', destination: { kind: 'queue', name: 'q' } }),
      /source exchange "nope" is not declared/,
    ],
    [
      'binding from the default exchange',
      routing(queue, { op: 'bind', source: '', destination: { kind: 'queue', name: 'q' } }),
      /source exchange "" is not declared/,
    ],
    [
      'binding to an undeclared queue',
      routing(exchange, { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'nope' } }),
      /destination queue "nope"/,
    ],
    [
      'binding to an undeclared exchange',
      routing(exchange, { op: 'bind', source: 'e', destination: { kind: 'exchange', name: 'nope' } }),
      /destination exchange "nope"/,
    ],
    [
      'publishing to an undeclared exchange',
      routing({ op: 'basic.publish', exchange: 'nope', body: 'm1' }),
      /exchange "nope" is not declared/,
    ],
    [
      'using a body twice',
      routing(
        exchange,
        { op: 'basic.publish', exchange: 'e', body: 'm1' },
        { op: 'basic.publish', exchange: 'e', body: 'm1' },
      ),
      /body "m1" is used twice/,
    ],
    [
      'a consumer step in a routing scenario',
      routing(queue, channel, consume),
      /routing scenario cannot use channel\.open/,
    ],
    ['opening a channel twice', delivery(channel, channel), /opened twice/],
    ['consuming on a channel that is not open', delivery(queue, consume), /channel "ch" is not open/],
    [
      'consuming on a closed channel',
      delivery(queue, channel, { op: 'channel.close', channel: 'ch' }, consume),
      /channel "ch" is not open/,
    ],
    ['consuming from an undeclared queue', delivery(channel, consume), /queue "q" is not declared/],
    [
      'using a consumer name twice',
      delivery(queue, channel, consume, { ...consume, queue: 'q' }),
      /consumer "c" is used twice/,
    ],
    [
      'cancelling a consumer that does not exist',
      delivery({ op: 'basic.cancel', consumer: 'c' }),
      /consumer "c" does not exist/,
    ],
    [
      'acknowledging for a consumer that does not exist',
      delivery({ op: 'basic.ack', consumer: 'c' }),
      /consumer "c" does not exist/,
    ],
    [
      'closing a channel that is not open',
      delivery({ op: 'channel.close', channel: 'ch' }),
      /channel "ch" is not open/,
    ],
    [
      'closing a channel twice',
      delivery(channel, { op: 'channel.close', channel: 'ch' }, { op: 'channel.close', channel: 'ch' }),
      /not open/,
    ],
    ['waiting for no deliveries', delivery({ op: 'await.deliveries', count: 0 }), /positive whole number/],
    ['waiting for a fraction of a delivery', delivery({ op: 'await.deliveries', count: 1.5 }), /positive whole number/],
  ])('rejects %s', (_name, scenario, message) => {
    expect(() => validateScenario(scenario)).toThrow(ScenarioError);
    expect(() => validateScenario(scenario)).toThrow(message);
  });

  it('names the scenario and the step in its message', () => {
    expect(() => validateScenario({ ...routing(exchange, exchange), id: 'routing/twice' })).toThrow(
      'Scenario routing/twice: step 2 (exchange.declare): exchange "e" is declared twice',
    );
  });
});

describe('the seed scenarios', () => {
  it('are all well formed', () => {
    for (const scenario of SCENARIOS) {
      expect(() => validateScenario(scenario), scenario.id).not.toThrow();
    }
  });

  it('have distinct ids and distinct titles', () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.id)).size).toBe(SCENARIOS.length);
    expect(new Set(SCENARIOS.map((scenario) => scenario.title)).size).toBe(SCENARIOS.length);
  });

  it('include a regression case for each of the original simulator bugs the plan names, #10 and #18', () => {
    const origin = (issue: number) => SCENARIOS.find((scenario) => scenario.origin?.endsWith(`#${issue}`));

    expect(origin(10)?.id).toBe('delivery/issue-10-a-message-goes-to-one-consumer-only');
    expect(origin(18)?.id).toBe('delivery/issue-18-a-removed-consumer-gets-nothing-more');
  });

  it('cover both kinds, and every exchange type', () => {
    expect(new Set(SCENARIOS.map((scenario) => scenario.kind))).toEqual(new Set(['routing', 'delivery']));
    const types = SCENARIOS.flatMap((scenario) => scenario.steps)
      .filter((step): step is Extract<Step, { op: 'exchange.declare' }> => step.op === 'exchange.declare')
      .map((step) => step.type);
    expect(new Set(types)).toEqual(new Set(['direct', 'fanout', 'topic', 'headers']));
  });

  it('send typed headers, including a float, an exists condition and a 64-bit integer', () => {
    const text = JSON.stringify(SCENARIOS.filter((scenario) => scenario.id.includes('headers')));

    expect(text).toContain('"t":"float"');
    expect(text).toContain('"t":"exists"');
    expect(text).toContain('"width":64');
  });
});
