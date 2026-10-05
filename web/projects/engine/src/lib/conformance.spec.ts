import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HeaderArguments, HeaderCondition, HeaderEntry, HeaderValue, XMatch } from './headers';
import { route, type RouteResult } from './route';
import type { Binding, Exchange, ExchangeType, Topology } from './topology';

/**
 * The routing fixtures are what RabbitMQ 4.3 did with each scenario (M1 plan, section 5), recorded on the pinned image by
 * the conformance runner. This replays them through `route()` on every push, with no Docker, and the engine has to give
 * the broker's answer for every publish: the same queues, unroutable when the broker returned the message, and the
 * broker's code and text when it refused. The nightly job asks the other question, whether the broker still says it.
 *
 * A fixture is read as the JSON that it is, with only the part of the format that routing needs, so the engine imports
 * nothing from the runner. A step that this does not know is an error, never skipped: a new kind of step in a fixture
 * must not pass by being ignored.
 */

type Json = Record<string, unknown>;

interface Fixture {
  readonly id: string;
  readonly steps: readonly Json[];
  readonly observed: {
    readonly routes: readonly {
      readonly body: string;
      readonly returned: boolean;
      readonly queues: readonly string[];
    }[];
    readonly refusals?: readonly { readonly step: number; readonly code: number; readonly text: string }[];
  };
}

const ROUTING = fileURLToPath(new URL('../../../../fixtures/conformance/4.3/routing/', import.meta.url));
const MANIFEST = fileURLToPath(new URL('../../../../fixtures/conformance/4.3/manifest.json', import.meta.url));

const fixtures: Fixture[] = readdirSync(ROUTING)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(`${ROUTING}${name}`, 'utf8')) as Fixture);

const asValue = (json: Json): HeaderValue => {
  const { t, v } = json as { t: HeaderValue['t']; v: never };
  return { t, v } as HeaderValue; // The scenario may also say how wide an integer is on the wire, which does not matter.
};
const asCondition = (json: Json): HeaderCondition => (json['t'] === 'exists' ? { t: 'exists' } : asValue(json));
const asEntries = <V>(list: unknown, convert: (value: Json) => V): HeaderEntry<V>[] =>
  ((list ?? []) as { key: string; value: Json }[]).map(({ key, value }) => ({ key, value: convert(value) }));

/** Plays a fixture's steps into a topology, and routes each publish. Returns what differs from the broker's answers. */
function replay(fixture: Fixture): string[] {
  const problems: string[] = [];
  const exchanges: Exchange[] = [];
  const queues: string[] = [];
  const bindings: Binding[] = [];
  const topology = (): Topology => ({ vhost: '/', exchanges, queues, bindings });
  const refusals = new Map((fixture.observed.refusals ?? []).map((refusal) => [refusal.step, refusal]));
  const routes = [...fixture.observed.routes];

  fixture.steps.forEach((step, index) => {
    const at = `${fixture.id}, step ${index + 1} (${String(step['op'])})`;
    const refused = step['refused'] === true;
    switch (step['op']) {
      case 'exchange.declare':
        if (!refused) {
          exchanges.push({
            name: step['name'] as string,
            type: step['type'] as ExchangeType,
            internal: step['internal'] === true,
          });
        }
        break;
      case 'queue.declare':
        if (!refused) {
          queues.push(step['name'] as string);
        }
        break;
      case 'bind':
        if (!refused) {
          const headers = step['headers'] as { xMatch: XMatch | null; args: unknown } | undefined;
          bindings.push({
            source: step['source'] as string,
            destination: step['destination'] as Binding['destination'],
            key: (step['key'] as string | undefined) ?? '',
            ...(headers
              ? {
                  headers: {
                    xMatch: headers.xMatch,
                    args: asEntries(headers.args, asCondition),
                  } satisfies HeaderArguments,
                }
              : {}),
          });
        }
        break;
      case 'basic.publish': {
        const result = route(topology(), {
          exchange: step['exchange'] as string,
          key: (step['key'] as string | undefined) ?? '',
          headers: asEntries(step['headers'], asValue),
        });
        problems.push(...traceProblems(result, step, at));
        if (refused) {
          const refusal = refusals.get(index + 1);
          if (result.ok || refusal === undefined || result.code !== refusal.code || result.text !== refusal.text) {
            problems.push(
              `${at}: the broker refused with ${JSON.stringify(refusal)}, and route() gave ${JSON.stringify(result.ok ? 'a route' : result)}`,
            );
          }
          break;
        }
        const observed = routes.shift();
        if (observed === undefined || !result.ok) {
          problems.push(
            `${at}: the broker accepted the publish, and route() ${result.ok ? 'has no route recorded' : 'refused it'}`,
          );
          break;
        }
        // The broker lists queues in the order that they were declared, and a queue twice if it got two copies. route()
        // lists each queue once, in the order it was reached, so the two are compared as sets, and the copies are
        // checked on their own below.
        const expected = [...new Set(observed.queues)].sort();
        const actual = [...result.queues].sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
          problems.push(
            `${at} ("${observed.body}"): the broker put it in ${JSON.stringify(expected)}, and route() in ${JSON.stringify(actual)}`,
          );
        }
        if (observed.returned !== (result.queues.length === 0)) {
          problems.push(
            `${at} ("${observed.body}"): the broker returned it: ${observed.returned}, and route() found ${result.queues.length} queues`,
          );
        }
        break;
      }
      default:
        throw new Error(
          `${at}: this replay does not know the step "${String(step['op'])}". Teach it, so that it is not skipped`,
        );
    }
  });
  return problems;
}

