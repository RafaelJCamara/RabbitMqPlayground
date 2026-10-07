import { explainQueue, explainRoute, toTopology, type CanvasDocument } from '@rmq/domain';
import type { MessageInfo } from '@rmq/engine';
import { bindingRecord, consumerRecord, documentOf, exchangeRecord, producerRecord, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { implicitEdgeId } from '../state/default-exchange';
import { isLit, Marks, NO_EMPHASIS, type Emphasis } from './emphasis';
import { emphasisOfQueue, emphasisOfRoute, emphasisOfSubject, explanationOf } from './highlight';
import { HeldMessages } from './held-messages';

/**
 *     P sender ──▶ E orders (topic) ──'a.*'──▶ Q1 billing ──▶ C worker
 *                      ├──'b.*'──▶ Q2 archive
 *                      └──'a.#'──▶ X audit (fanout) ──▶ Q3 log
 */
const canvas = (changes: { default?: boolean } = {}): CanvasDocument => {
  const document = documentOf({
    exchanges: { E: exchangeRecord('orders', 'topic'), X: exchangeRecord('audit', 'fanout') },
    queues: { Q1: queueRecord('billing'), Q2: queueRecord('archive'), Q3: queueRecord('log') },
    bindings: {
      B1: bindingRecord('E', { kind: 'queue', id: 'Q1' }, 'a.*'),
      B2: bindingRecord('E', { kind: 'queue', id: 'Q2' }, 'b.*'),
      B3: bindingRecord('E', { kind: 'exchange', id: 'X' }, 'a.#'),
      B4: bindingRecord('X', { kind: 'queue', id: 'Q3' }),
    },
    producers: { P: producerRecord('sender', { kind: 'exchange', id: 'E' }) },
    consumers: { C: consumerRecord('worker', ['Q1']) },
  });
  return changes.default === true
    ? { ...document, settings: { ...document.settings, showDefaultExchange: true } }
    : document;
};

const info = (changes: Partial<MessageInfo> = {}): MessageInfo => ({
  id: 7,
  producer: 'P',
  exchange: 'orders',
  key: 'a.created',
  headers: [],
  payload: 'hi',
  ...changes,
});

const plain = (emphasis: Emphasis) => ({
  edges: Object.fromEntries(emphasis.edges),
  nodes: Object.fromEntries(emphasis.nodes),
  gone: emphasis.gone,
});

describe('Marks (ADR-0062)', () => {
  it('keeps the stronger mark of a thing that is marked twice, and the first reason of the bindings that missed', () => {
    const marks = new Marks();
    marks.edge('e1', 'missed', 'first');
    marks.edge('e1', 'missed', 'second');
    marks.edge('e2', 'missed');
    marks.edge('e2', 'missed', 'late');
    marks.edge('e3', 'missed', 'weak');
    marks.edge('e3', 'matched');
    marks.edge('e3', 'missed', 'weaker');
    marks.edge('e4', 'path');
    marks.edge('e4', 'asked');
    marks.edge('e5', 'asked');
    marks.edge('e5', 'path');
    // Only a binding that missed has a reason, whatever it is given.
    marks.edge('e6', 'path', 'not a reason');
    marks.edge('e7', 'matched', 'not a reason');
    marks.node('n1', 'missed');
    marks.node('n1', 'visited');
    marks.node('n1', 'reached');
    marks.node('n1', 'visited');
    marks.node('n2', 'asked');
    marks.node('n2', 'reached');
    marks.gone();
    marks.gone(2);

    expect(plain(marks.build())).toStrictEqual({
      edges: {
        e1: { mark: 'missed', reason: 'first' },
        e2: { mark: 'missed', reason: 'late' },
        e3: { mark: 'matched' },
        e4: { mark: 'asked' },
        e5: { mark: 'asked' },
        e6: { mark: 'path' },
        e7: { mark: 'matched' },
      },
      nodes: { n1: 'reached', n2: 'asked' },
      gone: 3,
    });
  });

  it('says whether anything is lit', () => {
    expect(isLit(NO_EMPHASIS)).toBe(false);
    const edge = new Marks();
    edge.edge('a', 'path');
    const node = new Marks();
    node.node('n', 'visited');

    expect(isLit(edge.build())).toBe(true);
    expect(isLit(node.build())).toBe(true);
    expect(isLit(new Marks().build())).toBe(false);
  });
});

describe('the Why? of a message (ADR-0062)', () => {
  const document = canvas();
  const explanation = explainRoute(toTopology(document), { exchange: 'orders', key: 'a.created', headers: [] });

  it('lights the producer’s link, each binding with what became of it, the exchanges that were reached, and each queue, reached or not', () => {
    expect(plain(emphasisOfRoute(explanation, 'P', document, document))).toEqual({
      edges: {
        'P>E': { mark: 'path' },
        'E>Q1': { mark: 'path' },
        'E>Q2': { mark: 'missed', reason: 'first word is "a", not "b"' },
        'E>X': { mark: 'path' },
        'X>Q3': { mark: 'path' },
      },
      nodes: { P: 'visited', E: 'visited', X: 'visited', Q1: 'reached', Q3: 'reached', Q2: 'missed' },
      gone: 0,
    });
  });

  it('lights a binding that matched and was not followed as matched, and the edge as the strongest of the bindings between the same two nodes', () => {
    const twice = documentOf({
      exchanges: { E: exchangeRecord('orders', 'topic') },
      queues: { Q: queueRecord('billing') },
      bindings: {
        B1: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'a.*'),
        B2: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'a.#'),
        B3: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'z'),
      },
    });
    const result = explainRoute(toTopology(twice), { exchange: 'orders', key: 'a.created', headers: [] });

    // The first binding gave the queue its copy, and the second matched too and was not followed.
    expect(plain(emphasisOfRoute(result, null, twice, twice)).edges).toEqual({ 'E>Q': { mark: 'path' } });
    const onlySecond = documentOf({
      exchanges: { E: exchangeRecord('orders', 'topic') },
      queues: { Q: queueRecord('billing') },
      bindings: {
        B1: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'z.*'),
        B3: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'q'),
      },
    });
    expect(
      plain(
        emphasisOfRoute(
          explainRoute(toTopology(onlySecond), { exchange: 'orders', key: 'a.b', headers: [] }),
          null,
          onlySecond,
          onlySecond,
        ),
      ).edges,
    ).toEqual({ 'E>Q': { mark: 'missed', reason: 'first word is "a", not "z"' } });
  });

  it('lights a binding that matched and was not followed as matched', () => {
    const diamond = documentOf({
      exchanges: { T: exchangeRecord('top', 'fanout'), L: exchangeRecord('left', 'fanout') },
      queues: { Q: queueRecord('shared') },
      bindings: {
        B1: bindingRecord('T', { kind: 'exchange', id: 'L' }),
        B2: bindingRecord('T', { kind: 'queue', id: 'Q' }),
        B3: bindingRecord('L', { kind: 'queue', id: 'Q' }),
      },
    });
    const result = explainRoute(toTopology(diamond), { exchange: 'top', key: '', headers: [] });

    expect(plain(emphasisOfRoute(result, null, diamond, diamond)).edges).toEqual({
      'T>L': { mark: 'path' },
      'T>Q': { mark: 'path' },
      'L>Q': { mark: 'matched' },
    });
  });

  it('follows a canvas that changed: a rename keeps what is lit, a node that was deleted is not lit, and the card is told how many parts went', () => {
    const renamed: CanvasDocument = {
      ...document,
      queues: { ...document.queues, Q1: queueRecord('invoices') },
      producers: { P: producerRecord('dispatcher', { kind: 'exchange', id: 'E' }) },
    };
    expect(plain(emphasisOfRoute(explanation, 'P', document, renamed)).gone).toBe(0);
    expect(emphasisOfRoute(explanation, 'P', document, renamed).nodes.get('Q1')).toBe('reached');

    const { Q3: _gone, ...queues } = document.queues;
    const { B4: _binding, ...bindings } = document.bindings;
    const cut: CanvasDocument = { ...document, queues, bindings };
    const result = emphasisOfRoute(explanation, 'P', document, cut);

    expect(result.nodes.has('Q3')).toBe(false);
    expect(result.edges.has('X>Q3')).toBe(false);
    expect(result.gone).toBe(2);
    expect(result.nodes.get('Q1')).toBe('reached');

    // An exchange that was reached and is not on the canvas any more is not lit, and counts as one part that went.
    const { X: _exchange, ...exchanges } = document.exchanges;
    const withoutX = emphasisOfRoute(explanation, 'P', document, { ...document, exchanges });

    expect(withoutX.nodes.has('X')).toBe(false);
    expect(withoutX.nodes.get('E')).toBe('visited');
    expect(withoutX.gone).toBe(1);
  });

  it('does not light a producer that was deleted, and says so, and does not light its link when it was linked elsewhere since', () => {
    const { P: _producer, ...producers } = document.producers;
    const deleted: CanvasDocument = { ...document, producers };
    const relinked: CanvasDocument = {
      ...document,
      producers: { P: producerRecord('sender', { kind: 'queue', id: 'Q1' }) },
    };

    expect(emphasisOfRoute(explanation, 'P', document, deleted)).toMatchObject({ gone: 1 });
    expect(emphasisOfRoute(explanation, 'P', document, deleted).nodes.has('P')).toBe(false);
    expect(emphasisOfRoute(explanation, 'P', document, relinked).edges.has('P>E')).toBe(false);
    expect(emphasisOfRoute(explanation, 'P', document, relinked).gone).toBe(1);
    expect(emphasisOfRoute(explanation, 'P', document, relinked).nodes.get('P')).toBe('visited');
  });

  it('lights a message that no producer sent without a producer, and leaves out a producer that the held canvas never had', () => {
    expect(emphasisOfRoute(explanation, null, document, document).nodes.has('P')).toBe(false);
    expect(emphasisOfRoute(explanation, 'nobody', document, document).nodes.has('nobody')).toBe(false);
  });

  it('lights the exchange that a refused publish went to, when it is there, and nothing else of the route', () => {
    const hidden = documentOf({ exchanges: { H: exchangeRecord('hidden', 'fanout', { internal: true }) } });
    const refused = explainRoute(toTopology(hidden), { exchange: 'hidden', key: '', headers: [] });
    const missing = explainRoute(toTopology(hidden), { exchange: 'nope', key: '', headers: [] });
    const invalid = explainRoute(toTopology(hidden), { exchange: 'hidden', key: 'x'.repeat(300), headers: [] });

    expect(plain(emphasisOfRoute(refused, null, hidden, hidden))).toEqual({
      edges: {},
      nodes: { H: 'visited' },
      gone: 0,
    });
    expect(plain(emphasisOfRoute(missing, null, hidden, hidden))).toEqual({ edges: {}, nodes: {}, gone: 0 });
    expect(plain(emphasisOfRoute(invalid, null, hidden, hidden)).nodes).toEqual({ H: 'visited' });
  });

  it('lights the implicit bindings of the default exchange only while it is drawn, and gives them no words', () => {
    // A producer that is linked to a queue publishes through the default exchange.
    const linked = { producers: { P: producerRecord('sender', { kind: 'queue', id: 'Q1' }) } };
    const drawn = { ...canvas({ default: true }), ...linked };
    const hidden = { ...canvas(), ...linked };
    const toQueue = explainRoute(toTopology(drawn), { exchange: '', key: 'billing', headers: [] });

    expect(plain(emphasisOfRoute(toQueue, 'P', drawn, drawn)).edges).toEqual({
      'P>Q1': { mark: 'path' },
      [implicitEdgeId('Q1')]: { mark: 'path' },
      [implicitEdgeId('Q2')]: { mark: 'missed' },
      [implicitEdgeId('Q3')]: { mark: 'missed' },
    });
    expect(plain(emphasisOfRoute(toQueue, 'P', drawn, drawn)).nodes).toMatchObject({ Q1: 'reached', Q2: 'missed' });
    // Not drawn: there is no edge to light, and the producer's link says where the message went.
    expect(plain(emphasisOfRoute(toQueue, 'P', drawn, hidden)).edges).toEqual({ 'P>Q1': { mark: 'path' } });
    // The edge of a queue that is gone from the canvas is not lit, and a queue that the held canvas had and the canvas has not is gone.
    const { Q2: _queue, ...queues } = drawn.queues;
    const cut = emphasisOfRoute(toQueue, null, drawn, { ...drawn, queues });
    expect(cut.edges.has(implicitEdgeId('Q2'))).toBe(false);
    expect(cut.gone).toBe(1);
  });
});

