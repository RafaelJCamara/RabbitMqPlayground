import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
} from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { elements } from './document/elements';
import type { CanvasDocument } from './document/schema';
import { edgeKeys } from './document/topology';
import { autoLayout, COLUMN_SEPARATION, NODE_SEPARATION, NODE_SIZE } from './layout';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const at = (document: CanvasDocument, id: string) => autoLayout(document)[id] as { x: number; y: number };

/** The edges of a document as pairs of ids, from the one that a message leaves to the one that it goes to. */
const pairs = (document: CanvasDocument): [string, string][] =>
  [...edgeKeys(document)].map((key) => key.split('>') as [string, string]);

describe('autoLayout', () => {
  it('has no positions for a canvas with nothing on it', () => {
    expect(autoLayout(documentOf())).toEqual({});
  });

  it('gives every node a position, as whole numbers, with the top left of the whole drawing at the origin', () => {
    const positions = autoLayout(sample());

    expect(Object.keys(positions).sort()).toEqual(['C1', 'E1', 'E2', 'E3', 'P1', 'Q1', 'Q2']);
    for (const { x, y } of Object.values(positions)) {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
    }
    expect(Math.min(...Object.values(positions).map(({ x }) => x))).toBe(0);
    expect(Math.min(...Object.values(positions).map(({ y }) => y))).toBe(0);
  });

  it('puts each node to the right of the one that feeds it: producer, exchange, queue, consumer', () => {
    const document = sample();
    const positions = autoLayout(document);

    for (const [from, to] of pairs(document)) {
      expect((positions[from]?.x ?? 0) < (positions[to]?.x ?? 0), `${from} before ${to}`).toBe(true);
    }
  });

  it('puts a chain of exchanges in columns of its own, so that a queue is right of the exchange that feeds it', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { A: exchangeRecord('a'), B: exchangeRecord('b'), C: exchangeRecord('c') },
        queues: { Q: queueRecord('q') },
        bindings: {
          B1: bindingRecord('A', { kind: 'exchange', id: 'B' }),
          B2: bindingRecord('B', { kind: 'exchange', id: 'C' }),
          B3: bindingRecord('C', { kind: 'queue', id: 'Q' }),
        },
      }),
    );
    const positions = autoLayout(document);

    expect(positions['A']?.x).toBeLessThan(positions['B']?.x ?? 0);
    expect(positions['B']?.x).toBeLessThan(positions['C']?.x ?? 0);
    expect(positions['C']?.x).toBeLessThan(positions['Q']?.x ?? 0);
  });

  it('draws a straight line for a canvas that is a straight line', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q') },
        bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }) },
        consumers: { C: consumerRecord('c', ['Q']) },
      }),
    );
    const positions = autoLayout(document);

    expect(new Set(Object.values(positions).map(({ y }) => y)).size).toBe(1);
    expect(['P', 'E', 'Q', 'C'].map((id) => positions[id]?.x ?? -1)).toEqual(
      [...['P', 'E', 'Q', 'C'].map((id) => positions[id]?.x ?? -1)].sort((a, b) => a - b),
    );
    expect(new Set(Object.values(positions).map(({ x }) => x)).size).toBe(4);
  });

  it('puts each column the width of its nodes and the column gap from the one before, and rows the node gap apart', () => {
    const chain = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q') },
        bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }) },
        consumers: { C: consumerRecord('c', ['Q']) },
      }),
    );

    expect(autoLayout(chain)).toEqual({
      P: { x: 0, y: 0 },
      E: { x: NODE_SIZE.producer.width + COLUMN_SEPARATION, y: 0 },
      Q: { x: NODE_SIZE.producer.width + NODE_SIZE.exchange.width + 2 * COLUMN_SEPARATION, y: 0 },
      C: {
        x: NODE_SIZE.producer.width + NODE_SIZE.exchange.width + NODE_SIZE.queue.width + 3 * COLUMN_SEPARATION,
        y: 0,
      },
    });
    // The numbers that the sizes and the gaps come to, so that a change of one is a change that a test shows.
    expect(autoLayout(chain)).toEqual({
      P: { x: 0, y: 0 },
      E: { x: 260, y: 0 },
      Q: { x: 540, y: 0 },
      C: { x: 820, y: 0 },
    });

    const two = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        producers: {
          P1: producerRecord('p1', { kind: 'exchange', id: 'E' }),
          P2: producerRecord('p2', { kind: 'exchange', id: 'E' }),
        },
      }),
    );
    const rows = autoLayout(two);

    expect(Math.abs((rows['P1']?.y ?? 0) - (rows['P2']?.y ?? 0))).toBe(NODE_SIZE.producer.height + NODE_SEPARATION);
    expect(rows['E']?.y).toBe(48);
  });

  it('puts the nodes that nothing is linked to in the column of their kind, left to right: producer, exchange, queue, consumer', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q') },
        producers: { P: producerRecord('p') },
        consumers: { C: consumerRecord('c') },
      }),
    );
    const positions = autoLayout(document);

    expect(positions['P']?.x).toBeLessThan(positions['E']?.x ?? 0);
    expect(positions['E']?.x).toBeLessThan(positions['Q']?.x ?? 0);
    expect(positions['Q']?.x).toBeLessThan(positions['C']?.x ?? 0);
  });

  it('puts a node that nothing is linked to in the column of its kind among nodes that are linked', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q'), R: queueRecord('loose') },
        bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }), L: producerRecord('lone') },
        consumers: { C: consumerRecord('c', ['Q']), M: consumerRecord('free') },
      }),
    );
    const positions = autoLayout(document);

    expect(positions['L']?.x).toBe(positions['P']?.x);
    expect(positions['R']?.x).toBe(positions['Q']?.x);
    expect(positions['M']?.x).toBe(positions['C']?.x);
  });

  it('leaves room for the nodes: nodes in a column are a gap apart, and columns are a gap apart', () => {
    const document = sample();
    const positions = autoLayout(document);
    const boxes = elements(document).map(({ id, kind }) => ({
      id,
      ...(positions[id] as { x: number; y: number }),
      ...NODE_SIZE[kind],
    }));

    for (const [index, a] of boxes.entries()) {
      for (const b of boxes.slice(index + 1)) {
        const sharesColumn = a.x < b.x + b.width && b.x < a.x + a.width;
        if (sharesColumn) {
          // The positions are rounded, so a gap may be one short.
          const apart = a.y + a.height + NODE_SEPARATION - 1 <= b.y || b.y + b.height + NODE_SEPARATION - 1 <= a.y;

          expect(apart, `${a.id} and ${b.id} in one column`).toBe(true);
        } else {
          const gap = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width));

          expect(gap, `${a.id} and ${b.id} in two columns`).toBeGreaterThanOrEqual(COLUMN_SEPARATION - 1);
        }
      }
    }
  });

  it('copes with an exchange bound to itself, a cycle of exchanges, and a queue that nothing feeds', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { A: exchangeRecord('a'), B: exchangeRecord('b') },
        queues: { Q: queueRecord('q') },
        bindings: {
          B1: bindingRecord('A', { kind: 'exchange', id: 'A' }),
          B2: bindingRecord('A', { kind: 'exchange', id: 'B' }),
          B3: bindingRecord('B', { kind: 'exchange', id: 'A' }),
          B4: bindingRecord('B', { kind: 'queue', id: 'Q' }),
        },
      }),
    );
    const positions = autoLayout(document);

    expect(Object.keys(positions).sort()).toEqual(['A', 'B', 'Q']);
    for (const { x, y } of Object.values(positions)) {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    }
  });

  it('copes with several bindings between the same two nodes, which are one edge', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q') },
        bindings: {
          B1: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'a'),
          B2: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'b'),
        },
      }),
    );

    expect(at(document, 'E').x).toBeLessThan(at(document, 'Q').x);
  });

  it('leaves out an edge that goes to something that is not there, which a valid canvas has none of', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        bindings: {
          B: bindingRecord('E', { kind: 'queue', id: 'gone' }),
          C: bindingRecord('gone', { kind: 'exchange', id: 'E' }),
        },
        producers: { P: producerRecord('p', { kind: 'queue', id: 'gone' }) },
        consumers: { K: consumerRecord('k', ['gone']) },
      }),
    );

    expect(Object.keys(autoLayout(document)).sort()).toEqual(['E', 'K', 'P']);
    // It is as if the edges were not there: the same places as for the nodes with nothing linked to them.
    expect(autoLayout(document)).toEqual(
      autoLayout(
        documentOf({
          exchanges: { E: exchangeRecord('e') },
          producers: { P: producerRecord('p') },
          consumers: { K: consumerRecord('k') },
        }),
      ),
    );
  });

  it('does not depend on where the nodes were, and gives the same answer every time', () => {
    const document = sample();
    const moved = deepFreeze({
      ...sampleDocument(),
      layout: {
        nodes: Object.fromEntries(Object.keys(document.layout.nodes).map((id) => [id, { x: 99999, y: -99999 }])),
        labels: {},
      },
    });

    expect(autoLayout(moved)).toEqual(autoLayout(document));
    expect(autoLayout(document)).toEqual(autoLayout(document));
  });

  it('does not change the document it is given', () => {
    const document = sample();
    autoLayout(document);

    expect(document).toEqual(sampleDocument());
  });

  it('lays out a canvas of the size the plan asks the editor to carry: 200 nodes and 500 edges', () => {
    const exchanges = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`E${i}`, exchangeRecord(`e${i}`)]));
    const queues = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`Q${i}`, queueRecord(`q${i}`)]));
    const producers = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`P${i}`, producerRecord(`p${i}`, { kind: 'exchange', id: `E${i}` })]),
    );
    const consumers = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`C${i}`, consumerRecord(`c${i}`, [`Q${i}`, `Q${i + 40}`])]),
    );
    const bindings = Object.fromEntries(
      Array.from({ length: 160 }, (_, i) => [
        `B${i}`,
        bindingRecord(`E${i % 40}`, { kind: 'queue', id: `Q${(i * 7) % 80}` }, `k${i}`),
      ]),
    );
    const document = deepFreeze(documentOf({ exchanges, queues, producers, consumers, bindings }));
    const positions = autoLayout(document);

    expect(Object.keys(positions)).toHaveLength(200);
  });

  it('puts every node at a place with whole coordinates from the origin, for any shape of canvas, links that go anywhere included', () => {
    const arbShape = fc.record({
      exchanges: fc.integer({ min: 0, max: 5 }),
      queues: fc.integer({ min: 0, max: 5 }),
      producers: fc.integer({ min: 0, max: 3 }),
      consumers: fc.integer({ min: 0, max: 3 }),
      links: fc.array(fc.tuple(fc.nat(30), fc.nat(30)), { maxLength: 20 }),
    });
    const ids = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}${i}`);

    fc.assert(
      fc.property(arbShape, ({ exchanges, queues, producers, consumers, links }) => {
        const exchangeIds = ids('E', exchanges);
        const queueIds = ids('Q', queues);
        const bindings: Record<string, ReturnType<typeof bindingRecord>> = {};
        links.forEach(([a, b], index) => {
          const source = exchangeIds[a % Math.max(exchangeIds.length, 1)];
          if (source === undefined) {
            return;
          }
          const toQueue = b % 2 === 0 && queueIds.length > 0;
          const target = toQueue ? queueIds[b % queueIds.length] : exchangeIds[b % exchangeIds.length];
          bindings[`B${index}`] = bindingRecord(
            source,
            { kind: toQueue ? 'queue' : 'exchange', id: target as string },
            `${index}`,
          );
        });
        const document = documentOf({
          exchanges: Object.fromEntries(exchangeIds.map((id) => [id, exchangeRecord(id.toLowerCase())])),
          queues: Object.fromEntries(queueIds.map((id) => [id, queueRecord(id.toLowerCase())])),
          producers: Object.fromEntries(
            ids('P', producers).map((id, i) => [
              id,
              producerRecord(
                id,
                exchangeIds.length === 0
                  ? null
                  : { kind: 'exchange', id: exchangeIds[i % exchangeIds.length] as string },
              ),
            ]),
          ),
          consumers: Object.fromEntries(
            ids('C', consumers).map((id, i) => [
              id,
              consumerRecord(id, queueIds.length === 0 ? [] : [queueIds[i % queueIds.length] as string]),
            ]),
          ),
          bindings,
        });
        const positions = autoLayout(document);

        expect(Object.keys(positions).sort()).toEqual(Object.keys(document.layout.nodes).sort());
        for (const { x, y } of Object.values(positions)) {
          expect(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0).toBe(true);
        }
      }),
    );
  });
});
