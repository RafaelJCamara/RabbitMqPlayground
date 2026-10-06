import type { Id, LinkRules } from '@rmq/domain';
import type { NodeVm } from './canvas-vm';
import { inId, NOTHING } from './connector-ids';

/**
 * The connectors that a handle may be joined to (ADR-0016, workaround 2). Foblex has no validator: it reads the list that the
 * source connector carries, once, when a drag starts. The adapter makes this list for the handle that is pressed, from the
 * rules of ADR-0011, and gives it before the library reads it. The list is the inputs of the nodes that the rules allow, or
 * `NOTHING` when none is allowed, because an empty list would mean that anything goes.
 */
export function armedTargets(
  source: Id | null,
  nodes: readonly NodeVm[],
  rules: Pick<LinkRules, 'allowedTargets'> | undefined,
): readonly string[] {
  if (source === null || rules === undefined) {
    return NOTHING;
  }
  const allowed = new Set(rules.allowedTargets(source));
  const connectors = nodes.filter((node) => node.hasInput && allowed.has(node.id)).map((node) => inId(node.id));
  return connectors.length === 0 ? NOTHING : connectors;
}