describe('one queue that is asked about (ADR-0062)', () => {
  const document = canvas();
  const topology = toTopology(document);
  const message = { exchange: 'orders', key: 'a.created', headers: [] };

  it('lights a queue that got a copy as asked, with the way that the message went to it', () => {
    const result = emphasisOfQueue(explainQueue(topology, message, 'log'), 'P', document, document);

    expect(plain(result)).toEqual({
      edges: { 'P>E': { mark: 'path' }, 'E>X': { mark: 'path' }, 'X>Q3': { mark: 'path' } },
      nodes: { Q3: 'asked', P: 'visited', E: 'visited', X: 'visited' },
      gone: 0,
    });
  });

  it('lights a queue that did not as asked, with the binding that was tried and the reason that it did not match', () => {
    const result = emphasisOfQueue(explainQueue(topology, message, 'archive'), 'P', document, document);

    expect(plain(result)).toEqual({
      edges: { 'E>Q2': { mark: 'missed', reason: 'first word is "a", not "b"' } },
      nodes: { Q2: 'asked' },
      gone: 0,
    });
  });

  it('lights, for a queue that the message could not get to, the chain that it never went along, and says what it never reached', () => {
    const island = documentOf({
      exchanges: {
        S: exchangeRecord('start', 'fanout'),
        H: exchangeRecord('hub', 'fanout'),
        L: exchangeRecord('left', 'fanout'),
      },
      queues: { Q: queueRecord('q') },
      bindings: {
        B1: bindingRecord('H', { kind: 'exchange', id: 'L' }),
        B2: bindingRecord('L', { kind: 'queue', id: 'Q' }),
      },
    });
    const result = emphasisOfQueue(
      explainQueue(toTopology(island), { exchange: 'start', key: '', headers: [] }, 'q'),
      null,
      island,
      island,
    );

    expect(plain(result)).toEqual({
      edges: { 'L>Q': { mark: 'asked' }, 'H>L': { mark: 'asked' } },
      nodes: { Q: 'asked', L: 'missed', H: 'missed' },
      gone: 0,
    });
  });

  it('lights the exchanges of a cycle that the message never entered, and an exchange that was explained already', () => {
    const cycle = documentOf({
      exchanges: {
        Z: exchangeRecord('z', 'fanout'),
        X: exchangeRecord('x', 'fanout'),
        Y: exchangeRecord('y', 'fanout'),
      },
      queues: { Q: queueRecord('q') },
      bindings: {
        B1: bindingRecord('X', { kind: 'exchange', id: 'Y' }),
        B2: bindingRecord('Y', { kind: 'exchange', id: 'X' }),
        B3: bindingRecord('Y', { kind: 'queue', id: 'Q' }),
      },
    });
    const result = emphasisOfQueue(
      explainQueue(toTopology(cycle), { exchange: 'z', key: '', headers: [] }, 'q'),
      null,
      cycle,
      cycle,
    );

    expect(result.nodes.get('X')).toBe('missed');
    expect(result.nodes.get('Y')).toBe('missed');
    expect(result.nodes.get('Q')).toBe('asked');
  });

  it('lights nothing but the queue for a publish that the broker refuses, and does not light what is gone', () => {
    const hidden = documentOf({
      exchanges: { H: exchangeRecord('hidden', 'fanout', { internal: true }) },
      queues: { Q: queueRecord('q') },
    });
    const refused = emphasisOfQueue(
      explainQueue(toTopology(hidden), { exchange: 'hidden', key: '', headers: [] }, 'q'),
      null,
      hidden,
      hidden,
    );
    const gone = emphasisOfQueue(explainQueue(topology, message, 'archive'), 'P', document, documentOf());

    expect(plain(refused)).toEqual({ edges: {}, nodes: { Q: 'asked' }, gone: 0 });
    expect(gone.gone).toBeGreaterThan(0);
    expect(isLit(gone)).toBe(false);
  });
});

