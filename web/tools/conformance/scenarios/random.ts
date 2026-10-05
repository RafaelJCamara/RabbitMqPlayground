import { createPrng, type Prng } from '@rmq/engine';
import type {
  Destination,
  ExchangeType,
  HeaderCondition,
  HeaderEntry,
  HeaderValue,
  Scenario,
  Step,
  XMatch,
} from '../scenario';
import { bool, declareExchange, declareQueue, entry, exists, float, int, publish, str } from './helpers';

/**
 * Random topologies (M1 plan, section 5; ADR-0015: "generated topologies and messages run on a real broker and on the
 * engine, and the queues each message reaches are compared"). Each one is made from a seed with the engine's own PRNG,
 * never `Math.random`, so the scenario is the same on every machine and every run, and a fixture can be checked against
 * the scenario as it is written now.
 *
 * The vocabulary is small on purpose: three words, a few header keys and values. Messages and bindings then meet often
 * enough for the routes to be worth recording, across exchange types that are chained, cycled and bound to themselves.
 */

const pick = <T>(prng: Prng, items: readonly T[]): T => {
  const item = items[prng.nextInt(items.length)];
  if (item === undefined) {
    throw new Error('Nothing to pick from');
  }
  return item;
};

const chance = (prng: Prng, outOf: number): boolean => prng.nextInt(outOf) === 0;

const WORDS = ['a', 'b', 'c'] as const;
const HEADER_KEYS = ['a', 'b', 'x-c'] as const;
const MODES: readonly (XMatch | null)[] = [null, 'all', 'any', 'all-with-x', 'any-with-x'];
const TYPES: readonly ExchangeType[] = ['direct', 'fanout', 'topic', 'headers'];

const joinWords = (words: readonly string[]): string => words.join('.');

function sequence(prng: Prng, vocabulary: readonly string[], most: number): string {
  const length = prng.nextInt(most + 1);
  return joinWords(Array.from({ length }, () => pick(prng, vocabulary)));
}

/** A topic pattern. A binding key may have at most two `#` words (ADR-0022), so a third is turned into a `*`. */
function topicPattern(prng: Prng): string {
  const words = Array.from({ length: 1 + prng.nextInt(3) }, () => pick(prng, [...WORDS, '*', '#', '*', '#']));
  let hashes = 0;
  return joinWords(
    words.map((word) => {
      hashes += word === '#' ? 1 : 0;
      return word === '#' && hashes > 2 ? '*' : word;
    }),
  );
}

function headerValue(prng: Prng): HeaderValue {
  return pick<HeaderValue>(prng, [int(1), int(2), str('1'), float(1), bool(true)]);
}

function headerCondition(prng: Prng): HeaderCondition {
  return chance(prng, 5) ? exists : headerValue(prng);
}

function headerEntries<V>(prng: Prng, value: (prng: Prng) => V, most: number): HeaderEntry<V>[] {
  const keys = [...HEADER_KEYS].filter(() => prng.nextInt(2) === 0).slice(0, most);
  return keys.map((key) => entry(key, value(prng)));
}

interface Names {
  readonly exchanges: readonly { readonly name: string; readonly type: ExchangeType; readonly internal: boolean }[];
  readonly queues: readonly string[];
}

function bindingFor(prng: Prng, names: Names): Step {
  const source = pick(prng, names.exchanges);
  const destination: Destination = chance(prng, 3)
    ? { kind: 'exchange', name: pick(prng, names.exchanges).name }
    : { kind: 'queue', name: pick(prng, names.queues) };

  switch (source.type) {
    case 'direct':
      return { op: 'bind', source: source.name, destination, key: sequence(prng, WORDS, 2) };
    case 'topic':
      return { op: 'bind', source: source.name, destination, key: topicPattern(prng) };
    case 'fanout':
      return { op: 'bind', source: source.name, destination, key: pick(prng, ['', 'x']) };
    case 'headers':
      return {
        op: 'bind',
        source: source.name,
        destination,
        key: '',
        headers: { xMatch: pick(prng, MODES), args: headerEntries(prng, headerCondition, 3) },
      };
  }
}

function publishFor(prng: Prng, names: Names, body: string): Step {
  // Now and then a message goes to the default exchange, which routes by the name of a queue.
  if (chance(prng, 8)) {
    return publish('', pick(prng, [...names.queues, 'nobody']), body);
  }
  const target = pick(
    prng,
    names.exchanges.filter((candidate) => !candidate.internal),
  );
  const headers = chance(prng, 4) ? undefined : headerEntries(prng, headerValue, 3);
  return publish(target.name, sequence(prng, WORDS, 3), body, headers);
}

const sameBinding = (left: Step, right: Step): boolean => JSON.stringify(left) === JSON.stringify(right);

export function randomTopologyScenario(seed: number): Scenario {
  const prng = createPrng(seed);

  const exchanges = Array.from({ length: 2 + prng.nextInt(4) }, (_, index) => ({
    name: `x${index + 1}`,
    type: pick(prng, TYPES),
    // The first exchange is never internal, so that there is always one to publish to.
    internal: index > 0 && chance(prng, 8),
  }));
  const queues = Array.from({ length: 2 + prng.nextInt(4) }, (_, index) => `q${index + 1}`);
  const names: Names = { exchanges, queues };

  const bindings: Step[] = [];
  for (let count = 4 + prng.nextInt(9); count > 0; count--) {
    const binding = bindingFor(prng, names);
    if (!bindings.some((existing) => sameBinding(existing, binding))) {
      bindings.push(binding);
    }
  }

  const publishes = Array.from({ length: 6 + prng.nextInt(7) }, (_, index) => publishFor(prng, names, `m${index + 1}`));

  return {
    id: `routing/random-topology-${seed}`,
    kind: 'routing',
    title: `A random topology made from seed ${seed} with the engine's PRNG routes the way the broker does (ADR-0015)`,
    steps: [
      ...exchanges.map(({ name, type, internal }) => declareExchange(name, type, internal ? { internal: true } : {})),
      ...queues.map(declareQueue),
      ...bindings,
      ...publishes,
    ],
  };
}

/** How many random topologies are recorded. Raising it adds scenarios at the end and leaves the others as they are. */
export const RANDOM_TOPOLOGY_COUNT = 30;

export const RANDOM_SCENARIOS: readonly Scenario[] = Array.from({ length: RANDOM_TOPOLOGY_COUNT }, (_, index) =>
  randomTopologyScenario(index + 1),
);
