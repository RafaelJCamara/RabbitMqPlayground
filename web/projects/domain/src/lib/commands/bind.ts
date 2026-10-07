import { routingKeyIssue } from '@rmq/engine';
import { noRoomForEdge } from '../document/capacity';
import { findId, lookup } from '../document/elements';
import { bindingHeadersIssue, bindingSignature, canonicalHeaders } from '../document/headers';
import { fail, ok, type ElementKind, type Issue, type Result } from '../document/issue';
import {
  BUILT_IN_EXCHANGES,
  builtInExchangeIssue,
  defaultExchangeIssue,
  missingEndIssue,
  topicKeyIssue,
} from '../document/rules';
import type { CanvasDocument, Id } from '../document/schema';
import { freshId, without, withNameHints, withoutDanglingLabels, type ApplyContext } from './helpers';
import type { BindCommand, UnbindCommand } from './types';

/**
 * Binding and unbinding. A binding names an exchange and a queue or an exchange, and the checks run in the order that a
 * broker runs them: what a client library refuses before anything is sent (a key over 255 bytes), the default exchange
 * (403), the source and then the destination that are not there (404), and the key of a topic binding (406). A fault of
 * each kind has a reply that was recorded (ADR-0021, ADR-0022), and so has the order in which a broker reports two of them
 * (`routing/a-binding-with-two-faults-gets-one-refusal`, ADR-0026).
 *
 * An unbind is checked for the first two only. A broker accepts an unbind of a binding that is not there, of ends that are
 * not there, and of a key that no binding could have, and does nothing (ADR-0051), so the document is the same one.
 */

interface Ends {
  readonly sourceId: Id;
  readonly destinationId: Id;
  readonly sourceType: CanvasDocument['exchanges'][Id]['type'];
}

/** The exchange or queue that a binding names and the canvas does not have: not a refusal, if the broker has it built in. */
function missingEnd(document: CanvasDocument, kind: Exclude<ElementKind, 'producer' | 'consumer'>, name: string) {
  if (kind === 'exchange' && BUILT_IN_EXCHANGES.includes(name)) {
    return builtInExchangeIssue(name);
  }
  return withNameHints(missingEndIssue(kind, name, document.vhost), document, kind, name);
}

/** What a client library refuses before it sends anything, and the default exchange, which a broker refuses for a bind and for an unbind. */
function checkBinding(command: BindCommand | UnbindCommand): Issue | null {
  const { source, destination, key, headers } = command;

  const keyProblem = routingKeyIssue(key);
  if (keyProblem !== null) {
    return { kind: 'routing-key', message: `${keyProblem}.` };
  }
  const headersProblem = headers === undefined ? null : bindingHeadersIssue(headers);
  if (headersProblem !== null) {
    return headersProblem;
  }
  return source === '' || (destination.kind === 'exchange' && destination.name === '')
    ? defaultExchangeIssue('bind')
    : null;
}

function resolveEnds(document: CanvasDocument, command: BindCommand): Result<Ends> {
  const { source, destination } = command;
  const problem = checkBinding(command);
  if (problem !== null) {
    return fail(problem);
  }

  const sourceId = findId(document, 'exchange', source);
  if (sourceId === undefined) {
    return fail(missingEnd(document, 'exchange', source));
  }
  const destinationId = findId(document, destination.kind, destination.name);
  if (destinationId === undefined) {
    return fail(missingEnd(document, destination.kind, destination.name));
  }
  const sourceType = (lookup(document.exchanges, sourceId) as CanvasDocument['exchanges'][Id]).type;
  return ok({ sourceId, destinationId, sourceType });
}

/** The id of the binding that is this binding, if there is one. */
function findBinding(
  document: CanvasDocument,
  command: BindCommand | UnbindCommand,
  ends: Pick<Ends, 'sourceId' | 'destinationId'>,
): Id | undefined {
  const wanted = bindingSignature(
    ends.sourceId,
    command.destination.kind,
    ends.destinationId,
    command.key,
    command.headers,
  );
  return Object.entries(document.bindings).find(
    ([, { source, dest, key, headers }]) => bindingSignature(source, dest.kind, dest.id, key, headers) === wanted,
  )?.[0];
}

/**
 * Binds an exchange to a queue or to another exchange. Binding what is already bound changes nothing, because a broker
 * keeps a binding once, and the document is the same one. An exchange may be bound to itself, and bindings may go round in
 * a cycle: a broker accepts both (ADR-0008, rule 7).
 */
export function applyBind(
  document: CanvasDocument,
  command: BindCommand,
  context: ApplyContext,
): Result<CanvasDocument> {
  const ends = resolveEnds(document, command);
  if (!ends.ok) {
    return ends;
  }
  const { sourceId, destinationId, sourceType } = ends.value;

  const wildcards = sourceType === 'topic' ? topicKeyIssue(command.key) : null;
  if (wildcards !== null) {
    return fail(wildcards);
  }
  if (findBinding(document, command, ends.value) !== undefined) {
    return ok(document);
  }
  // A binding that is there is not another edge, so it is answered above even on a canvas that is full (ADR-0029).
  const full = noRoomForEdge(document);
  if (full !== null) {
    return fail(full);
  }

  const headers = canonicalHeaders(command.headers);
  const id = freshId(document, context, 'binding');
  return ok({
    ...document,
    bindings: {
      ...document.bindings,
      [id]: {
        source: sourceId,
        dest: { kind: command.destination.kind, id: destinationId },
        key: command.key,
        ...(headers === undefined ? {} : { headers }),
      },
    },
  });
}

/**
 * Takes off the binding that is exactly this one: the same two ends, key and arguments. If there is none, or the ends are
 * not on the canvas, nothing is changed and the document is the same one, because a broker accepts it (ADR-0051).
 */
export function applyUnbind(document: CanvasDocument, command: UnbindCommand): Result<CanvasDocument> {
  const problem = checkBinding(command);
  if (problem !== null) {
    return fail(problem);
  }
  const sourceId = findId(document, 'exchange', command.source);
  const destinationId = findId(document, command.destination.kind, command.destination.name);
  if (sourceId === undefined || destinationId === undefined) {
    return ok(document);
  }
  const id = findBinding(document, command, { sourceId, destinationId });
  return id === undefined
    ? ok(document)
    : ok(withoutDanglingLabels({ ...document, bindings: without(document.bindings, id) }));
}
