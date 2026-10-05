import type { Destination, ExchangeType, HeaderCondition, HeaderEntry, HeaderValue, Step, XMatch } from '../scenario';

/** Small constructors that keep the scenario files readable. */

type StepOf<Op extends Step['op']> = Extract<Step, { readonly op: Op }>;

export const queue = (name: string): Destination => ({ kind: 'queue', name });

/**
 * A durable queue, which is how a scenario gets a queue. RabbitMQ 4.3 refuses a queue that is neither durable nor
 * exclusive: it closes the connection (the first Nightly record run, 37341314213, was the first to see it). The
 * refusal has scenarios of their own (`routing/a-queue-that-is-neither-durable-nor-exclusive-is-refused` and
 * `routing/a-queue-that-is-not-durable-is-accepted-when-it-is-exclusive`), and ADR-0021 records what they showed.
 */
export const declareQueue = (name: string): StepOf<'queue.declare'> => ({ op: 'queue.declare', name, durable: true });
export const exchange = (name: string): Destination => ({ kind: 'exchange', name });

export const declareExchange = (
  name: string,
  type: ExchangeType,
  options: { readonly internal?: true } = {},
): StepOf<'exchange.declare'> => ({
  op: 'exchange.declare',
  name,
  type,
  ...options,
});

type RefusableStep = StepOf<'exchange.declare' | 'queue.declare' | 'bind' | 'basic.publish'>;

/** A step that the broker is expected to refuse. The recording keeps what it answered (see `Refusable`). */
export const refused = <S extends RefusableStep>(step: S): S => ({ ...step, refused: true });

export const str = (v: string): HeaderValue => ({ t: 'string', v });
export const int = (v: number, width?: 8 | 16 | 32 | 64): HeaderValue =>
  width === undefined ? { t: 'integer', v } : { t: 'integer', v, width };
export const float = (v: number): HeaderValue => ({ t: 'float', v });
export const bool = (v: boolean): HeaderValue => ({ t: 'boolean', v });
export const exists: HeaderCondition = { t: 'exists' };

export const entry = <V>(key: string, value: V): HeaderEntry<V> => ({ key, value });

export const publish = (
  exchangeName: string,
  key: string,
  body: string,
  headers?: readonly HeaderEntry<HeaderValue>[],
): StepOf<'basic.publish'> => ({
  op: 'basic.publish',
  exchange: exchangeName,
  key,
  body,
  ...(headers ? { headers } : {}),
});

export const bindKey = (source: string, destination: Destination, key: string): StepOf<'bind'> => ({
  op: 'bind',
  source,
  destination,
  key,
});

export const bindHeaders = (
  source: string,
  destination: Destination,
  xMatch: XMatch | null,
  args: readonly HeaderEntry<HeaderCondition>[],
): StepOf<'bind'> => ({ op: 'bind', source, destination, key: '', headers: { xMatch, args } });
