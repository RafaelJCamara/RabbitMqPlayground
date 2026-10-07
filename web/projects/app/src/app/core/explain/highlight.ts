import {
  bindingIds,
  edgeKey,
  explainQueue,
  explainRoute,
  findId,
  lookup,
  toTopology,
  type BindingNode,
  type CanvasDocument,
  type ExchangeNode,
  type Id,
  type QueueExplanation,
  type ReasonNode,
  type RouteExplanation,
} from '@rmq/domain';
import { implicitEdgeId } from '../state/default-exchange';
import { Marks, NO_EMPHASIS, type Emphasis } from './emphasis';
import { explainedUnder, messageOf, type HeldMessage } from './held-messages';
import type { Subject } from './log-row';

/**
 * What is lit for what (ADR-0062), as pure functions: an explanation, or a row of the log, and the canvas as it is, make the marks of the edges and of the nodes. An explanation names exchanges and queues by
 * name and bindings by their place in the topology, which are the ones of the canvas that routed the message (the held document). They are found in that canvas by name and by `bindingIds`, and the ids that they
 * give are looked up on the canvas as it is now, so that a rename keeps what is lit and a delete drops it, and says how many parts went.
 */

interface NameIds {
  readonly exchanges: ReadonlyMap<string, Id>;
  readonly queues: ReadonlyMap<string, Id>;
  readonly bindings: readonly Id[];
}

const cache = new WeakMap<CanvasDocument, NameIds>();

function idsOf(document: CanvasDocument): NameIds {
  let known = cache.get(document);
  if (known === undefined) {
    known = {
      exchanges: new Map(Object.entries(document.exchanges).map(([id, { name }]) => [name, id])),
      queues: new Map(Object.entries(document.queues).map(([id, { name }]) => [name, id])),
      bindings: bindingIds(document),
    };
    cache.set(document, known);
  }
  return known;
}

/** The canvas that an explanation was made for, and the canvas as it is. */
interface Lens {
  readonly held: CanvasDocument;
  readonly current: CanvasDocument;
}

function lightExchange(marks: Marks, { held, current }: Lens, name: string, mark: 'visited' | 'missed'): void {
  const id = name === '' ? undefined : idsOf(held).exchanges.get(name);
  if (id === undefined) {
    return;
  }
  if (lookup(current.exchanges, id) === undefined) {
    marks.gone();
  } else {
    marks.node(id, mark);
  }
}

function lightQueue(marks: Marks, { held, current }: Lens, name: string, mark: 'reached' | 'missed' | 'asked'): void {
  const id = idsOf(held).queues.get(name);
  if (id === undefined) {
    return;
  }
  if (lookup(current.queues, id) === undefined) {
    marks.gone();
  } else {
    marks.node(id, mark);
  }
}

/** The producer that sent the message, and the link that it sent it along, if they are still there. */
function lightProducer(marks: Marks, { held, current }: Lens, producer: Id | null): void {
  const was = producer === null ? undefined : lookup(held.producers, producer);
  if (producer === null || was === undefined) {
    return;
  }
  const is = lookup(current.producers, producer);
  if (is === undefined) {
    marks.gone();
    return;
  }
  marks.node(producer, 'visited');
  if (was.target !== null) {
    if (is.target?.id === was.target.id) {
      marks.edge(edgeKey(producer, was.target.id), 'path');
    } else {
      marks.gone();
    }
  }
}

/** The edge of a binding of the explanation: its key on the canvas, and the id of the binding, or `null` for a binding that is not on the canvas any more. */
function bindingEdge(marks: Marks, { held, current }: Lens, index: number): string | null {
  const id = idsOf(held).bindings[index];
  const was = id === undefined ? undefined : lookup(held.bindings, id);
  if (id === undefined || was === undefined) {
    return null;
  }
  if (lookup(current.bindings, id) === undefined) {
    marks.gone();
    return null;
  }
  return edgeKey(was.source, was.dest.id);
}

function lightBinding(marks: Marks, lens: Lens, node: BindingNode, forced?: 'path' | 'asked'): void {
  if (node.index === null) {
    // An implicit binding of the default exchange, which is an edge only while that exchange is drawn, and has no words, because there is one for every queue.
    const queue = idsOf(lens.held).queues.get(node.to.name);
    if (
      queue !== undefined &&
      lens.current.settings.showDefaultExchange &&
      lookup(lens.current.queues, queue) !== undefined
    ) {
      marks.edge(implicitEdgeId(queue), forced ?? (node.verdict === 'matched' ? 'path' : 'missed'));
    }
    return;
  }
  const key = bindingEdge(marks, lens, node.index);
  if (key === null) {
    return;
  }
  if (forced !== undefined) {
    marks.edge(key, forced);
  } else if (node.verdict === 'matched') {
    marks.edge(key, node.followed ? 'path' : 'matched');
  } else {
    marks.edge(key, 'missed', node.short);
  }
}

/** Every exchange and every binding of the tree of a route, in the order that it is read. */
function walk(root: ExchangeNode): { exchanges: ExchangeNode[]; bindings: BindingNode[] } {
  const exchanges: ExchangeNode[] = [];
  const bindings: BindingNode[] = [];
  const stack: ExchangeNode[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    exchanges.push(node);
    for (const binding of node.bindings) {
      bindings.push(binding);
      if (binding.next !== null) {
        stack.push(binding.next);
      }
    }
  }
  return { exchanges, bindings };
}

