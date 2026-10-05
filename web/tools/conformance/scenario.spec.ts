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

describe('validateScenario, for a step that the broker is expected to refuse', () => {
  const refused = <S extends Step>(step: S): S => ({ ...step, refused: true });
  const bindTo = (source: string, destination: { kind: 'queue' | 'exchange'; name: string }): Step => ({
    op: 'bind',
    source,
    destination,
  });

  it.each<[string, Scenario]>([
    [
      'declaring a reserved exchange name',
      routing(refused({ op: 'exchange.declare', name: 'amq.custom', type: 'direct' })),
    ],
    [
      'declaring an exchange with the empty name',
      routing(refused({ op: 'exchange.declare', name: '', type: 'direct' })),
    ],
    [
      'declaring an exchange that exists with other properties',
      routing(exchange, refused({ op: 'exchange.declare', name: 'e', type: 'topic' })),
    ],
    ['declaring a reserved queue name', routing(refused({ op: 'queue.declare', name: 'amq.custom', durable: true }))],
    [
      'declaring a queue that is neither durable nor exclusive',
      routing(refused({ op: 'queue.declare', name: 'q', durable: false })),
    ],
    ['binding from the default exchange', routing(queue, refused(bindTo('', { kind: 'queue', name: 'q' })))],
    ['binding to the default exchange', routing(exchange, refused(bindTo('e', { kind: 'exchange', name: '' })))],
    [
      'binding from an exchange that does not exist',
      routing(queue, refused(bindTo('nope', { kind: 'queue', name: 'q' }))),
    ],
    [
      'binding to a queue that does not exist',
      routing(exchange, refused(bindTo('e', { kind: 'queue', name: 'nope' }))),
    ],
    [
      'binding to an exchange that does not exist',
      routing(exchange, refused(bindTo('e', { kind: 'exchange', name: 'nope' }))),
    ],
    [
      'publishing to an exchange that does not exist',
      routing(refused({ op: 'basic.publish', exchange: 'nope', body: 'm1' })),
    ],
  ])('accepts %s', (_name, scenario) => {
    expect(() => validateScenario(scenario)).not.toThrow();
  });

  it('does not count what a refused step names as declared, because the broker did not create it', () => {
    expect(() =>
      validateScenario(
        routing(refused({ op: 'exchange.declare', name: 'amq.custom', type: 'direct' }), {
          op: 'basic.publish',
          exchange: 'amq.custom',
          body: 'm1',
        }),
      ),
    ).toThrow(/exchange "amq\.custom" is not declared/);
    expect(() =>
      validateScenario(
        routing(
          exchange,
          refused({ op: 'queue.declare', name: 'q', durable: false }),
          bindTo('e', { kind: 'queue', name: 'q' }),
        ),
      ),
    ).toThrow(/destination queue "q" is not declared/);
  });

  it('lets a body be used again after a publish that was refused, because only an accepted publish is observed', () => {
    expect(() =>
      validateScenario(
        routing(exchange, refused({ op: 'basic.publish', exchange: 'nope', body: 'm1' }), {
          op: 'basic.publish',
          exchange: 'e',
          body: 'm1',
        }),
      ),
    ).not.toThrow();
  });

  it('keeps what was declared before a refused step, because the broker kept it too', () => {
    expect(() => validateScenario(routing(exchange, refused(exchange), exchange))).toThrow(/declared twice/);
  });

  it.each<[string, Scenario, RegExp]>([
    [
      'a delivery scenario',
      delivery(refused({ op: 'queue.declare', name: 'q', durable: false })),
      /a delivery scenario cannot expect a refusal/,
    ],
    [
      'a step that is not one of the four the broker can refuse here',
      routing(queue, { op: 'channel.open', channel: 'ch', refused: true } as unknown as Step),
      /routing scenario cannot use channel\.open/,
    ],
    [
      'a refused flag on a delivery step',
      delivery({ op: 'channel.open', channel: 'ch', refused: true } as unknown as Step),
      /channel\.open cannot be marked as refused/,
    ],
    [
      'a refused flag that is not true',
      routing({ ...exchange, refused: false } as unknown as Step),
      /"refused" can only be true/,
    ],
  ])('rejects %s', (_name, scenario, message) => {
    expect(() => validateScenario(scenario)).toThrow(ScenarioError);
    expect(() => validateScenario(scenario)).toThrow(message);
  });
});

describe('validateScenario, for the queues and names that RabbitMQ 4.3 does not accept', () => {
  it('rejects a queue that is neither durable nor exclusive, unless the step is expected to be refused', () => {
    expect(() => validateScenario(routing({ op: 'queue.declare', name: 'q', durable: false }))).toThrow(
      /neither durable nor exclusive/,
    );
  });

  it('accepts a queue that is not durable but is exclusive', () => {
    expect(() =>
      validateScenario(routing({ op: 'queue.declare', name: 'q', durable: false, exclusive: true })),
    ).not.toThrow();
  });

  it('rejects a publish to an internal exchange, unless the step is expected to be refused', () => {
    const internal: Step = { op: 'exchange.declare', name: 'hidden', type: 'fanout', internal: true };

    expect(() => validateScenario(routing(internal, { op: 'basic.publish', exchange: 'hidden', body: 'm1' }))).toThrow(
      /exchange "hidden" is internal/,
    );
    expect(() =>
      validateScenario(routing(internal, { op: 'basic.publish', exchange: 'hidden', body: 'm1', refused: true })),
    ).not.toThrow();
  });

  it('accepts a binding to an internal exchange, and a publish to an exchange that merely sounds internal', () => {
    const internal: Step = { op: 'exchange.declare', name: 'hidden', type: 'fanout', internal: true };

    expect(() =>
      validateScenario(
        routing(
          exchange,
          internal,
          { op: 'bind', source: 'e', destination: { kind: 'exchange', name: 'hidden' } },
          { op: 'basic.publish', exchange: 'e', body: 'm1' },
        ),
      ),
    ).not.toThrow();
    expect(() =>
      validateScenario(
        routing(
          { op: 'exchange.declare', name: 'hidden', type: 'fanout', internal: false },
          { op: 'basic.publish', exchange: 'hidden', body: 'm1' },
        ),
      ),
    ).not.toThrow();
  });

  it('rejects a binding to the default exchange, unless the step is expected to be refused', () => {
    const toDefault: Step = { op: 'bind', source: 'e', destination: { kind: 'exchange', name: '' } };

    expect(() => validateScenario(routing(exchange, toDefault))).toThrow(
      /default exchange cannot be the destination of a binding/,
    );
    expect(() => validateScenario(routing(exchange, { ...toDefault, refused: true }))).not.toThrow();
  });

  it('rejects a queue name that starts with amq., unless the step is expected to be refused', () => {
    expect(() => validateScenario(routing({ op: 'queue.declare', name: 'amq.mine', durable: true }))).toThrow(
      /not a name a client may declare/,
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