/** What has to hold of any result, whatever the broker did: the paths, the visits and the JSON are consistent. */
function traceProblems(result: RouteResult, step: Json, at: string): string[] {
  if (!result.ok) {
    return [];
  }
  const problems: string[] = [];
  const published = step['exchange'] as string;
  if (result.trace.exchange !== published || result.trace.visits[0]?.exchange !== published) {
    problems.push(`${at}: the trace does not start from the exchange that was published to`);
  }
  if (result.paths.length !== result.queues.length || result.paths.some((path, i) => path.queue !== result.queues[i])) {
    problems.push(`${at}: the paths are not parallel to the queues`);
  }
  for (const path of result.paths) {
    const [first] = path.hops;
    const last = path.hops.at(-1);
    const joined = path.hops.every(
      (hop, i) => i === 0 || (path.hops[i - 1]?.to.kind === 'exchange' && path.hops[i - 1]?.to.name === hop.from),
    );
    if (first?.from !== published || last?.to.kind !== 'queue' || last.to.name !== path.queue || !joined) {
      problems.push(`${at}: the path to ${path.queue} is not a chain from the exchange published to`);
    }
  }
  if (JSON.stringify(JSON.parse(JSON.stringify(result))) !== JSON.stringify(result)) {
    problems.push(`${at}: the result does not survive JSON`);
  }
  return problems;
}

describe('the routing fixtures recorded on RabbitMQ 4.3', () => {
  it('are all there, and there are many: the replay below cannot pass by finding none', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as { counts: { routing: number } };

    expect(fixtures).toHaveLength(manifest.counts.routing);
    expect(fixtures.length).toBeGreaterThan(50);
  });

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s: route() answers as the broker did',
    (_id, fixture) => {
      expect(replay(fixture)).toEqual([]);
    },
  );

  it('never gives a queue two copies of a message, which is rule 7 of ADR-0008 as the broker kept it', () => {
    for (const fixture of fixtures) {
      for (const route of fixture.observed.routes) {
        expect(new Set(route.queues).size, `${fixture.id}: ${route.body}`).toBe(route.queues.length);
      }
    }
  });

  it('returns a message exactly when no queue got it, which is rules 10 and 12 of ADR-0008', () => {
    for (const fixture of fixtures) {
      for (const route of fixture.observed.routes) {
        expect(route.returned, `${fixture.id}: ${route.body}`).toBe(route.queues.length === 0);
      }
    }
  });

  describe('the replay itself', () => {
    const named = (id: string) => fixtures.find((fixture) => fixture.id === id) as Fixture;
    const direct = named('routing/direct-matches-the-whole-key-case-sensitively');
    const refusal = named('routing/publishing-to-an-exchange-that-does-not-exist-is-refused');

    it('notices a queue that the broker did not use', () => {
      const [first, ...rest] = direct.observed.routes;
      const wrong = {
        ...direct,
        observed: { ...direct.observed, routes: [{ ...(first as object), queues: ['created-upper'] }, ...rest] },
      } as Fixture;

      expect(replay(wrong).join('\n')).toMatch(/the broker put it in \["created-upper"\]/);
    });

    it('notices a message that the broker returned and route() did not, and one it kept and route() did not find', () => {
      const [first, ...rest] = direct.observed.routes;
      const returned = {
        ...direct,
        observed: { ...direct.observed, routes: [{ ...(first as object), returned: true }, ...rest] },
      } as Fixture;

      expect(replay(returned).join('\n')).toMatch(/the broker returned it: true/);
    });

    it('notices a refusal with another code or other words', () => {
      const [first, ...rest] = refusal.observed.refusals ?? [];
      const other = (change: object) =>
        ({
          ...refusal,
          observed: { ...refusal.observed, refusals: [{ ...(first as object), ...change }, ...rest] },
        }) as Fixture;

      expect(replay(other({ code: 403 })).join('\n')).toMatch(/the broker refused with/);
      expect(replay(other({ text: 'NOT_FOUND - something else' })).join('\n')).toMatch(/the broker refused with/);
    });

    it('notices a refusal that the broker did not give', () => {
      const none = { ...refusal, observed: { ...refusal.observed, refusals: [] } } as Fixture;

      expect(replay(none).join('\n')).toMatch(/the broker refused with undefined/);
    });

    it('does not skip a step that it does not know', () => {
      const odd = { ...direct, steps: [...direct.steps, { op: 'queue.purge', name: 'x' }] } as Fixture;

      expect(() => replay(odd)).toThrow('does not know the step "queue.purge"');
    });
  });
});
