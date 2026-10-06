import { computed, Injectable, signal } from '@angular/core';
import { edgeKeys, kindOf, type CanvasDocument, type Id } from '@rmq/domain';

/** What is selected, in ids: nodes by id and edges by their key (`from>to`, the key of an edge's label). */
export interface Selection {
  readonly nodes: readonly Id[];
  readonly edges: readonly string[];
}

export const NOTHING_SELECTED: Selection = Object.freeze({ nodes: [], edges: [] });

/** The one thing that is selected, when it is one thing. */
export type OnlySelected = { readonly kind: 'node'; readonly id: Id } | { readonly kind: 'edge'; readonly key: string };

const sameItems = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * What the learner has selected (ADR-0031). The canvas reports a selection in ids, and the commands that act on it name elements
 * by kind and name, so this keeps ids and the editor converts at the edge. It forgets what is no longer on the canvas.
 */
@Injectable()
export class SelectionStore {
  private readonly current = signal<Selection>(NOTHING_SELECTED);

  readonly selection = this.current.asReadonly();
  readonly count = computed(() => this.current().nodes.length + this.current().edges.length);
  readonly only = computed<OnlySelected | undefined>(() => {
    const { nodes, edges } = this.current();
    const [node] = nodes;
    const [edge] = edges;
    if (nodes.length === 1 && edges.length === 0 && node !== undefined) {
      return { kind: 'node', id: node };
    }
    if (nodes.length === 0 && edges.length === 1 && edge !== undefined) {
      return { kind: 'edge', key: edge };
    }
    return undefined;
  });

  /** Selects these, and leaves the selection as the very same object when it already is these, so that nothing is told twice. */
  select(nodes: readonly Id[], edges: readonly string[] = []): void {
    const current = this.current();
    if (!sameItems(current.nodes, nodes) || !sameItems(current.edges, edges)) {
      this.current.set({ nodes: [...nodes], edges: [...edges] });
    }
  }

  clear(): void {
    this.select([], []);
  }

  /** Forgets the nodes and edges that the canvas does not have any more. */
  prune(document: CanvasDocument): void {
    const { nodes, edges } = this.current();
    const keys = edgeKeys(document);
    this.select(
      nodes.filter((id) => kindOf(document, id) !== undefined),
      edges.filter((key) => keys.has(key)),
    );
  }
}
