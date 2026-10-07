import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CANVAS_TIMING, newEngine, settle, ZERO_TIMING } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { EngineCommand } from './command';
import type { Engine } from './engine';
import type { EngineEvent } from './events';
import type { HeaderArguments, HeaderCondition, HeaderEntry, HeaderValue, XMatch } from './headers';
import type { Timing } from './view';

/**
 * The fixtures that RabbitMQ 4.3 recorded, replayed through the engine's `dispatch` (ADR-0050 to ADR-0053): the steps of each scenario are
 * commands, the engine runs everything that it has scheduled after every step (the runner of the recording settles the broker after every step
 * in the same way), and what each consumer received, what each queue still holds, which queues each publish reached and every refusal are the
 * broker's. Interleaving between consumers is not compared, because a real broker does not make it observable, and the replay is made twice,
 * with no latency and with the latency of a new canvas, which must give the same answers.
 *
 * A step that this does not know is an error, never skipped, and so is a fixture that uses something that the model cannot say, unless it is
 * on the list below, with its reason.
 */

type Json = Record<string, unknown>;

interface Fixture {
  readonly id: string;
  readonly kind: 'routing' | 'delivery';
  readonly steps: readonly Json[];
  readonly observed: {
    readonly routes?: readonly {
      readonly body: string;
      readonly returned: boolean;
      readonly queues: readonly string[];
    }[];
    readonly refusals?: readonly { readonly step: number; readonly code: number; readonly text: string }[];
    readonly deliveries?: Readonly<Record<string, readonly { readonly body: string; readonly redelivered: boolean }[]>>;
    readonly ready?: Readonly<Record<string, readonly { readonly body: string; readonly redelivered: boolean }[]>>;
  };
}

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/conformance/4.3/', import.meta.url));

const load = (kind: 'routing' | 'delivery'): Fixture[] =>
  readdirSync(`${FIXTURES}${kind}/`)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => JSON.parse(readFileSync(`${FIXTURES}${kind}/${name}`, 'utf8')) as Fixture);

const fixtures = [...load('routing'), ...load('delivery')];

/** What the model cannot say, by fixture, and why. An exclusive queue arrives with connections and lifecycles in M3. */
const OUTSIDE_THE_MODEL: Readonly<Record<string, string>> = {
  'routing/a-queue-that-is-not-durable-is-accepted-when-it-is-exclusive':
    'it declares an exclusive queue, and the simulator has no exclusive flag (ADR-0024)',
};

const asValue = (json: Json): HeaderValue => {
  const { t, v } = json as { t: HeaderValue['t']; v: never };
  return { t, v } as HeaderValue; // The width of an integer on the wire is not in the model, which does not need it (ADR-0009).
};
const asCondition = (json: Json): HeaderCondition => (json['t'] === 'exists' ? { t: 'exists' } : asValue(json));
const asEntries = <V>(list: unknown, convert: (value: Json) => V): HeaderEntry<V>[] =>
  ((list ?? []) as { key: string; value: Json }[]).map(({ key, value }) => ({ key, value: convert(value) }));
const asArguments = (headers: unknown): { headers: HeaderArguments } | Record<string, never> => {
  const given = headers as { xMatch: XMatch | null; args: unknown } | undefined;
  return given === undefined ? {} : { headers: { xMatch: given.xMatch, args: asEntries(given.args, asCondition) } };
};

interface Played {
  readonly problems: string[];
  /** What each step was answered, for the specs of the replay itself. */
  readonly refusals: Map<number, { code: number; text: string }>;
}

