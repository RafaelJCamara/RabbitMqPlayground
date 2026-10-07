import {
  createEngine,
  type EngineCommand,
  type HeaderArguments,
  type HeaderCondition,
  type HeaderEntry,
  type HeaderValue,
  type Message,
  type Topology,
} from '@rmq/engine';
import type { Fixture } from '../conformance/fixtures';
import type { HeaderCondition as RecordedCondition, HeaderValue as RecordedValue, Step } from '../conformance/scenario';
import type { RoutingObserved } from '../conformance/session';

/**
 * The publishes of a routing fixture, each with the topology that it met (ADR-0060). The steps are played through the engine's `dispatch`, so the topology at a publish is what the engine
 * held, which the engine's own replay of the fixtures holds to what the broker held, and what the broker recorded for each publish is beside it: the queues that got a copy, or the refusal.
 */

/** What RabbitMQ recorded for one publish. */
export type Recorded =
  | { readonly kind: 'routed'; readonly returned: boolean; readonly queues: readonly string[] }
  | { readonly kind: 'refused'; readonly code: number; readonly text: string };

export interface Publish {
  /** Counted from 1 among the publishes of the fixture, and how many there are. */
  readonly number: number;
  readonly of: number;
  /** The step of the scenario, counted from 1, which is how a refusal is named. */
  readonly step: number;
  /** The message's body, which is its name in the fixture. */
  readonly body: string;
  readonly message: Message;
  readonly topology: Topology;
  readonly recorded: Recorded;
}

/** What the model cannot say, by fixture, and why: the same list as the engine's replay, because it is the same limit. */
export const OUTSIDE_THE_MODEL: Readonly<Record<string, string>> = {
  'routing/a-queue-that-is-not-durable-is-accepted-when-it-is-exclusive':
    'it declares an exclusive queue, and the simulator has no exclusive flag (ADR-0024)',
};

const asValue = (value: RecordedValue): HeaderValue =>
  // The width of an integer on the wire is not in the model, which does not need it (ADR-0009).
  ({ t: value.t, v: value.v }) as HeaderValue;
const asCondition = (value: RecordedCondition): HeaderCondition =>
  value.t === 'exists' ? { t: 'exists' } : asValue(value);
const asHeaders = (entries: readonly HeaderEntry<RecordedValue>[] | undefined): HeaderEntry<HeaderValue>[] =>
  (entries ?? []).map(({ key, value }) => ({ key, value: asValue(value) }));
const asArguments = (
  headers:
    | { readonly xMatch: HeaderArguments['xMatch']; readonly args: readonly HeaderEntry<RecordedCondition>[] }
    | undefined,
): { headers: HeaderArguments } | Record<string, never> =>
  headers === undefined
    ? {}
    : {
        headers: {
          xMatch: headers.xMatch,
          args: headers.args.map(({ key, value }) => ({ key, value: asCondition(value) })),
        },
      };

/** The topology steps as engine commands. A step that is not one of them is not a routing step, and a routing fixture has none. */
function commandOf(step: Step): EngineCommand | null {
  switch (step.op) {
    case 'exchange.declare':
      return {
        op: 'exchange.declare',
        name: step.name,
        type: step.type,
        durable: step.durable ?? false,
        autoDelete: step.autoDelete ?? false,
        internal: step.internal === true,
      };
    case 'queue.declare':
      return { op: 'queue.declare', name: step.name, durable: step.durable ?? true };
    case 'bind':
    case 'unbind':
      return {
        op: step.op,
        source: step.source,
        destination: step.destination,
        key: step.key ?? '',
        ...asArguments(step.headers),
      };
    case 'basic.publish':
      return null;
    default:
      throw new Error(`a routing fixture has a step that is not a routing step: ${step.op}`);
  }
}

export function publishesOf(fixture: Fixture): Publish[] {
  const observed = fixture.observed as RoutingObserved;
  const engine = createEngine({ seed: 1, timing: { publishMs: 0, brokerMs: 0, deliverMs: 0 } });
  const routes = [...observed.routes];
  const total = fixture.steps.filter((step) => step.op === 'basic.publish').length;
  const publishes: Publish[] = [];

  fixture.steps.forEach((step, index) => {
    if (step.op !== 'basic.publish') {
      const command = commandOf(step);
      if (command !== null) {
        engine.dispatch(command);
      }
      return;
    }
    const message: Message = { exchange: step.exchange, key: step.key ?? '', headers: asHeaders(step.headers) };
    const refusal = observed.refusals?.find((candidate) => candidate.step === index + 1);
    const route = step.refused === true ? undefined : routes.shift();
    if (step.refused === true ? refusal === undefined : route === undefined) {
      throw new Error(`${fixture.id}, step ${index + 1}: the fixture has nothing recorded for this publish`);
    }
    publishes.push({
      number: publishes.length + 1,
      of: total,
      step: index + 1,
      body: step.body,
      message,
      topology: engine.view().topology,
      recorded:
        route === undefined
          ? { kind: 'refused', code: refusal!.code, text: refusal!.text }
          : { kind: 'routed', returned: route.returned, queues: route.queues },
    });
  });
  return publishes;
}
