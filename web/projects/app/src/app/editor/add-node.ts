import type { CanvasDocument, DocumentCommand } from '@rmq/domain';
import { nextName } from '../core/state/ids';
import { frameOf } from '../canvas/model/shapes';
import type { NewNode } from '../canvas/model/new-node';
import type { Point } from '../canvas/model/transform';

/** What it takes to add something from the toolbox: the command, and the name that it gives the new element. */
export interface Addition {
  readonly command: DocumentCommand;
  readonly kind: NewNode['kind'];
  readonly name: string;
}

/**
 * The command that adds a node (ADR-0031). A click adds it where its kind goes, in its column below the lowest of its kind. A drop
 * puts it where the pointer was, with its middle there, as one batch, so that a drop is one step of undo. The name is the
 * kind and the smallest number that is free, which a learner then changes.
 */
export function addNode(document: CanvasDocument, node: NewNode, at?: Point): Addition {
  const name = nextName(document, node.kind);
  const declare = ((): DocumentCommand => {
    switch (node.kind) {
      case 'exchange':
        return {
          type: 'declare-exchange',
          name,
          exchangeType: node.exchangeType,
          durable: true,
          autoDelete: false,
          internal: false,
        };
      case 'queue':
        return { type: 'declare-queue', name, durable: true };
      case 'producer':
        return { type: 'add-producer', name };
      case 'consumer':
        return { type: 'add-consumer', name };
    }
  })();

  if (at === undefined) {
    return { command: declare, kind: node.kind, name };
  }
  const { width, height } = frameOf(node.kind, name);
  const move: DocumentCommand = {
    type: 'move',
    target: { kind: node.kind, name },
    x: Math.round(at.x - width / 2),
    y: Math.round(at.y - height / 2),
  };
  return { command: { type: 'batch', commands: [declare, move] }, kind: node.kind, name };
}
