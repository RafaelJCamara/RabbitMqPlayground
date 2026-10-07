import { routingKeyIssue } from '@rmq/engine';
import { payloadIssue } from '../document/capacity';
import { findId, lookup } from '../document/elements';
import { messageHeadersIssue } from '../document/headers';
import type { Issue } from '../document/issue';
import { internalExchangeIssue } from '../document/rules';
import type { CanvasDocument, Id } from '../document/schema';
import { missingElementIssue } from './helpers';
import type { RuntimeCommand } from './types';

/**
 * What a command that runs the simulation needs of the canvas (ADR-0054). These are not applied to the document, so there is no `applyCommand` to
 * refuse them: this says why one cannot be run, in the words of the commands that change the canvas, with the broker's reply where a broker would
 * have one. A command that can always be run is `null`.
 */
export function runtimeIssue(document: CanvasDocument, command: RuntimeCommand): Issue | null {
  switch (command.type) {
    case 'purge':
      return findId(document, 'queue', command.queue) === undefined
        ? missingElementIssue(document, 'queue', command.queue)
        : null;
    case 'publish':
      return command.from.kind === 'producer'
        ? producerIssue(document, command.from.name)
        : exchangeIssue(document, command);
    default:
      return null;
  }
}

function producerIssue(document: CanvasDocument, name: string): Issue | null {
  const id = findId(document, 'producer', name);
  if (id === undefined) {
    return missingElementIssue(document, 'producer', name);
  }
  const { target } = lookup(document.producers, id) as CanvasDocument['producers'][Id];
  return target === null
    ? {
        kind: 'not-linked',
        message: `The producer '${name}' is not linked to anything, so it has nowhere to publish. Link it with link ${name.includes(' ') ? `"${name}"` : name} -> <an exchange or a queue>.`,
      }
    : null;
}

function exchangeIssue(document: CanvasDocument, command: Extract<RuntimeCommand, { type: 'publish' }>): Issue | null {
  const { name } = command.from;
  const id = findId(document, 'exchange', name);
  if (id === undefined) {
    return missingElementIssue(document, 'exchange', name);
  }
  // The broker refuses a client that publishes to an internal exchange, with a 403 (ADR-0008, rule 8).
  if ((lookup(document.exchanges, id) as CanvasDocument['exchanges'][Id]).internal) {
    return internalExchangeIssue(name, document.vhost);
  }
  const keyProblem = command.key === undefined ? null : routingKeyIssue(command.key);
  if (keyProblem !== null) {
    return { kind: 'routing-key', message: `${keyProblem}.` };
  }
  return (
    (command.headers === undefined ? null : messageHeadersIssue(command.headers)) ??
    (command.payload === undefined ? null : payloadIssue(command.payload))
  );
}
