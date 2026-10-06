import { findId } from '../document/elements';
import { fail, ok, type ElementKind, type Result } from '../document/issue';
import { nameIssue } from '../document/names';
import { duplicateNameIssue, transientQueueIssue } from '../document/rules';
import type { CanvasDocument } from '../document/schema';
import { freshId, withElement, type ApplyContext } from './helpers';
import type { AddConsumer, AddProducer, DeclareExchange, DeclareQueue } from './types';

/**
 * The commands that put something new on the canvas. A name has to be one that a broker would take (ADR-0021) and that no
 * other element of its kind has, and a new node goes where its kind belongs (`defaultPosition`).
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
  if (taken(document, 'exchange', command.name)) {
    return fail(duplicateNameIssue('exchange', command.name));
  }
  const { name, exchangeType: type, durable, autoDelete, internal } = command;
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
 * name is checked first, because a broker reads it before anything else about the declaration.
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
  if (!command.durable) {
    return fail(transientQueueIssue(command.name));
  }
  if (taken(document, 'queue', command.name)) {
    return fail(duplicateNameIssue('queue', command.name));
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
  return ok(
    withElement(document, 'consumer', freshId(document, context, 'consumer'), {
      name: command.name,
      queues: [],
      ...NEW_CONSUMER,
    }),
  );
}
