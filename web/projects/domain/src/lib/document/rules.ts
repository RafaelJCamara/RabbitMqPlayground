import {
  hashWordCount,
  internalExchangeReply,
  noExchangeReply,
  noQueueReply,
  TOPIC_MAX_HASH_WORDS,
  topicWildcardsReply,
  transientQueueReply,
} from '@rmq/engine';
import type { ElementKind, Issue } from './issue';
import { KIND_LABEL } from './names';

/**
 * The refusals of ADR-0021 and ADR-0022 and the rules of the simulator, as `Issue`s. A command and the validation of a
 * document refuse the same thing in the same words, so each refusal is made here, once. Each carries the broker's reply
 * where one was recorded, and a message that says what is wrong at its root.
 */

/** `541`: a queue that is not durable (ADR-0021, ADR-0024). */
export function transientQueueIssue(name: string): Issue {
  return {
    kind: 'transient-queue',
    message: `Queue '${name}' is not durable. RabbitMQ 4.3 no longer allows a queue that is neither durable nor exclusive: that is a deprecated feature (transient_nonexcl_queues) which is switched off, and the broker closes the connection of a client that declares one. The simulator has no exclusive queues, so every queue has to be durable.`,
    refusal: transientQueueReply(),
  };
}

/** `406`: a topic binding key with more `#` words than a broker allows (ADR-0022), or `null` when it has few enough. */
export function topicKeyIssue(key: string): Issue | null {
  const count = hashWordCount(key);
  return count <= TOPIC_MAX_HASH_WORDS
    ? null
    : {
        kind: 'topic-wildcards',
        message: `The binding key '${key}' has ${count} '#' words, and RabbitMQ allows at most ${TOPIC_MAX_HASH_WORDS} in the key of a topic binding. One '#' already matches any number of words, so use fewer.`,
        refusal: topicWildcardsReply(key, count),
      };
}

/** `403`: a producer cannot publish to an internal exchange (ADR-0008, rule 8). */
export function internalExchangeIssue(name: string, vhost: string): Issue {
  return {
    kind: 'internal-exchange',
    message: `Exchange '${name}' is internal, so a client cannot publish to it. Another exchange can still route messages to it through a binding.`,
    refusal: internalExchangeReply(name, vhost),
  };
}

/** `404`: a binding starts from an exchange that is not there, or ends at a queue or an exchange that is not there. */
export function missingEndIssue(kind: 'exchange' | 'queue', name: string, vhost: string): Issue {
  return {
    kind: kind === 'exchange' ? 'missing-exchange' : 'missing-queue',
    message: `There is no ${kind} named '${name}'.`,
    refusal: kind === 'exchange' ? noExchangeReply(name, vhost) : noQueueReply(name, vhost),
  };
}

/** A name that another element of the same kind has. This is the simulator's rule: a canvas has each name once. */
export function duplicateNameIssue(kind: ElementKind, name: string): Issue {
  return {
    kind: 'duplicate-name',
    message: `There is already ${kind === 'exchange' ? 'an' : 'a'} ${KIND_LABEL[kind]} named '${name}'. Names are unique within a kind.`,
  };
}
