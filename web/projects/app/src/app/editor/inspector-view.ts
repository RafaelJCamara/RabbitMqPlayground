import { defaultPosition, kindOf, lookup, nameOf, type CanvasDocument, type ElementKind, type Id } from '@rmq/domain';
import type { ExchangeType } from '@rmq/engine';
import { buildCanvasVm, type EdgeKind } from '../canvas/model/canvas-vm';
import type { Selection } from '../core/state/selection-store';

/**
 * What the inspector shows (ADR-0010, ADR-0032), made from the document and the selection by a function, so that it is tested. The
 * inspector only ever shows what the document says: a field that was refused goes back to it.
 */

export interface ExchangeFlags {
  readonly type: ExchangeType;
  readonly durable: boolean;
  readonly autoDelete: boolean;
  readonly internal: boolean;
}

export interface NodeView {
  readonly kind: 'node';
  readonly id: Id;
  readonly element: ElementKind;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly exchange?: ExchangeFlags;
  readonly queue?: { readonly durable: boolean };
  /** What it is joined to, in sentences. */
  readonly joins: readonly string[];
}

export interface EdgeView {
  readonly kind: 'edge';
  readonly key: string;
  readonly edge: EdgeKind;
  /** What the canvas says about it: `Binding from exchange orders to queue billing, key order.*`. */
  readonly label: string;
}

export type InspectorView =
  { readonly kind: 'nothing' } | { readonly kind: 'several'; readonly count: number } | NodeView | EdgeView;

const NOTHING: InspectorView = { kind: 'nothing' };

/** A sentence about the nodes at one end of a node: `Receives from exchange orders, exchange docs.` */
const sentence = (verb: string, ends: readonly string[]): string[] =>
  ends.length === 0 ? [] : [`${verb} ${ends.join(', ')}.`];

function joinsOf(document: CanvasDocument, id: Id, kind: ElementKind): string[] {
  const name = (of: ElementKind, at: Id): string => `${of} ${nameOf(document, of, at) ?? at}`;
  const unique = (items: readonly string[]): string[] => [...new Set(items)];
  const bindings = Object.values(document.bindings);

  const receivesFrom = ((): string[] => {
    switch (kind) {
      case 'producer':
        return [];
      case 'exchange':
        return [
          ...Object.entries(document.producers)
            .filter(([, { target }]) => target?.id === id)
            .map(([producer]) => name('producer', producer)),
          ...unique(bindings.filter(({ dest }) => dest.id === id).map(({ source }) => name('exchange', source))),
        ];
      case 'queue':
        return unique(bindings.filter(({ dest }) => dest.id === id).map(({ source }) => name('exchange', source)));
      case 'consumer':
        return (lookup(document.consumers, id)?.queues ?? []).map((queue) => name('queue', queue));
    }
  })();

  const sendsTo = ((): string[] => {
    switch (kind) {
      case 'producer': {
        const target = lookup(document.producers, id)?.target;
        return target === null || target === undefined ? [] : [name(target.kind, target.id)];
      }
      case 'exchange':
        return unique(bindings.filter(({ source }) => source === id).map(({ dest }) => name(dest.kind, dest.id)));
      case 'queue':
        return Object.entries(document.consumers)
          .filter(([, { queues }]) => queues.includes(id))
          .map(([consumer]) => name('consumer', consumer));
      case 'consumer':
        return [];
    }
  })();

  const lines = [...sentence('Receives from', receivesFrom), ...sentence('Sends to', sendsTo)];
  return lines.length > 0 ? lines : ['Not linked to anything yet.'];
}

function nodeView(document: CanvasDocument, id: Id): NodeView | undefined {
  const kind = kindOf(document, id);
  const name = kind === undefined ? undefined : nameOf(document, kind, id);
  if (kind === undefined || name === undefined) {
    return undefined;
  }
  const { x, y } = lookup(document.layout.nodes, id) ?? defaultPosition(document, kind);
  // An id belongs to one element, whatever its kind, so an exchange is found only for an exchange, and a queue only for a queue.
  const exchange = lookup(document.exchanges, id);
  const queue = lookup(document.queues, id);
  return {
    kind: 'node',
    id,
    element: kind,
    name,
    x,
    y,
    ...(exchange === undefined
      ? {}
      : {
          exchange: {
            type: exchange.type,
            durable: exchange.durable,
            autoDelete: exchange.autoDelete,
            internal: exchange.internal,
          },
        }),
    ...(queue === undefined ? {} : { queue: { durable: queue.durable } }),
    joins: joinsOf(document, id, kind),
  };
}

/** What the inspector shows for this selection of this document. What is selected and not on the canvas is not shown. */
export function inspectorView(document: CanvasDocument, selection: Selection): InspectorView {
  const nodes = selection.nodes.filter((id) => kindOf(document, id) !== undefined);
  const edges = selection.edges;
  const [node] = nodes;
  const [key] = edges;

  if (nodes.length + edges.length > 1) {
    return { kind: 'several', count: nodes.length + edges.length };
  }
  if (node !== undefined) {
    return nodeView(document, node) ?? NOTHING;
  }
  if (key !== undefined) {
    const edge = buildCanvasVm(document).edges.find(({ id }) => id === key);
    return edge === undefined ? NOTHING : { kind: 'edge', key, edge: edge.kind, label: edge.label };
  }
  return NOTHING;
}
