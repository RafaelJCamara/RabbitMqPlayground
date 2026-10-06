import { allowedTargets, NODE_SIZE, type CanvasDocument, type ElementKind } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  headerArguments,
  producerRecord,
  queueRecord,
  sampleDocument,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { buildCanvasVm, EMPTY_VM } from './canvas-vm';
import { inId, NOTHING, nodeIdOf, outId } from './connector-ids';
import { classifyDrop } from './drop';
import { bindingLabel, linkLabel, lowerFirst, nodeLabel, subscriptionLabel } from './labels';
import { armedTargets } from './link-targets';
import { RMQ_A11Y_MESSAGES } from './messages';
import { EXCHANGE_TYPES, kindOfNew, newNodeKey } from './new-node';
import { frameOf, shapePath } from './shapes';
import { liveViewport, toCanvas, toScreen } from './transform';

describe('connector ids', () => {
  it('make a connector id from a node id, and read the node id back from either', () => {
    expect(inId('q1')).toBe('in:q1');
    expect(outId('q1')).toBe('out:q1');
    expect(nodeIdOf(inId('q1'))).toBe('q1');
    expect(nodeIdOf(outId('x.a:b-c_d'))).toBe('x.a:b-c_d');
  });

  it('has a list for "nothing may be joined" that no connector id is in', () => {
    expect(NOTHING).toHaveLength(1);
    expect(NOTHING[0]).not.toMatch(/^(in|out):/);
  });
});

describe('shapes', () => {
  it('gives each kind the size that the domain’s auto-layout leaves room for', () => {
    for (const kind of ['producer', 'exchange', 'queue', 'consumer'] as const) {
      expect(frameOf(kind)).toEqual(NODE_SIZE[kind]);
    }
  });

  it('gives each kind an outline of its own, as a closed path', () => {
    const paths = (['producer', 'exchange', 'queue', 'consumer'] as const).map((kind) => shapePath(kind));

    expect(new Set(paths).size).toBe(4);
    for (const path of paths) {
      expect(path).toMatch(/^M[\d.,]+/);
      expect(path.endsWith('Z')).toBe(true);
    }
  });

  it('touches the middle of the sides that have a handle, which is where the handles are', () => {
    const middle = (kind: ElementKind) => frameOf(kind).height / 2;
    // A point at the middle of the right side for a producer, and at the middle of both sides for an exchange.
    expect(shapePath('producer')).toContain(`L${frameOf('producer').width},${middle('producer')}`);
    expect(shapePath('exchange')).toContain(`L${frameOf('exchange').width},${middle('exchange')}`);
    expect(shapePath('exchange')).toContain(`L0,${middle('exchange')}`);
    // A rounded tray runs straight along its sides, from below one corner to above the next, so it passes the middle.
    const { width, height } = frameOf('queue');
    expect(shapePath('queue')).toContain(`${width},10 V${height - 10}`);
    expect(shapePath('queue')).toContain(`0,${height - 10} V10`);
    // A pill curves round each end with a radius of half its height, so its ends are at the middle.
    const radius = middle('consumer');
    expect(shapePath('consumer')).toContain(`A${radius},${radius} 0 0 1`);
  });
});

describe('labels', () => {
  it('say what a node is, with the type for an exchange', () => {
    expect(nodeLabel('queue', 'billing')).toBe('Queue billing');
    expect(nodeLabel('producer', 'sender')).toBe('Producer sender');
    expect(nodeLabel('consumer', 'worker')).toBe('Consumer worker');
    expect(nodeLabel('exchange', 'orders', 'topic')).toBe('Exchange orders, topic');
    expect(nodeLabel('exchange', 'orders')).toBe('Exchange orders');
  });

  it('lower the first letter, for a sentence that goes on', () => {
    expect(lowerFirst('Queue billing')).toBe('queue billing');
    expect(lowerFirst('')).toBe('');
  });

  it('say what a binding is, with its keys, once each, and the headers if it has arguments', () => {
    const base = { from: 'orders', to: 'billing', toKind: 'queue', hasArguments: false } as const;

    expect(bindingLabel({ ...base, keys: ['order.*', 'invoice.#'] })).toBe(
      'Binding from exchange orders to queue billing, keys order.*, invoice.#',
    );
    expect(bindingLabel({ ...base, keys: ['a'] })).toBe('Binding from exchange orders to queue billing, key a');
    expect(bindingLabel({ ...base, keys: ['a', 'a', ''] })).toBe(
      'Binding from exchange orders to queue billing, key a',
    );
    expect(bindingLabel({ ...base, keys: [''] })).toBe('Binding from exchange orders to queue billing');
    expect(bindingLabel({ ...base, toKind: 'exchange', to: 'hidden', keys: [], hasArguments: true })).toBe(
      'Binding from exchange orders to exchange hidden, with header arguments',
    );
  });

  it('say what a link and a subscription are', () => {
    expect(linkLabel('sender', 'exchange', 'orders')).toBe('Producer sender publishes to exchange orders');
    expect(linkLabel('sender', 'queue', 'jobs')).toBe('Producer sender publishes to queue jobs');
    expect(subscriptionLabel('worker', 'billing')).toBe('Consumer worker consumes from queue billing');
  });
});

