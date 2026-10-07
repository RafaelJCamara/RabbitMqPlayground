import { edgeKey } from '@rmq/domain';
import type { Flight, RoutePath } from '@rmq/engine';
import { bindingRecord, documentOf, exchangeRecord, producerRecord, queueRecord, consumerRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { implicitEdgeId } from '../../core/state/default-exchange';
import { markersOf, placesOf, type Places } from './edges';

/**
 * Where a message is (ADR-0055): the edge that it is going along, and how far along it. The producer `P` is linked to the exchange `E` (`orders`), which is bound to the queue `Q`
 * (`billing`) and to the exchange `F` (`audit`), which is bound to the queue `R` (`archive`), and the consumer `C` is subscribed to `Q`. The producer `L` is linked to the queue `R`.
 */
const document = documentOf({
  exchanges: { E: exchangeRecord('orders'), F: exchangeRecord('audit') },
  queues: { Q: queueRecord('billing'), R: queueRecord('archive') },
  bindings: {
    B1: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'k'),
    B2: bindingRecord('E', { kind: 'exchange', id: 'F' }, 'k'),
    B3: bindingRecord('F', { kind: 'queue', id: 'R' }, 'k'),
  },
  producers: {
    P: producerRecord('sender', { kind: 'exchange', id: 'E' }),
    L: producerRecord('direct', { kind: 'queue', id: 'R' }),
    N: producerRecord('nowhere'),
  },
  consumers: { C: consumerRecord('worker', ['Q']) },
});
const places = placesOf(document);
const shown: Places = placesOf({ ...document, settings: { ...document.settings, showDefaultExchange: true } });

const path = (...hops: readonly [string, 'queue' | 'exchange', string][]): RoutePath => ({
  queue: 'billing',
  hops: hops.map(([from, kind, name]) => ({ from, binding: from === '' ? null : 0, to: { kind, name } })),
});

const publishing = (over: Partial<Extract<Flight, { leg: 'publish' }>> = {}): Flight => ({
  leg: 'publish',
  message: 1,
  key: 'k',
  producer: 'P',
  exchange: 'orders',
  from: 1_000,
  to: 1_500,
  ...over,
});

const inBroker = (paths: readonly RoutePath[], over: Partial<Extract<Flight, { leg: 'broker' }>> = {}): Flight => ({
  leg: 'broker',
  message: 1,
  key: 'k',
  producer: 'P',
  exchange: 'orders',
  paths,
  from: 1_000,
  to: 1_400,
  ...over,
});

const delivering = (over: Partial<Extract<Flight, { leg: 'deliver' }>> = {}): Flight => ({
  leg: 'deliver',
  message: 1,
  key: 'k',
  queue: 'billing',
  channel: 'C',
  consumer: 'C/billing',
  redelivered: false,
  from: 1_000,
  to: 1_500,
  ...over,
});

describe('placesOf', () => {
  it('knows what the engine calls by a name, and what each producer is linked to', () => {
    expect([...places.exchanges]).toEqual([
      ['orders', 'E'],
      ['audit', 'F'],
    ]);
    expect([...places.queues]).toEqual([
      ['billing', 'Q'],
      ['archive', 'R'],
    ]);
    expect([...places.links]).toEqual([
      ['P', 'E'],
      ['L', 'R'],
    ]);
    expect(places.showsDefault).toBe(false);
    expect(shown.showsDefault).toBe(true);
  });
});

