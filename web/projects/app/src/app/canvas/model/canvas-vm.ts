import {
  defaultPosition,
  edgeKey,
  elements,
  lint,
  lookup,
  nameOf,
  type CanvasDocument,
  type ElementKind,
  type Id,
} from '@rmq/domain';
import type { ExchangeType } from '@rmq/engine';
import { DEFAULT_EXCHANGE_ID, defaultExchangePosition, implicitEdgeId } from '../../core/state/default-exchange';
import {
  bindingLabel,
  chipsOf,
  implicitLabel,
  linkLabel,
  nodeLabel,
  splitChips,
  subscriptionLabel,
  type BindingFacts,
} from './labels';
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
  /** What a screen reader says: `Queue billing`, and `Exchange orders, topic, 1 warning` for a node that has a lint. */
  readonly label: string;
  /** For an exchange, its type, which is drawn as a badge. */
  readonly exchangeType?: ExchangeType;
  /** What is under the name when there is no badge: the kind, unless a node says otherwise. */
  readonly caption?: string;
  /** A producer has no input, and a consumer has no output (ADR-0011's table). */
  readonly hasInput: boolean;
  readonly hasOutput: boolean;
  /** What is wrong with it that a broker would accept (ADR-0044): the sentence of each lint. */
  readonly warnings: readonly string[];
  /** It is not in the document: the default exchange, drawn on request (ADR-0043). */
  readonly virtual?: true;
}

export type EdgeKind = 'binding' | 'link' | 'subscription' | 'implicit';

export interface EdgeVm {
  /** The key of the edge: the id it starts from, `>`, and the id it ends at. It is also the key of its label in the layout. */
  readonly id: string;
  /** The node that it is drawn from, and the one that it is drawn to. A link to a queue is drawn to the default exchange while that is shown (ADR-0043). */
  readonly source: Id;
  readonly target: Id;
  readonly kind: EdgeKind;
  readonly label: string;
  /** What the label of the edge says, three at most (ADR-0044), and what "+N more" stands for. */
  readonly chips: readonly string[];
  readonly more: readonly string[];
  /** Where along the edge the document keeps its label, from 0 to 1. Left out when the document has no place for it. */
  readonly labelAt?: number;
  /** What is wrong with it that a broker would accept. */
  readonly warnings: readonly string[];
}

export interface CanvasVm {
  readonly nodes: readonly NodeVm[];
  readonly edges: readonly EdgeVm[];
}

export const EMPTY_VM: CanvasVm = { nodes: [], edges: [] };

/** Whether two values are the same for the view: the same value, or lists that hold the same values in the same order. */
function sameValue(a: unknown, b: unknown): boolean {
  return Array.isArray(a) && Array.isArray(b) ? sameItems(a, b) : Object.is(a, b);
}

function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => sameValue(left[key], right[key]));
}

/** `next`, unless the one before had the very same content, in which case that one. */
function reuse<T extends object>(next: T, previous: T | undefined): T {
  return previous !== undefined && shallowEqual(next, previous) ? previous : next;
}

/** The sentences of the lints about each thing, by the id of the node, and by the key of the edge. */
function warningsOf(document: CanvasDocument): {
  readonly nodes: Map<Id, string[]>;
  readonly edges: Map<string, string[]>;
} {
  const nodes = new Map<Id, string[]>();
  const edges = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, id: string, message: string) =>
    map.set(id, [...(map.get(id) ?? []), message]);
  for (const { subject, message } of lint(document)) {
    if (subject.kind === 'exchange') {
      add(nodes, subject.id, message);
    } else {
      const binding = lookup(document.bindings, subject.id);
      if (binding !== undefined) {
        add(edges, edgeKey(binding.source, binding.dest.id), message);
      }
    }
  }
  return { nodes, edges };
}