describe('the live viewport', () => {
  const model = { position: { x: 100, y: 50 }, scaledPosition: { x: 20, y: -10 }, scale: 2 };

  it('is the sum of the position and the offset that zooming makes, and the scale', () => {
    expect(liveViewport(model)).toEqual({ x: 120, y: 40, zoom: 2 });
  });

  it('puts a point of the canvas on the screen, and a point of the screen back on the canvas', () => {
    const viewport = liveViewport(model);

    expect(toScreen(viewport, { x: 10, y: 10 })).toEqual({ x: 140, y: 60 });
    expect(toCanvas(viewport, { x: 140, y: 60 })).toEqual({ x: 10, y: 10 });
    for (const point of [
      { x: 0, y: 0 },
      { x: -37.5, y: 81.25 },
      { x: 1_000, y: -1_000 },
    ]) {
      expect(toCanvas(viewport, toScreen(viewport, point))).toEqual(point);
    }
  });
});

describe('what the toolbox can add', () => {
  it('has a key for each, and the kind of node that it makes', () => {
    expect(newNodeKey({ kind: 'queue' })).toBe('queue');
    expect(newNodeKey({ kind: 'exchange', exchangeType: 'topic' })).toBe('exchange:topic');
    expect(kindOfNew({ kind: 'exchange', exchangeType: 'fanout' })).toBe('exchange');
    expect(kindOfNew({ kind: 'consumer' })).toBe('consumer');
    expect(EXCHANGE_TYPES).toEqual(['direct', 'fanout', 'topic', 'headers']);
  });
});

