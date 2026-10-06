import { routingKeyIssue } from '@rmq/engine';
import { findId, lookup } from '../document/elements';
import { bindingHeadersIssue, bindingSignature, canonicalHeaders } from '../document/headers';
import { fail, ok, type ElementKind, type Result } from '../document/issue';
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

function resolveEnds(document: CanvasDocument, command: BindCommand | UnbindCommand): Result<Ends> {
  const { source, destination, key, headers } = command;

  const keyProblem = routingKeyIssue(key);
  if (keyProblem !== null) {
    return fail({ kind: 'routing-key', message: `${keyProblem}.` });
  }
  const headersProblem = headers === undefined ? null : bindingHeadersIssue(headers);
  if (headersProblem !== null) {
    return fail(headersProblem);
  }

  if (source === '' || (destination.kind === 'exchange' && destination.name === '')) {
    return fail(defaultExchangeIssue('bind'));
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
function findBinding(document: CanvasDocument, command: BindCommand | UnbindCommand, ends: Ends): Id | undefined {
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

/** Describes what a binding is, for a message that says that there is none. */
function describe(command: UnbindCommand): string {
  return `from exchange '${command.source}' to ${command.destination.kind} '${command.destination.name}' with the key '${command.key}'`;
}

export function applyUnbind(document: CanvasDocument, command: UnbindCommand): Result<CanvasDocument> {
  const ends = resolveEnds(document, command);
  if (!ends.ok) {
    return ends;
  }
  const id = findBinding(document, command, ends.value);
  if (id === undefined) {
    const { sourceId, destinationId } = ends.value;
    const keys = Object.values(document.bindings)
      .filter(
        ({ source, dest }) =>
          source === sourceId && dest.kind === command.destination.kind && dest.id === destinationId,
      )
      .map(({ key }) => `'${key}'`);
    const between =
      keys.length === 0
        ? ''
        : ` The bindings between them have the ${keys.length === 1 ? 'key' : 'keys'} ${keys.join(', ')}.`;
    return fail({
      kind: 'not-bound',
      message: `There is no binding ${describe(command)}${command.headers === undefined ? '' : ' and those arguments'}.${between}`,
    });
  }
  return ok(withoutDanglingLabels({ ...document, bindings: without(document.bindings, id) }));
}
