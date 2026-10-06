import type { BindCommand, Link, Subscribe } from './commands/types';
import { elements, kindOf, lookup, nameOf } from './document/elements';
import { A_KIND, fail, KIND_LABEL, ok, type ElementKind, type Result } from './document/issue';
import type { CanvasDocument, Id } from './document/schema';

/**
 * What can be linked to what (ADR-0011's table). The editor offers a target only if a rule allows it, says why when it does
 * not, and gives a link the same command whichever way it was made: dragged from a handle, clicked, chosen from the
 * "Link to…" picker, picked from a context menu or typed. The rules go from the node that a message leaves to the node
 * that it goes to:
 *
 * | From → To          | Meaning                                                                        |
 * |--------------------|--------------------------------------------------------------------------------|
 * | producer → exchange | a publish target, but not an internal exchange                                |
 * | producer → queue    | a publish through the default exchange                                        |
 * | exchange → queue    | a binding                                                                     |
 * | exchange → exchange | a binding between exchanges, which may be to itself                           |
 * | queue → consumer    | a subscription                                                                |
 */

/** What linking two nodes would do, or why it cannot be done. */
export type LinkVerdict =
  | { readonly ok: true; readonly command: 'bind' | 'link' | 'subscribe'; readonly summary: string }
  | { readonly ok: false; readonly reason: string };

const NOT_FOUND: LinkVerdict = { ok: false, reason: 'There is nothing on the canvas with that id.' };

const noun = (kind: ElementKind, name: string): string => `${KIND_LABEL[kind]} '${name}'`;

/** Says what linking the node `sourceId` to the node `targetId` would do, or why it would not work. */
export function linkVerdict(document: CanvasDocument, sourceId: Id, targetId: Id): LinkVerdict {
  const from = kindOf(document, sourceId);
  const to = kindOf(document, targetId);
  if (from === undefined || to === undefined) {
    return NOT_FOUND;
  }
  const source = noun(from, nameOf(document, from, sourceId) as string);
  const target = noun(to, nameOf(document, to, targetId) as string);

  switch (from) {
    case 'producer':
      if (to === 'exchange') {
        return lookup(document.exchanges, targetId)?.internal === true
          ? {
              ok: false,
              reason: `A client cannot publish to ${target}, because it is internal. Producers publish to ordinary exchanges, or to a queue.`,
            }
          : { ok: true, command: 'link', summary: `Publishes from ${source} to ${target}.` };
      }
      return to === 'queue'
        ? { ok: true, command: 'link', summary: `Publishes from ${source} to ${target}, through the default exchange.` }
        : {
            ok: false,
            reason: `A producer publishes to an exchange or to a queue, and ${target} is ${A_KIND[to]}.`,
          };
    case 'exchange':
      if (to === 'queue' || to === 'exchange') {
        return { ok: true, command: 'bind', summary: `Binds ${source} to ${target}.` };
      }
      return {
        ok: false,
        reason:
          to === 'consumer'
            ? 'Consumers subscribe to queues, not exchanges. Bind the exchange to a queue, and subscribe the consumer to it.'
            : 'Nothing is bound to a producer: a producer publishes, and does not receive.',
      };
    case 'queue':
      return to === 'consumer'
        ? { ok: true, command: 'subscribe', summary: `Makes ${target} consume from ${source}.` }
        : {
            ok: false,
            reason: `A queue is filled by the exchanges that are bound to it, and emptied by consumers. It is not linked to ${A_KIND[to]}.`,
          };
    case 'consumer':
      return {
        ok: false,
        reason: 'A consumer is where a message ends: it takes messages from queues, and nothing is linked from it.',
      };
  }
}

/** The nodes that `sourceId` may be linked to, in the order they are drawn: an exchange may be linked to itself. */
export function allowedTargets(document: CanvasDocument, sourceId: Id): Id[] {
  return elements(document)
    .filter(({ id }) => linkVerdict(document, sourceId, id).ok)
    .map(({ id }) => id);
}

/** In a sentence: what the link would do, or why it cannot be made. */
export function explainLink(document: CanvasDocument, sourceId: Id, targetId: Id): string {
  const verdict = linkVerdict(document, sourceId, targetId);
  return verdict.ok ? verdict.summary : verdict.reason;
}

/** What the canvas offers its editor to ask which nodes may be linked (ADR-0016's `LinkRules`). */
export interface LinkRules {
  allowedTargets(source: Id): Id[];
  explain(source: Id, target: Id): string;
}

export function linkRules(document: CanvasDocument): LinkRules {
  return {
    allowedTargets: (source) => allowedTargets(document, source),
    explain: (source, target) => explainLink(document, source, target),
  };
}

/**
 * The command that a link makes, with what it needs filled in as plainly as it can be: a binding with an empty key and no
 * arguments, which the editor asks about, and replaces the key and the arguments in. It is the same command that the typed
 * `bind`, `link` and `subscribe` make, so that the equivalent command in the log reads as what was typed.
 */
export function linkCommand(
  document: CanvasDocument,
  sourceId: Id,
  targetId: Id,
): Result<BindCommand | Link | Subscribe> {
  const verdict = linkVerdict(document, sourceId, targetId);
  if (!verdict.ok) {
    return fail({ kind: 'invalid-link', message: verdict.reason });
  }
  const from = kindOf(document, sourceId) as ElementKind;
  const to = kindOf(document, targetId) as ElementKind;
  const source = nameOf(document, from, sourceId) as string;
  const target = nameOf(document, to, targetId) as string;
  switch (verdict.command) {
    case 'bind':
      return ok({ type: 'bind', source, destination: { kind: to as 'queue' | 'exchange', name: target }, key: '' });
    case 'link':
      return ok({ type: 'link', producer: source, target: { kind: to as 'exchange' | 'queue', name: target } });
    case 'subscribe':
      return ok({ type: 'subscribe', consumer: target, queue: source });
  }
}
