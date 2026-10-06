import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
  undoRedoProblems,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { ElementKind } from '../document/issue';
import { LIMITS, type CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { COLUMN_X } from './helpers';
import { applyLayout, applyMove, applyMoveLabel } from './place';
import type { Move, MoveLabel } from './types';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const move = (kind: ElementKind, name: string, x?: number, y?: number): Move => ({
  type: 'move',
  target: { kind, name },
  ...(x === undefined ? {} : { x }),
  ...(y === undefined ? {} : { y }),
});
const moveLabel = (from: [ElementKind, string], to: [ElementKind, string], at: number): MoveLabel => ({
  type: 'move-label',
  from: { kind: from[0], name: from[1] },
  to: { kind: to[0], name: to[1] },
  at,
});

describe('move', () => {
  it('puts a node at a place, for a node of every kind', () => {
    for (const [kind, name, id] of [
      ['exchange', 'orders', 'E1'],
      ['queue', 'billing', 'Q1'],
      ['producer', 'sender', 'P1'],
      ['consumer', 'worker', 'C1'],
    ] as const) {
      const result = applyMove(sample(), move(kind, name, 12.5, -40));

      expect(result.ok && result.value.layout.nodes[id], kind).toEqual({ x: 12.5, y: -40 });
    }
  });

  it('moves along one axis when it is given one coordinate, and keeps the other', () => {
    const before = sample();
    const onlyX = applyMove(before, move('queue', 'billing', 700));
    const onlyY = applyMove(before, move('queue', 'billing', undefined, 300));

    expect(onlyX.ok && onlyX.value.layout.nodes['Q1']).toEqual({ x: 700, y: before.layout.nodes['Q1']?.y });
    expect(onlyY.ok && onlyY.value.layout.nodes['Q1']).toEqual({ x: before.layout.nodes['Q1']?.x, y: 300 });
  });

  it('takes the edges of the range, and a node that has been moved to the origin', () => {
    const limit = LIMITS.coordinate;

    expect(applyMove(sample(), move('queue', 'billing', -limit, limit)).ok).toBe(true);
    expect(applyMove(sample(), move('queue', 'billing', 0, 0)).ok).toBe(true);
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applyMove(before, move('exchange', 'docs', 5, 5));

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.layout.labels).toBe(before.layout.labels);
    expect(result.ok && result.value.layout.nodes['E1']).toBe(before.layout.nodes['E1']);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('changes nothing when the node is already there, and returns the same document', () => {
    const before = sample();
    const at = before.layout.nodes['Q1'] as { x: number; y: number };

    expect((applyMove(before, move('queue', 'billing', at.x, at.y)) as { value: unknown }).value).toBe(before);
    expect((applyMove(before, move('queue', 'billing', at.x)) as { value: unknown }).value).toBe(before);
    expect((applyMove(before, move('queue', 'billing', undefined, at.y)) as { value: unknown }).value).toBe(before);
  });

  it('gives a node that has no position the place that its kind has by default, when told one coordinate', () => {
    const document = deepFreeze(documentOf({ queues: { Q: queueRecord('q') }, nodes: {} }));
    const result = applyMove(document, move('queue', 'q', undefined, 7));

    expect(result.ok && result.value.layout.nodes['Q']).toEqual({ x: COLUMN_X.queue, y: 7 });
    const same = applyMove(document, move('queue', 'q', COLUMN_X.queue, 0));

    expect(same.ok && same.value.layout.nodes['Q']).toEqual({ x: COLUMN_X.queue, y: 0 });
  });

  describe('refuses', () => {
    it('no coordinate, and says what to give', () => {
      expect(applyMove(sample(), move('queue', 'billing'))).toEqual({
        ok: false,
        error: { kind: 'nothing-to-change', message: 'Say where to move it, for example x=200 y=80.' },
      });
    });

    it.each([
      ['x', Number.NaN],
      ['x', Number.POSITIVE_INFINITY],
      ['x', LIMITS.coordinate + 1],
      ['x', -LIMITS.coordinate - 1],
      ['y', Number.NEGATIVE_INFINITY],
      ['y', LIMITS.coordinate + 0.5],
    ])('a %s of %d, which is not a place on the canvas', (axis, value) => {
      const result = applyMove(
        sample(),
        axis === 'x' ? move('queue', 'billing', value) : move('queue', 'billing', 0, value),
      );

      expect(!result.ok && result.error.kind).toBe('invalid-value');
      expect(!result.ok && result.error.message).toBe(
        `The ${axis} must be a number from -${LIMITS.coordinate} to ${LIMITS.coordinate}, and ${value} is not.`,
      );
    });

    it('a node that is not there, and says what was probably meant', () => {
      expect(applyMove(sample(), move('queue', 'biling', 1, 1))).toMatchObject({
        error: { kind: 'missing-element', message: "There is no queue named 'biling'. Did you mean 'billing'?" },
      });
    });
  });
});

describe('move label', () => {
  it('puts the label of an edge somewhere along it, for each of the three kinds of edge', () => {
    for (const [from, to, key] of [
      [['exchange', 'orders'], ['queue', 'billing'], 'E1>Q1'],
      [['exchange', 'orders'], ['exchange', 'hidden'], 'E1>E3'],
      [['producer', 'sender'], ['exchange', 'orders'], 'P1>E1'],
      [['queue', 'billing'], ['consumer', 'worker'], 'Q1>C1'],
    ] as const) {
      const result = applyMoveLabel(sample(), moveLabel([...from], [...to], 0.9));

      expect(result.ok && result.value.layout.labels[key], key).toEqual({ at: 0.9 });
      expect(result.ok && validateDocument(result.value), key).toEqual([]);
    }
  });

  it('takes the two ends of the edge', () => {
    expect(applyMoveLabel(sample(), moveLabel(['exchange', 'orders'], ['queue', 'billing'], 0)).ok).toBe(true);
    expect(applyMoveLabel(sample(), moveLabel(['exchange', 'orders'], ['queue', 'billing'], 1)).ok).toBe(true);
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applyMoveLabel(before, moveLabel(['exchange', 'docs'], ['queue', 'archive'], 0.2));

    expect(result.ok && result.value.layout.nodes).toBe(before.layout.nodes);
    expect(result.ok && result.value.layout.labels['E1>Q1']).toBe(before.layout.labels['E1>Q1']);
    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('changes nothing when the label is already there, and returns the same document', () => {
    const before = sample();

    expect(
      (applyMoveLabel(before, moveLabel(['exchange', 'orders'], ['queue', 'billing'], 0.5)) as { value: unknown })
        .value,
    ).toBe(before);
  });

  describe('refuses', () => {
    it('an edge that is not there, in either direction, and says so', () => {
      const wrongWay = applyMoveLabel(sample(), moveLabel(['queue', 'billing'], ['exchange', 'orders'], 0.5));
      const unlinked = applyMoveLabel(sample(), moveLabel(['exchange', 'orders'], ['queue', 'archive'], 0.5));

      expect(!wrongWay.ok && wrongWay.error).toEqual({
        kind: 'invalid-link',
        message: "There is no edge from 'billing' to 'orders' on the canvas, so there is no label to move.",
      });
      expect(!unlinked.ok && unlinked.error.kind).toBe('invalid-link');
    });

    it.each([-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, 2])('a place of %d, which is not on the edge', (at) => {
      const result = applyMoveLabel(sample(), moveLabel(['exchange', 'orders'], ['queue', 'billing'], at));

      expect(!result.ok && result.error.kind).toBe('invalid-value');
      expect(!result.ok && result.error.message).toBe(
        `A label sits from 0, at the start of its edge, to 1, at the end, and ${at} is not between them.`,
      );
    });

    it('an end that is not there, the first before the second, and says what was probably meant', () => {
      expect(applyMoveLabel(sample(), moveLabel(['exchange', 'ordrs'], ['queue', 'billing'], 0.5))).toMatchObject({
        error: { message: "There is no exchange named 'ordrs'. Did you mean 'orders'?" },
      });
      expect(applyMoveLabel(sample(), moveLabel(['exchange', 'orders'], ['queue', 'biling'], 0.5))).toMatchObject({
        error: { message: "There is no queue named 'biling'. Did you mean 'billing'?" },
      });
      expect(applyMoveLabel(sample(), moveLabel(['exchange', 'nope'], ['queue', 'nope'], 0.5))).toMatchObject({
        error: { message: "There is no exchange named 'nope'." },
      });
    });
  });
});

describe('layout', () => {
  const linear = (): CanvasDocument =>
    deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q') },
        bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }) },
        consumers: { C: consumerRecord('c', ['Q']) },
        nodes: { E: { x: 500, y: 500 }, Q: { x: 0, y: 900 }, P: { x: 123, y: 4 }, C: { x: -50, y: -50 } },
      }),
    );

  it('puts the nodes left to right in the way a message goes: producer, exchange, queue, consumer', () => {
    const result = applyLayout(linear(), { type: 'layout' });
    const at = result.ok ? result.value.layout.nodes : {};

    expect(Object.keys(at).sort()).toEqual(['C', 'E', 'P', 'Q']);
    expect((at['P']?.x ?? 0) < (at['E']?.x ?? 0)).toBe(true);
    expect((at['E']?.x ?? 0) < (at['Q']?.x ?? 0)).toBe(true);
    expect((at['Q']?.x ?? 0) < (at['C']?.x ?? 0)).toBe(true);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = linear();
    const result = applyLayout(before, { type: 'layout' });

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.layout.labels).toBe(before.layout.labels);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('changes nothing when the nodes are where it would put them, and returns the same document', () => {
    const once = applyLayout(linear(), { type: 'layout' });
    const twice = once.ok ? applyLayout(deepFreeze(once.value), { type: 'layout' }) : once;

    expect(twice.ok && once.ok && twice.value).toBe(once.ok && once.value);
  });

  it('does not depend on where the nodes were', () => {
    const one = applyLayout(linear(), { type: 'layout' });
    const moved = applyMove(linear(), move('queue', 'q', 9000, 9000));
    const other = moved.ok ? applyLayout(deepFreeze(moved.value), { type: 'layout' }) : moved;

    expect(one.ok && other.ok && other.value.layout.nodes).toEqual(one.ok && one.value.layout.nodes);
  });

  it('leaves the canvas with nothing on it as it is', () => {
    const before = deepFreeze(documentOf());
    const result = applyLayout(before, { type: 'layout' });

    expect(result.ok && result.value).toBe(before);
  });
});
