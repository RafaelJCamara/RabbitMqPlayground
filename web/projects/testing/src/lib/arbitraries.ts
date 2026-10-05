import type {
  Binding,
  Destination,
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
import * as fc from 'fast-check';

/** A seed for the engine's PRNG: any unsigned 32-bit integer. */
export const arbSeed: fc.Arbitrary<number> = fc.integer({ min: 0, max: 0xffff_ffff });

// The vocabulary is small on purpose, so that bindings and messages meet often enough for routing to happen.

export const arbHeaderValue: fc.Arbitrary<HeaderValue> = fc.oneof(
  fc.constantFrom('1', '2', 'x', '').map((v): HeaderValue => ({ t: 'string', v })),
  fc.constantFrom(0, 1, 2).map((v): HeaderValue => ({ t: 'integer', v })),
  fc.constantFrom(0, 1, 1.5).map((v): HeaderValue => ({ t: 'float', v })),
  fc.boolean().map((v): HeaderValue => ({ t: 'boolean', v })),
);

export const arbHeaderCondition: fc.Arbitrary<HeaderCondition> = fc.oneof(
  { arbitrary: arbHeaderValue as fc.Arbitrary<HeaderCondition>, weight: 4 },
  { arbitrary: fc.constant<HeaderCondition>({ t: 'exists' }), weight: 1 },
);

const HEADER_KEYS = ['a', 'b', 'x-c'] as const;

/** Entries with distinct keys, in any order, taken from a few. */
function arbEntries<V>(value: fc.Arbitrary<V>): fc.Arbitrary<HeaderEntry<V>[]> {
  return fc
    .uniqueArray(fc.constantFrom(...HEADER_KEYS), { maxLength: 3 })
    .chain((keys) => fc.tuple(...keys.map((key) => value.map((v): HeaderEntry<V> => ({ key, value: v })))))
    .map((entries) => entries as HeaderEntry<V>[]);
}

const arbXMatch: fc.Arbitrary<XMatch | null> = fc.constantFrom<XMatch | null>(
  null,
  'all',
  'any',
  'all-with-x',
  'any-with-x',
);

export const arbHeaderArguments: fc.Arbitrary<HeaderArguments> = fc.record({
  xMatch: arbXMatch,
  args: arbEntries(arbHeaderCondition),
});

const arbWords = (vocabulary: readonly string[], most: number): fc.Arbitrary<string> =>
  fc.array(fc.constantFrom(...vocabulary), { maxLength: most }).map((words) => words.join('.'));

/** A topic pattern. A binding key may have at most two `#` words (ADR-0022), so patterns with more are left out. */
const arbPattern: fc.Arbitrary<string> = arbWords(['a', 'b', '*', '#', ''], 3).filter(
  (pattern) => pattern.split('.').filter((word) => word === '#').length <= 2,
);
const arbKey: fc.Arbitrary<string> = arbWords(['a', 'b', ''], 3);

const EXCHANGES = ['x0', 'x1', 'x2', 'x3'] as const;
const QUEUES = ['q0', 'q1', 'q2'] as const;
const TYPES: readonly ExchangeType[] = ['direct', 'fanout', 'topic', 'headers'];

const arbExchange = (name: string): fc.Arbitrary<Exchange> =>
  fc.record({
    name: fc.constant(name),
    type: fc.constantFrom(...TYPES),
    internal: fc.constantFrom(false, false, false, true),
  });

function arbBinding(exchanges: readonly Exchange[], queues: readonly string[]): fc.Arbitrary<Binding> {
  return fc
    .tuple(
      fc.constantFrom(...exchanges),
      fc
        .boolean()
        .chain((toExchange): fc.Arbitrary<Destination> =>
          toExchange
            ? fc.constantFrom(...exchanges).map((target): Destination => ({ kind: 'exchange', name: target.name }))
            : fc.constantFrom(...queues).map((name): Destination => ({ kind: 'queue', name })),
        ),
    )
    .chain(([source, destination]) => {
      switch (source.type) {
        case 'direct':
          return arbKey.map((key): Binding => ({ source: source.name, destination, key }));
        case 'topic':
          return arbPattern.map((key): Binding => ({ source: source.name, destination, key }));
        case 'fanout':
          return fc.constantFrom('', 'x').map((key): Binding => ({ source: source.name, destination, key }));
        case 'headers':
          return arbHeaderArguments.map((headers): Binding => ({ source: source.name, destination, key: '', headers }));
      }
    });
}

/**
 * A topology of up to four exchanges and three queues, with bindings between them that may form chains, diamonds,
 * cycles and loops on one exchange. Some exchanges are internal. At least one exchange is not.
 */
export const arbTopology: fc.Arbitrary<Topology> = fc
  .tuple(fc.integer({ min: 1, max: EXCHANGES.length }), fc.integer({ min: 1, max: QUEUES.length }))
  .chain(([exchangeCount, queueCount]) =>
    fc.tuple(...EXCHANGES.slice(0, exchangeCount).map(arbExchange)).chain((exchanges) => {
      const queues = QUEUES.slice(0, queueCount);
      const [first, ...rest] = exchanges;
      const open = first === undefined ? [] : [{ ...first, internal: false }, ...rest];
      return fc
        .array(arbBinding(open, queues), { maxLength: 14 })
        .map((bindings): Topology => ({ vhost: '/', exchanges: open, queues, bindings }));
    }),
  );

/** A message for `topology`: to one of its exchanges (internal or not), the default exchange, or one that is not there. */
export function arbMessageFor(topology: Topology): fc.Arbitrary<Message> {
  const targets = [...topology.exchanges.map((exchange) => exchange.name), '', 'missing'];
  return fc.record({
    exchange: fc.constantFrom(...targets),
    key: fc.oneof(arbKey, fc.constantFrom(...QUEUES)),
    headers: arbEntries(arbHeaderValue),
  });
}
