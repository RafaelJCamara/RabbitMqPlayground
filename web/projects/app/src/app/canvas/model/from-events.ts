import type { CanvasIntent, InputBy } from './intents';
import type { NewNode } from './new-node';
import type { Point } from './transform';

/**
 * Foblex's events, as intents (ADR-0016, ADR-0033). The shapes below are the parts of the library's events that are used, so
 * that this stays outside the adapter, and a spec can build them by hand.
 */

export interface SelectionEventLike {
  readonly nodeIds: readonly string[];
  readonly connectionIds: readonly string[];
}

export interface MoveEventLike {
  readonly nodes: readonly { readonly id: string; readonly position?: Point }[];
}

export interface CreateNodeEventLike {
  readonly data: unknown;
  readonly externalItemRect: { readonly gravityCenter: Point };
}

export const selectIntent = (event: SelectionEventLike): CanvasIntent => ({
  type: 'select',
  nodes: [...event.nodeIds],
  edges: [...event.connectionIds],
});

/** The library reports where nodes were dropped, and a node that has no position was not moved. */
export const moveIntent = (event: MoveEventLike, by: InputBy): CanvasIntent => ({
  type: 'move',
  moves: event.nodes.flatMap(({ id, position }) =>
    position === undefined ? [] : [{ id, x: position.x, y: position.y }],
  ),
  by,
});

export const deleteIntent = (event: SelectionEventLike, by: InputBy): CanvasIntent => ({
  type: 'delete',
  nodes: [...event.nodeIds],
  edges: [...event.connectionIds],
  by,
});

/**
 * Something dragged from the toolbox, dropped on the canvas: it is where the middle of the preview was, in the coordinates of the
 * canvas. The library has the pointer too, but only when the drop is on a node, and then in the coordinates of the page, so the
 * preview, which is always there and always in the coordinates of the canvas, is what is used (ADR-0033).
 */
export const dropNewIntent = (event: CreateNodeEventLike): CanvasIntent => ({
  type: 'drop-new',
  node: event.data as NewNode,
  at: event.externalItemRect.gravityCenter,
});
