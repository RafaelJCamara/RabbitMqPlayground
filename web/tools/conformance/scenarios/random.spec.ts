import { describe, expect, it } from 'vitest';
import { validateScenario, type Scenario, type Step } from '../scenario';
import { RANDOM_SCENARIOS, RANDOM_TOPOLOGY_COUNT, randomTopologyScenario } from './random';

const stepsOf = <Op extends Step['op']>(scenario: Scenario, op: Op) =>
  scenario.steps.filter((step): step is Extract<Step, { op: Op }> => step.op === op);

const allSteps = RANDOM_SCENARIOS.flatMap((scenario) => scenario.steps);
const binds = allSteps.filter((step): step is Extract<Step, { op: 'bind' }> => step.op === 'bind');
const publishes = allSteps.filter(
  (step): step is Extract<Step, { op: 'basic.publish' }> => step.op === 'basic.publish',
);
const exchanges = allSteps.filter(
  (step): step is Extract<Step, { op: 'exchange.declare' }> => step.op === 'exchange.declare',
);

describe('randomTopologyScenario', () => {
  it('makes the same scenario from the same seed, every time, because a fixture is checked against it', () => {
    expect(randomTopologyScenario(7)).toEqual(randomTopologyScenario(7));
    expect(JSON.stringify(randomTopologyScenario(7))).toBe(JSON.stringify(randomTopologyScenario(7)));
  });

  it('makes a different scenario from a different seed', () => {
    const steps = new Set(
      Array.from({ length: 20 }, (_, index) => JSON.stringify(randomTopologyScenario(index + 1).steps)),
    );

    expect(steps.size).toBe(20);
  });

  it('names the scenario and its title after the seed, so that no two are alike', () => {
    expect(randomTopologyScenario(12).id).toBe('routing/random-topology-12');
    expect(randomTopologyScenario(12).title).toContain('seed 12');
  });

  describe('for any seed, not only the recorded ones', () => {
    const seeds = Array.from({ length: 500 }, (_, index) => index + 1);

    it('makes a scenario that is well formed, with something to publish to', () => {
      for (const seed of seeds) {
        const scenario = randomTopologyScenario(seed);
        expect(() => validateScenario(scenario), `seed ${seed}`).not.toThrow();
        expect(stepsOf(scenario, 'basic.publish').length, `seed ${seed}`).toBeGreaterThanOrEqual(6);
      }
    });

    it('never gives a topic binding key more than two # words, which the broker refuses (ADR-0022)', () => {
      for (const seed of seeds) {
        const scenario = randomTopologyScenario(seed);
        const topics = new Set(
          stepsOf(scenario, 'exchange.declare')
            .filter((step) => step.type === 'topic')
            .map((step) => step.name),
        );
        for (const step of stepsOf(scenario, 'bind').filter((bind) => topics.has(bind.source))) {
          const hashes = (step.key ?? '').split('.').filter((word) => word === '#').length;
          expect(hashes, `seed ${seed}: ${step.key}`).toBeLessThanOrEqual(2);
        }
      }
    });

    it('never publishes to an internal exchange, and always leaves one exchange that is not internal', () => {
      for (const seed of seeds) {
        const scenario = randomTopologyScenario(seed);
        const declared = stepsOf(scenario, 'exchange.declare');
        const internal = new Set(declared.filter((step) => step.internal === true).map((step) => step.name));
        expect(internal.size, `seed ${seed}`).toBeLessThan(declared.length);
        for (const step of stepsOf(scenario, 'basic.publish')) {
          expect(internal.has(step.exchange), `seed ${seed}: ${step.body}`).toBe(false);
        }
      }
    });

    it('never binds the same thing twice', () => {
      for (const seed of seeds) {
        const bindings = stepsOf(randomTopologyScenario(seed), 'bind').map((step) => JSON.stringify(step));
        expect(new Set(bindings).size, `seed ${seed}`).toBe(bindings.length);
      }
    });
  });
});

describe('the recorded random topologies', () => {
  it('are the first RANDOM_TOPOLOGY_COUNT seeds, in order', () => {
    expect(RANDOM_SCENARIOS.map((scenario) => scenario.id)).toEqual(
      Array.from({ length: RANDOM_TOPOLOGY_COUNT }, (_, index) => `routing/random-topology-${index + 1}`),
    );
  });

  it('use every type of exchange, and an exchange that is internal', () => {
    expect(new Set(exchanges.map((step) => step.type))).toEqual(new Set(['direct', 'fanout', 'topic', 'headers']));
    expect(exchanges.some((step) => step.internal === true)).toBe(true);
  });

  it('bind exchanges to exchanges, including one to itself and a cycle, because those are where routing goes wrong', () => {
    const toExchanges = RANDOM_SCENARIOS.map((scenario) =>
      stepsOf(scenario, 'bind').filter((step) => step.destination.kind === 'exchange'),
    );

    expect(toExchanges.flat().length).toBeGreaterThan(0);
    expect(toExchanges.flat().some((step) => step.destination.name === step.source)).toBe(true);
    expect(
      toExchanges.some((edges) =>
        edges.some((first) =>
          edges.some(
            (second) =>
              first.destination.name === second.source &&
              second.destination.name === first.source &&
              first.source !== second.source,
          ),
        ),
      ),
    ).toBe(true);
  });

  it('use every x-match mode, an omitted one, and an exists condition', () => {
    const headers = binds.flatMap((step) => (step.headers ? [step.headers] : []));

    expect(new Set(headers.map((entry) => entry.xMatch))).toEqual(
      new Set([null, 'all', 'any', 'all-with-x', 'any-with-x']),
    );
    expect(headers.some((entry) => entry.args.some((arg) => arg.value.t === 'exists'))).toBe(true);
  });

  it('publish with headers of every type, with none at all, and with an empty table', () => {
    const types = new Set(publishes.flatMap((step) => step.headers?.map((header) => header.value.t) ?? []));

    expect(types).toEqual(new Set(['integer', 'float', 'string', 'boolean']));
    // The default exchange never takes headers, so only a message to a real exchange tells.
    expect(publishes.some((step) => step.exchange !== '' && step.headers === undefined)).toBe(true);
    expect(publishes.some((step) => step.headers?.length === 0)).toBe(true);
  });

  it('publish to the default exchange, to a queue that exists and to one that does not', () => {
    const toDefault = publishes.filter((step) => step.exchange === '');

    expect(toDefault.length).toBeGreaterThan(0);
    expect(toDefault.some((step) => step.key === 'nobody')).toBe(true);
    expect(toDefault.some((step) => step.key !== 'nobody')).toBe(true);
  });
});
