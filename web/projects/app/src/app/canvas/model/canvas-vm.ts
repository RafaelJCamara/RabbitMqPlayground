import {
  defaultPosition,
  edgeKey,
  elements,
  lookup,
  nameOf,
  type CanvasDocument,
  type ElementKind,
  type Id,
} from '@rmq/domain';
import type { ExchangeType } from '@rmq/engine';
import { bindingLabel, linkLabel, nodeLabel, subscriptionLabel } from './labels';
import { frameOf, shapePath } from './shapes';

/**
 * What is drawn (ADR-0016, ADR-0033), made from a document by a function and not by the template, so that it is tested. The
 * canvas gets the very same objects for whatever a command did not touch, so that Angular has nothing to look at for the nodes
 * that stayed where they were.
 */

export interface NodeVm {
  readonly id: Id;
  readonly kind: ElementKind;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The outline, as an SVG path, at that size. */
  readonly shape: string;
  /** What a screen reader says: `Queue billing`. */
  readonly label: string;
  /** For an exchange, its type, which is drawn as a badge. */
  readonly exchangeType?: ExchangeType;
  /** A producer has no input, and a consumer has no output (ADR-0011's table). */
  readonly hasInput: boolean;
  readonly hasOutput: boolean;
}

export type EdgeKind = 'binding' | 'link' | 'subscription';

export interface EdgeVm {
  /** The key of the edge: the id it starts from, `>`, and the id it ends at. It is also the key of its label in the layout. */
  readonly id: string;
  readonly source: Id;
  readonly target: Id;
  readonly kind: EdgeKind;
  readonly label: string;
}

export interface CanvasVm {
  readonly nodes: readonly NodeVm[];
  readonly edges: readonly EdgeVm[];
}

export const EMPTY_VM: CanvasVm = { nodes: [], edges: [] };

function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => Object.is(left[key], right[key]));
}

/** `next`, unless the one before had the very same content, in which case that one. */
function reuse<T extends object>(next: T, previous: T | undefined): T {
  return previous !== undefined && shallowEqual(next, previous) ? previous : next;
}

function nodesOf(document: CanvasDocument, previous: ReadonlyMap<Id, NodeVm>): NodeVm[] {
  return elements(document).map(({ kind, id, name }) => {
    const { width, height } = frameOf(kind);
    const { x, y } = lookup(document.layout.nodes, id) ?? defaultPosition(document, kind);
    // Ids are the same nowhere in a document, whatever the kind, so only an exchange is found here.
    const exchangeType = lookup(document.exchanges, id)?.type;
    return reuse<NodeVm>(
      {
        id,
        kind,
        name,
        x,
        y,
        width,
        height,
        shape: shapePath(kind),
        label: nodeLabel(kind, name, exchangeType),
        ...(exchangeType === undefined ? {} : { exchangeType }),
        hasInput: kind !== 'producer',
        hasOutput: kind !== 'consumer',
      },
      previous.get(id),
    );
  });
}

interface BindingGroup {
  readonly from: Id;
  readonly to: Id;
  readonly toKind: 'queue' | 'exchange';
  readonly keys: string[];
  hasArguments: boolean;
}

function edgesOf(document: CanvasDocument, previous: ReadonlyMap<string, EdgeVm>): EdgeVm[] {
  const edges: EdgeVm[] = [];
  const add = (edge: EdgeVm) => edges.push(reuse(edge, previous.get(edge.id)));
  const name = (kind: ElementKind, id: Id): string => nameOf(document, kind, id) ?? id;

  // Several bindings between the same two ends are one edge, with the keys of all of them (ADR-0011).
  const bindings = new Map<string, BindingGroup>();
  for (const { source, dest, key, headers } of Object.values(document.bindings)) {
    const id = edgeKey(source, dest.id);
    const group = bindings.get(id) ?? { from: source, to: dest.id, toKind: dest.kind, keys: [], hasArguments: false };
    group.keys.push(key);
    group.hasArguments ||= headers !== undefined;
    bindings.set(id, group);
  }
  for (const [id, { from, to, toKind, keys, hasArguments }] of bindings) {
    add({
      id,
      source: from,
      target: to,
      kind: 'binding',
      label: bindingLabel({ from: name('exchange', from), to: name(toKind, to), toKind, keys, hasArguments }),
    });
  }
  for (const [id, { name: producer, target }] of Object.entries(document.producers)) {
    if (target !== null) {
      add({
        id: edgeKey(id, target.id),
        source: id,
        target: target.id,
        kind: 'link',
        label: linkLabel(producer, target.kind, name(target.kind, target.id)),
      });
    }
  }
  for (const [id, { name: consumer, queues }] of Object.entries(document.consumers)) {
    for (const queue of queues) {
      add({
        id: edgeKey(queue, id),
        source: queue,
        target: id,
        kind: 'subscription',
        label: subscriptionLabel(consumer, name('queue', queue)),
      });
    }
  }
  return edges;
}

const sameItems = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * The view model of a document. `previous` is the one that was drawn before, so that what did not change is the same object,
 * and when nothing at all changed, the same view model.
 */
export function buildCanvasVm(document: CanvasDocument, previous: CanvasVm = EMPTY_VM): CanvasVm {
  const nodes = nodesOf(document, new Map(previous.nodes.map((node) => [node.id, node])));
  const edges = edgesOf(document, new Map(previous.edges.map((edge) => [edge.id, edge])));
  const sameNodes = sameItems(nodes, previous.nodes);
  const sameEdges = sameItems(edges, previous.edges);
  return sameNodes && sameEdges
    ? previous
    : { nodes: sameNodes ? previous.nodes : nodes, edges: sameEdges ? previous.edges : edges };
}
