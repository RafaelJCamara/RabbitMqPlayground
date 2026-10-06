import { routingKeyIssue, utf8Length } from '@rmq/engine';
import { canvasFullIssue, edgeCount, elementCount, payloadIssue } from './capacity';
import { COLLECTION, elements, kindOf, lookup } from './elements';
import { bindingHeadersIssue, bindingSignature, messageHeadersIssue } from './headers';
import type { ElementKind, Issue } from './issue';
import { nameIssue } from './names';
import { duplicateNameIssue, internalExchangeIssue, topicKeyIssue, transientQueueIssue } from './rules';
import { canvasDocumentSchema, LIMITS, type CanvasDocument } from './schema';
import { edgeKeys } from './topology';

/**
 * What it means for a document to be right, beyond having the right shape: names that a broker would accept, each name
 * once, every reference pointing at something that is there, and no binding or queue that a broker would refuse (ADR-0021,
 * ADR-0022, ADR-0024). A document that commands made has none of these problems, because every command refuses what would
 * cause one. A document that arrives some other way, from a file or a link, might, and then this says so, in the words that
 * a command would have used.
 */

const KINDS = ['exchange', 'queue', 'producer', 'consumer'] as const satisfies readonly ElementKind[];

/** Every problem that a document has, in the order that it is checked. It is empty for a valid document. */
export function validateDocument(document: CanvasDocument): Issue[] {
  const issues: Issue[] = [];
  const add = (issue: Issue, ...path: string[]): void => {
    issues.push({ ...issue, path });
  };

  // A canvas that has more than it may hold is refused by `loadCanvas` before it gets here, and by every command before it
  // is made (ADR-0029). It is said here too, so that a document that arrives some other way gets the same sentence.
  const elementTotal = elementCount(document);
  if (elementTotal > LIMITS.elements) {
    add(canvasFullIssue('elements', elementTotal));
  }
  const edgeTotal = edgeCount(document);
  if (edgeTotal > LIMITS.edges) {
    add(canvasFullIssue('edges', edgeTotal));
  }

  // The vhost is a name too, and the broker writes it in some of its replies.
  if (document.vhost === '') {
    add({ kind: 'empty-name', message: 'A vhost needs a name.' }, 'vhost');
  } else if (utf8Length(document.vhost) > 255) {
    add({ kind: 'name-too-long', message: 'The name of a vhost is at most 255 bytes of UTF-8.' }, 'vhost');
  }

  // Layout is by id, and a record that has an id that another record has would be two things at one place.
  const owners = new Map<string, string>();
  for (const collection of ['exchanges', 'queues', 'bindings', 'producers', 'consumers'] as const) {
    for (const id of Object.keys(document[collection])) {
      const owner = owners.get(id);
      if (owner !== undefined) {
        add(
          {
            kind: 'duplicate-id',
            message: `The id '${id}' is used twice, in ${owner} and in ${collection}. An id belongs to one element.`,
          },
          collection,
          id,
        );
      }
      owners.set(id, collection);
    }
  }

  for (const kind of KINDS) {
    const collection = COLLECTION[kind];
    const names = new Set<string>();
    for (const [id, element] of Object.entries(document[collection])) {
      const serverNamed = 'serverNamed' in element && element.serverNamed;
      const issue = nameIssue(kind, element.name, { serverNamed });
      if (issue !== null) {
        add(issue, collection, id, 'name');
      } else if (names.has(element.name)) {
        add(duplicateNameIssue(kind, element.name), collection, id, 'name');
      }
      names.add(element.name);
    }
  }

  for (const [id, queue] of Object.entries(document.queues)) {
    if (!queue.durable) {
      add(transientQueueIssue(queue.name), 'queues', id, 'durable');
    }
  }

  const bound = new Set<string>();
  for (const [id, binding] of Object.entries(document.bindings)) {
    const source = lookup(document.exchanges, binding.source);
    if (source === undefined) {
      add(
        { kind: 'missing-exchange', message: `The binding '${id}' starts from an exchange that is not on the canvas.` },
        'bindings',
        id,
        'source',
      );
    }
    const destination = lookup(binding.dest.kind === 'queue' ? document.queues : document.exchanges, binding.dest.id);
    if (destination === undefined) {
      add(
        {
          kind: binding.dest.kind === 'queue' ? 'missing-queue' : 'missing-exchange',
          message: `The binding '${id}' ends at ${binding.dest.kind === 'queue' ? 'a queue' : 'an exchange'} that is not on the canvas.`,
        },
        'bindings',
        id,
        'dest',
      );
    }

    const keyProblem = routingKeyIssue(binding.key);
    if (keyProblem !== null) {
      add({ kind: 'routing-key', message: `${keyProblem}.` }, 'bindings', id, 'key');
    }
    const wildcards = source?.type === 'topic' ? topicKeyIssue(binding.key) : null;
    if (wildcards !== null) {
      add(wildcards, 'bindings', id, 'key');
    }
    const headers = binding.headers === undefined ? null : bindingHeadersIssue(binding.headers);
    if (headers !== null) {
      add(headers, 'bindings', id, 'headers');
    }

    const signature = bindingSignature(
      binding.source,
      binding.dest.kind,
      binding.dest.id,
      binding.key,
      binding.headers,
    );
    if (bound.has(signature)) {
      add(
        {
          kind: 'duplicate-edge',
          message: `The binding '${id}' is the same binding as another one: the same ends, key and arguments. A broker keeps it once.`,
        },
        'bindings',
        id,
      );
    }
    bound.add(signature);
  }

  for (const [id, producer] of Object.entries(document.producers)) {
    if (producer.target !== null) {
      const target = lookup(
        producer.target.kind === 'exchange' ? document.exchanges : document.queues,
        producer.target.id,
      );
      if (target === undefined) {
        add(
          {
            kind: 'missing-element',
            message: `The producer '${producer.name}' publishes to ${producer.target.kind === 'exchange' ? 'an exchange' : 'a queue'} that is not on the canvas.`,
          },
          'producers',
          id,
          'target',
        );
      } else if (producer.target.kind === 'exchange' && 'internal' in target && target.internal) {
        add(internalExchangeIssue(target.name, document.vhost), 'producers', id, 'target');
      }
    }
    const keyProblem = routingKeyIssue(producer.message.key);
    if (keyProblem !== null) {
      add({ kind: 'routing-key', message: `${keyProblem}.` }, 'producers', id, 'message', 'key');
    }
    const payload = payloadIssue(producer.message.payload);
    if (payload !== null) {
      add(payload, 'producers', id, 'message', 'payload');
    }
    const headers = messageHeadersIssue(producer.message.headers);
    if (headers !== null) {
      add(headers, 'producers', id, 'message', 'headers');
    }
  }

  for (const [id, consumer] of Object.entries(document.consumers)) {
    const subscribed = new Set<string>();
    for (const queueId of consumer.queues) {
      if (lookup(document.queues, queueId) === undefined) {
        add(
          {
            kind: 'missing-queue',
            message: `The consumer '${consumer.name}' consumes from a queue that is not on the canvas.`,
          },
          'consumers',
          id,
          'queues',
        );
      } else if (subscribed.has(queueId)) {
        add(
          {
            kind: 'duplicate-edge',
            message: `The consumer '${consumer.name}' consumes from the queue '${lookup(document.queues, queueId)?.name}' twice.`,
          },
          'consumers',
          id,
          'queues',
        );
      }
      subscribed.add(queueId);
    }
  }

  for (const id of Object.keys(document.layout.nodes)) {
    if (kindOf(document, id) === undefined) {
      add(
        { kind: 'layout', message: `A position is kept for '${id}', which is not on the canvas.` },
        'layout',
        'nodes',
        id,
      );
    }
  }
  for (const { kind, id, name } of elements(document)) {
    if (lookup(document.layout.nodes, id) === undefined) {
      add({ kind: 'layout', message: `The ${kind} '${name}' has no position.` }, 'layout', 'nodes', id);
    }
  }
  const edges = edgeKeys(document);
  for (const key of Object.keys(document.layout.labels)) {
    if (!edges.has(key)) {
      add(
        { kind: 'layout', message: `A label is kept for the edge '${key}', which is not on the canvas.` },
        'layout',
        'labels',
        key,
      );
    }
  }

  return issues;
}

export type ParsedDocument =
  { readonly ok: true; readonly value: CanvasDocument } | { readonly ok: false; readonly issues: readonly Issue[] };

/**
 * Reads a document from data that nothing vouches for: a file, a link, an import. It has the right shape (the schema is
 * strict, so a key that it does not know is refused) and it is right (`validateDocument`). It never throws.
 */
export function parseDocument(raw: unknown): ParsedDocument {
  const shape = canvasDocumentSchema.safeParse(raw);
  if (!shape.success) {
    return {
      ok: false,
      issues: shape.error.issues.map((problem) => ({
        kind: 'schema',
        message: `${problem.path.length === 0 ? 'The document' : problem.path.join('.')}: ${problem.message}`,
        path: problem.path.map(String),
      })),
    };
  }
  const issues = validateDocument(shape.data);
  return issues.length === 0 ? { ok: true, value: shape.data } : { ok: false, issues };
}