/**
 * The Why? of a message: the producer's link, every binding that was tried (`path`, `matched` or `missed`, with its short reason), the exchanges that were reached, and every queue, reached or not. `held` is the canvas that
 * routed it, and `current` the canvas as it is.
 */
export function emphasisOfRoute(
  explanation: RouteExplanation,
  producer: Id | null,
  held: CanvasDocument,
  current: CanvasDocument,
): Emphasis {
  const marks = new Marks();
  const lens: Lens = { held, current };
  lightProducer(marks, lens, producer);
  if (explanation.outcome === 'routed' || explanation.outcome === 'unroutable') {
    const { exchanges, bindings } = walk(explanation.root);
    for (const exchange of exchanges) {
      lightExchange(marks, lens, exchange.name, 'visited');
    }
    for (const binding of bindings) {
      lightBinding(marks, lens, binding);
    }
    for (const queue of explanation.queues) {
      lightQueue(marks, lens, queue, 'reached');
    }
    for (const queue of explanation.unreached) {
      lightQueue(marks, lens, queue, 'missed');
    }
  } else {
    lightExchange(marks, lens, explanation.message.exchange, 'visited');
  }
  return marks.build();
}

/**
 * One queue that is asked about: the queue itself, and, for a queue that got a copy, the way that the message went to it; for one that did not, the bindings that point at it, with the reasons of the ones that were
 * tried, and the chain of exchanges that the message never reached.
 */
export function emphasisOfQueue(
  queue: QueueExplanation,
  producer: Id | null,
  held: CanvasDocument,
  current: CanvasDocument,
): Emphasis {
  const marks = new Marks();
  const lens: Lens = { held, current };
  lightQueue(marks, lens, queue.queue, 'asked');
  if (queue.reached) {
    lightProducer(marks, lens, producer);
    for (const step of queue.path) {
      lightExchange(marks, lens, step.from, 'visited');
      lightBinding(marks, lens, step, 'path');
    }
    return marks.build();
  }
  const stack: ReasonNode[] = [...queue.because];
  for (let reason = stack.pop(); reason !== undefined; reason = stack.pop()) {
    if (reason.kind === 'binding-did-not-match') {
      lightBinding(marks, lens, reason.binding);
    } else if (reason.kind === 'exchange-not-reached') {
      const edge = bindingEdge(marks, lens, reason.binding);
      if (edge !== null) {
        marks.edge(edge, 'asked');
      }
      lightExchange(marks, lens, reason.exchange, 'missed');
      stack.push(...reason.because);
    } else if (reason.kind === 'cycle' || reason.kind === 'already-explained') {
      lightExchange(marks, lens, reason.exchange, 'missed');
    }
  }
  return marks.build();
}

/** Where the held messages are asked for. */
export interface HeldSource {
  get(message: number): HeldMessage | undefined;
}

/** The explanation of a held message, made again with the canvas that routed it. */
export function explanationOf(held: HeldMessage): { explanation: RouteExplanation; document: CanvasDocument } {
  const document = explainedUnder(held);
  return { explanation: explainRoute(toTopology(document), messageOf(held)), document };
}

/** What choosing a row lights: the Why? of its message, the way to its queue, the producer's link, the subscription of a consumer, or nodes. */
export function emphasisOfSubject(subject: Subject, source: HeldSource, current: CanvasDocument): Emphasis {
  switch (subject.kind) {
    case 'route': {
      const held = source.get(subject.message);
      if (held === undefined) {
        return NO_EMPHASIS;
      }
      const { explanation, document } = explanationOf(held);
      return emphasisOfRoute(explanation, held.info.producer, document, current);
    }
    case 'publish': {
      const held = source.get(subject.message);
      if (held === undefined) {
        return NO_EMPHASIS;
      }
      const marks = new Marks();
      lightProducer(marks, { held: held.under, current }, held.info.producer);
      const target = held.info.producer === null ? undefined : lookup(held.under.producers, held.info.producer)?.target;
      if (target?.kind === 'exchange' && lookup(current.exchanges, target.id) !== undefined) {
        marks.node(target.id, 'visited');
      } else if (target?.kind === 'queue' && lookup(current.queues, target.id) !== undefined) {
        marks.node(target.id, 'reached');
      }
      return marks.build();
    }
    case 'copy': {
      const held = source.get(subject.message);
      if (held === undefined) {
        return NO_EMPHASIS;
      }
      const document = explainedUnder(held);
      const queue = explainQueue(toTopology(document), messageOf(held), subject.queue);
      return emphasisOfQueue(queue, held.info.producer, document, current);
    }
    case 'delivery': {
      const marks = new Marks();
      const queue = findId(current, 'queue', subject.queue);
      const consumer = lookup(current.consumers, subject.channel);
      if (queue === undefined || consumer === undefined) {
        marks.gone();
      }
      if (queue !== undefined) {
        marks.node(queue, 'reached');
      }
      if (consumer !== undefined) {
        marks.node(subject.channel, 'visited');
      }
      if (queue !== undefined && consumer?.queues.includes(queue) === true) {
        marks.edge(edgeKey(queue, subject.channel), 'path');
      }
      return marks.build();
    }
    case 'nodes': {
      const marks = new Marks();
      for (const name of subject.queues) {
        const queue = findId(current, 'queue', name);
        if (queue === undefined) {
          marks.gone();
        } else {
          marks.node(queue, 'reached');
        }
      }
      for (const channel of subject.channels) {
        if (lookup(current.consumers, channel) === undefined) {
          marks.gone();
        } else {
          marks.node(channel, 'visited');
        }
      }
      return marks.build();
    }
  }
}
