import type { HeaderCondition, HeaderEntry, HeaderValue, XMatch } from './scenario';

/**
 * How scenario header values go on the wire. amqplib guesses a type for a plain JavaScript number, and cannot tell
 * `1` from `1.0`, so every value that matters is sent as a tagged value: `{ '!': type, value }` (ADR-0009).
 */

const INTEGER_TAGS = { 8: 'byte', 16: 'short', 32: 'int', 64: 'long' } as const;

export function toAmqpValue(value: HeaderCondition): unknown {
  switch (value.t) {
    case 'string':
      return value.v;
    case 'boolean':
      return value.v;
    case 'float':
      return { '!': 'double', value: value.v };
    case 'integer':
      // Without a width, amqplib picks the smallest integer type that fits.
      return value.width === undefined ? value.v : { '!': INTEGER_TAGS[value.width], value: value.v };
    case 'exists':
      // A header with no value is sent as AMQP "void". A headers binding treats that as "the key must be present".
      return null;
  }
}

/** The headers of a message. */
export function messageHeaders(entries: readonly HeaderEntry<HeaderValue>[]): Record<string, unknown> {
  return Object.fromEntries(entries.map(({ key, value }) => [key, toAmqpValue(value)]));
}

/** The arguments of a binding: `x-match` unless it is left out, then the conditions. */
export function bindingArguments(headers: {
  readonly xMatch: XMatch | null;
  readonly args: readonly HeaderEntry<HeaderCondition>[];
}): Record<string, unknown> {
  return {
    ...(headers.xMatch === null ? {} : { 'x-match': headers.xMatch }),
    ...Object.fromEntries(headers.args.map(({ key, value }) => [key, toAmqpValue(value)])),
  };
}
