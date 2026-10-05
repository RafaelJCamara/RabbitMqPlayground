import type { Scenario } from '../scenario';
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
 * Exchange-to-exchange bindings (ADR-0008, rule 7): a message is passed on from exchange to exchange with the routing
 * key and the headers it was published with, each exchange applies its own type, an exchange is visited once however
 * it is reached, and a queue gets at most one copy.
 */

const exchangeNames = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `x${String(index + 1).padStart(2, '0')}`);

export const CHAIN_SCENARIOS: readonly Scenario[] = [
  {
    id: 'routing/a-chain-of-exchanges-of-every-type-passes-the-key-and-the-headers-on',
    kind: 'routing',
    title:
      'A message goes through a topic, a headers, a direct and a fanout exchange in a row with the key and the headers it was published with, and each one applies its own type (ADR-0008, rule 7)',
    steps: [
      declareExchange('t', 'topic'),
      declareExchange('h', 'headers'),
      declareExchange('d', 'direct'),
      declareExchange('f', 'fanout'),
      declareQueue('end'),
      declareQueue('side'),
      bindKey('t', exchange('h'), 'a.#'),
      bindHeaders('h', exchange('d'), 'all', [entry('n', int(1))]),
      bindKey('d', exchange('f'), 'a.b'),
      bindKey('f', queue('end'), ''),
      bindKey('d', queue('side'), 'a.c'),
      publish('t', 'a.b', 'm1', [entry('n', int(1))]),
      publish('t', 'a.c', 'm2', [entry('n', int(1))]),
      publish('t', 'a.b', 'm3', [entry('n', int(2))]),
      publish('t', 'b.b', 'm4', [entry('n', int(1))]),
      publish('t', 'a.x', 'm5', [entry('n', int(1))]),
      publish('h', 'whatever', 'm6', [entry('n', int(1))]),
      publish('h', 'a.b', 'm7', [entry('n', int(1))]),
      publish('d', 'a.b', 'm8'),
      publish('f', 'x', 'm9'),
    ],
  },
  {
    id: 'routing/a-binding-between-exchanges-is-matched-by-the-source-exchange-with-its-own-type',
    kind: 'routing',
    title:
      'The key of a binding between exchanges is matched by the exchange it starts from, and the next exchange matches the same message again with its own bindings (ADR-0008, rule 7)',
    steps: [
      declareExchange('src-direct', 'direct'),
      declareExchange('src-topic', 'topic'),
      declareExchange('dst-fanout', 'fanout'),
      declareExchange('dst-direct', 'direct'),
      declareQueue('fanned'),
      declareQueue('exact'),
      bindKey('src-direct', exchange('dst-fanout'), 'k'),
      bindKey('dst-fanout', queue('fanned'), 'ignored'),
      bindKey('src-topic', exchange('dst-direct'), 'a.*'),
      bindKey('dst-direct', queue('exact'), 'a.b'),
      publish('src-direct', 'k', 'm1'),
      publish('src-direct', 'other', 'm2'),
      publish('src-topic', 'a.b', 'm3'),
      publish('src-topic', 'a.c', 'm4'),
      publish('src-topic', 'b.b', 'm5'),
    ],
  },
  {
    id: 'routing/headers-to-topic-to-direct-chain',
    kind: 'routing',
    title:
      'A message goes through a headers, a topic and a direct exchange in a row, and a miss at any of them stops it (ADR-0008, rule 7)',
    steps: [
      declareExchange('h', 'headers'),
      declareExchange('t', 'topic'),
      declareExchange('d', 'direct'),
      declareQueue('end'),
      bindHeaders('h', exchange('t'), 'any', [entry('a', int(1)), entry('b', str('x'))]),
      bindKey('t', exchange('d'), '#.x'),
      bindKey('d', queue('end'), 'k.x'),
      publish('h', 'k.x', 'm1', [entry('a', int(1))]),
      publish('h', 'k.x', 'm2', [entry('b', str('x'))]),
      publish('h', 'k.x', 'm3', [entry('b', int(1))]),
      publish('h', 'k.y', 'm4', [entry('a', int(1))]),
      publish('h', 'z.x', 'm5', [entry('a', int(1))]),
    ],
  },
  {
    id: 'routing/a-diamond-delivers-one-copy-however-many-paths-reach-the-queue',
    kind: 'routing',
    title:
      'A queue that three paths reach, two through exchanges and one directly, gets one copy, and the exchange that two paths reach is visited once (ADR-0008, rule 7)',
    steps: [
      declareExchange('top', 'fanout'),
      declareExchange('left', 'fanout'),
      declareExchange('right', 'fanout'),
      declareQueue('shared'),
      declareQueue('left-only'),
      declareQueue('right-only'),
      bindKey('top', exchange('left'), ''),
      bindKey('top', exchange('right'), ''),
      bindKey('top', queue('shared'), ''),
      bindKey('left', queue('shared'), ''),
      bindKey('right', queue('shared'), ''),
      bindKey('left', queue('left-only'), ''),
      bindKey('right', queue('right-only'), ''),
      publish('top', '', 'm1'),
      publish('left', '', 'm2'),
      publish('right', '', 'm3'),
    ],
  },
  {
    id: 'routing/a-cycle-of-two-exchanges-terminates',
    kind: 'routing',
    title:
      'Two exchanges that are bound to each other pass a message on once and stop, whichever one is published to (ADR-0008, rule 7)',
    steps: [
      declareExchange('a', 'fanout'),
      declareExchange('b', 'fanout'),
      declareQueue('qa'),
      declareQueue('qb'),
      bindKey('a', exchange('b'), ''),
      bindKey('b', exchange('a'), ''),
      bindKey('a', queue('qa'), ''),
      bindKey('b', queue('qb'), ''),
      publish('a', '', 'm1'),
      publish('b', '', 'm2'),
    ],
  },
  {
    id: 'routing/a-cycle-that-leads-to-the-queue-only-by-going-round',
    kind: 'routing',
    title:
      'A queue that hangs off the last exchange of a cycle is reached once, from any exchange of the cycle, and the cycle is gone round once (ADR-0008, rule 7)',
    steps: [
      declareExchange('x1', 'fanout'),
      declareExchange('x2', 'fanout'),
      declareExchange('x3', 'fanout'),
      declareExchange('x4', 'fanout'),
      declareQueue('only'),
      bindKey('x1', exchange('x2'), ''),
      bindKey('x2', exchange('x3'), ''),
      bindKey('x3', exchange('x1'), ''),
      bindKey('x3', queue('only'), ''),
      bindKey('x4', exchange('x2'), ''),
      publish('x1', '', 'm1'),
      publish('x2', '', 'm2'),
      publish('x3', '', 'm3'),
      publish('x4', '', 'm4'),
    ],
  },
  {
    id: 'routing/a-cycle-of-direct-and-topic-exchanges-matches-at-every-hop',
    kind: 'routing',
    title:
      'A cycle through a direct and a topic exchange matches the key at every hop, so it is only gone round while the key matches (ADR-0008, rule 7)',
    steps: [
      declareExchange('d', 'direct'),
      declareExchange('t', 'topic'),
      declareQueue('from-d'),
      declareQueue('from-t'),
      bindKey('d', exchange('t'), 'a.b'),
      bindKey('t', exchange('d'), 'a.*'),
      bindKey('d', queue('from-d'), 'a.b'),
      bindKey('t', queue('from-t'), '#'),
      publish('d', 'a.b', 'm1'),
      publish('d', 'a.c', 'm2'),
      publish('t', 'a.b', 'm3'),
      publish('t', 'a.c', 'm4'),
      publish('t', 'b', 'm5'),
    ],
  },
  {
    id: 'routing/an-exchange-bound-to-itself-terminates',
    kind: 'routing',
    title:
      'An exchange that is bound to itself passes a message on to itself once, and still delivers it (ADR-0008, rule 7)',
    steps: [
      declareExchange('f', 'fanout'),
      declareExchange('d', 'direct'),
      declareExchange('t', 'topic'),
      declareQueue('qf'),
      declareQueue('qd'),
      declareQueue('qt'),
      bindKey('f', exchange('f'), ''),
      bindKey('f', queue('qf'), ''),
      bindKey('d', exchange('d'), 'k'),
      bindKey('d', queue('qd'), 'k'),
      bindKey('t', exchange('t'), '#'),
      bindKey('t', queue('qt'), 'a.*'),
      publish('f', '', 'm1'),
      publish('d', 'k', 'm2'),
      publish('d', 'other', 'm3'),
      publish('t', 'a.b', 'm4'),
      publish('t', 'b', 'm5'),
    ],
  },
  {
    id: 'routing/a-long-chain-of-exchanges-reaches-its-queue',
    kind: 'routing',
    title:
      'A chain of thirty exchanges carries a message from either end to the queue at the last one (ADR-0008, rule 7)',
    steps: [
      ...exchangeNames(30).map((name) => declareExchange(name, 'fanout')),
      declareQueue('end'),
      ...exchangeNames(30).flatMap((name, index, all) => {
        const next = all[index + 1];
        return [next === undefined ? bindKey(name, queue('end'), '') : bindKey(name, exchange(next), '')];
      }),
      publish('x01', '', 'm1'),
      publish('x15', '', 'm2'),
      publish('x30', '', 'm3'),
    ],
  },
  {
    id: 'routing/a-wide-set-of-exchanges-reaches-each-queue-once',
    kind: 'routing',
    title:
      'One exchange that passes a message on to eight exchanges, which all share a queue and each have one of their own, reaches every queue once (ADR-0008, rule 7)',
    steps: [
      declareExchange('root', 'fanout'),
      ...exchangeNames(8).map((name) => declareExchange(name, 'fanout')),
      declareQueue('shared'),
      ...exchangeNames(8).flatMap((name, index) => [
        declareQueue(`own-${index + 1}`),
        bindKey('root', exchange(name), ''),
        bindKey(name, queue('shared'), ''),
        bindKey(name, queue(`own-${index + 1}`), ''),
      ]),
      publish('root', '', 'm1'),
      publish('x03', '', 'm2'),
    ],
  },
];