describe('what choosing a row lights (ADR-0062)', () => {
  const document = canvas();
  const held = new HeldMessages();
  held.published(info(), 0, document);
  held.settled(7, 'routed', ['billing', 'log'], document);

  it('lights, for a route, what the Why? of the message lights, worked out with the canvas that routed it', () => {
    const { explanation } = explanationOf(held.get(7)!);

    expect(emphasisOfSubject({ kind: 'route', message: 7 }, held, document)).toEqual(
      emphasisOfRoute(explanation, 'P', document, document),
    );
  });

  it('lights the producer’s link and the producer and what it is linked to, for a publish', () => {
    expect(plain(emphasisOfSubject({ kind: 'publish', message: 7 }, held, document))).toEqual({
      edges: { 'P>E': { mark: 'path' } },
      nodes: { P: 'visited', E: 'visited' },
      gone: 0,
    });
    const toQueue = new HeldMessages();
    const linked = { ...document, producers: { P: producerRecord('sender', { kind: 'queue', id: 'Q1' }) } };
    toQueue.published(info({ exchange: '', key: 'billing' }), 0, linked);

    expect(plain(emphasisOfSubject({ kind: 'publish', message: 7 }, toQueue, linked))).toEqual({
      edges: { 'P>Q1': { mark: 'path' } },
      nodes: { P: 'visited', Q1: 'reached' },
      gone: 0,
    });
  });

  it('lights nothing of a message that is not held, whatever the row says of it', () => {
    for (const subject of [
      { kind: 'route', message: 99 },
      { kind: 'publish', message: 99 },
      { kind: 'copy', message: 99, queue: 'billing' },
    ] as const) {
      expect(emphasisOfSubject(subject, held, document), subject.kind).toBe(NO_EMPHASIS);
    }
  });

  it('lights the way to the queue that a copy is in, and the queue as asked', () => {
    expect(plain(emphasisOfSubject({ kind: 'copy', message: 7, queue: 'billing' }, held, document))).toEqual({
      edges: { 'P>E': { mark: 'path' }, 'E>Q1': { mark: 'path' } },
      nodes: { Q1: 'asked', P: 'visited', E: 'visited' },
      gone: 0,
    });
  });

  it('lights the subscription of a queue to the consumer that was given a message, and both nodes', () => {
    expect(plain(emphasisOfSubject({ kind: 'delivery', queue: 'billing', channel: 'C' }, held, document))).toEqual({
      edges: { 'Q1>C': { mark: 'path' } },
      nodes: { Q1: 'reached', C: 'visited' },
      gone: 0,
    });
  });

  it('does not light a subscription that is gone, a queue that was renamed, or a consumer that was deleted, and counts them', () => {
    const unsubscribed = { ...document, consumers: { C: consumerRecord('worker', []) } };
    const renamed = { ...document, queues: { ...document.queues, Q1: queueRecord('invoices') } };

    expect(plain(emphasisOfSubject({ kind: 'delivery', queue: 'billing', channel: 'C' }, held, unsubscribed))).toEqual({
      edges: {},
      nodes: { Q1: 'reached', C: 'visited' },
      gone: 0,
    });
    expect(plain(emphasisOfSubject({ kind: 'delivery', queue: 'billing', channel: 'C' }, held, renamed))).toEqual({
      edges: {},
      nodes: { C: 'visited' },
      gone: 1,
    });
    // Nothing is lit that is not there: the queue and the consumer are both gone, and a consumer that is gone is a part that went and not a node.
    expect(plain(emphasisOfSubject({ kind: 'delivery', queue: 'billing', channel: 'C' }, held, documentOf()))).toEqual({
      edges: {},
      nodes: {},
      gone: 1,
    });
    const { C: _consumer, ...consumers } = document.consumers;
    expect(
      plain(emphasisOfSubject({ kind: 'delivery', queue: 'billing', channel: 'C' }, held, { ...document, consumers })),
    ).toEqual({ edges: {}, nodes: { Q1: 'reached' }, gone: 1 });
  });

  it('lights the queues and the consumers that a row is about, and counts the ones that have gone', () => {
    expect(
      plain(emphasisOfSubject({ kind: 'nodes', queues: ['billing', 'gone'], channels: ['C', 'gone'] }, held, document)),
    ).toEqual({
      edges: {},
      nodes: { Q1: 'reached', C: 'visited' },
      gone: 2,
    });
  });
});
