import { defaultPosition, kindOf, lookup, nameOf, type CanvasDocument, type ElementKind, type Id } from '@rmq/domain';
import type { ExchangeType } from '@rmq/engine';
import { buildCanvasVm, type EdgeKind, type VmOptions } from '../canvas/model/canvas-vm';
import { bindingRows, type BindingRow } from '../core/state/binding-commands';
import { DEFAULT_EXCHANGE_ID } from '../core/state/default-exchange';
import { edgeEnds } from '../core/state/refs';
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
  /** What is wrong with it that a broker would accept, in the sentence of each lint (ADR-0044). */
  readonly warnings: readonly string[];
  /** Something can be linked from it: every kind but a consumer, which is where a message ends (ADR-0041). */
  readonly canLink: boolean;
}

export interface EdgeView {
  readonly kind: 'edge';
  readonly key: string;
  readonly edge: EdgeKind;
  /** What the canvas says about it: `Binding from exchange orders to queue billing, key order.*`. */
  readonly label: string;
  /** For a binding, each of the bindings between the two ends, to be changed and taken off (ADR-0044). */
  readonly bindings: readonly BindingRow[];
  readonly warnings: readonly string[];
  /** Where it starts and where it ends, which are the ids that a command about it is made from. */
  readonly from: Id;
  readonly to: Id;
  /** Its label can be put somewhere along it: there is one, and the edge is the document's. */
  readonly movable: boolean;
  /** Where the document keeps the label, as a percentage of the way along the edge, or `null` when the app places it. */
  readonly labelPercent: number | null;
}

/** The default exchange, which is drawn on request and is not in the document, so there is nothing to change (ADR-0043). */
export interface DefaultExchangeView {
  readonly kind: 'default-exchange';
}

export type InspectorView =
  | { readonly kind: 'nothing' }
  | { readonly kind: 'several'; readonly count: number }
  | NodeView
  | EdgeView
  | DefaultExchangeView;

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

function nodeView(document: CanvasDocument, id: Id, warnings: readonly string[]): NodeView | undefined {
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
    warnings,
    canLink: kind !== 'consumer',
  };
}

/** What the inspector shows for this selection of this document. What is selected and not on the canvas is not shown. */
export function inspectorView(document: CanvasDocument, selection: Selection, options: VmOptions = {}): InspectorView {
  const shown = document.settings.showDefaultExchange;
  const nodes = selection.nodes.filter(
    (id) => kindOf(document, id) !== undefined || (shown && id === DEFAULT_EXCHANGE_ID),
  );
  const edges = selection.edges;
  const [node] = nodes;
  const [key] = edges;

  if (nodes.length + edges.length > 1) {
    return { kind: 'several', count: nodes.length + edges.length };
  }
  if (node === DEFAULT_EXCHANGE_ID) {
    return { kind: 'default-exchange' };
  }
  if (node !== undefined) {
    const vm = buildCanvasVm(document, undefined, options).nodes.find(({ id }) => id === node);
    return nodeView(document, node, vm?.warnings ?? []) ?? NOTHING;
  }
  if (key !== undefined) {
    const edge = buildCanvasVm(document, undefined, options).edges.find(({ id }) => id === key);
    const ends = edgeEnds(key);
    if (edge === undefined || ends === undefined) {
      return NOTHING;
    }
    const movable = edge.kind !== 'implicit' && edge.chips.length > 0;
    return {
      kind: 'edge',
      key,
      edge: edge.kind,
      label: edge.label,
      bindings: bindingRows(document, key),
      warnings: edge.warnings,
      from: ends.from,
      to: ends.to,
      movable,
      labelPercent: movable && edge.labelAt !== undefined ? Math.round(edge.labelAt * 100) : null,
    };
  }
  return NOTHING;
}
