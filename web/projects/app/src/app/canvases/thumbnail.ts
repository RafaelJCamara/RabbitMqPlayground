import { edgeKeys, elements, lookup, NODE_SIZE, type CanvasDocument, type ElementKind } from '@rmq/domain';

/**
 * The thumbnail of a canvas on the home (ADR-0073): its layout as data, drawn by a component as one SVG. It is a pure function of the document. The box is
 * the `viewBox` of that SVG, in canvas units, so that a node is drawn at its own size and there is no scaling to get wrong.
 */

/** At most this many nodes are drawn, the first ones in the order of the document. A canvas of 2,000 elements is a sketch; the card says the true count. */
export const THUMBNAIL_NODES = 150;
/** At most this many edges are drawn, among the nodes that are. */
export const THUMBNAIL_EDGES = 300;
/** The room around the nodes, in canvas units, so that the outline of a node at the edge of the box is not cut. */
export const THUMBNAIL_MARGIN = 24;

export interface ThumbNode {
  readonly kind: ElementKind;
  /** The top left of the node, in canvas units. */
  readonly x: number;
  readonly y: number;
}

/** A line between the middle of two nodes. */
export interface ThumbEdge {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

export interface ThumbBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Thumbnail {
  /** The box that holds every node that is drawn, with its margin, or `null` when there is nothing to draw. */
  readonly box: ThumbBox | null;
  readonly nodes: readonly ThumbNode[];
  readonly edges: readonly ThumbEdge[];
}

export const EMPTY_THUMBNAIL: Thumbnail = { box: null, nodes: [], edges: [] };

const middleX = (node: ThumbNode): number => node.x + NODE_SIZE[node.kind].width / 2;
const middleY = (node: ThumbNode): number => node.y + NODE_SIZE[node.kind].height / 2;

/** What to draw for a canvas. An element that has no position in the layout is not drawn: there is nowhere to draw it. */
export function thumbnailOf(document: CanvasDocument): Thumbnail {
  const placed = new Map<string, ThumbNode>();
  for (const { kind, id } of elements(document)) {
    if (placed.size >= THUMBNAIL_NODES) {
      break;
    }
    const at = lookup(document.layout.nodes, id);
    if (at !== undefined) {
      placed.set(id, { kind, x: at.x, y: at.y });
    }
  }
  if (placed.size === 0) {
    return EMPTY_THUMBNAIL;
  }

  const edges: ThumbEdge[] = [];
  for (const key of edgeKeys(document)) {
    if (edges.length >= THUMBNAIL_EDGES) {
      break;
    }
    // An id has no `>` in it, so the first one divides the key.
    const divide = key.indexOf('>');
    const from = placed.get(key.slice(0, divide));
    const to = placed.get(key.slice(divide + 1));
    if (from !== undefined && to !== undefined) {
      edges.push({ x1: middleX(from), y1: middleY(from), x2: middleX(to), y2: middleY(to) });
    }
  }

  const nodes = [...placed.values()];
  const left = Math.min(...nodes.map(({ x }) => x));
  const top = Math.min(...nodes.map(({ y }) => y));
  const right = Math.max(...nodes.map((node) => node.x + NODE_SIZE[node.kind].width));
  const bottom = Math.max(...nodes.map((node) => node.y + NODE_SIZE[node.kind].height));
  return {
    box: {
      x: left - THUMBNAIL_MARGIN,
      y: top - THUMBNAIL_MARGIN,
      width: right - left + 2 * THUMBNAIL_MARGIN,
      height: bottom - top + 2 * THUMBNAIL_MARGIN,
    },
    nodes,
    edges,
  };
}
