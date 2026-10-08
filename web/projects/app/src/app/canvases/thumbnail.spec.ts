import { emptyDocument, NODE_SIZE, type CanvasDocument } from '@rmq/domain';
import {
  arbDocument,
  bindingRecord,
  configureFastCheck,
  consumerRecord,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
} from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_THUMBNAIL,
  THUMBNAIL_EDGES,
  THUMBNAIL_MARGIN,
  THUMBNAIL_NODES,
  thumbnailOf,
  type Thumbnail,
} from './thumbnail';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const M = THUMBNAIL_MARGIN;

describe('thumbnailOf (ADR-0073)', () => {
  it('draws at most 150 nodes and 300 edges, which are the numbers of the ADR, in a box with a margin of 24', () => {
    expect(THUMBNAIL_NODES).toBe(150);
    expect(THUMBNAIL_EDGES).toBe(300);
    expect(THUMBNAIL_MARGIN).toBe(24);
  });

  it('has nothing to draw for a canvas with nothing on it', () => {
    expect(thumbnailOf(emptyDocument())).toBe(EMPTY_THUMBNAIL);
    expect(EMPTY_THUMBNAIL).toEqual({ box: null, nodes: [], edges: [] });
  });

  it('has nothing to draw for elements that have no position, because there is nowhere to draw them', () => {
    const document = documentOf({ queues: { Q1: queueRecord('a') }, nodes: {} });

    expect(thumbnailOf(document)).toBe(EMPTY_THUMBNAIL);
  });

  it('draws a node at its own position, in a box that is its size and a margin all round', () => {
    const document = documentOf({ queues: { Q1: queueRecord('a') }, nodes: { Q1: { x: 300, y: -40 } } });

    const { width, height } = NODE_SIZE.queue;
    expect(thumbnailOf(document)).toEqual({
      box: { x: 300 - M, y: -40 - M, width: width + 2 * M, height: height + 2 * M },
      nodes: [{ kind: 'queue', x: 300, y: -40 }],
      edges: [],
    });
  });

  it('draws a node that has no position beside ones that have, and leaves it out', () => {
    const document = documentOf({
      queues: { Q1: queueRecord('a'), Q2: queueRecord('b') },
      nodes: { Q2: { x: 10, y: 20 } },
    });

    expect(thumbnailOf(document).nodes).toEqual([{ kind: 'queue', x: 10, y: 20 }]);
  });

  it('holds every node in the box, whichever way they lie', () => {
    const document = documentOf({
      exchanges: { E1: exchangeRecord('x') },
      queues: { Q1: queueRecord('q') },
      producers: { P1: producerRecord('p') },
      consumers: { C1: consumerRecord('c') },
      nodes: { E1: { x: -500, y: 100 }, Q1: { x: 700, y: -300 }, P1: { x: 0, y: 900 }, C1: { x: 40, y: 40 } },
    });

    const { box, nodes } = thumbnailOf(document);

    expect(nodes.map(({ kind }) => kind)).toEqual(['exchange', 'queue', 'producer', 'consumer']);
    expect(box).toEqual({
      x: -500 - M,
      y: -300 - M,
      width: 700 + NODE_SIZE.queue.width + 500 + 2 * M,
      height: 900 + NODE_SIZE.producer.height + 300 + 2 * M,
    });
  });

  it('draws a binding, the link of a producer and the subscription of a consumer as lines between the middles of their ends', () => {
    const document = documentOf({
      exchanges: { E1: exchangeRecord('x') },
      queues: { Q1: queueRecord('q') },
      producers: { P1: producerRecord('p', { kind: 'exchange', id: 'E1' }) },
      consumers: { C1: consumerRecord('c', ['Q1']) },
      bindings: { B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'k') },
      nodes: { P1: { x: 0, y: 0 }, E1: { x: 400, y: 0 }, Q1: { x: 800, y: 0 }, C1: { x: 1200, y: 0 } },
    });

    const { edges } = thumbnailOf(document);

    const middle = (kind: keyof typeof NODE_SIZE, x: number) => ({
      x: x + NODE_SIZE[kind].width / 2,
      y: NODE_SIZE[kind].height / 2,
    });
    const line = (from: { x: number; y: number }, to: { x: number; y: number }) => ({
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
    });
    expect(edges).toHaveLength(3);
    expect(edges).toContainEqual(line(middle('producer', 0), middle('exchange', 400)));
    expect(edges).toContainEqual(line(middle('exchange', 400), middle('queue', 800)));
    expect(edges).toContainEqual(line(middle('queue', 800), middle('consumer', 1200)));
  });

  it('draws one line for several bindings between the same two ends, as the canvas does', () => {
    const document = documentOf({
      exchanges: { E1: exchangeRecord('x') },
      queues: { Q1: queueRecord('q') },
      bindings: {
        B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'a'),
        B2: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'b'),
      },
    });

    expect(thumbnailOf(document).edges).toHaveLength(1);
  });

  it('leaves out an edge that goes to a node that is not drawn', () => {
    const document = documentOf({
      exchanges: { E1: exchangeRecord('x') },
      queues: { Q1: queueRecord('q') },
      bindings: { B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }) },
      nodes: { E1: { x: 0, y: 0 } },
    });

    expect(thumbnailOf(document).edges).toEqual([]);
  });

  it('draws a canvas of the sample with the lines of its edges, inside its box', () => {
    const { box, nodes, edges } = thumbnailOf(sampleDocument());

    expect(nodes).toHaveLength(7);
    expect(edges).toHaveLength(5);
    expect(box).not.toBeNull();
  });

  describe('for a canvas that is bigger than a card can show', () => {
    const exchanges = (count: number) =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`E${index}`, exchangeRecord(`x${index}`)]));

    it('draws the first 150 nodes, in the order of the document, and says nothing of the rest', () => {
      const document = documentOf({
        exchanges: exchanges(THUMBNAIL_NODES + 50),
        nodes: Object.fromEntries(
          Array.from({ length: THUMBNAIL_NODES + 50 }, (_, index) => [`E${index}`, { x: index, y: 0 }]),
        ),
      });

      const { nodes, box } = thumbnailOf(document);

      expect(nodes).toHaveLength(THUMBNAIL_NODES);
      expect(nodes[0]?.x).toBe(0);
      expect(nodes.at(-1)?.x).toBe(THUMBNAIL_NODES - 1);
      expect(box?.x).toBe(-M);
      expect(box?.width).toBe(THUMBNAIL_NODES - 1 + NODE_SIZE.exchange.width + 2 * M);
    });

    it('draws no more than 300 edges, and keeps the ones among the nodes that it draws', () => {
      const count = 100;
      const queues = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`Q${index}`, queueRecord(`q${index}`)]),
      );
      const bindings = Object.fromEntries(
        Array.from({ length: count * 4 }, (_, index) => {
          const exchange = `E${index % 4}`;
          return [
            `B${index}`,
            bindingRecord(exchange, { kind: 'queue', id: `Q${Math.floor(index / 4)}` }, `k${index}`),
          ];
        }),
      );
      const document = documentOf({ exchanges: exchanges(4), queues, bindings });

      const { edges } = thumbnailOf(document);

      expect(edges).toHaveLength(THUMBNAIL_EDGES);
    });
  });

  it('is the same drawing every time for the same canvas', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        expect(thumbnailOf(document)).toEqual(thumbnailOf(document));
      }),
    );
  });

  it('holds every node and every line in its box, with the margin, for any canvas that commands made', () => {
    fc.assert(
      fc.property(arbDocument, (document: CanvasDocument) => {
        const thumbnail: Thumbnail = thumbnailOf(document);

        expect(thumbnail.nodes.length).toBeLessThanOrEqual(THUMBNAIL_NODES);
        expect(thumbnail.edges.length).toBeLessThanOrEqual(THUMBNAIL_EDGES);
        expect(thumbnail.box === null).toBe(thumbnail.nodes.length === 0);
        const { box } = thumbnail;
        if (box === null) {
          expect(thumbnail.edges).toEqual([]);
          return;
        }
        for (const { kind, x, y } of thumbnail.nodes) {
          expect(x - M).toBeGreaterThanOrEqual(box.x);
          expect(y - M).toBeGreaterThanOrEqual(box.y);
          expect(x + NODE_SIZE[kind].width + M).toBeLessThanOrEqual(box.x + box.width);
          expect(y + NODE_SIZE[kind].height + M).toBeLessThanOrEqual(box.y + box.height);
        }
        for (const { x1, y1, x2, y2 } of thumbnail.edges) {
          for (const [x, y] of [
            [x1, y1],
            [x2, y2],
          ] as const) {
            expect(x).toBeGreaterThanOrEqual(box.x);
            expect(x).toBeLessThanOrEqual(box.x + box.width);
            expect(y).toBeGreaterThanOrEqual(box.y);
            expect(y).toBeLessThanOrEqual(box.y + box.height);
          }
        }
      }),
    );
  });
});
