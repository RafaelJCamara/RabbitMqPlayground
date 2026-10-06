import { defaultExchangeReply, RESERVED_NAME_PREFIX, reservedNameReply, utf8Length } from '@rmq/engine';
import type { ElementKind, Issue } from './issue';

/**
 * What a name may be. A name is not empty and is at most 255 bytes of UTF-8, because AMQP writes names as short strings
 * and a client library refuses a longer one before anything is sent (ADR-0021). An exchange or a queue may not start with
 * `amq.`, which the broker reserves for itself, and the broker refuses the default exchange, whose name is empty, as a
 * name to declare. The names of producers and consumers are the simulator's own, so only the first two rules apply.
 */

export const NAME_MAX_BYTES = 255;

/** The words that name a kind in a sentence. */
export const KIND_LABEL: Readonly<Record<ElementKind, string>> = {
  exchange: 'exchange',
  queue: 'queue',
  producer: 'producer',
  consumer: 'consumer',
};

/** Whether a name starts with the prefix that is the broker's own. */
export const hasReservedPrefix = (name: string): boolean => name.startsWith(RESERVED_NAME_PREFIX);

export interface NameOptions {
  /** The broker chose the name, so it may start with `amq.` (a queue that the broker names `amq.gen-…`). */
  readonly serverNamed?: boolean;
}

/**
 * Why `name` cannot be the name of an element of this kind, or `null` when it can. It does not look at what else is on
 * the canvas, so it does not say that a name is taken.
 */
export function nameIssue(kind: ElementKind, name: string, options: NameOptions = {}): Issue | null {
  if (name === '') {
    if (kind === 'exchange') {
      return {
        kind: 'default-exchange',
        message:
          'The default exchange is the one with no name. It is built in, so it cannot be declared. Every queue is already reachable through it, by its own name.',
        refusal: defaultExchangeReply(),
      };
    }
    return { kind: 'empty-name', message: `A ${KIND_LABEL[kind]} needs a name.` };
  }

  const bytes = utf8Length(name);
  if (bytes > NAME_MAX_BYTES) {
    return {
      kind: 'name-too-long',
      message: `A name is at most ${NAME_MAX_BYTES} bytes of UTF-8, because AMQP writes it as a short string, and this one is ${bytes}.`,
    };
  }

  // Only a queue can be named by the broker. A client always names an exchange.
  const namedByBroker = kind === 'queue' && options.serverNamed === true;
  if ((kind === 'exchange' || kind === 'queue') && hasReservedPrefix(name) && !namedByBroker) {
    return {
      kind: 'reserved-name',
      message: `'${name}' starts with '${RESERVED_NAME_PREFIX}', which RabbitMQ keeps for its own exchanges and queues. Choose a name that does not start with '${RESERVED_NAME_PREFIX}'.`,
      refusal: reservedNameReply(kind, name),
    };
  }

  return null;
}
