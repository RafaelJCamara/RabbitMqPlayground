import type { Scenario, Step } from '../scenario';
import {
  bindHeaders,
  bindKey,
  declareExchange,
  declareQueue,
  entry,
  exchange,
  int,
  publish,
  queue,
  str,
} from './helpers';

/**
 * Direct and fanout exchanges, the default exchange, and what is unroutable (ADR-0008, rules 2, 3, 6, 10 and 12).
 */

/** One exchange `e`, one queue for every key (named `k:<key>`), and one publish for every key (body `m:<key>`). */
function keyTable(
  id: string,
  title: string,
  type: 'direct' | 'fanout',
  bindingKeys: readonly string[],
  messageKeys: readonly string[],
): Scenario {
  const steps: Step[] = [
    declareExchange('e', type),
    ...bindingKeys.flatMap((key) => [declareQueue(`k:${key}`), bindKey('e', queue(`k:${key}`), key)]),
    ...messageKeys.map((key) => publish('e', key, `m:${key}`)),
  ];
  return { id: `routing/${id}`, kind: 'routing', title, steps };
}

/** Keys that are the same to a person and different to a broker, and keys that look like patterns. */
const DIRECT_KEYS = ['a', 'A', 'a ', ' a', '', 'é', 'é', '#', '*', 'a.#', 'a.*', 'a.b', '#.#.#'];

export const EXCHANGE_SCENARIOS: readonly Scenario[] = [
  keyTable(
    'direct-compares-the-whole-key-byte-for-byte',
    'A direct exchange routes on the whole key: case, spaces, a composed and a decomposed é, and the empty key all count, and # and * are ordinary characters (ADR-0008, rule 2)',
    'direct',
    DIRECT_KEYS,
    [...DIRECT_KEYS, 'a.x', 'x', 'a.b.c'],
  ),
  {
    id: 'routing/direct-a-key-may-reach-several-queues-and-a-queue-may-have-several-keys',
    kind: 'routing',
    title:
      'A direct exchange sends a message to every queue that is bound with its key, and a queue bound twice, or with several keys, gets one copy (ADR-0008, rules 2 and 7)',
    steps: [
      declareExchange('d', 'direct'),
      declareQueue('first'),
      declareQueue('second'),
      declareQueue('third'),
      bindKey('d', queue('first'), 'k1'),
      bindKey('d', queue('first'), 'k2'),
      bindKey('d', queue('second'), 'k1'),
      bindKey('d', queue('third'), 'k3'),
      bindKey('d', queue('third'), 'k3'),
      publish('d', 'k1', 'm1'),
      publish('d', 'k2', 'm2'),
      publish('d', 'k3', 'm3'),
      publish('d', 'k4', 'm4'),
    ],
  },
  {
    id: 'routing/fanout-ignores-the-key-and-the-headers-of-a-binding-and-of-a-message',
    kind: 'routing',
    title:
      'A fanout exchange ignores the key and the headers, on the binding and on the message, even a key that no topic exchange would accept (ADR-0008, rule 3)',
    steps: [
      declareExchange('f', 'fanout'),
      declareQueue('plain'),
      declareQueue('keyed'),
      declareQueue('hashes'),
      declareQueue('headed'),
      bindKey('f', queue('plain'), ''),
      bindKey('f', queue('keyed'), 'some.key'),
      bindKey('f', queue('hashes'), '#.#.#'),
      bindHeaders('f', queue('headed'), 'all', [entry('a', int(1))]),
      publish('f', '', 'm1'),
      publish('f', 'other.key', 'm2'),
      publish('f', '', 'm3', [entry('a', int(2))]),
      publish('f', 'some.key', 'm4', [entry('a', str('1')), entry('b', int(1))]),
    ],
  },
  {
    id: 'routing/fanout-reaches-every-queue-bound-to-it',
    kind: 'routing',
    title:
      'A fanout exchange sends one copy to every queue that is bound to it, however many there are (ADR-0008, rule 3)',
    steps: [
      declareExchange('f', 'fanout'),
      ...Array.from({ length: 12 }, (_, index) => [
        declareQueue(`q${index + 1}`),
        bindKey('f', queue(`q${index + 1}`), `key-${index % 3}`),
      ]).flat(),
      declareQueue('unbound'),
      publish('f', 'x', 'm1'),
      publish('f', 'x', 'm2'),
    ],
  },
  {
    id: 'routing/the-default-exchange-routes-by-queue-name-and-nothing-else',
    kind: 'routing',
    title:
      'The default exchange routes by the exact name of a queue: case, spaces and dots count, a pattern is not one, and a binding elsewhere does not change it (ADR-0008, rule 6)',
    steps: [
      declareQueue('alpha'),
      declareQueue('ALPHA'),
      declareQueue('a.b'),
      declareQueue('a.*'),
      declareQueue('#'),
      declareQueue('with space'),
      declareQueue('é'),
      declareExchange('alpha', 'fanout'),
      declareExchange('elsewhere', 'direct'),
      bindKey('elsewhere', queue('alpha'), 'other'),
      publish('', 'alpha', 'm1'),
      publish('', 'ALPHA', 'm2'),
      publish('', 'a.b', 'm3'),
      publish('', 'a.*', 'm4'),
      publish('', 'a.x', 'm5'),
      publish('', '#', 'm6'),
      publish('', 'anything', 'm7'),
      publish('', 'with space', 'm8'),
      publish('', 'with  space', 'm9'),
      publish('', 'é', 'm10'),
      publish('', 'é', 'm11'),
      publish('', 'other', 'm12'),
      // An exchange named like a queue is a different thing, and has no bindings.
      publish('alpha', 'alpha', 'm13'),
      publish('elsewhere', 'other', 'm14'),
      publish('', 'alpha', 'm15', [entry('a', int(1))]),
    ],
  },
  {
    id: 'routing/a-message-that-matches-no-binding-is-returned',
    kind: 'routing',
    title:
      'A message that no binding matches is returned to the publisher, on every type of exchange, and so is one that is passed on to an exchange with no queues (ADR-0008, rules 10 and 12)',
    steps: [
      declareExchange('d', 'direct'),
      declareExchange('t', 'topic'),
      declareExchange('h', 'headers'),
      declareExchange('f', 'fanout'),
      declareExchange('dead-end', 'fanout'),
      declareQueue('dq'),
      declareQueue('tq'),
      declareQueue('hq'),
      bindKey('d', queue('dq'), 'k'),
      bindKey('t', queue('tq'), 'a.b'),
      bindHeaders('h', queue('hq'), 'all', [entry('n', int(1))]),
      bindKey('f', exchange('dead-end'), ''),
      publish('d', 'other', 'm1'),
      publish('t', 'a.c', 'm2'),
      publish('h', '', 'm3', [entry('n', int(2))]),
      publish('f', '', 'm4'),
      publish('dead-end', '', 'm5'),
      // The same exchanges, with a message that does match, so that returning is not what they always do.
      publish('d', 'k', 'm6'),
      publish('t', 'a.b', 'm7'),
      publish('h', '', 'm8', [entry('n', int(1))]),
    ],
  },
];
