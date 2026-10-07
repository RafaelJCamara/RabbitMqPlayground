import {
  explainMiss,
  route,
  type Binding,
  type ExchangeType,
  type Message,
  type MissReason,
  type Routed,
  type RoutePath,
  type Topology,
} from '@rmq/engine';
import { bindingEnds, bindingLabel, bindingNode, destinationText } from './binding';
import { messageIssue, refusalText } from './route';
import type { BindingNode, QueueExplanation, ReasonNode } from './types';
import { exchangeText, quoted } from './words';

/**
 * What came of one queue (ADR-0060): how a message got a copy into it, or every way that it could have, and what stopped each. It is asked for on demand, because a canvas has as many answers as it has queues,
 * and the answer is bounded by the size of the topology (ADR-0059).
 */

const typeOf = (topology: Topology, name: string): ExchangeType | 'default' =>
  name === '' ? 'default' : (topology.exchanges.find((candidate) => candidate.name === name)?.type ?? 'direct');

/** The bindings that took the message to a queue, in order, each as the tree draws it. */
function pathTo(topology: Topology, result: Routed, queue: string): BindingNode[] {
  const { hops } = result.paths.find((path) => path.queue === queue) as RoutePath;
  return hops.map((hop) => {
    const visit = result.trace.visits.find((candidate) => candidate.exchange === hop.from);
    const evaluation = visit?.bindings.find((candidate) => candidate.index === hop.binding);
    return bindingNode(
      topology,
      hop.from,
      typeOf(topology, hop.from),
      evaluation as NonNullable<typeof evaluation>,
      null,
    );
  });
}

function reasonNode(topology: Topology, message: Message, queue: string, reason: MissReason): ReasonNode {
  switch (reason.kind) {
    case 'refused':
      return {
        kind: 'refused',
        text: refusalText(message.exchange, reason.code, reason.text),
        code: reason.code,
        reply: reason.text,
      };
    case 'no-such-queue':
      return { kind: 'no-such-queue', text: `There is no queue called ${quoted(queue)}.` };
    case 'default-exchange':
      return {
        kind: 'default-exchange',
        text: `The message was published to the default exchange, which sends it to the queue that is named by its key, ${quoted(reason.routingKey)}, and not to ${queue}.`,
        routingKey: reason.routingKey,
      };
    case 'no-bindings':
      return {
        kind: 'no-bindings',
        text:
          reason.destination.kind === 'queue'
            ? `Nothing is bound to the queue ${reason.destination.name}, so no message can get there by a binding.`
            : `Nothing is bound to the exchange ${reason.destination.name}, so nothing leads into it and the message cannot reach it.`,
        destination: reason.destination,
      };
    case 'binding-did-not-match': {
      const source = (topology.bindings[reason.binding] as Binding).source;
      const node = bindingNode(topology, source, typeOf(topology, source), reason.evaluation, null);
      return {
        kind: 'binding-did-not-match',
        text: `The binding from ${bindingEnds(source, node.to)} (${node.label}) was tried, and it did not match. ${node.text}`,
        binding: node,
      };
    }
    case 'exchange-not-reached': {
      const binding = topology.bindings[reason.binding] as Binding;
      const label = bindingLabel(binding, typeOf(topology, reason.exchange));
      const to = destinationText(binding.destination);
      return {
        kind: 'exchange-not-reached',
        text: `${exchangeText(reason.exchange)} is bound to ${to} (${label}), but the message never reached ${exchangeText(reason.exchange)}.`,
        binding: reason.binding,
        exchange: reason.exchange,
        because: reason.because.map((inner) => reasonNode(topology, message, queue, inner)),
      };
    }
    case 'cycle':
      return {
        kind: 'cycle',
        text: `The exchange ${reason.exchange} is part of a cycle that this explanation is already inside: the exchanges in it only lead into each other, and nothing that the message reached leads into them.`,
        exchange: reason.exchange,
      };
    case 'already-explained':
      return {
        kind: 'already-explained',
        text: `Why the message did not reach the exchange ${reason.exchange} is given above, where it was first met.`,
        exchange: reason.exchange,
      };
  }
}

export function explainQueue(topology: Topology, message: Message, queue: string): QueueExplanation {
  const issue = messageIssue(message);
  if (issue !== null) {
    return {
      queue,
      reached: false,
      text: `The message cannot be sent, so ${queue} did not get it.`,
      path: [],
      because: [{ kind: 'invalid', text: `${issue}.` }],
    };
  }
  const result = route(topology, message);
  const miss = explainMiss(topology, message, queue);
  if (!result.ok) {
    return {
      queue,
      reached: false,
      text: `The broker refuses the publish, so ${queue} did not get the message.`,
      path: [],
      because: miss.reasons.map((reason) => reasonNode(topology, message, queue, reason)),
    };
  }
  if (miss.reached) {
    return {
      queue,
      reached: true,
      text: `The queue ${queue} got a copy of the message.`,
      path: pathTo(topology, result, queue),
      because: [],
    };
  }
  return {
    queue,
    reached: false,
    text: `The queue ${queue} did not get the message.`,
    path: [],
    because: miss.reasons.map((reason) => reasonNode(topology, message, queue, reason)),
  };
}
