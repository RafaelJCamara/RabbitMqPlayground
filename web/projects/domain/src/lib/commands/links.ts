import { noRoomForEdge } from '../document/capacity';
import { findId, lookup } from '../document/elements';
import { fail, ok, type Result } from '../document/issue';
import { internalExchangeIssue } from '../document/rules';
import type { CanvasDocument, Id } from '../document/schema';
import { missingElementIssue, withoutDanglingLabels } from './helpers';
import type { Link, Subscribe, Unlink, Unsubscribe } from './types';

/**
 * The two links that are not bindings: a producer publishes to something, and a consumer consumes from queues
 * (ADR-0011's table). A producer has one target, so linking it again changes it. A consumer has as many queues as it
 * likes, so subscribing it again to one it already has changes nothing.
 */

function withProducer(document: CanvasDocument, id: Id, producer: CanvasDocument['producers'][Id]): CanvasDocument {
  return { ...document, producers: { ...document.producers, [id]: producer } };
}

function withConsumer(document: CanvasDocument, id: Id, consumer: CanvasDocument['consumers'][Id]): CanvasDocument {
  return { ...document, consumers: { ...document.consumers, [id]: consumer } };
}

export function applyLink(document: CanvasDocument, command: Link): Result<CanvasDocument> {
  const producerId = findId(document, 'producer', command.producer);
  if (producerId === undefined) {
    return fail(missingElementIssue(document, 'producer', command.producer));
  }
  const { kind, name } = command.target;
  const targetId = findId(document, kind, name);
  if (targetId === undefined) {
    return fail(missingElementIssue(document, kind, name));
  }
  // A producer that publishes to an internal exchange is refused by the broker when it publishes, with a 403 (ADR-0008, rule 8).
  if (kind === 'exchange' && lookup(document.exchanges, targetId)?.internal === true) {
    return fail(internalExchangeIssue(name, document.vhost));
  }

  const producer = lookup(document.producers, producerId) as CanvasDocument['producers'][Id];
  if (producer.target?.kind === kind && producer.target.id === targetId) {
    return ok(document);
  }
  // A producer that has a target and is pointed at another still has one edge. One that has none gets its first (ADR-0029).
  const full = producer.target === null ? noRoomForEdge(document) : null;
  if (full !== null) {
    return fail(full);
  }
  return ok(withoutDanglingLabels(withProducer(document, producerId, { ...producer, target: { kind, id: targetId } })));
}

export function applyUnlink(document: CanvasDocument, command: Unlink): Result<CanvasDocument> {
  const producerId = findId(document, 'producer', command.producer);
  if (producerId === undefined) {
    return fail(missingElementIssue(document, 'producer', command.producer));
  }
  const producer = lookup(document.producers, producerId) as CanvasDocument['producers'][Id];
  if (producer.target === null) {
    return fail({ kind: 'not-linked', message: `The producer '${command.producer}' is not linked to anything.` });
  }
  return ok(withoutDanglingLabels(withProducer(document, producerId, { ...producer, target: null })));
}

export function applySubscribe(document: CanvasDocument, command: Subscribe): Result<CanvasDocument> {
  const consumerId = findId(document, 'consumer', command.consumer);
  if (consumerId === undefined) {
    return fail(missingElementIssue(document, 'consumer', command.consumer));
  }
  const queueId = findId(document, 'queue', command.queue);
  if (queueId === undefined) {
    return fail(missingElementIssue(document, 'queue', command.queue));
  }
  const consumer = lookup(document.consumers, consumerId) as CanvasDocument['consumers'][Id];
  if (consumer.queues.includes(queueId)) {
    return ok(document);
  }
  const full = noRoomForEdge(document);
  if (full !== null) {
    return fail(full);
  }
  return ok(withConsumer(document, consumerId, { ...consumer, queues: [...consumer.queues, queueId] }));
}

export function applyUnsubscribe(document: CanvasDocument, command: Unsubscribe): Result<CanvasDocument> {
  const consumerId = findId(document, 'consumer', command.consumer);
  if (consumerId === undefined) {
    return fail(missingElementIssue(document, 'consumer', command.consumer));
  }
  const queueId = findId(document, 'queue', command.queue);
  if (queueId === undefined) {
    return fail(missingElementIssue(document, 'queue', command.queue));
  }
  const consumer = lookup(document.consumers, consumerId) as CanvasDocument['consumers'][Id];
  if (!consumer.queues.includes(queueId)) {
    return fail({
      kind: 'not-subscribed',
      message: `The consumer '${command.consumer}' does not consume from the queue '${command.queue}'.`,
    });
  }
  return ok(
    withoutDanglingLabels(
      withConsumer(document, consumerId, { ...consumer, queues: consumer.queues.filter((id) => id !== queueId) }),
    ),
  );
}