describe('markersOf', () => {
  describe('on the way to the broker', () => {
    it('is on the link of the producer, as far along as its time says', () => {
      expect(markersOf([publishing()], places, 1_000)).toEqual([
        { message: 1, key: 'k', edge: 'P>E', at: 0, redelivered: false },
      ]);
      expect(markersOf([publishing()], places, 1_125)[0]?.at).toBe(0.25);
      expect(markersOf([publishing()], places, 1_500)[0]?.at).toBe(1);
    });

    it('is where the leg begins before it begins, and where it ends after it ends, so that a picture that is behind the clock is never off its edge', () => {
      expect(markersOf([publishing()], places, 0)[0]?.at).toBe(0);
      expect(markersOf([publishing()], places, 9_999)[0]?.at).toBe(1);
    });

    it('is at the end of a leg that takes no time', () => {
      expect(markersOf([publishing({ from: 1_000, to: 1_000 })], places, 500)[0]?.at).toBe(1);
    });

    it('is on the link of a producer that is linked to a queue, which is drawn to the queue or to the default exchange', () => {
      expect(markersOf([publishing({ producer: 'L' })], places, 1_250)).toEqual([
        { message: 1, key: 'k', edge: 'L>R', at: 0.5, redelivered: false },
      ]);
    });

    it('is on no edge when no producer sent it, or the producer is not linked, or is not on the canvas', () => {
      expect(markersOf([publishing({ producer: null })], places, 1_250)).toEqual([]);
      expect(markersOf([publishing({ producer: 'N' })], places, 1_250)).toEqual([]);
      expect(markersOf([publishing({ producer: 'gone' })], places, 1_250)).toEqual([]);
    });
  });

  describe('in the broker', () => {
    it('is on the binding of a path of one hop for the whole of the time that the broker takes', () => {
      const flight = inBroker([path(['orders', 'queue', 'billing'])]);

      expect(markersOf([flight], places, 1_000)).toEqual([
        { message: 1, key: 'k', edge: 'E>Q', at: 0, redelivered: false },
      ]);
      expect(markersOf([flight], places, 1_200)[0]).toMatchObject({ edge: 'E>Q', at: 0.5 });
      expect(markersOf([flight], places, 1_400)[0]).toMatchObject({ edge: 'E>Q', at: 1 });
    });

    it('shares the time among the hops of a path of several, a hop each in turn, and each is drawn along its own edge from its start to its end', () => {
      const flight = inBroker([path(['orders', 'exchange', 'audit'], ['audit', 'queue', 'archive'])]);

      expect(markersOf([flight], places, 1_100)[0]).toMatchObject({ edge: 'E>F', at: 0.5 });
      expect(markersOf([flight], places, 1_000)[0]).toMatchObject({ edge: 'E>F', at: 0 });
      expect(markersOf([flight], places, 1_300)[0]).toMatchObject({ edge: 'F>R', at: 0.5 });
      expect(markersOf([flight], places, 1_400)[0]).toMatchObject({ edge: 'F>R', at: 1 });
    });

    it('is on an edge for each path, so that a fanout is a message on each of its edges', () => {
      const flight = inBroker([
        path(['orders', 'queue', 'billing']),
        path(['orders', 'exchange', 'audit'], ['audit', 'queue', 'archive']),
      ]);

      expect(markersOf([flight], places, 1_100).map(({ edge }) => edge)).toEqual(['E>Q', 'E>F']);
    });

    it('is one message on an edge that two paths share, and not two', () => {
      const flight = inBroker([
        path(['orders', 'exchange', 'audit'], ['audit', 'queue', 'archive']),
        path(['orders', 'exchange', 'audit'], ['audit', 'queue', 'billing']),
      ]);

      expect(markersOf([flight], places, 1_100).map(({ edge }) => edge)).toEqual(['E>F']);
      // Once they part, they are two messages on two edges.
      expect(markersOf([flight], places, 1_300).map(({ edge }) => edge)).toEqual(['F>R', 'F>Q']);
    });

    it('goes along the implicit edge of the default exchange when it is drawn', () => {
      const flight = inBroker([path(['', 'queue', 'archive'])], { producer: 'L' });

      expect(markersOf([flight], shown, 1_200)).toEqual([
        { message: 1, key: 'k', edge: implicitEdgeId('R'), at: 0.5, redelivered: false },
      ]);
    });

    it('waits at the end of the link that it came along when the default exchange is not drawn, because it is inside an exchange that is not', () => {
      const flight = inBroker([path(['', 'queue', 'archive'])], { producer: 'L' });

      expect(markersOf([flight], places, 1_000)).toEqual([
        { message: 1, key: 'k', edge: 'L>R', at: 1, redelivered: false },
      ]);
      expect(markersOf([flight], places, 1_300)[0]).toMatchObject({ edge: edgeKey('L', 'R'), at: 1 });
    });

    it('is on no edge in the default exchange when no producer sent it and the default exchange is not drawn', () => {
      expect(markersOf([inBroker([path(['', 'queue', 'archive'])], { producer: null })], places, 1_200)).toEqual([]);
    });

    it('is on no edge when the exchange or the queue of a hop is not on the canvas, which is a canvas that was changed since', () => {
      expect(markersOf([inBroker([path(['gone', 'queue', 'billing'])])], places, 1_200)).toEqual([]);
      expect(markersOf([inBroker([path(['orders', 'queue', 'gone'])])], places, 1_200)).toEqual([]);
      expect(markersOf([inBroker([path(['orders', 'exchange', 'gone'])])], places, 1_200)).toEqual([]);
      expect(markersOf([inBroker([path(['', 'queue', 'gone'])], { producer: 'L' })], shown, 1_200)).toEqual([]);
    });

    it('is on no edge for a path that has no hops', () => {
      expect(markersOf([inBroker([{ queue: 'billing', hops: [] }])], places, 1_200)).toEqual([]);
    });
  });

  describe('on the way to a consumer', () => {
    it('is on the subscription of the consumer, as far along as its time says, and says that it is a message that came back', () => {
      expect(markersOf([delivering()], places, 1_250)).toEqual([
        { message: 1, key: 'k', edge: 'Q>C', at: 0.5, redelivered: false },
      ]);
      expect(markersOf([delivering({ redelivered: true })], places, 1_250)[0]?.redelivered).toBe(true);
    });

    it('is on no edge for a queue that is not on the canvas', () => {
      expect(markersOf([delivering({ queue: 'gone' })], places, 1_250)).toEqual([]);
    });
  });

  it('is a marker for each message that is on the move, in the order that the engine says, and none for nothing', () => {
    expect(markersOf([], places, 0)).toEqual([]);
    expect(
      markersOf([publishing(), delivering({ message: 2, key: 'other' })], places, 1_250).map(({ message, edge }) => [
        message,
        edge,
      ]),
    ).toEqual([
      [1, 'P>E'],
      [2, 'Q>C'],
    ]);
  });
});
