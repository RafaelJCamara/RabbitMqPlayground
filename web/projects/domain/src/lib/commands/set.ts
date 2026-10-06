import { routingKeyIssue, type HeaderEntry, type HeaderValue } from '@rmq/engine';
import { payloadIssue } from '../document/capacity';
import { findId, lookup } from '../document/elements';
import { messageHeadersIssue, tooManyEntriesIssue } from '../document/headers';
import { fail, ok, type Issue, type Result } from '../document/issue';
import { topicKeyIssue, transientQueueIssue } from '../document/rules';
import { LIMITS, type CanvasDocument, type Id } from '../document/schema';
import { keepIfSame, missingElementIssue, sameValue } from './helpers';
import type {
  CanvasChanges,
  ConsumerChanges,
  ExchangeChanges,
  ProducerChanges,
  QueueChanges,
  SetCommand,
  Unset,
} from './types';

/**
 * Setting what an element is. Every value is checked against the same ranges that a document is (`LIMITS`), against the
 * broker's rules where it has one (a queue that is not durable, 541; a topic key with too many # words, 406), and against
 * what else is on the canvas: an exchange cannot become internal while a producer publishes to it, and cannot become a
 * topic exchange while a binding has a key that a topic exchange would refuse. A `set` that changes nothing changes nothing.
 */

interface Range {
  readonly min: number;
  readonly max: number;
}

/** Why `value` is not a whole number in the range, or `null` when it is. */
function rangeIssue(label: string, value: number, { min, max }: Range): Issue | null {
  return Number.isInteger(value) && value >= min && value <= max
    ? null
    : {
        kind: 'invalid-value',
        message: `The ${label} must be a whole number from ${min} to ${max}, and ${value} is not.`,
      };
}

/** The first problem of a list of checks, or `null` when every one passes. */
const firstIssue = (...checks: (Issue | null)[]): Issue | null => checks.find((check) => check !== null) ?? null;

const changedOrSame = (document: CanvasDocument, current: unknown, next: unknown, build: () => CanvasDocument) =>
  ok(sameValue(current, next) ? document : build());

function setExchange(document: CanvasDocument, name: string, changes: ExchangeChanges): Result<CanvasDocument> {
  const id = findId(document, 'exchange', name);
  if (id === undefined) {
    return fail(missingElementIssue(document, 'exchange', name));
  }
  const current = lookup(document.exchanges, id) as CanvasDocument['exchanges'][Id];
  const next = {
    name: current.name,
    type: changes.exchangeType ?? current.type,
    durable: changes.durable ?? current.durable,
    autoDelete: changes.autoDelete ?? current.autoDelete,
    internal: changes.internal ?? current.internal,
  };

  if (next.type === 'topic' && current.type !== 'topic') {
    const refused = Object.values(document.bindings)
      .filter((binding) => binding.source === id)
      .map((binding) => topicKeyIssue(binding.key))
      .find((issue) => issue !== null);
    if (refused) {
      return fail({
        ...refused,
        message: `${refused.message} Change that binding first, because the exchange would refuse it as a topic exchange.`,
      });
    }
  }
  if (next.internal && !current.internal) {
    const publishing = Object.values(document.producers).find(
      ({ target }) => target?.kind === 'exchange' && target.id === id,
    );
    if (publishing !== undefined) {
      return fail({
        kind: 'internal-exchange',
        message: `The exchange '${name}' cannot be internal while the producer '${publishing.name}' publishes to it, because a client cannot publish to an internal exchange. Unlink the producer first.`,
      });
    }
  }
  return changedOrSame(document, current, next, () => ({
    ...document,
    exchanges: { ...document.exchanges, [id]: next },
  }));
}

function setQueue(document: CanvasDocument, name: string, changes: QueueChanges): Result<CanvasDocument> {
  const id = findId(document, 'queue', name);
  if (id === undefined) {
    return fail(missingElementIssue(document, 'queue', name));
  }
  // A queue that is not durable is refused whether it is new or has been there all along (ADR-0021, ADR-0024).
  if (changes.durable === false) {
    return fail(transientQueueIssue(name));
  }
  const current = lookup(document.queues, id) as CanvasDocument['queues'][Id];
  // The only change that gets here is to make it durable: the other was refused above, and an empty one before that.
  const next = { ...current, durable: true };
  return changedOrSame(document, current, next, () => ({ ...document, queues: { ...document.queues, [id]: next } }));
}

/** The headers of a message with these set: a header that is there has its value replaced where it is, and the others go last. */
function mergeHeaders(
  current: readonly HeaderEntry<HeaderValue>[],
  changes: readonly HeaderEntry<HeaderValue>[],
): HeaderEntry<HeaderValue>[] {
  const merged = [...current];
  for (const change of changes) {
    const at = merged.findIndex(({ key }) => key === change.key);
    if (at === -1) {
      merged.push(change);
    } else {
      merged[at] = change;
    }
  }
  return merged;
}

