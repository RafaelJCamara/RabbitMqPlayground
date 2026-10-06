import { documentOf, exchangeRecord, queueRecord, sampleDocument } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { NOTHING_SELECTED } from '../core/state/selection-store';
import { inspectorView, type NodeView } from './inspector-view';

const select = (nodes: string[], edges: string[] = []) => ({ nodes, edges });
const node = (id: string): NodeView => {
  const view = inspectorView(sampleDocument(), select([id]));
  if (view.kind !== 'node') {
    throw new Error(`${id} is not a node: ${view.kind}`);
  }
  return view;
};

describe('inspectorView', () => {
  describe('what is not a node or an edge', () => {
    it('shows nothing when nothing is selected', () => {
      expect(inspectorView(sampleDocument(), NOTHING_SELECTED)).toEqual({ kind: 'nothing' });
    });

    it('counts what is selected, when it is more than one thing, nodes and edges together', () => {
      expect(inspectorView(sampleDocument(), select(['Q1', 'C1']))).toEqual({ kind: 'several', count: 2 });
      expect(inspectorView(sampleDocument(), select(['Q1'], ['E1>Q1']))).toEqual({ kind: 'several', count: 2 });
      expect(inspectorView(sampleDocument(), select([], ['E1>Q1', 'P1>E1']))).toEqual({ kind: 'several', count: 2 });
    });

    it('shows nothing for a node or an edge that is not on the canvas, as the selection may be a moment behind', () => {
      expect(inspectorView(sampleDocument(), select(['gone']))).toEqual({ kind: 'nothing' });
      expect(inspectorView(sampleDocument(), select([], ['gone>too']))).toEqual({ kind: 'nothing' });
    });
  });

  describe('a node', () => {
    it('says what it is called, what kind it is, and where it is', () => {
      expect(node('Q1')).toMatchObject({ kind: 'node', id: 'Q1', element: 'queue', name: 'billing', x: 300, y: 0 });
    });

    it('has no flags of an exchange or a queue unless it is one', () => {
      expect(node('P1').exchange).toBeUndefined();
      expect(node('P1').queue).toBeUndefined();
      expect(node('C1').exchange).toBeUndefined();
      expect(node('Q1').exchange).toBeUndefined();
      expect(node('E1').queue).toBeUndefined();
    });

    it('has the type and the three flags of an exchange', () => {
      expect(node('E1').exchange).toEqual({ type: 'topic', durable: true, autoDelete: false, internal: false });
      expect(node('E3').exchange).toEqual({ type: 'fanout', durable: true, autoDelete: false, internal: true });
    });

    it('has the flag of a queue', () => {
      expect(node('Q1').queue).toEqual({ durable: true });
    });

    it('is put where a new one would be when the document says nowhere', () => {
      const document = { ...documentOf({ queues: { Q1: queueRecord('billing') } }), layout: { nodes: {}, labels: {} } };

      const view = inspectorView(document, select(['Q1']));

      expect(view).toMatchObject({ kind: 'node', x: expect.any(Number), y: expect.any(Number) });
    });
  });

  describe('what a node is joined to', () => {
    it('says where a producer sends', () => {
      expect(node('P1').joins).toEqual(['Sends to exchange orders.']);
    });

    it('says what an exchange receives from, and sends to', () => {
      expect(node('E1').joins).toEqual(['Receives from producer sender.', 'Sends to queue billing, exchange hidden.']);
      expect(node('E3').joins).toEqual(['Receives from exchange orders.']);
      expect(node('E2').joins).toEqual(['Sends to queue archive.']);
    });

    it('says what a queue receives from, and where it sends', () => {
      expect(node('Q1').joins).toEqual(['Receives from exchange orders.', 'Sends to consumer worker.']);
      expect(node('Q2').joins).toEqual(['Receives from exchange docs.']);
    });

    it('says what a consumer receives from', () => {
      expect(node('C1').joins).toEqual(['Receives from queue billing.']);
    });

    it('names an end once, however many bindings there are to it', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('orders') },
        queues: { Q1: queueRecord('billing') },
        bindings: {
          B1: { source: 'E1', dest: { kind: 'queue', id: 'Q1' }, key: 'a' },
          B2: { source: 'E1', dest: { kind: 'queue', id: 'Q1' }, key: 'b' },
        },
      });

      const view = inspectorView(document, select(['E1']));

      expect(view).toMatchObject({ joins: ['Sends to queue billing.'] });
    });

    it('says that a node is not linked to anything when it is not', () => {
      const document = documentOf({ queues: { Q1: queueRecord('billing') } });

      expect(inspectorView(document, select(['Q1']))).toMatchObject({ joins: ['Not linked to anything yet.'] });
    });
  });

  describe('an edge', () => {
    it('says what the canvas says of a binding, with its key', () => {
      expect(inspectorView(sampleDocument(), select([], ['E1>Q1']))).toEqual({
        kind: 'edge',
        key: 'E1>Q1',
        edge: 'binding',
        label: 'Binding from exchange orders to queue billing, key order.*',
      });
    });

    it('says what the canvas says of a link and of a subscription', () => {
      expect(inspectorView(sampleDocument(), select([], ['P1>E1']))).toMatchObject({
        edge: 'link',
        label: 'Producer sender publishes to exchange orders',
      });
      expect(inspectorView(sampleDocument(), select([], ['Q1>C1']))).toMatchObject({
        edge: 'subscription',
        label: 'Consumer worker consumes from queue billing',
      });
    });
  });
});
