import type {
  Binding,
  Exchange,
  ExchangeType,
  HeaderArguments,
  HeaderCondition,
  HeaderEntry,
  HeaderValue,
  Message,
  Topology,
  XMatch,
} from '@rmq/engine';

/** Small constructors for the data that the engine routes, so that a spec can say what it means in one line. */

export const str = (v: string): HeaderValue => ({ t: 'string', v });
export const int = (v: number): HeaderValue => ({ t: 'integer', v });
export const float = (v: number): HeaderValue => ({ t: 'float', v });
export const bool = (v: boolean): HeaderValue => ({ t: 'boolean', v });
export const exists: HeaderCondition = { t: 'exists' };

export const entry = <V>(key: string, value: V): HeaderEntry<V> => ({ key, value });

export const headerArguments = (xMatch: XMatch | null, ...args: HeaderEntry<HeaderCondition>[]): HeaderArguments => ({
  xMatch,
  args,
});

export const exchange = (name: string, type: ExchangeType, internal = false): Exchange => ({ name, type, internal });

/** A binding from an exchange to a queue. */
export const toQueue = (source: string, queue: string, key = '', headers?: HeaderArguments): Binding => ({
  source,
  destination: { kind: 'queue', name: queue },
  key,
  ...(headers ? { headers } : {}),
});

/** A binding from an exchange to another exchange. */
export const toExchange = (source: string, target: string, key = '', headers?: HeaderArguments): Binding => ({
  source,
  destination: { kind: 'exchange', name: target },
  key,
  ...(headers ? { headers } : {}),
});

export function topology(parts: {
  readonly vhost?: string;
  readonly exchanges?: readonly Exchange[];
  readonly queues?: readonly string[];
  readonly bindings?: readonly Binding[];
}): Topology {
  return {
    vhost: parts.vhost ?? '/',
    exchanges: parts.exchanges ?? [],
    queues: parts.queues ?? [],
    bindings: parts.bindings ?? [],
  };
}

export const message = (
  exchangeName: string,
  key = '',
  headers: readonly HeaderEntry<HeaderValue>[] = [],
): Message => ({
  exchange: exchangeName,
  key,
  headers,
});

/** Freezes a value and everything inside it, so that a spec can prove that a function never changes its input. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) {
      deepFreeze(inner);
    }
  }
  return value;
}