function nodesOf(
  document: CanvasDocument,
  previous: ReadonlyMap<Id, NodeVm>,
  warnings: ReadonlyMap<Id, readonly string[]>,
): NodeVm[] {
  const nodes = elements(document).map(({ kind, id, name }) => {
    const { width, height } = frameOf(kind);
    const { x, y } = lookup(document.layout.nodes, id) ?? defaultPosition(document, kind);
    // An id belongs to one element, whatever its kind, so only the id of an exchange is found among the exchanges.
    const exchangeType = lookup(document.exchanges, id)?.type;
    const lints = warnings.get(id) ?? [];
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
        label: nodeLabel(kind, name, exchangeType, lints.length),
        ...(exchangeType === undefined ? {} : { exchangeType }),
        hasInput: kind !== 'producer',
        hasOutput: kind !== 'consumer',
        warnings: lints,
      },
      previous.get(id),
    );
  });
  if (document.settings.showDefaultExchange) {
    const { width, height } = frameOf('exchange');
    const { x, y } = defaultExchangePosition(document);
    nodes.push(
      reuse<NodeVm>(
        {
          id: DEFAULT_EXCHANGE_ID,
          kind: 'exchange',
          name: '(default)',
          caption: 'default exchange',
          x,
          y,
          width,
          height,
          shape: shapePath('exchange'),
          label: 'Default exchange',
          hasInput: true,
          hasOutput: true,
          warnings: [],
          virtual: true,
        },
        previous.get(DEFAULT_EXCHANGE_ID),
      ),
    );
  }
  return nodes;
}

interface BindingGroup {
  readonly from: Id;
  readonly to: Id;
  readonly toKind: 'queue' | 'exchange';
  readonly keys: string[];
  readonly facts: BindingFacts[];
  hasArguments: boolean;
}

function edgesOf(
  document: CanvasDocument,
  previous: ReadonlyMap<string, EdgeVm>,
  warnings: ReadonlyMap<string, readonly string[]>,
): EdgeVm[] {
  const edges: EdgeVm[] = [];
  const name = (kind: ElementKind, id: Id): string => nameOf(document, kind, id) ?? id;
  const add = (
    edge: Omit<EdgeVm, 'chips' | 'more' | 'warnings' | 'labelAt'> & { readonly all?: readonly string[] },
  ) => {
    const { all = [], ...rest } = edge;
    const at = lookup(document.layout.labels, edge.id)?.at;
    const { chips, more } = splitChips(all);
    edges.push(
      reuse<EdgeVm>(
        { ...rest, chips, more, labelAt: at, warnings: warnings.get(edge.id) ?? [] },
        previous.get(edge.id),
      ),
    );
  };
  const showDefault = document.settings.showDefaultExchange;

  // Several bindings between the same two ends are one edge, with the keys of all of them (ADR-0011).
  const bindings = new Map<string, BindingGroup>();
  for (const { source, dest, key, headers } of Object.values(document.bindings)) {
    const id = edgeKey(source, dest.id);
    const group = bindings.get(id) ?? {
      from: source,
      to: dest.id,
      toKind: dest.kind,
      keys: [],
      facts: [],
      hasArguments: false,
    };
    group.keys.push(key);
    group.facts.push({ key, hasArguments: headers !== undefined });
    group.hasArguments ||= headers !== undefined;
    bindings.set(id, group);
  }
  for (const [id, { from, to, toKind, keys, facts, hasArguments }] of bindings) {
    add({
      id,
      source: from,
      target: to,
      kind: 'binding',
      label: bindingLabel({ from: name('exchange', from), to: name(toKind, to), toKind, keys, hasArguments }),
      all: chipsOf(lookup(document.exchanges, from)?.type, facts),
    });
  }
  for (const [id, { name: producer, target }] of Object.entries(document.producers)) {
    if (target === null) {
      continue;
    }
    const targetName = name(target.kind, target.id);
    const toQueue = target.kind === 'queue';
    // Through the default exchange when it is drawn: the edge keeps the key of the link, and is drawn to the exchange (ADR-0043).
    const viaNode = toQueue && showDefault;
    add({
      id: edgeKey(id, target.id),
      source: id,
      target: viaNode ? DEFAULT_EXCHANGE_ID : target.id,
      kind: 'link',
      label: linkLabel(producer, target.kind, targetName, viaNode),
      all: toQueue ? [viaNode ? targetName : 'default exchange'] : [],
    });
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
  if (showDefault) {
    for (const [queue, { name: queueName }] of Object.entries(document.queues)) {
      add({
        id: implicitEdgeId(queue),
        source: DEFAULT_EXCHANGE_ID,
        target: queue,
        kind: 'implicit',
        label: implicitLabel(queueName),
        all: [queueName],
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
  const warnings = warningsOf(document);
  const nodes = nodesOf(document, new Map(previous.nodes.map((node) => [node.id, node])), warnings.nodes);
  const edges = edgesOf(document, new Map(previous.edges.map((edge) => [edge.id, edge])), warnings.edges);
  const sameNodes = sameItems(nodes, previous.nodes);
  const sameEdges = sameItems(edges, previous.edges);
  return sameNodes && sameEdges
    ? previous
    : { nodes: sameNodes ? previous.nodes : nodes, edges: sameEdges ? previous.edges : edges };
}