/** Plays a fixture into an engine, and says what differs from what the broker did. */
function replay(fixture: Fixture, timing: Timing): Played {
  const problems: string[] = [];
  const engine: Engine = newEngine(timing);
  const refusals = new Map<number, { code: number; text: string }>();
  const recorded = new Map((fixture.observed.refusals ?? []).map((refusal) => [refusal.step, refusal]));
  const routes = [...(fixture.observed.routes ?? [])];
  const idOf = new Map<string, number>();
  const bodyOf = new Map<number, string>();
  const received: Record<string, { body: string; redelivered: boolean }[]> = {};
  let delivered = 0;
  const channelOfTag = new Map<string, string>();

  const hear = (events: readonly EngineEvent[]): void => {
    for (const event of events) {
      if (event.type === 'published') {
        idOf.set(event.message.payload, event.message.id);
        bodyOf.set(event.message.id, event.message.payload);
      } else if (event.type === 'delivered') {
        delivered += 1;
        (received[event.consumer] ??= []).push({
          body: bodyOf.get(event.message) as string,
          redelivered: event.redelivered,
        });
      }
    }
  };

  fixture.steps.forEach((step, index) => {
    const at = `${fixture.id}, step ${index + 1} (${String(step['op'])})`;
    const expectRefusal = step['refused'] === true;
    const answer = (command: EngineCommand): void => {
      const result = engine.dispatch(command);
      hear(result.events);
      hear(settle(engine));
      if (result.ok) {
        if (expectRefusal && command.op !== 'basic.publish') {
          problems.push(
            `${at}: the broker refused it with ${JSON.stringify(recorded.get(index + 1))}, and the engine accepted it`,
          );
        }
        return;
      }
      refusals.set(index + 1, { code: result.code, text: result.text });
      const wanted = recorded.get(index + 1);
      if (!expectRefusal || wanted === undefined || wanted.code !== result.code || wanted.text !== result.text) {
        problems.push(
          `${at}: the broker answered ${JSON.stringify(expectRefusal ? wanted : 'nothing')}, and the engine refused with ${result.code} ${result.text}`,
        );
      }
    };

    switch (step['op']) {
      case 'exchange.declare':
        answer({
          op: 'exchange.declare',
          name: step['name'] as string,
          type: step['type'] as 'direct',
          durable: (step['durable'] as boolean | undefined) ?? false,
          autoDelete: (step['autoDelete'] as boolean | undefined) ?? false,
          internal: step['internal'] === true,
        });
        break;
      case 'queue.declare':
        answer({
          op: 'queue.declare',
          name: step['name'] as string,
          durable: (step['durable'] as boolean | undefined) ?? true,
        });
        break;
      case 'bind':
      case 'unbind':
        answer({
          op: step['op'],
          source: step['source'] as string,
          destination: step['destination'] as { kind: 'queue' | 'exchange'; name: string },
          key: (step['key'] as string | undefined) ?? '',
          ...asArguments(step['headers']),
        });
        break;
      case 'basic.publish': {
        const command: EngineCommand = {
          op: 'basic.publish',
          exchange: step['exchange'] as string,
          key: (step['key'] as string | undefined) ?? '',
          headers: asEntries(step['headers'], asValue),
          body: step['body'] as string,
        };
        const result = engine.dispatch(command);
        hear(result.events);
        const events = settle(engine);
        hear(events);
        const refusal = events.find((event) => event.type === 'refused');
        if (expectRefusal) {
          const wanted = recorded.get(index + 1);
          if (
            refusal?.type !== 'refused' ||
            wanted === undefined ||
            refusal.code !== wanted.code ||
            refusal.text !== wanted.text
          ) {
            problems.push(
              `${at}: the broker refused with ${JSON.stringify(wanted)}, and the engine said ${JSON.stringify(refusal)}`,
            );
          } else {
            refusals.set(index + 1, { code: refusal.code, text: refusal.text });
          }
          break;
        }
        if (fixture.kind === 'delivery') {
          // A delivery fixture records what the consumers were given and what the queues kept, and not which queue each publish reached.
          break;
        }
        const observed = routes.shift();
        const routed = events.find((event) => event.type === 'routed');
        const queues = routed?.type === 'routed' ? [...routed.queues].sort() : [];
        if (observed === undefined || refusal !== undefined) {
          problems.push(
            `${at}: the broker accepted the publish, and the engine ${refusal === undefined ? 'has no route recorded' : 'refused it'}`,
          );
        } else if (JSON.stringify([...new Set(observed.queues)].sort()) !== JSON.stringify(queues)) {
          problems.push(
            `${at} ("${observed.body}"): the broker put it in ${JSON.stringify(observed.queues)}, and the engine in ${JSON.stringify(queues)}`,
          );
        } else if (observed.returned !== events.some((event) => event.type === 'unroutable')) {
          problems.push(
            `${at} ("${observed.body}"): the broker returned it: ${observed.returned}, and the engine disagrees`,
          );
        }
        break;
      }
      case 'channel.open':
        answer({
          op: 'channel.open',
          channel: step['channel'] as string,
          ...(step['prefetch'] === undefined ? {} : { prefetch: step['prefetch'] as number }),
          processingMs: null,
        });
        break;
      case 'basic.consume':
        channelOfTag.set(step['consumer'] as string, step['channel'] as string);
        answer({
          op: 'basic.consume',
          channel: step['channel'] as string,
          queue: step['queue'] as string,
          consumer: step['consumer'] as string,
          ack: step['ack'] as 'auto' | 'manual',
        });
        break;
      case 'basic.cancel':
        answer({ op: 'basic.cancel', consumer: step['consumer'] as string });
        break;
      case 'basic.ack':
        answer({
          op: 'basic.ack',
          consumer: step['consumer'] as string,
          ...(step['body'] === undefined ? {} : { message: idOf.get(step['body'] as string) as number }),
        });
        break;
      case 'channel.close':
        answer({ op: 'channel.close', channel: step['channel'] as string });
        break;
      case 'await.deliveries':
        if (delivered < (step['count'] as number)) {
          problems.push(`${at}: the broker had delivered ${String(step['count'])} by now, and the engine ${delivered}`);
        }
        break;
      default:
        throw new Error(
          `${at}: this replay does not know the step "${String(step['op'])}". Teach it, so that it is not skipped`,
        );
    }
  });

  if (fixture.kind === 'delivery') {
    const wanted = fixture.observed.deliveries ?? {};
    for (const consumer of Object.keys(wanted)) {
      if (JSON.stringify(received[consumer] ?? []) !== JSON.stringify(wanted[consumer])) {
        problems.push(
          `${fixture.id}: ${consumer} was given ${JSON.stringify(wanted[consumer])}, and the engine gave it ${JSON.stringify(received[consumer] ?? [])}`,
        );
      }
    }
    for (const [queue, expected] of Object.entries(fixture.observed.ready ?? {})) {
      const held = engine
        .messages(queue)
        .filter(({ heldBy }) => heldBy === null)
        .map(({ payload, redelivered }) => ({ body: payload, redelivered }));
      if (JSON.stringify(held) !== JSON.stringify(expected)) {
        problems.push(
          `${fixture.id}: ${queue} was left with ${JSON.stringify(expected)}, and the engine's has ${JSON.stringify(held)}`,
        );
      }
    }
  }
  if (routes.length > 0) {
    problems.push(`${fixture.id}: the broker recorded ${routes.length} more routes than the engine was asked about`);
  }
  return { problems, refusals };
}