describe('buildCanvasVm', () => {
  const sample = (): CanvasDocument => deepFreeze(sampleDocument());

  it('has nothing for an empty canvas', () => {
    expect(buildCanvasVm(documentOf())).toEqual({ nodes: [], edges: [] });
    expect(EMPTY_VM).toEqual({ nodes: [], edges: [] });
  });

  it('draws every element at its place, at the size of its kind, with an outline, a label and the handles that its kind has', () => {
    const { nodes } = buildCanvasVm(sample());
    const orders = nodes.find((node) => node.name === 'orders');

    expect(nodes.map((node) => node.kind)).toEqual([
      'exchange',
      'exchange',
      'exchange',
      'queue',
      'queue',
      'producer',
      'consumer',
    ]);
    expect(orders).toMatchObject({
      id: 'E1',
      kind: 'exchange',
      width: NODE_SIZE.exchange.width,
      height: NODE_SIZE.exchange.height,
      label: 'Exchange orders, topic',
      exchangeType: 'topic',
      hasInput: true,
      hasOutput: true,
    });
    expect(orders?.shape).toBe(shapePath('exchange'));
    expect(nodes.find((node) => node.kind === 'producer')).toMatchObject({ hasInput: false, hasOutput: true });
    expect(nodes.find((node) => node.kind === 'consumer')).toMatchObject({ hasInput: true, hasOutput: false });
    expect(nodes.find((node) => node.kind === 'queue')).toMatchObject({ hasInput: true, hasOutput: true });
    expect(nodes.find((node) => node.kind === 'queue')?.exchangeType).toBeUndefined();
  });

  it('takes the position from the layout, and falls back to where a new node of that kind goes when it has none', () => {
    const placed = buildCanvasVm(documentOf({ queues: { q: queueRecord('q') }, nodes: { q: { x: 12, y: 34 } } }));
    expect(placed.nodes[0]).toMatchObject({ x: 12, y: 34 });

    const unplaced = buildCanvasVm(documentOf({ queues: { q: queueRecord('q') }, nodes: {} }));
    expect(unplaced.nodes[0]).toMatchObject({ x: 640, y: 0 });
  });

  it('draws one edge for each binding pair, link and subscription, from where a message leaves to where it goes', () => {
    const { edges } = buildCanvasVm(sample());

    expect(edges.map(({ id, source, target, kind }) => [id, source, target, kind])).toEqual([
      ['E1>Q1', 'E1', 'Q1', 'binding'],
      ['E2>Q2', 'E2', 'Q2', 'binding'],
      ['E1>E3', 'E1', 'E3', 'binding'],
      ['P1>E1', 'P1', 'E1', 'link'],
      ['Q1>C1', 'Q1', 'C1', 'subscription'],
    ]);
  });

  it('draws several bindings between the same two ends as one edge that says all their keys', () => {
    const document = documentOf({
      exchanges: { x: exchangeRecord('orders', 'topic') },
      queues: { q: queueRecord('billing') },
      bindings: {
        b1: bindingRecord('x', { kind: 'queue', id: 'q' }, 'order.*'),
        b2: bindingRecord('x', { kind: 'queue', id: 'q' }, 'invoice.#'),
      },
    });
    const { edges } = buildCanvasVm(document);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.label).toBe('Binding from exchange orders to queue billing, keys order.*, invoice.#');
  });

  it('says that a binding has header arguments', () => {
    const document = documentOf({
      exchanges: { x: exchangeRecord('docs', 'headers') },
      queues: { q: queueRecord('archive') },
      bindings: {
        b: bindingRecord('x', { kind: 'queue', id: 'q' }, '', headerArguments('any', entry('format', str('pdf')))),
      },
    });

    expect(buildCanvasVm(document).edges[0]?.label).toBe(
      'Binding from exchange docs to queue archive, with header arguments',
    );
  });

  it('names the ends of a link and a subscription, to an exchange and to a queue', () => {
    const document = documentOf({
      exchanges: { x: exchangeRecord('orders') },
      queues: { q: queueRecord('jobs') },
      producers: {
        p: producerRecord('a', { kind: 'exchange', id: 'x' }),
        r: producerRecord('b', { kind: 'queue', id: 'q' }),
      },
      consumers: { c: consumerRecord('w', ['q']) },
    });
    const labels = buildCanvasVm(document).edges.map((edge) => edge.label);

    expect(labels).toEqual([
      'Producer a publishes to exchange orders',
      'Producer b publishes to queue jobs',
      'Consumer w consumes from queue jobs',
    ]);
  });

  it('gives back the very same view model when nothing changed, and the very same node for each node that did not', () => {
    const before = buildCanvasVm(sample());

    expect(buildCanvasVm(sample(), before)).toBe(before);

    const moved = documentOf({
      ...sampleDocument(),
      nodes: { ...sampleDocument().layout.nodes, Q1: { x: 1, y: 2 } },
      labels: sampleDocument().layout.labels,
    });
    const after = buildCanvasVm(moved, before);

    expect(after).not.toBe(before);
    expect(after.edges).toBe(before.edges);
    expect(after.nodes.find((node) => node.id === 'Q1')).not.toBe(before.nodes.find((node) => node.id === 'Q1'));
    for (const node of after.nodes.filter((each) => each.id !== 'Q1')) {
      expect(node).toBe(before.nodes.find((each) => each.id === node.id));
    }
  });

  it('keeps the nodes and the edges apart: a change of one leaves the other list as it was', () => {
    const before = buildCanvasVm(sample());
    const renamed = sampleDocument();
    const next = buildCanvasVm(
      documentOf({
        ...renamed,
        exchanges: renamed.exchanges,
        queues: { ...renamed.queues, Q2: queueRecord('archive2') },
        nodes: renamed.layout.nodes,
        labels: renamed.layout.labels,
      }),
      before,
    );

    expect(next.nodes).not.toBe(before.nodes);
    expect(next.nodes.find((node) => node.id === 'Q2')?.name).toBe('archive2');
    // The queue Q2 is at the end of the edge E2>Q2, whose label says its name.
    expect(next.edges).not.toBe(before.edges);
  });
});

describe('armedTargets', () => {
  const document = deepFreeze(sampleDocument());
  const { nodes } = buildCanvasVm(document);
  const rules = { allowedTargets: (source: string) => allowedTargets(document, source) };

  it('are the inputs of the nodes that the rules allow, for the node that is pressed', () => {
    expect(armedTargets('E1', nodes, rules)).toEqual(['in:E1', 'in:E2', 'in:E3', 'in:Q1', 'in:Q2']);
    expect(armedTargets('Q1', nodes, rules)).toEqual(['in:C1']);
    expect(armedTargets('P1', nodes, rules)).toEqual(['in:E1', 'in:E2', 'in:Q1', 'in:Q2']);
  });

  it('are "nothing" and never an empty list, which would mean that anything goes, when nothing is allowed', () => {
    expect(armedTargets('C1', nodes, rules)).toBe(NOTHING);
    expect(armedTargets('gone', nodes, rules)).toBe(NOTHING);
  });

  it('are "nothing" when no node is pressed, or the canvas has no rules yet', () => {
    expect(armedTargets(null, nodes, rules)).toBe(NOTHING);
    expect(armedTargets('E1', nodes, undefined)).toBe(NOTHING);
  });

  it('leave out a node that has no input, even if the rules should name it', () => {
    const odd = { allowedTargets: () => ['P1', 'Q1'] };

    expect(armedTargets('E1', nodes, odd)).toEqual(['in:Q1']);
  });
});

