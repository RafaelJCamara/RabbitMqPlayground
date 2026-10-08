import { fileURLToPath } from 'node:url';
import { toTopology } from '@rmq/domain';
import {
  route,
  RABBITMQ_BASELINE,
  type Binding,
  type Exchange,
  type HeaderCondition,
  type HeaderEntry,
  type HeaderValue,
  type Topology,
  type XMatch,
} from '@rmq/engine';
import { asEntries, asValue, canonicalTopology } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { alreadyDeclared, canvasOf, exportFixture, exportVhostFor, observeExported, whyNotExportable } from './export';
import { FakeBroker, FakeSession } from './fake-session';
import { readFixtureSet, type Fixture } from './fixtures';
import type { Step } from './scenario';
import type { RoutingObserved } from './session';

/**
 * The export, held to what RabbitMQ 4.3 did (ADR-0079, ADR-0015). The Nightly imports the file that the app writes for each routing scenario into a live broker and plays the publishes. This is the same question asked of the fixtures, with no
 * broker: the file is read back (a number that is written `1.0` is a float and one that is written `1` is an integer, as the broker reads them) into the topology it describes, and the recorded publishes are routed through it by the engine's
 * `route()`. A file that routes as the broker did, for every scenario that a file can say, is a file that says what the canvas says.
 */

const fixturesRoot = fileURLToPath(new URL('../../fixtures/conformance', import.meta.url));
const { fixtures } = readFixtureSet(fixturesRoot, RABBITMQ_BASELINE);

const routing = fixtures.filter(({ kind }) => kind === 'routing');
const exportable = routing.filter((fixture) => whyNotExportable(fixture) === null);