const inside = fixtures.filter(({ id }) => !(id in OUTSIDE_THE_MODEL));
const named = (id: string): Fixture => fixtures.find((fixture) => fixture.id === id) as Fixture;

describe('the fixtures recorded on RabbitMQ 4.3, replayed through the engine', () => {
  it('are all there, and there are many: the replay below cannot pass by finding none', () => {
    expect(fixtures.filter(({ kind }) => kind === 'routing').length).toBeGreaterThan(80);
    expect(fixtures.filter(({ kind }) => kind === 'delivery')).toHaveLength(14);
    expect(inside.length).toBe(fixtures.length - Object.keys(OUTSIDE_THE_MODEL).length);
  });

  it('leave out only the fixtures that use what the model cannot say, and each of those is listed with its reason', () => {
    const exclusive = fixtures
      .filter(({ steps }) => steps.some((step) => step['op'] === 'queue.declare' && step['exclusive'] === true))
      .map(({ id }) => id);

    expect(exclusive.sort()).toEqual(Object.keys(OUTSIDE_THE_MODEL).sort());
    for (const reason of Object.values(OUTSIDE_THE_MODEL)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  describe.each([
    ['with no latency', ZERO_TIMING],
    ['with the latency of a new canvas', CANVAS_TIMING],
  ])('%s', (_name, timing) => {
    it.each(inside.map((fixture) => [fixture.id, fixture] as const))(
      '%s: the engine answers as the broker did',
      (_id, fixture) => {
        expect(replay(fixture, timing).problems).toEqual([]);
      },
    );
  });

  it('replays every refusal that the broker recorded, for declarations, bindings and publishes: none is left unchecked', () => {
    let recorded = 0;
    let replayed = 0;
    for (const fixture of inside) {
      recorded += (fixture.observed.refusals ?? []).length;
      replayed += replay(fixture, ZERO_TIMING).refusals.size;
    }

    expect(recorded).toBeGreaterThanOrEqual(35);
    expect(replayed).toBe(recorded);
  });

  it('delivers, in every delivery fixture, what the broker delivered: all 14 of them, which include #10 and #18', () => {
    const delivery = inside.filter(({ kind }) => kind === 'delivery');

    expect(delivery.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        'delivery/issue-10-a-message-goes-to-one-consumer-only',
        'delivery/issue-18-a-removed-consumer-gets-nothing-more',
      ]),
    );
    for (const fixture of delivery) {
      expect(replay(fixture, CANVAS_TIMING).problems, fixture.id).toEqual([]);
    }
  });

  describe('the replay itself', () => {
    const round = named('delivery/round-robin-between-consumers');
    const refusal = named('routing/publishing-to-an-exchange-that-does-not-exist-is-refused');
    const direct = named('routing/direct-matches-the-whole-key-case-sensitively');
    const withObserved = (fixture: Fixture, change: Partial<Fixture['observed']>): Fixture => ({
      ...fixture,
      observed: { ...fixture.observed, ...change },
    });

    it('notices a consumer that was given other messages, and a queue that was left with other ones', () => {
      const other = withObserved(round, { deliveries: { c1: [{ body: 'm2', redelivered: false }], c2: [] } });
      const left = withObserved(round, { ready: { work: [{ body: 'm9', redelivered: false }] } });

      expect(replay(other, ZERO_TIMING).problems.join('\n')).toMatch(/c1 was given \[\{"body":"m2"/);
      expect(replay(left, ZERO_TIMING).problems.join('\n')).toMatch(/work was left with \[\{"body":"m9"/);
    });

    it('notices a delivery that the broker had made and the engine had not', () => {
      const more = { ...round, steps: [...round.steps, { op: 'await.deliveries', count: 9 }] };

      expect(replay(more, ZERO_TIMING).problems.join('\n')).toMatch(/had delivered 9 by now, and the engine 4/);
    });

    it('notices a refusal that has another code, other words, or none, and a refusal that the broker did not give', () => {
      const [first, ...rest] = refusal.observed.refusals ?? [];
      const changed = (change: object) =>
        withObserved(refusal, { refusals: [{ ...(first as object), ...change } as never, ...rest] });

      expect(replay(changed({ code: 403 }), ZERO_TIMING).problems.join('\n')).toMatch(/the broker refused with/);
      expect(replay(changed({ text: 'NOT_FOUND - other' }), ZERO_TIMING).problems.join('\n')).toMatch(
        /the broker refused with/,
      );
      expect(replay(withObserved(refusal, { refusals: [] }), ZERO_TIMING).problems.join('\n')).toMatch(
        /refused with undefined/,
      );
    });

    it('notices a publish that the engine routes in another way than the broker did', () => {
      const [first, ...rest] = direct.observed.routes ?? [];
      const wrong = withObserved(direct, {
        routes: [{ ...(first as object), queues: ['created-upper'] } as never, ...rest],
      });
      const returned = withObserved(direct, { routes: [{ ...(first as object), returned: true } as never, ...rest] });

      expect(replay(wrong, ZERO_TIMING).problems.join('\n')).toMatch(/the broker put it in \["created-upper"\]/);
      expect(replay(returned, ZERO_TIMING).problems.join('\n')).toMatch(/the broker returned it: true/);
    });

    it('notices routes that nothing asked about, and a step that the broker refused and the engine accepted', () => {
      const extra = withObserved(direct, {
        routes: [...(direct.observed.routes ?? []), { body: 'x', returned: false, queues: [] }],
      });
      const accepted = {
        ...direct,
        steps: direct.steps.map((step, index) => (index === 0 ? { ...step, refused: true } : step)),
      };

      expect(replay(extra, ZERO_TIMING).problems.join('\n')).toMatch(/recorded 1 more routes/);
      expect(replay(accepted, ZERO_TIMING).problems.join('\n')).toMatch(/the engine accepted it/);
    });

    it('does not skip a step that it does not know', () => {
      const odd = { ...round, steps: [...round.steps, { op: 'queue.rename', name: 'x' }] };

      expect(() => replay(odd, ZERO_TIMING)).toThrow('does not know the step "queue.rename"');
    });
  });
});
