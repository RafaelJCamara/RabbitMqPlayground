import type { Scenario, Step } from '../scenario';
import {
  again,
  bindHeaders,
  bindKey,
  declareQueue,
  entry,
  exchange,
  int,
  publish,
  queue,
  refused,
  unbindHeaders,
  unbindKey,
} from './helpers';

/**
 * A declaration that repeats, and an unbind of what is not there (ADR-0051). RabbitMQ treats a declaration as "make sure
 * that this is there": the same attributes change nothing, and other attributes are refused with 406 and the first
 * attribute that differs, in the order type, durable, auto_delete, internal. An unbind is accepted whether or not the
 * binding is there, and whether or not its ends are, and only the default exchange is refused.
 */

/** An exchange with every attribute written out, because the runner's own defaults are not durable and not auto-delete. */
const declare = (
  name: string,
  type: 'direct' | 'fanout' | 'topic' | 'headers',
  flags: { durable?: boolean; autoDelete?: boolean; internal?: boolean } = {},
): Extract<Step, { op: 'exchange.declare' }> => ({
  op: 'exchange.declare',
  name,
  type,
  durable: flags.durable ?? true,
  autoDelete: flags.autoDelete ?? false,
  internal: flags.internal ?? false,
});

export const REDECLARE_SCENARIOS: readonly Scenario[] = [
  {
    id: 'routing/declaring-an-exchange-again-with-the-same-attributes-changes-nothing',
    kind: 'routing',
    title:
      'Declaring an exchange that is there, with every attribute the same, is accepted and changes nothing: the bindings stay (ADR-0051)',
    steps: [
      declare('e', 'direct'),
      declareQueue('inbox'),
      bindKey('e', queue('inbox'), 'k'),
      again(declare('e', 'direct')),
      publish('e', 'k', 'm1'),
      declare('f', 'topic', { durable: false, autoDelete: true, internal: true }),
      again(declare('f', 'topic', { durable: false, autoDelete: true, internal: true })),
      bindKey('e', exchange('f'), 'k'),
      publish('e', 'k', 'm2'),
    ],
  },
  {
    id: 'routing/declaring-an-exchange-again-with-another-attribute-is-refused',
    kind: 'routing',
    title:
      'Declaring an exchange that is there with another type, or another durable, auto-delete or internal flag, is refused with 406 and the attribute that differs, and the exchange is as it was (ADR-0051)',
    steps: [
      declare('e', 'direct'),
      declareQueue('inbox'),
      bindKey('e', queue('inbox'), 'a.*'),
      refused(again(declare('e', 'topic'))),
      refused(again(declare('e', 'direct', { durable: false }))),
      refused(again(declare('e', 'direct', { autoDelete: true }))),
      refused(again(declare('e', 'direct', { internal: true }))),
      // Still a direct exchange, so the key is a literal: a topic exchange would have routed it.
      publish('e', 'a.b', 'm1'),
      publish('e', 'a.*', 'm2'),
    ],
  },
  {
    id: 'routing/declaring-an-exchange-again-with-several-attributes-different-reports-the-first',
    kind: 'routing',
    title:
      'When several attributes differ, the refusal names the first of the type, durable, auto-delete and internal flags, in that order (ADR-0051)',
    steps: [
      declare('e', 'direct'),
      refused(again(declare('e', 'fanout', { durable: false, autoDelete: true, internal: true }))),
      refused(again(declare('e', 'direct', { durable: false, autoDelete: true, internal: true }))),
      refused(again(declare('e', 'direct', { autoDelete: true, internal: true }))),
      declareQueue('inbox'),
      bindKey('e', queue('inbox'), 'k'),
      publish('e', 'k', 'm1'),
    ],
  },
  {
    id: 'routing/declaring-a-queue-again-changes-nothing',
    kind: 'routing',
    title:
      'Declaring a queue that is there, with the same attributes, is accepted and changes nothing: the messages and the bindings stay (ADR-0051)',
    steps: [
      declareQueue('inbox'),
      declare('e', 'fanout'),
      bindKey('e', queue('inbox'), ''),
      publish('e', '', 'm1'),
      again(declareQueue('inbox')),
      publish('e', '', 'm2'),
    ],
  },
  {
    id: 'routing/declaring-a-queue-that-is-there-as-not-durable-is-refused-as-another-attribute',
    kind: 'routing',
    title:
      'A queue that is there and is declared again as not durable is refused with 406 and the durable flag, and not with the 541 of a new transient queue (ADR-0051, ADR-0021)',
    steps: [
      declareQueue('inbox'),
      declare('e', 'fanout'),
      bindKey('e', queue('inbox'), ''),
      refused(again({ op: 'queue.declare', name: 'inbox', durable: false })),
      publish('e', '', 'm1'),
    ],
  },
  {
    id: 'routing/unbinding-takes-a-binding-away',
    kind: 'routing',
    title: 'After an unbind, the exchange no longer routes by that binding, and the others stay (ADR-0051)',
    steps: [
      declare('e', 'direct'),
      declareQueue('inbox'),
      bindKey('e', queue('inbox'), 'k1'),
      bindKey('e', queue('inbox'), 'k2'),
      publish('e', 'k1', 'm1'),
      unbindKey('e', queue('inbox'), 'k1'),
      publish('e', 'k1', 'm2'),
      publish('e', 'k2', 'm3'),
    ],
  },
  {
    id: 'routing/unbinding-what-is-not-bound-changes-nothing',
    kind: 'routing',
    title:
      'Unbinding a key that is not bound, a binding that is already gone, or two ends that were never bound is accepted and changes nothing (ADR-0051)',
    steps: [
      declare('e', 'direct'),
      declareQueue('inbox'),
      declareQueue('other'),
      bindKey('e', queue('inbox'), 'k1'),
      unbindKey('e', queue('inbox'), 'never-bound'),
      unbindKey('e', queue('other'), 'k1'),
      publish('e', 'k1', 'm1'),
      unbindKey('e', queue('inbox'), 'k1'),
      unbindKey('e', queue('inbox'), 'k1'),
      publish('e', 'k1', 'm2'),
    ],
  },
  {
    id: 'routing/unbinding-an-exchange-from-an-exchange',
    kind: 'routing',
    title:
      'An exchange-to-exchange binding is taken away by an unbind, and then nothing is routed through it (ADR-0051)',
    steps: [
      declare('front', 'direct'),
      declare('back', 'fanout'),
      declareQueue('inbox'),
      bindKey('front', exchange('back'), 'k'),
      bindKey('back', queue('inbox'), ''),
      publish('front', 'k', 'm1'),
      unbindKey('front', exchange('back'), 'k'),
      publish('front', 'k', 'm2'),
    ],
  },
  {
    id: 'routing/unbinding-from-or-to-something-that-is-not-there-is-accepted',
    kind: 'routing',
    title:
      'An unbind whose exchange or queue does not exist is accepted, as is one between two exchanges where one is missing, and routing is unchanged (ADR-0051)',
    steps: [
      declare('e', 'direct'),
      declareQueue('inbox'),
      bindKey('e', queue('inbox'), 'k'),
      unbindKey('nope', queue('inbox'), 'k'),
      unbindKey('e', queue('nope'), 'k'),
      unbindKey('e', exchange('nope'), 'k'),
      unbindKey('nope', exchange('e'), 'k'),
      publish('e', 'k', 'm1'),
    ],
  },
  {
    id: 'routing/unbinding-a-topic-key-that-no-binding-could-have-is-accepted',
    kind: 'routing',
    title:
      'An unbind with a key that a topic exchange would refuse in a binding (more than two # words) is accepted: only a binding is checked for it (ADR-0051, ADR-0022)',
    steps: [
      declare('t', 'topic'),
      declareQueue('inbox'),
      bindKey('t', queue('inbox'), 'a.#'),
      unbindKey('t', queue('inbox'), '#.#.#'),
      publish('t', 'a.b', 'm1'),
    ],
  },
  {
    id: 'routing/the-default-exchange-cannot-be-unbound-from-or-to',
    kind: 'routing',
    title:
      'Unbinding from the default exchange, or to it, is refused with 403 as binding is, and leaves nothing behind (ADR-0051, ADR-0008 rule 6)',
    steps: [
      declare('e', 'direct'),
      declareQueue('inbox'),
      refused(unbindKey('', queue('inbox'), 'inbox')),
      refused(unbindKey('', exchange('e'), 'k')),
      refused(unbindKey('e', exchange(''), 'k')),
      publish('', 'inbox', 'm1'),
    ],
  },
  {
    id: 'routing/unbinding-a-headers-binding-needs-the-same-arguments',
    kind: 'routing',
    title:
      'A headers binding is taken away only by an unbind with the same arguments: other values or another x-match leave it, and the same arguments remove it (ADR-0051, ADR-0009)',
    steps: [
      declare('h', 'headers'),
      declareQueue('inbox'),
      bindHeaders('h', queue('inbox'), 'all', [entry('a', int(1))]),
      unbindHeaders('h', queue('inbox'), 'all', [entry('a', int(2))]),
      unbindHeaders('h', queue('inbox'), 'any', [entry('a', int(1))]),
      publish('h', '', 'm1', [entry('a', int(1))]),
      unbindHeaders('h', queue('inbox'), 'all', [entry('a', int(1))]),
      publish('h', '', 'm2', [entry('a', int(1))]),
    ],
  },
  {
    id: 'routing/an-unbind-with-x-match-all-is-not-the-binding-that-left-x-match-out',
    kind: 'routing',
    title:
      'A headers binding that leaves x-match out is another binding than one that says all, so an unbind has to say the same (ADR-0051, ADR-0009)',
    steps: [
      declare('h', 'headers'),
      declareQueue('inbox'),
      bindHeaders('h', queue('inbox'), null, [entry('a', int(1))]),
      unbindHeaders('h', queue('inbox'), 'all', [entry('a', int(1))]),
      publish('h', '', 'm1', [entry('a', int(1))]),
      unbindHeaders('h', queue('inbox'), null, [entry('a', int(1))]),
      publish('h', '', 'm2', [entry('a', int(1))]),
    ],
  },
];
