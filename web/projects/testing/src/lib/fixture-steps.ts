import type { BindCommand, DeclareExchange, DeclareQueue, DocumentCommand, UnbindCommand } from '@rmq/domain';
import type { HeaderCondition, HeaderEntry, HeaderValue, XMatch } from '@rmq/engine';

/**
 * Reading the conformance fixtures (ADR-0015, ADR-0021): each step that the runner recorded on a real RabbitMQ, as the command of the domain that does the same to a canvas. The domain replays them to check that the commands
 * answer as the broker did, and the Nightly makes a canvas of them, exports it, and imports the file into the broker. A step that is not a declaration or a binding is not a command of the canvas, and is `undefined`.
 */

/** A step of a fixture as the JSON file has it. */
export type RecordedStep = Readonly<Record<string, unknown>>;

type Json = Record<string, unknown>;

export const asValue = (json: Json): HeaderValue => {
  const { t, v } = json as { t: HeaderValue['t']; v: never };
  return { t, v } as HeaderValue; // The width of an integer on the wire is not in the model, which does not need it (ADR-0009).
};

export const asCondition = (json: Json): HeaderCondition => (json['t'] === 'exists' ? { t: 'exists' } : asValue(json));

export const asEntries = <V>(list: unknown, convert: (value: Json) => V): HeaderEntry<V>[] =>
  ((list ?? []) as { key: string; value: Json }[]).map(({ key, value }) => ({ key, value: convert(value) }));

/** The command that a declaration or a binding of a fixture is, or `undefined` for a step that is not one. */
export function commandOfStep(step: RecordedStep): DocumentCommand | undefined {
  switch (step['op']) {
    case 'exchange.declare':
      return {
        type: 'declare-exchange',
        name: step['name'] as string,
        exchangeType: step['type'] as DeclareExchange['exchangeType'],
        durable: (step['durable'] as boolean | undefined) ?? true,
        autoDelete: (step['autoDelete'] as boolean | undefined) ?? false,
        internal: step['internal'] === true,
      };
    case 'queue.declare':
      return {
        type: 'declare-queue',
        name: step['name'] as string,
        durable: (step['durable'] as boolean | undefined) ?? true,
      } satisfies DeclareQueue;
    case 'bind':
    case 'unbind': {
      const headers = step['headers'] as { xMatch: XMatch | null; args: unknown } | undefined;
      return {
        type: step['op'] as 'bind' | 'unbind',
        source: step['source'] as string,
        destination: step['destination'] as BindCommand['destination'],
        key: (step['key'] as string | undefined) ?? '',
        ...(headers ? { headers: { xMatch: headers.xMatch, args: asEntries(headers.args, asCondition) } } : {}),
      } satisfies BindCommand | UnbindCommand;
    }
    default:
      return undefined;
  }
}
