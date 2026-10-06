import type { Id } from '@rmq/domain';
import type { NewNode } from './new-node';
import type { Point } from './transform';

/** How a link was made: by dragging a handle, by clicking one source and then a target, or from the keyboard (ADR-0017). */
export type LinkVia = 'drag' | 'click' | 'keyboard';

/** What a context menu was asked for: a node or an edge. */
export type ContextTarget =
  { readonly kind: 'node'; readonly id: Id } | { readonly kind: 'edge'; readonly key: string };

/**
 * What the canvas reports (ADR-0016, ADR-0033). Foblex events never change what is on the canvas: the adapter turns each into
 * one of these, in the ids that the canvas talks in, and the editor decides which commands they are. Points are on the canvas
 * unless they are called `client`, which is where a pointer is on the page.
 */
export type CanvasIntent =
  | { readonly type: 'select'; readonly nodes: readonly Id[]; readonly edges: readonly string[] }
  | { readonly type: 'move'; readonly moves: readonly { readonly id: Id; readonly x: number; readonly y: number }[] }
  | { readonly type: 'delete'; readonly nodes: readonly Id[]; readonly edges: readonly string[] }
  /** A drop on a node that the link rules allow, or the Enter that ends a keyboard link. */
  | { readonly type: 'link'; readonly source: Id; readonly target: Id; readonly via: LinkVia }
  /** A drop on a node that the rules do not allow. The editor says why. */
  | { readonly type: 'link-invalid'; readonly source: Id; readonly target: Id; readonly via: LinkVia }
  /** A drop on nothing. */
  | {
      readonly type: 'link-to-empty';
      readonly source: Id;
      readonly at: Point;
      readonly client: Point;
      readonly via: LinkVia;
    }
  | { readonly type: 'context-menu'; readonly target: ContextTarget; readonly client: Point }
  /** A double click on a node: the learner wants to rename it. */
  | { readonly type: 'rename'; readonly id: Id }
  /** A node dragged from the toolbox and dropped on the canvas. */
  | { readonly type: 'drop-new'; readonly node: NewNode; readonly at: Point };
