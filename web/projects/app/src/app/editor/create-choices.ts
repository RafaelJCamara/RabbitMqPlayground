import { applyCommand, findId, linkVerdict, type ApplyContext, type CanvasDocument, type Id } from '@rmq/domain';
import type { NewNode } from '../canvas/model/new-node';
import { addNode } from './add-node';
import { TOOLBOX } from './toolbox';

/** What a drop on nothing can make, and, when it cannot make anything, why. */
export interface CreateChoices {
  readonly nodes: readonly NewNode[];
  /** Why there is nothing to offer, in the words of the rule or of the limit. `null` when there is something. */
  readonly reason: string | null;
}

/** Ids for the canvases that a choice is tried on, which only have to be ones that the canvas does not have. */
function scratchIds(): ApplyContext {
  let count = 0;
  return { newId: (kind) => `scratch-${kind}-${(count += 1)}` };
}

/**
 * What a link that ends on empty canvas can make (ADR-0042): each item of the toolbox is tried on the document, added, and the rules are asked whether the node that
 * the link started from may be linked to it. It is derived from the rules and not written as a table, so that a rule that changes changes the menu with it, and it
 * can only offer what the commands would accept: a canvas that is full offers nothing, and says what the limit is.
 */
export function createChoices(document: CanvasDocument, source: Id): CreateChoices {
  const nodes: NewNode[] = [];
  let reason: string | null = null;
  for (const { node } of TOOLBOX) {
    const addition = addNode(document, node);
    const added = applyCommand(document, addition.command, scratchIds());
    if (!added.ok) {
      reason ??= added.error.message;
      continue;
    }
    const id = findId(added.value, addition.kind, addition.name) as Id;
    const verdict = linkVerdict(added.value, source, id);
    if (verdict.ok) {
      nodes.push(node);
    } else {
      reason ??= verdict.reason;
    }
  }
  return { nodes, reason: nodes.length === 0 ? reason : null };
}
