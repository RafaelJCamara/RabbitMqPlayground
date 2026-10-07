import type { Binding, BindingEvaluation, BindingOutcome, Destination, ExchangeType, Topology } from '@rmq/engine';
import { formatCondition } from '../syntax/values';
import { headersWords } from './headers-words';
import { topicWords } from './topic-words';
import type { BindingDetail, BindingNode, ExchangeNode } from './types';
import { exchangeText, keyText, quoted, shorten } from './words';

/** What a binding made of a message, as the tree of an explanation draws it (ADR-0060): the verdict, the sentence, the short reason and the detail that they were made of. */

/** A binding as a person says it: the key of a direct or a topic exchange, nothing for a fanout, the mode and conditions of a headers exchange. */
export function bindingLabel(binding: Binding | undefined, type: ExchangeType | 'default'): string {
  if (binding === undefined || type === 'default') {
    return 'the queue that is named by the key';
  }
  switch (type) {
    case 'direct':
    case 'topic':
      return keyText(binding.key);
    case 'fanout':
      return 'any key';
    case 'headers':
      return [
        `x-match=${binding.headers?.xMatch ?? 'all'}`,
        ...(binding.headers?.args ?? []).map(({ key, value }) => formatCondition(key, value, [])),
      ].join(' ');
  }
}

/** The name of a destination in a sentence: `queue billing`, `exchange payments`. */
export const destinationText = ({ kind, name }: Destination): string => `${kind} ${name}`;

const OUTCOME_TEXT: Readonly<Record<BindingOutcome, (to: Destination) => string>> = {
  'queue-first-copy': (to) => `The queue ${to.name} gets its first copy.`,
  'queue-already-had-a-copy': (to) =>
    `The queue ${to.name} had a copy already, and a queue gets one copy of a message however many bindings match.`,
  'exchange-visited-next': (to) => `The message goes on to the exchange ${to.name}.`,
  'exchange-already-visited': (to) =>
    `The exchange ${to.name} had been reached already, and an exchange is visited once.`,
  'destination-missing': (to) => `The ${destinationText(to)} is not there.`,
};

/** The sentence and the short reason of one evaluation, and what it compared. */
function describe(evaluation: BindingEvaluation): { text: string; short: string; detail: BindingDetail } {
  const { match } = evaluation;
  switch (match.kind) {
    case 'direct':
      return {
        text: evaluation.matched
          ? `The key ${keyText(match.routingKey)} is the binding key, letter for letter.`
          : `The key is ${keyText(match.routingKey)}, and this binding wants ${keyText(match.bindingKey)}: a direct exchange compares the whole key, letter for letter.`,
        short: evaluation.matched ? 'key matches' : shorten(`key is not ${keyText(match.bindingKey)}`),
        detail: { kind: 'direct', bindingKey: match.bindingKey, routingKey: match.routingKey },
      };
    case 'fanout':
      return {
        text: 'A fanout exchange sends every message to every queue and exchange that is bound to it, whatever the key.',
        short: 'fanout: always matches',
        detail: { kind: 'fanout' },
      };
    case 'topic': {
      const words = topicWords(evaluation.key, match.key.join('.'), match.pattern, match.key, match.alignment);
      return {
        ...words,
        detail: {
          kind: 'topic',
          pattern: match.pattern,
          key: match.key,
          segments: match.alignment.segments,
          ...(match.alignment.miss === undefined ? {} : { miss: match.alignment.miss }),
        },
      };
    }
    case 'headers': {
      const { text, short, conditions } = headersWords(match.result);
      return {
        text,
        short,
        detail: {
          kind: 'headers',
          xMatch: match.result.xMatch,
          omitted: match.result.omitted,
          conditions,
          counted: match.result.counted,
          passed: match.result.passed,
        },
      };
    }
    case 'default':
      return {
        text: evaluation.matched
          ? `The key is ${keyText(match.routingKey)}, and the default exchange sends a message to the queue that has that name: ${match.queue}.`
          : `The key is ${keyText(match.routingKey)}, and the queue ${match.queue} is named ${quoted(match.queue)}: the default exchange only sends a message to the queue that is named by its key.`,
        short: evaluation.matched ? 'named by the key' : 'not named by the key',
        detail: { kind: 'default', queue: match.queue, routingKey: match.routingKey },
      };
  }
}

/** One evaluation of a binding as a node of the tree. `next` is the exchange that it took the message to, when it was the first to. */
export function bindingNode(
  topology: Topology,
  from: string,
  type: ExchangeType | 'default',
  evaluation: BindingEvaluation,
  next: ExchangeNode | null,
): BindingNode {
  const { text, short, detail } = describe(evaluation);
  const { outcome } = evaluation;
  return {
    index: evaluation.index,
    from,
    to: evaluation.destination,
    label: bindingLabel(evaluation.index === null ? undefined : topology.bindings[evaluation.index], type),
    verdict: evaluation.matched ? 'matched' : 'missed',
    followed: outcome === 'queue-first-copy' || outcome === 'exchange-visited-next',
    ...(outcome === undefined ? {} : { outcome }),
    short,
    text: outcome === undefined ? text : `${text} ${OUTCOME_TEXT[outcome](evaluation.destination)}`,
    detail,
    next,
  };
}

/** What a binding is, in a sentence that names where it starts and where it goes: `orders to queue billing`. */
export const bindingEnds = (from: string, to: Destination): string => `${exchangeText(from)} to ${destinationText(to)}`;