function setProducer(document: CanvasDocument, name: string, changes: ProducerChanges): Result<CanvasDocument> {
  const id = findId(document, 'producer', name);
  if (id === undefined) {
    return fail(missingElementIssue(document, 'producer', name));
  }
  const current = lookup(document.producers, id) as CanvasDocument['producers'][Id];
  const headers =
    changes.headers === undefined ? current.message.headers : mergeHeaders(current.message.headers, changes.headers);
  const problem = firstIssue(
    changes.key === undefined ? null : issueOfKey(routingKeyIssue(changes.key)),
    changes.payload === undefined ? null : payloadIssue(changes.payload),
    changes.burst === undefined ? null : rangeIssue('burst', changes.burst, LIMITS.burst),
    changes.everyMs === undefined ? null : rangeIssue('interval', changes.everyMs, LIMITS.everyMs),
    changes.headers === undefined ? null : messageHeadersIssue(changes.headers),
    // The headers that are set and the ones that the message has come to what it is left with (ADR-0029).
    tooManyEntriesIssue('message', headers.length),
  );
  if (problem !== null) {
    return fail(problem);
  }

  // The message and the interval are branches of their own, and one that is not changed stays the one that it was.
  const next = {
    ...current,
    message: keepIfSame(current.message, {
      payload: changes.payload ?? current.message.payload,
      key: changes.key ?? current.message.key,
      headers,
    }),
    burst: changes.burst ?? current.burst,
    interval: keepIfSame(current.interval, {
      everyMs: changes.everyMs ?? current.interval.everyMs,
      on: changes.repeat ?? current.interval.on,
    }),
  };
  return changedOrSame(document, current, next, () => ({
    ...document,
    producers: { ...document.producers, [id]: next },
  }));
}

/** The engine says why a key cannot be sent in a sentence with no full stop, and a message has one. */
const issueOfKey = (reason: string | null): Issue | null =>
  reason === null ? null : { kind: 'routing-key', message: `${reason}.` };

function setConsumer(document: CanvasDocument, name: string, changes: ConsumerChanges): Result<CanvasDocument> {
  const id = findId(document, 'consumer', name);
  if (id === undefined) {
    return fail(missingElementIssue(document, 'consumer', name));
  }
  const problem = firstIssue(
    changes.prefetch === undefined ? null : rangeIssue('prefetch', changes.prefetch, LIMITS.prefetch),
    changes.processingMs === undefined
      ? null
      : rangeIssue('processing time', changes.processingMs, LIMITS.processingMs),
  );
  if (problem !== null) {
    return fail(problem);
  }
  const current = lookup(document.consumers, id) as CanvasDocument['consumers'][Id];
  const next = {
    ...current,
    ack: changes.ack ?? current.ack,
    prefetch: changes.prefetch ?? current.prefetch,
    processingMs: changes.processingMs ?? current.processingMs,
  };
  return changedOrSame(document, current, next, () => ({
    ...document,
    consumers: { ...document.consumers, [id]: next },
  }));
}

function setCanvas(document: CanvasDocument, changes: CanvasChanges): Result<CanvasDocument> {
  const problem = firstIssue(
    changes.seed === undefined ? null : rangeIssue('seed', changes.seed, LIMITS.seed),
    changes.publishMs === undefined ? null : rangeIssue('publish time', changes.publishMs, LIMITS.timingMs),
    changes.brokerMs === undefined ? null : rangeIssue('broker time', changes.brokerMs, LIMITS.timingMs),
    changes.deliverMs === undefined ? null : rangeIssue('delivery time', changes.deliverMs, LIMITS.timingMs),
  );
  if (problem !== null) {
    return fail(problem);
  }
  const current = document.settings;
  const next = {
    showDefaultExchange: changes.showDefaultExchange ?? current.showDefaultExchange,
    seed: changes.seed ?? current.seed,
    timing: keepIfSame(current.timing, {
      publishMs: changes.publishMs ?? current.timing.publishMs,
      brokerMs: changes.brokerMs ?? current.timing.brokerMs,
      deliverMs: changes.deliverMs ?? current.timing.deliverMs,
    }),
  };
  return changedOrSame(document, current, next, () => ({ ...document, settings: next }));
}

/** An empty `changes` object is a `set` that says nothing, and that is a mistake of whoever made it. */
const saysNothing = (changes: object): boolean => Object.values(changes).every((value) => value === undefined);

export function applySet(document: CanvasDocument, command: SetCommand): Result<CanvasDocument> {
  if (saysNothing(command.changes)) {
    return fail({ kind: 'nothing-to-change', message: 'Say what to set, for example durable=true.' });
  }
  switch (command.kind) {
    case 'exchange':
      return setExchange(document, command.name, command.changes);
    case 'queue':
      return setQueue(document, command.name, command.changes);
    case 'producer':
      return setProducer(document, command.name, command.changes);
    case 'consumer':
      return setConsumer(document, command.name, command.changes);
    case 'canvas':
      return setCanvas(document, command.changes);
  }
}

export function applyUnset(document: CanvasDocument, command: Unset): Result<CanvasDocument> {
  const id = findId(document, 'producer', command.name);
  if (id === undefined) {
    return fail(missingElementIssue(document, 'producer', command.name));
  }
  if (command.headers.length === 0) {
    return fail({ kind: 'nothing-to-change', message: 'Say which headers to take off, for example header:format.' });
  }
  const current = lookup(document.producers, id) as CanvasDocument['producers'][Id];
  const missing = command.headers.find((key) => !current.message.headers.some((header) => header.key === key));
  if (missing !== undefined) {
    return fail({
      kind: 'no-header',
      message: `The producer '${command.name}' has no header '${missing}'.${
        current.message.headers.length === 0
          ? ' It has no headers.'
          : ` Its headers are ${current.message.headers.map(({ key }) => `'${key}'`).join(', ')}.`
      }`,
    });
  }
  const headers = current.message.headers.filter(({ key }) => !command.headers.includes(key));
  return ok({
    ...document,
    producers: { ...document.producers, [id]: { ...current, message: { ...current.message, headers } } },
  });
}
