import {
  headerValueIssue,
  route,
  routingKeyIssue,
  type BindingEvaluation,
  type ExchangeType,
  type ExchangeVisit,
  type Message,
  type Topology,
} from '@rmq/engine';
import { bindingNode } from './binding';
import type { BindingNode, ExchangeNode, RouteExplanation } from './types';
import { exchangeText, listOf, plural, quoted } from './words';

/**
 * The explanation of a route (ADR-0060): what a message did on a topology, as a tree of the exchanges that it reached and every binding that each one tried, with the verdict of each in words,
 * and the queues that got a copy and the ones that did not. It is the one function that the inspector, the Why? overlay, the what-if tester and the golden files all read, and it never throws:
 * a message that no client could send is `invalid` and says why.
 */

/** Why a message cannot be sent at all, or `null` when it can: the checks that `route` throws for, in the same words. */
export function messageIssue(message: Message): string | null {
  const key = routingKeyIssue(message.key);
  if (key !== null) {
    return key;
  }
  for (const { key: name, value } of message.headers) {
    const issue = headerValueIssue(value);
    if (issue !== null) {
      return `Header "${name}": ${issue}`;
    }
  }
  return null;
}

/** The sentence for a publish that the broker refuses: the cause first, and the broker's reply after it, as it says it. */
export function refusalText(exchange: string, code: 403 | 404, reply: string): string {
  return code === 404
    ? `There is no exchange called ${quoted(exchange)}, so the broker refuses the publish. Its reply is ${code} ${reply}.`
    : `${exchange} is an internal exchange, which a client cannot publish to and only another exchange can send messages to, so the broker refuses the publish. Its reply is ${code} ${reply}.`;
}

const TYPE_TEXT: Readonly<Record<ExchangeType, string>> = {
  direct: 'a direct exchange',
  fanout: 'a fanout exchange',
  topic: 'a topic exchange',
  headers: 'a headers exchange',
};

/** The implicit bindings of the default exchange: one for each queue, and the one whose name is the key is the one that matches. The topology has the queues, so the trace need not carry them. */
function implicitBindings(topology: Topology, message: Message): BindingEvaluation[] {
  return topology.queues.map((queue): BindingEvaluation => {
    const matched = queue === message.key;
    return {
      index: null,
      destination: { kind: 'queue', name: queue },
      key: queue,
      matched,
      match: { kind: 'default', queue, routingKey: message.key },
      ...(matched ? { outcome: 'queue-first-copy' as const } : {}),
    };
  });
}

function exchangeSentence(visit: ExchangeVisit, bindings: readonly BindingNode[], message: Message): string {
  const matched = bindings.filter(({ verdict }) => verdict === 'matched').length;
  const counted =
    bindings.length === 0
      ? ' It has no bindings.'
      : ` ${matched} of its ${plural(bindings.length, 'binding')} matched.`;
  if (visit.type === 'default') {
    return `The message was published to the default exchange, which sends it to the queue that is named by its key, ${quoted(message.key)}.${counted}`;
  }
  const arrival =
    visit.via === undefined
      ? 'the message was published to it'
      : `the message came to it from ${exchangeText(visit.via.from)}`;
  return `${visit.exchange} is ${TYPE_TEXT[visit.type]}, and ${arrival}.${counted}`;
}

/** What came of a message that reached no queue, in a sentence: where it went, and what each binding made of it. */
function nothingReached(
  visits: readonly ExchangeVisit[],
  nodes: ReadonlyMap<string, ExchangeNode>,
  message: Message,
): string {
  if (visits[0]?.type === 'default') {
    return `No queue got it: the default exchange sends a message to the queue that is named by its key, and no queue is named ${quoted(message.key)}.`;
  }
  const names = visits.map(({ exchange }) => exchange);
  const bindings = [...nodes.values()].flatMap((node) => node.bindings);
  const matched = bindings.filter(({ verdict }) => verdict === 'matched').length;
  const reached = `it reached ${listOf(names)}`;
  if (bindings.length === 0) {
    // An exchange that no binding leaves is the only one that the message reached.
    return `No queue got it: ${reached}, which has no bindings.`;
  }
  if (matched === 0) {
    // Nothing matched, so the message did not go beyond the exchange that it was published to.
    return bindings.length === 1
      ? `No queue got it: ${reached}, and its only binding did not match.`
      : `No queue got it: ${reached}, and none of its ${bindings.length} bindings matched.`;
  }
  return `No queue got it: ${reached}, and ${matched} of ${names.length === 1 ? 'its' : 'their'} ${plural(bindings.length, 'binding')} matched, but none of them led to a queue.`;
}

export function explainRoute(topology: Topology, message: Message): RouteExplanation {
  const issue = messageIssue(message);
  if (issue !== null) {
    return { outcome: 'invalid', message, text: `${issue}.` };
  }
  const result = route(topology, message);
  if (!result.ok) {
    return {
      outcome: 'refused',
      message,
      code: result.code,
      reply: result.text,
      text: refusalText(message.exchange, result.code, result.text),
    };
  }

  // The visits come in the order that the exchanges were reached, so an exchange is always after the one that led to it, and the tree is built from the last to the first.
  const nodes = new Map<string, ExchangeNode>();
  for (const visit of [...result.trace.visits].reverse()) {
    const evaluations = visit.type === 'default' ? implicitBindings(topology, message) : visit.bindings;
    const bindings = evaluations.map((evaluation) =>
      bindingNode(
        topology,
        visit.exchange,
        visit.type,
        evaluation,
        evaluation.outcome === 'exchange-visited-next'
          ? (nodes.get(evaluation.destination.name) as ExchangeNode)
          : null,
      ),
    );
    nodes.set(visit.exchange, {
      name: visit.exchange,
      type: visit.type,
      text: exchangeSentence(visit, bindings, message),
      bindings,
    });
  }

  return {
    outcome: result.queues.length === 0 ? 'unroutable' : 'routed',
    message,
    queues: result.queues,
    unreached: topology.queues.filter((queue) => !result.queues.includes(queue)),
    paths: result.paths,
    root: nodes.get(result.trace.exchange) as ExchangeNode,
    summary:
      result.queues.length === 0
        ? nothingReached(result.trace.visits, nodes, message)
        : `Reached ${listOf(result.queues)}.`,
  };
}