describe('classifyDrop', () => {
  const base = { source: 'out:E1', at: { x: 1, y: 2 }, client: { x: 30, y: 40 }, via: 'drag' } as const;

  it('is a link when the library joined the link to a connector, whoever was under the pointer', () => {
    expect(classifyDrop({ ...base, targetConnector: 'in:Q1', nodeUnderPointer: 'Q1' })).toEqual({
      type: 'link',
      source: 'E1',
      target: 'Q1',
      via: 'drag',
    });
    expect(classifyDrop({ ...base, targetConnector: 'in:Q1', nodeUnderPointer: null, via: 'keyboard' })).toEqual({
      type: 'link',
      source: 'E1',
      target: 'Q1',
      via: 'keyboard',
    });
  });

  it('is an invalid link when there is no target and the pointer is on a node, which the rules would not allow', () => {
    expect(classifyDrop({ ...base, targetConnector: undefined, nodeUnderPointer: 'P1', via: 'click' })).toEqual({
      type: 'link-invalid',
      source: 'E1',
      target: 'P1',
      via: 'click',
    });
  });

  it('is a link to nothing when there is no target and nothing is under the pointer, and says where', () => {
    expect(classifyDrop({ ...base, targetConnector: undefined, nodeUnderPointer: null })).toEqual({
      type: 'link-to-empty',
      source: 'E1',
      at: { x: 1, y: 2 },
      client: { x: 30, y: 40 },
      via: 'drag',
    });
  });
});

describe('the messages of the canvas', () => {
  const m = RMQ_A11Y_MESSAGES;

  it('read on from our own labels', () => {
    expect(m.nodeFocused('Queue billing', 2, 5)).toBe('Queue billing, 2 of 5');
    expect(m.connectStarted('Exchange orders, topic')).toBe('Linking from exchange orders, topic');
    expect(m.connectTarget('Queue billing', 2, 4)).toBe('Target 2 of 4: queue billing');
    expect(m.connected('Exchange orders', 'Queue billing')).toBe('Linking exchange orders to queue billing');
    expect(m.connectionFocused('Binding from exchange orders to queue billing, key a')).toBe(
      'Binding from exchange orders to queue billing, key a',
    );
    expect(m.grabbed('Queue billing')).toContain('Queue billing picked up.');
    expect(m.moved(120, 40)).toBe('Moved to 120, 40');
    expect(m.dropped('Queue billing', 120, 40)).toBe('Queue billing dropped at 120, 40');
    expect(m.moveCancelled('Queue billing')).toBe('Queue billing put back');
  });

  it('count items with the right number', () => {
    expect(m.allSelected(1)).toBe('Everything is selected: 1 item');
    expect(m.allSelected(4)).toBe('Everything is selected: 4 items');
    expect(m.itemsCount(1)).toBe('1 item');
    expect(m.itemsCount(3)).toBe('3 items');
    expect(m.deleteRequested(1)).toBe('Deleting 1 item');
    expect(m.deleteRequested(2)).toBe('Deleting 2 items');
    expect(m.zoom(150)).toBe('Zoom 150 percent');
  });

  it('name a connection by its nodes when the app has not given it a label, and not by the connectors', () => {
    expect(m.connectionLabel('out:E1', 'in:Q1')).toBe('Connection from E1 to Q1');
  });

  it('say what the keys are, and use the keys that the editor configures: L to link and M to move', () => {
    expect(m.instructions).toContain('M picks up');
    expect(m.instructions).toContain('L links');
    expect(m.instructions).toContain('F2 renames');
    expect(m.instructions).not.toContain('Space');
  });

  it('say that nothing can be linked, and what can be, and that one node has to be selected', () => {
    expect(m.connectUnavailable).toContain('Nothing can be linked from here.');
    expect(m.connectRequiresSingleNode).toBe('Select one node first, then press L to link it.');
    expect(m.connectCancelled).toBe('Link cancelled');
    expect(m.selectionCleared).toBe('Selection cleared');
    expect([m.flow, m.node, m.group, m.connection]).toEqual(['topology editor', 'node', 'group', 'connection']);
  });
});
