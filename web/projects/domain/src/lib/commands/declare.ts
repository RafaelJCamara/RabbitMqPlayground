import { noRoomForElement } from '../document/capacity';
import { exchangeDifference, queueDifference } from '@rmq/engine';
import { findId, lookup } from '../document/elements';
import { fail, ok, type ElementKind, type Result } from '../document/issue';
import { nameIssue } from '../document/names';
import {
  duplicateNameIssue,
  inequivalentExchangeIssue,
  inequivalentQueueIssue,
  transientQueueIssue,
} from '../document/rules';
import type { CanvasDocument, Id } from '../document/schema';
import { freshId, withElement, type ApplyContext } from './helpers';
import type { AddConsumer, AddProducer, DeclareExchange, DeclareQueue } from './types';

/**
 * The commands that put something new on the canvas. A name has to be one that a broker would take (ADR-0021), there has to
 * be room for one more (ADR-0029), and a new node goes where its kind belongs (`defaultPosition`). The room is checked last, so
 * that a name that is wrong is told so even on a canvas that is full.
 *
 * An exchange or a queue that has the name is not refused for that: a declaration says "make sure that this is there", so
 * one that says what is there already changes nothing and answers the same document, and one that says another thing is
 * refused with the attribute that differs, as a broker does (ADR-0051). A producer and a consumer are not a broker's, and a
 * canvas has each of their names once.
 */

const taken = (document: CanvasDocument, kind: ElementKind, name: string): boolean =>
  findId(document, kind, name) !== undefined;

export function applyDeclareExchange(
  document: CanvasDocument,
  command: DeclareExchange,
  context: ApplyContext,
): Result<CanvasDocument> {
  const problem = nameIssue('exchange', command.name);
  if (problem !== null) {
    return fail(problem);
  }
  const { name, exchangeType: type, durable, autoDelete, internal } = command;
  const id = findId(document, 'exchange', name);
  if (id !== undefined) {
    const there = lookup(document.exchanges, id) as CanvasDocument['exchanges'][Id];
    const difference = exchangeDifference(there, { type, durable, autoDelete, internal });
    return difference === null ? ok(document) : fail(inequivalentExchangeIssue(name, difference, document.vhost));
  }
  const full = noRoomForElement(document);
  if (full !== null) {
    return fail(full);
  }
  return ok(
    withElement(document, 'exchange', freshId(document, context, 'exchange'), {
      name,
      type,
      durable,
      autoDelete,
      internal,
    }),
  );
}

/**
 * A queue that is not durable is refused with the broker's own 541 and a message that says why (ADR-0021, ADR-0024). The
 * name is checked first, then whether it is taken, then the flag: a queue that is there and is declared as not durable is
 * answered as a declaration that repeats with another attribute, with 406, and not with the 541 of a new queue, which is the
 * order that the broker has (`routing/declaring-a-queue-that-is-there-as-not-durable-is-refused-as-another-attribute`).
 */
export function applyDeclareQueue(
  document: CanvasDocument,
  command: DeclareQueue,
  context: ApplyContext,
): Result<CanvasDocument> {
  const problem = nameIssue('queue', command.name);
  if (problem !== null) {
    return fail(problem);
  }
  const id = findId(document, 'queue', command.name);
  if (id !== undefined) {
    const there = lookup(document.queues, id) as CanvasDocument['queues'][Id];
    const difference = queueDifference(there, command);
    return difference === null ? ok(document) : fail(inequivalentQueueIssue(command.name, difference, document.vhost));
  }
  if (!command.durable) {
    return fail(transientQueueIssue(command.name));
  }
  const full = noRoomForElement(document);
  if (full !== null) {
    return fail(full);
  }
  return ok(
    withElement(document, 'queue', freshId(document, context, 'queue'), {
      name: command.name,
      serverNamed: false,
      durable: true,
    }),
  );
}

/** What a new producer does until it is told otherwise: nothing, to nothing, once. */
export const NEW_PRODUCER = {
  target: null,
  message: { payload: '', key: '', headers: [] },
  burst: 1,
  interval: { everyMs: 1000, on: false },
} as const;

export function applyAddProducer(
  document: CanvasDocument,
  command: AddProducer,
  context: ApplyContext,
): Result<CanvasDocument> {
  const problem = nameIssue('producer', command.name);
  if (problem !== null) {
    return fail(problem);
  }
  if (taken(document, 'producer', command.name)) {
    return fail(duplicateNameIssue('producer', command.name));
  }
  const full = noRoomForElement(document);
  if (full !== null) {
    return fail(full);
  }
  return ok(
    withElement(document, 'producer', freshId(document, context, 'producer'), {
      name: command.name,
      target: NEW_PRODUCER.target,
      message: { ...NEW_PRODUCER.message, headers: [] },
      burst: NEW_PRODUCER.burst,
      interval: { ...NEW_PRODUCER.interval },
    }),
  );
}

/** What a new consumer does until it is told otherwise: takes what it is given, and spends half a second on each. */
export const NEW_CONSUMER = { ack: 'auto', prefetch: 0, processingMs: 500 } as const;

export function applyAddConsumer(
  document: CanvasDocument,
  command: AddConsumer,
  context: ApplyContext,
): Result<CanvasDocument> {
  const problem = nameIssue('consumer', command.name);
  if (problem !== null) {
    return fail(problem);
  }
  if (taken(document, 'consumer', command.name)) {
    return fail(duplicateNameIssue('consumer', command.name));
  }
  const full = noRoomForElement(document);
  if (full !== null) {
    return fail(full);
  }
  return ok(
    withElement(document, 'consumer', freshId(document, context, 'consumer'), {
      name: command.name,
      queues: [],
      ...NEW_CONSUMER,
    }),
  );
}
