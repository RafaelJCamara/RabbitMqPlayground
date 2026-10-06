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
    it('says what the canvas says of a binding, with its key, and each of the bindings between the two ends', () => {
      expect(inspectorView(sampleDocument(), select([], ['E1>Q1']))).toEqual({
        kind: 'edge',
        key: 'E1>Q1',
        edge: 'binding',
        label: 'Binding from exchange orders to queue billing, key order.*',
        bindings: [{ id: 'B1', key: 'order.*', hasArguments: false }],
        warnings: [],
        from: 'E1',
        to: 'Q1',
        movable: true,
        labelPercent: 50,
      });
    });

    it('has no row of bindings for a link or a subscription, which are not bindings', () => {
      expect(inspectorView(sampleDocument(), select([], ['P1>E1']))).toMatchObject({
        bindings: [],
        from: 'P1',
        to: 'E1',
      });
      expect(inspectorView(sampleDocument(), select([], ['Q1>C1']))).toMatchObject({ bindings: [] });
    });

    it('says where the document keeps the label, as a percentage, and nothing when it keeps none', () => {
      const moved = { ...sampleDocument(), layout: { ...sampleDocument().layout, labels: { 'E1>Q1': { at: 0.25 } } } };

      expect(inspectorView(moved, select([], ['E1>Q1']))).toMatchObject({ labelPercent: 25 });
      expect(inspectorView(sampleDocument(), select([], ['E1>E3']))).toMatchObject({
        movable: true,
        labelPercent: null,
      });
    });

    it('says that the label of an edge that has none cannot be moved: a subscription, and a link to an exchange', () => {
      expect(inspectorView(sampleDocument(), select([], ['Q1>C1']))).toMatchObject({
        movable: false,
        labelPercent: null,
      });
      expect(inspectorView(sampleDocument(), select([], ['P1>E1']))).toMatchObject({ movable: false });
    });

    it('says what is wrong with a binding that matches nothing, in the sentence of the lint', () => {
      const view = inspectorView(
        documentOf({
          exchanges: { x: exchangeRecord('docs', 'headers') },
          queues: { q: queueRecord('archive') },
          bindings: {
            b: { source: 'x', dest: { kind: 'queue', id: 'q' }, key: '', headers: { xMatch: 'any', args: [] } },
          },
        }),
        select([], ['x>q']),
      );

      expect(view).toMatchObject({ kind: 'edge', warnings: [expect.stringContaining('x-match=any')] });
    });
  });

  describe('the default exchange (ADR-0043)', () => {
    const shown = (flag: boolean) => ({
      ...sampleDocument(),
      settings: { ...sampleDocument().settings, showDefaultExchange: flag },
    });

    it('is shown for itself while it is drawn, and for nothing when it is not', () => {
      expect(inspectorView(shown(true), select(['~default']))).toEqual({ kind: 'default-exchange' });
      expect(inspectorView(shown(false), select(['~default']))).toEqual({ kind: 'nothing' });
    });

    it('is shown for an implicit edge as an edge that has nothing to change, with where it starts and where it ends', () => {
      expect(inspectorView(shown(true), select([], ['~default>Q1']))).toEqual({
        kind: 'edge',
        key: '~default>Q1',
        edge: 'implicit',
        label: 'Implicit binding from the default exchange to queue billing, key billing',
        bindings: [],
        warnings: [],
        from: '~default',
        to: 'Q1',
        movable: false,
        labelPercent: null,
      });
    });

    it('is counted with what else is selected', () => {
      expect(inspectorView(shown(true), select(['~default', 'Q1']))).toEqual({ kind: 'several', count: 2 });
    });

    it('shows the link of a producer to a queue as a link, with the key that it always had', () => {
      const document = {
        ...shown(true),
        producers: { P1: { ...sampleDocument().producers['P1']!, target: { kind: 'queue' as const, id: 'Q1' } } },
      };

      expect(inspectorView(document, select([], ['P1>Q1']))).toMatchObject({
        edge: 'link',
        from: 'P1',
        to: 'Q1',
        movable: true,
      });
    });
  });

  describe('what is wrong with a node', () => {
    it('is the sentence of each lint, for an exchange that nothing is bound from', () => {
      const document = documentOf({ exchanges: { x: exchangeRecord('lonely') } });

      expect(inspectorView(document, select(['x']))).toMatchObject({
        kind: 'node',
        warnings: [expect.stringContaining("Nothing is bound from the exchange 'lonely'")],
      });
    });

    it('is nothing for a node that has no lint', () => {
      expect(node('E1').warnings).toEqual([]);
      expect(node('Q1').warnings).toEqual([]);
    });

    it('says that something can be linked from every node that is not a consumer', () => {
      expect(node('P1').canLink).toBe(true);
      expect(node('E1').canLink).toBe(true);
      expect(node('Q1').canLink).toBe(true);
      expect(node('C1').canLink).toBe(false);
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
