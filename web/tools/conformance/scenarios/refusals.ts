import type { Scenario } from '../scenario';
import { bindKey, declareExchange, declareQueue, exchange, publish, queue, refused } from './helpers';

/**
 * What the broker refuses, and what it leaves alone when it does. A refused step closes a channel (or, for a transient
 * queue, the connection), so each scenario goes on after its refusals: that shows that the broker, and the runner,
 * recover. The recording says which code and text each refusal came with. These are the answers that the engine's
 * `route()` gives for a publish, and that later slices give for declaring and binding.
 */
export const REFUSAL_SCENARIOS: readonly Scenario[] = [
  {
    id: 'routing/publishing-to-an-exchange-that-does-not-exist-is-refused',
    kind: 'routing',
    title:
      'Publishing to an exchange that does not exist is refused, whether or not a queue has that name, and the next publish works (M1 plan, S1)',
    steps: [
      declareExchange('events', 'fanout'),
      declareQueue('inbox'),
      bindKey('events', queue('inbox'), ''),
      refused(publish('nowhere', 'k', 'm1')),
      publish('events', 'k', 'm2'),
      // `inbox` is a queue, not an exchange: the two kinds of name are separate.
      refused(publish('inbox', 'k', 'm3')),
      publish('events', 'k', 'm4'),
    ],
  },
  {
    id: 'routing/an-internal-exchange-cannot-be-published-to-but-still-routes',
    kind: 'routing',
    title:
      'A client cannot publish to an internal exchange, but another exchange can route through it (ADR-0008, rule 8)',
    steps: [
      declareExchange('front', 'fanout'),
      declareExchange('hidden', 'fanout', { internal: true }),
      declareQueue('inbox'),
      bindKey('front', exchange('hidden'), ''),
      bindKey('hidden', queue('inbox'), ''),
      refused(publish('hidden', '', 'm1')),
      publish('front', '', 'm2'),
      refused(publish('hidden', '', 'm3')),
    ],
  },
  {
    id: 'routing/a-queue-that-is-neither-durable-nor-exclusive-is-refused',
    kind: 'routing',
    title:
      'A queue that is neither durable nor exclusive is refused, the broker closes the connection, and nothing was created (ADR-0008, rule 28)',
    steps: [
      declareExchange('events', 'fanout'),
      refused({ op: 'queue.declare', name: 'transient', durable: false }),
      // The queue was not created, so there is nothing to bind to.
      refused(bindKey('events', queue('transient'), '')),
      declareQueue('inbox'),
      bindKey('events', queue('inbox'), ''),
      publish('events', '', 'm1'),
    ],
  },
  {
    id: 'routing/a-queue-that-is-not-durable-is-accepted-when-it-is-exclusive',
    kind: 'routing',
    title: 'A queue that is not durable is accepted when it is exclusive, and routing reaches it (ADR-0008, rule 28)',
    steps: [
      declareExchange('events', 'fanout'),
      { op: 'queue.declare', name: 'mine', durable: false, exclusive: true },
      bindKey('events', queue('mine'), ''),
      publish('events', '', 'm1'),
    ],
  },
  {
    id: 'routing/names-that-start-with-amq-are-refused',
    kind: 'routing',
    title:
      'Declaring an exchange or a queue whose name starts with amq. is refused with 403, and nothing is created (ADR-0008, rule 9)',
    steps: [
      declareExchange('events', 'fanout'),
      declareQueue('inbox'),
      bindKey('events', queue('inbox'), ''),
      refused(declareExchange('amq.mine', 'direct')),
      refused({ op: 'queue.declare', name: 'amq.mine', durable: true }),
      // The bare prefix is refused too.
      refused(declareExchange('amq.', 'direct')),
      // Nothing was created: there is no such exchange to publish to or to bind from.
      refused(publish('amq.mine', '', 'm1')),
      refused(bindKey('amq.mine', queue('inbox'), '')),
      publish('events', '', 'm2'),
    ],
  },
  {
    id: 'routing/only-the-prefix-amq-dot-is-reserved',
    kind: 'routing',
    title:
      'Only a name that starts with amq. in lower case is reserved: amq, AMQ.x and amqp.x are ordinary names (ADR-0008, rule 9)',
    steps: [
      declareExchange('amq', 'fanout'),
      declareExchange('AMQ.upper', 'fanout'),
      declareExchange('amqp.x', 'fanout'),
      declareQueue('amq'),
      declareQueue('AMQ.upper'),
      declareQueue('amqp.x'),
      bindKey('amq', queue('amq'), ''),
      bindKey('AMQ.upper', queue('AMQ.upper'), ''),
      bindKey('amqp.x', queue('amqp.x'), ''),
      publish('amq', '', 'm1'),
      publish('AMQ.upper', '', 'm2'),
      publish('amqp.x', '', 'm3'),
    ],
  },
  {
    id: 'routing/the-default-exchange-cannot-be-declared-or-bound',
    kind: 'routing',
    title:
      'The default exchange cannot be declared, and cannot be the source or the destination of a binding, which leaves nothing behind (ADR-0008, rule 6)',
    steps: [
      declareExchange('e', 'direct'),
      declareQueue('inbox'),
      refused(declareExchange('', 'direct')),
      refused(bindKey('', queue('inbox'), 'k')),
      refused(bindKey('', exchange('e'), 'k')),
      refused(bindKey('e', exchange(''), 'k')),
      // It still routes by queue name, and the bindings that were refused did not add a key.
      publish('', 'inbox', 'm1'),
      publish('', 'k', 'm2'),
    ],
  },
  {
    id: 'routing/a-binding-to-something-that-does-not-exist-is-refused',
    kind: 'routing',
    title:
      'A binding that names an exchange or a queue that does not exist is refused with 404, and routing is unchanged (M1 plan, S1)',
    steps: [
      declareExchange('e', 'direct'),
      declareQueue('inbox'),
      refused(bindKey('nope', queue('inbox'), 'k')),
      refused(bindKey('e', queue('nope'), 'k')),
      refused(bindKey('e', exchange('nope'), 'k')),
      refused(bindKey('nope', exchange('e'), 'k')),
      bindKey('e', queue('inbox'), 'k'),
      publish('e', 'k', 'm1'),
      publish('e', 'other', 'm2'),
    ],
  },
];
