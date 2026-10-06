import { Graph, layout } from '@dagrejs/dagre';
import { elements } from './document/elements';
import type { ElementKind } from './document/issue';
import type { CanvasDocument, Id, Position } from './document/schema';

/**
 * Auto-layout: every node in its place, from left to right in the way a message travels (ADR-0011): producers, then
 * exchanges, then queues, then consumers. A chain of exchanges takes a column for each. It is dagre's layered layout over
 * the edges of the canvas, which puts a node one column to the right of the node that feeds it and keeps the lines
 * between them short. Nothing that the canvas has already got is looked at, so the result depends on what is linked and
 * not on where things were.
 */

/** How big a node of each kind is drawn, which is what the layout leaves room for. It is a guess that the app may refine. */
export const NODE_SIZE: Readonly<Record<ElementKind, { readonly width: number; readonly height: number }>> = {
  producer: { width: 140, height: 56 },
  exchange: { width: 160, height: 56 },
  queue: { width: 160, height: 56 },
  consumer: { width: 140, height: 56 },
};
/** The space between nodes in a column, and between columns. */
export const NODE_SEPARATION = 40;
export const COLUMN_SEPARATION = 120;

/**
 * How many columns right of the producers a node that nothing is linked to belongs: an exchange one, a queue two, a
 * consumer three. A producer belongs in the first column, where a node with nothing feeding it already goes.
 */
const COLUMNS_FROM_PRODUCERS = { exchange: 1, queue: 2, consumer: 3 } as const;

/** The edges of the canvas as pairs of ids, from the node a message comes from to the node that it goes to. */
function edges(document: CanvasDocument): [Id, Id][] {
  return [
    ...Object.values(document.bindings).map(({ source, dest }): [Id, Id] => [source, dest.id]),
    ...Object.entries(document.producers).flatMap(([id, { target }]): [Id, Id][] =>
      target === null ? [] : [[id, target.id]],
    ),
    ...Object.entries(document.consumers).flatMap(([id, { queues }]): [Id, Id][] => queues.map((queue) => [queue, id])),
  ];
}

/**
 * Where every node of the canvas goes, by id, as the position of its top-left corner. The positions are whole numbers,
 * and the top-left of the whole drawing is at the origin. The same canvas gives the same answer every time.
 */
export function autoLayout(document: CanvasDocument): Readonly<Record<Id, Position>> {
  const nodes = elements(document);
  const known = new Set(nodes.map(({ id }) => id));
  const graph = new Graph();
  graph.setGraph({ rankdir: 'LR', nodesep: NODE_SEPARATION, ranksep: COLUMN_SEPARATION, marginx: 0, marginy: 0 });
  for (const { kind, id } of nodes) {
    graph.setNode(id, { ...NODE_SIZE[kind] });
  }

  const linked = new Set<Id>();
  for (const [from, to] of edges(document)) {
    if (known.has(from) && known.has(to)) {
      graph.setEdge(from, to, { minlen: 1, weight: 1 });
      linked.add(from).add(to);
    }
  }

  // A node with nothing linked to it would sit in the first column, whatever it is. Nodes with no size of their own and a
  // chain of edges between them hold the column that a kind belongs in, and only the nodes with nothing linked hang on them.
  const anchors = new Set<number>();
  for (const { kind, id } of nodes) {
    if (kind !== 'producer' && !linked.has(id)) {
      const column = COLUMNS_FROM_PRODUCERS[kind] - 1;
      for (let step = 0; step <= column; step++) {
        if (!anchors.has(step)) {
          anchors.add(step);
          graph.setNode(`@${step}`, { width: 0, height: 0 });
          if (step > 0) {
            graph.setEdge(`@${step - 1}`, `@${step}`, { minlen: 1, weight: 1 });
          }
        }
      }
      graph.setEdge(`@${column}`, id, { minlen: 1, weight: 1 });
    }
  }

  layout(graph);

  const corners = nodes.map(({ kind, id }) => {
    const centre = graph.node(id);
    return [id, { x: centre.x - NODE_SIZE[kind].width / 2, y: centre.y - NODE_SIZE[kind].height / 2 }] as const;
  });
  const left = Math.min(...corners.map(([, { x }]) => x));
  const top = Math.min(...corners.map(([, { y }]) => y));
  return Object.fromEntries(corners.map(([id, { x, y }]) => [id, { x: Math.round(x - left), y: Math.round(y - top) }]));
}
