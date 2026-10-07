/**
 * What is lit on the canvas (ADR-0062): plain data that the adapter turns into classes. A mark for each edge, by its key, and for each node, by its id; a short reason for a binding that missed, which is
 * written on its label; and how many parts of what the learner chose are not on the canvas any more, which the card says. It is made from an explanation and the canvas as it is, and it is the same for a row of
 * the log, the Why? of a message, a queue that is asked about, and the what-if tester.
 */

/**
 * `path` is where the message went, `matched` a binding that matched and was not followed, `missed` a binding that was tried and did not match, and `asked` a binding that points at the queue that the learner
 * is asking about.
 */
export type EdgeMark = 'path' | 'matched' | 'missed' | 'asked';

/** `visited` is an exchange that the message reached, `reached` a queue that got a copy, `missed` a queue that did not, and `asked` the queue that the learner is asking about. */
export type NodeMark = 'visited' | 'reached' | 'missed' | 'asked';

export interface EdgeEmphasis {
  readonly mark: EdgeMark;
  /** The short reason of a binding that missed, for its label. Only an edge that is `missed` has one. */
  readonly reason?: string;
}

export interface Emphasis {
  readonly edges: ReadonlyMap<string, EdgeEmphasis>;
  readonly nodes: ReadonlyMap<string, NodeMark>;
  /** How many parts of what is lit are not on the canvas any more: a node that was deleted, a binding that was taken away. */
  readonly gone: number;
}

export const NO_EMPHASIS: Emphasis = { edges: new Map(), nodes: new Map(), gone: 0 };

/** Whether anything is lit. */
export const isLit = (emphasis: Emphasis): boolean => emphasis.edges.size + emphasis.nodes.size > 0;

/** What each look means, in the words that the card uses. The look of a line is a shape as well as a colour: thick for where a message went, dimmed and dashed for where it did not, dotted for what is asked about. */
export interface Legend {
  readonly id: 'hit' | 'miss' | 'asked';
  readonly text: string;
}

/** What the looks that are lit mean, in the order that the card has them, or `null` when nothing that has a meaning is lit. */
export function legendOf(emphasis: Emphasis): readonly Legend[] | null {
  const edges = [...emphasis.edges.values()].map(({ mark }) => mark);
  const nodes = [...emphasis.nodes.values()];
  const items: Legend[] = [];
  if (
    edges.some((mark) => mark === 'path' || mark === 'matched') ||
    nodes.some((mark) => mark === 'reached' || mark === 'visited')
  ) {
    items.push({ id: 'hit', text: 'went this way, or got a copy' });
  }
  if (edges.includes('missed') || nodes.includes('missed')) {
    items.push({ id: 'miss', text: 'did not match, and why' });
  }
  if (edges.includes('asked') || nodes.includes('asked')) {
    items.push({ id: 'asked', text: 'asked about' });
  }
  return items.length === 0 ? null : items;
}

const EDGE_STRENGTH: Readonly<Record<EdgeMark, number>> = { missed: 1, matched: 2, path: 3, asked: 4 };
const NODE_STRENGTH: Readonly<Record<NodeMark, number>> = { missed: 1, visited: 2, reached: 3, asked: 4 };

/**
 * Collects marks. A thing that is marked twice has the stronger mark, so that several bindings between the same two nodes, which are one edge, light as the strongest of them, and the reason is the first one that missed.
 */
export class Marks {
  private readonly edges = new Map<string, EdgeEmphasis>();
  private readonly nodes = new Map<string, NodeMark>();
  private lost = 0;

  edge(key: string, mark: EdgeMark, reason?: string): void {
    const known = this.edges.get(key);
    if (known === undefined || EDGE_STRENGTH[mark] > EDGE_STRENGTH[known.mark]) {
      this.edges.set(key, reason === undefined || mark !== 'missed' ? { mark } : { mark, reason });
    } else if (known.mark === 'missed' && mark === 'missed' && known.reason === undefined && reason !== undefined) {
      this.edges.set(key, { mark, reason });
    }
  }

  node(id: string, mark: NodeMark): void {
    const known = this.nodes.get(id);
    if (known === undefined || NODE_STRENGTH[mark] > NODE_STRENGTH[known]) {
      this.nodes.set(id, mark);
    }
  }

  /** A part of what was chosen is not on the canvas. */
  gone(count = 1): void {
    this.lost += count;
  }

  build(): Emphasis {
    return { edges: this.edges, nodes: this.nodes, gone: this.lost };
  }
}
