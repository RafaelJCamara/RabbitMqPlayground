import { TOPIC_MAX_HASH_WORDS } from './topic';

/**
 * What RabbitMQ 4.3.6 answers when it refuses something that the simulator reproduces (ADR-0021, ADR-0022). The codes and
 * the texts are the broker's, recorded in the conformance fixtures, with the vhost written as the topology names it. They
 * live here, below the document and the dispatcher, so that both give the same words: the domain's validation of a
 * declaration or a binding, the engine's `route()` for a publish, and the dispatcher that arrives with the simulation.
 */

/**
 * The reply codes of the refusals that the simulator reproduces: `403 ACCESS_REFUSED`, `404 NOT_FOUND`,
 * `406 PRECONDITION_FAILED` and `541 INTERNAL_ERROR`. The first three close the channel that the client used. The fourth,
 * the refusal of a feature that is deprecated, closes the whole connection. Whether the simulator has connections to
 * close is not decided yet (open question 2), so nothing here says what a refusal closes.
 */
export type RefusalCode = 403 | 404 | 406 | 541;

/** A reply of the broker, word for word. */
export interface BrokerReply<Code extends RefusalCode = RefusalCode> {
  readonly code: Code;
  readonly text: string;
}

/** An operation that the broker refuses, as a result. */
export interface Refusal extends BrokerReply {
  readonly ok: false;
}

/** Exchange and queue names that start with this are reserved for the broker (ADR-0008, rule 9). */
export const RESERVED_NAME_PREFIX = 'amq.';

/** `403`: a client declared an exchange or a queue whose name starts with `amq.`. */
export function reservedNameReply(kind: 'exchange' | 'queue', name: string): BrokerReply<403> {
  return { code: 403, text: `ACCESS_REFUSED - ${kind} name '${name}' contains reserved prefix 'amq.*'` };
}

/** `403`: a client declared the default exchange, or bound from it or to it (ADR-0008, rule 6). */
export function defaultExchangeReply(): BrokerReply<403> {
  return { code: 403, text: 'ACCESS_REFUSED - operation not permitted on the default exchange' };
}

/** `403`: a client published to an internal exchange (ADR-0008, rule 8). */
export function internalExchangeReply(name: string, vhost: string): BrokerReply<403> {
  return { code: 403, text: `ACCESS_REFUSED - cannot publish to internal exchange '${name}' in vhost '${vhost}'` };
}

/** `404`: a client published to, or bound from or to, an exchange that does not exist. */
export function noExchangeReply(name: string, vhost: string): BrokerReply<404> {
  return { code: 404, text: `NOT_FOUND - no exchange '${name}' in vhost '${vhost}'` };
}

/** `404`: a client bound to a queue that does not exist. */
export function noQueueReply(name: string, vhost: string): BrokerReply<404> {
  return { code: 404, text: `NOT_FOUND - no queue '${name}' in vhost '${vhost}'` };
}

/** `406`: a client bound a topic exchange with a key that has more than two `#` words. `count` is how many it has. */
export function topicWildcardsReply(key: string, count: number): BrokerReply<406> {
  return {
    code: 406,
    text: `PRECONDITION_FAILED - Topic binding key '${key}' uses ${count} '#' wildcards, at most ${TOPIC_MAX_HASH_WORDS} are allowed`,
  };
}

/**
 * `541`: a client declared a queue that is neither durable nor exclusive (ADR-0021). The broker cuts its text at 255
 * bytes, the most that AMQP 0-9-1 allows in a reply text, and the dots at the end are the broker's.
 */
export function transientQueueReply(): BrokerReply<541> {
  return {
    code: 541,
    text: [
      'INTERNAL_ERROR - Feature `transient_nonexcl_queues` is deprecated.',
      'By default, this feature is not permitted anymore.',
      'The feature will be removed from a future major RabbitMQ version, regardless of the configuration; actual version to be determined.',
      'To...',
    ].join('\n'),
  };
}

/**
 * `406`: a client declared an exchange or a queue that is there, with an attribute that is not the same as the one it has
 * (ADR-0051). The broker names the first attribute that differs, with the value that it was sent and the value that it has,
 * and the attributes are `type`, `durable`, `auto_delete` and `internal` for an exchange, and `durable` and `auto_delete` for
 * a queue, written the way a broker writes them: `true` and `false`, and a type by its name.
 */
export function inequivalentReply(
  kind: 'exchange' | 'queue',
  attribute: string,
  name: string,
  vhost: string,
  received: string,
  current: string,
): BrokerReply<406> {
  return {
    code: 406,
    text: `PRECONDITION_FAILED - inequivalent arg '${attribute}' for ${kind} '${name}' in vhost '${vhost}': received '${received}' but current is '${current}'`,
  };
}
