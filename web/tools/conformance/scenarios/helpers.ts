import type { Destination, HeaderCondition, HeaderEntry, HeaderValue, Step, XMatch } from '../scenario';

/** Small constructors that keep the scenario files readable. */

export const queue = (name: string): Destination => ({ kind: 'queue', name });
export const exchange = (name: string): Destination => ({ kind: 'exchange', name });

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
): Step => ({
  op: 'basic.publish',
  exchange: exchangeName,
  key,
  body,
  ...(headers ? { headers } : {}),
});

export const bindKey = (source: string, destination: Destination, key: string): Step => ({
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
): Step => ({ op: 'bind', source, destination, key: '', headers: { xMatch, args } });