/** The file read the way a broker reads it: a number with a point or an exponent is a float, and one without is an integer. */
function topologyOf(text: string): Topology {
  const typed = JSON.parse(text, ((_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number'
      ? { t: /[.eE]/.test(context?.source ?? '') ? 'float' : 'integer', v: value }
      : value) as never) as {
    vhosts: { name: string }[];
    exchanges: { name: string; type: Exchange['type']; internal: boolean }[];
    queues: { name: string }[];
    bindings: {
      source: string;
      destination: string;
      destination_type: 'queue' | 'exchange';
      routing_key: string;
      arguments: Record<string, unknown>;
    }[];
  };
  const conditionOf = (value: unknown): HeaderCondition =>
    typeof value === 'string'
      ? { t: 'string', v: value }
      : typeof value === 'boolean'
        ? { t: 'boolean', v: value }
        : (value as HeaderCondition);
  return {
    vhost: typed.vhosts[0]?.name ?? '',
    exchanges: typed.exchanges.map(({ name, type, internal }) => ({ name, type, internal })),
    queues: typed.queues.map(({ name }) => name),
    bindings: typed.bindings.map((binding): Binding => {
      const { 'x-match': mode, ...conditions } = binding.arguments;
      const args = Object.entries(conditions).map(([key, value]) => ({ key, value: conditionOf(value) }));
      return {
        source: binding.source,
        destination: { kind: binding.destination_type, name: binding.destination },
        key: binding.routing_key,
        ...(mode === undefined && args.length === 0
          ? {}
          : { headers: { xMatch: (mode as XMatch | undefined) ?? null, args } }),
      };
    }),
  };
}

const publishes = (fixture: Fixture) =>
  fixture.steps.filter((step): step is Extract<Step, { op: 'basic.publish' }> => step.op === 'basic.publish');

describe('the routing scenarios that a definitions file can say', () => {
  it('are most of them, and the rest are listed with the reason they are not', () => {
    const reasons = new Map<string, number>();
    for (const fixture of routing) {
      const why = whyNotExportable(fixture);
      if (why !== null) {
        reasons.set(why, (reasons.get(why) ?? 0) + 1);
      }
    }

    expect(routing.length).toBeGreaterThan(50);
    expect(exportable.length).toBeGreaterThan(30);
    expect(exportable.length + [...reasons.values()].reduce((sum, count) => sum + count, 0)).toBe(routing.length);
    for (const reason of reasons.keys()) {
      expect(reason.length, reason).toBeGreaterThan(20);
    }
  });

  it('are not delivery scenarios, which are about consumers', () => {
    const delivery = fixtures.find(({ kind }) => kind === 'delivery');

    expect(delivery).toBeDefined();
    expect(whyNotExportable(delivery!)).toMatch(/delivery scenario/);
  });

  it.each([
    ['unbinds', 'unbind', /unbind step/],
    ['refused', 'refused', /refused/],
    ['an exclusive queue', 'exclusive', /exclusive queue/],
    ['binds on exists', 'exists', /header that has to exist/],
    ['changes the topology between publishes', 'between', /between its publishes/],
    ['declares after it publishes', 'publishes first', /between its publishes/],
    ['opens a channel to consume', 'consume', /channel\.open step/],
  ])('say why a scenario that %s is not one', (_what, which, pattern) => {
    const base = { kind: 'routing' as const, title: 't', observed: { routes: [] } };
    const declare: Step[] = [
      { op: 'exchange.declare', name: 'x', type: 'direct' },
      { op: 'queue.declare', name: 'q' },
    ];
    const steps: Record<string, Step[]> = {
      unbind: [...declare, { op: 'unbind', source: 'x', destination: { kind: 'queue', name: 'q' } }],
      refused: [...declare, { op: 'bind', source: 'x', destination: { kind: 'queue', name: 'nope' }, refused: true }],
      exclusive: [{ op: 'queue.declare', name: 'q', exclusive: true }],
      exists: [
        { op: 'exchange.declare', name: 'x', type: 'headers' },
        { op: 'queue.declare', name: 'q' },
        {
          op: 'bind',
          source: 'x',
          destination: { kind: 'queue', name: 'q' },
          headers: { xMatch: null, args: [{ key: 'k', value: { t: 'exists' } }] },
        },
      ],
      between: [...declare, { op: 'basic.publish', exchange: 'x', body: 'a' }, { op: 'queue.declare', name: 'r' }],
      'publishes first': [{ op: 'basic.publish', exchange: 'x', body: 'a' }, ...declare],
      consume: [
        ...declare,
        { op: 'channel.open', channel: 'c' },
        { op: 'basic.consume', channel: 'c', queue: 'q', consumer: 't', ack: 'auto' },
      ],
    };

    expect(whyNotExportable({ id: 'routing/x', ...base, steps: steps[which]! })).toMatch(pattern);
  });

  it('are exported for a scenario that only declares, binds and publishes, and for one that publishes first and nothing after', () => {
    const fixture: Fixture = {
      id: 'routing/x',
      kind: 'routing',
      title: 't',
      observed: { routes: [] },
      steps: [
        { op: 'exchange.declare', name: 'x', type: 'direct' },
        { op: 'queue.declare', name: 'q' },
        { op: 'bind', source: 'x', destination: { kind: 'queue', name: 'q' }, key: 'k' },
        { op: 'basic.publish', exchange: 'x', key: 'k', body: 'a' },
        { op: 'basic.publish', exchange: 'x', key: 'k', body: 'b' },
      ],
    };

    expect(whyNotExportable(fixture)).toBeNull();
    expect(whyNotExportable({ ...fixture, steps: fixture.steps.slice(0, 3) })).toBeNull();
  });
});

describe.each(exportable.map((fixture) => [fixture.id, fixture] as const))('%s, exported', (_id, fixture) => {
  const vhost = exportVhostFor(fixture.id);
  const { text } = exportFixture(fixture, vhost);

  it('is a file that describes the topology of the canvas that the scenario makes, and nothing else', () => {
    const fromFile = topologyOf(text);
    const fromCanvas = toTopology(canvasOf(fixture));

    expect(canonicalTopology(fromFile)).toEqual(canonicalTopology({ ...fromCanvas, vhost }));
  });

  it('routes every publish of the scenario to the queues that RabbitMQ put it in', () => {
    const topology = topologyOf(text);
    const recorded = [...(fixture.observed as RoutingObserved).routes];

    for (const step of publishes(fixture)) {
      const result = route(topology, {
        exchange: step.exchange,
        key: step.key ?? '',
        headers: asEntries(step.headers, asValue) as HeaderEntry<HeaderValue>[],
      });
      const seen = recorded.shift();

      expect(result.ok, `${fixture.id}: ${step.body}`).toBe(true);
      expect(seen, step.body).toBeDefined();
      expect([...new Set(seen?.queues)].sort(), step.body).toEqual(result.ok ? [...result.queues].sort() : null);
    }
  });
});

describe('exportVhostFor', () => {
  it('gives each scenario a vhost of its own, named after it', () => {
    expect(exportVhostFor('routing/a-name')).toBe('conformance-export-routing-a-name');
  });
});

describe('exportFixture', () => {
  it('throws, saying which fixture, when the app has nothing to put in a file for it', () => {
    const fixture: Fixture = {
      id: 'routing/empty',
      kind: 'routing',
      title: 't',
      observed: { routes: [] },
      steps: [{ op: 'basic.publish', exchange: '', key: 'x', body: 'a' }],
    };

    expect(() => exportFixture(fixture, 'v')).toThrow(
      /^routing\/empty: Nothing on the canvas can go in a definitions file/,
    );
  });

  it('throws, saying which step, when the canvas refuses a step that the broker accepted', () => {
    const fixture: Fixture = {
      id: 'routing/odd',
      kind: 'routing',
      title: 't',
      observed: { routes: [] },
      steps: [
        { op: 'exchange.declare', name: 'x', type: 'direct' },
        { op: 'exchange.declare', name: 'x', type: 'topic' },
      ],
    };

    expect(() => canvasOf(fixture)).toThrow(/^routing\/odd, step 2 \(exchange\.declare\): the canvas refused it: /);
  });
});

describe('alreadyDeclared', () => {
  it('does not declare or bind again what the file made, and passes every other call to the session', async () => {
    const session = new FakeSession();
    const played = alreadyDeclared(session);

    await played.declareExchange({ op: 'exchange.declare', name: 'x', type: 'direct' });
    await played.declareQueue({ op: 'queue.declare', name: 'q' });
    await played.bind({ op: 'bind', source: 'x', destination: { kind: 'queue', name: 'q' } });
    await played.publish({ op: 'basic.publish', exchange: 'x', body: 'a' });
    await played.settle();
    await played.drain('q');

    expect(session.calls).toEqual(['publish a', 'settle', 'drain q']);
    expect(played.vhost).toBe(session.vhost);
  });

  it('answers a declaration as a call that is done, so that whoever waits for it is not left with nothing', async () => {
    const played = alreadyDeclared(new FakeSession());

    await expect(
      played.declareExchange({ op: 'exchange.declare', name: 'x', type: 'direct' }),
    ).resolves.toBeUndefined();
    await expect(played.declareQueue({ op: 'queue.declare', name: 'q' })).resolves.toBeUndefined();
    await expect(
      played.bind({ op: 'bind', source: 'x', destination: { kind: 'queue', name: 'q' } }),
    ).resolves.toBeUndefined();
  });

  it('calls the other methods of the session as the session, so that what it keeps to itself is still its own', async () => {
    class Private extends FakeSession {
      readonly #kept = 'kept';
      override async settle(): Promise<void> {
        await super.settle();
        this.calls.push(this.#kept);
      }
    }
    const session = new Private();

    await alreadyDeclared(session).settle();

    expect(session.calls).toEqual(['settle', 'kept']);
  });
});

describe('observeExported', () => {
  const fixture = exportable[0]!;

  it('imports the file into a vhost of its own, plays the publishes against it, and closes the session', async () => {
    const broker = new FakeBroker();

    await observeExported(broker, fixture);

    expect(broker.imported).toHaveLength(1);
    expect(broker.imported[0]?.vhost).toBe(exportVhostFor(fixture.id));
    expect(broker.imported[0]?.definitions).toBe(exportFixture(fixture, exportVhostFor(fixture.id)).text);
    const [session] = broker.sessions;
    expect(session?.closed).toBe(true);
    expect(session?.calls.filter((call) => call.startsWith('publish'))).toHaveLength(publishes(fixture).length);
    expect(
      session?.calls.filter((call) => call.startsWith('exchange.declare') || call.startsWith('queue.declare')),
    ).toEqual([]);
  });

  it('closes the session when playing fails', async () => {
    const broker = new FakeBroker();
    const failing = new FakeSession();
    failing.failOn = 'publish';
    broker.openSession = () => {
      broker.sessions.push(failing);
      return Promise.resolve(failing);
    };

    await expect(observeExported(broker, fixture)).rejects.toThrow('scripted failure on publish');
    expect(failing.closed).toBe(true);
  });
});
