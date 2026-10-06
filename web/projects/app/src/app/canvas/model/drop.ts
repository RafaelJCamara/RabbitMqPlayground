import type { Id } from '@rmq/domain';
import { nodeIdOf } from './connector-ids';
import type { CanvasIntent, LinkVia } from './intents';
import type { Point } from './transform';

/** What is known about where a link ended (ADR-0016): the library's answer, and what is under the pointer. */
export interface DropFacts {
  /** The connector that the link started from. */
  readonly source: string;
  /** The connector that the library joined the link to, or `undefined` when it joined it to nothing. */
  readonly targetConnector: string | undefined;
  /** The node that is under the pointer where it ended, if any: the hit test of the adapter. */
  readonly nodeUnderPointer: Id | null;
  readonly at: Point;
  readonly client: Point;
  readonly via: LinkVia;
}

/**
 * A link that ends on a valid target and a link that ends on an invalid one, or on nothing, both come from Foblex as "no
 * target". The adapter tells them apart with a hit test, so that the editor can explain an invalid drop, and offer to make
 * something where nothing was.
 */
export function classifyDrop(facts: DropFacts): CanvasIntent {
  const source = nodeIdOf(facts.source);
  if (facts.targetConnector !== undefined) {
    return { type: 'link', source, target: nodeIdOf(facts.targetConnector), via: facts.via };
  }
  if (facts.nodeUnderPointer !== null) {
    return { type: 'link-invalid', source, target: facts.nodeUnderPointer, via: facts.via };
  }
  return { type: 'link-to-empty', source, at: facts.at, client: facts.client, via: facts.via };
}
