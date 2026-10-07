import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createHeap, type Timed } from './heap';

const timed = (at: number, seq: number): Timed => ({ at, seq });

describe('createHeap', () => {
  it('has nothing in it to begin with, and answers undefined', () => {
    const heap = createHeap();

    expect(heap.size).toBe(0);
    expect(heap.peek()).toBeUndefined();
    expect(heap.pop()).toBeUndefined();
    expect(heap.sorted()).toEqual([]);
  });

  it('gives the item that happens first, and leaves it where it is when it is only looked at', () => {
    const heap = createHeap([timed(30, 1), timed(10, 2), timed(20, 3)]);

    expect(heap.peek()).toEqual(timed(10, 2));
    expect(heap.size).toBe(3);
    expect([heap.pop(), heap.pop(), heap.pop(), heap.pop()]).toEqual([
      timed(10, 2),
      timed(20, 3),
      timed(30, 1),
      undefined,
    ]);
  });

  it('settles a tie by the order in which the items were scheduled', () => {
    const heap = createHeap<Timed>();
    for (const seq of [5, 2, 9, 1, 7]) {
      heap.push(timed(10, seq));
    }

    expect(Array.from({ length: 5 }, () => heap.pop()?.seq)).toEqual([1, 2, 5, 7, 9]);
  });

  it('keeps going after items are taken and pushed in between', () => {
    const heap = createHeap<Timed>();
    heap.push(timed(5, 1));
    heap.push(timed(3, 2));
    expect(heap.pop()).toEqual(timed(3, 2));
    heap.push(timed(4, 3));
    heap.push(timed(1, 4));

    expect(heap.sorted()).toEqual([timed(1, 4), timed(4, 3), timed(5, 1)]);
  });

  it('lists everything in the order that it will happen, without taking it', () => {
    const heap = createHeap([timed(2, 1), timed(1, 2), timed(2, 0)]);

    expect(heap.sorted()).toEqual([timed(1, 2), timed(2, 0), timed(2, 1)]);
    expect(heap.size).toBe(3);
  });

  describe('removeWhere', () => {
    it('takes out what it is true of, says how many, and keeps the order of the rest', () => {
      const heap = createHeap([timed(1, 1), timed(2, 2), timed(3, 3), timed(4, 4)]);

      expect(heap.removeWhere((item) => item.seq % 2 === 0)).toBe(2);
      expect(heap.sorted()).toEqual([timed(1, 1), timed(3, 3)]);
      expect(heap.pop()).toEqual(timed(1, 1));
    });

    it('touches nothing when it is true of none', () => {
      const heap = createHeap([timed(2, 1), timed(1, 2)]);

      expect(heap.removeWhere(() => false)).toBe(0);
      expect(heap.sorted()).toEqual([timed(1, 2), timed(2, 1)]);
    });

    it('can take out everything', () => {
      const heap = createHeap([timed(2, 1), timed(1, 2)]);

      expect(heap.removeWhere(() => true)).toBe(2);
      expect(heap.size).toBe(0);
      expect(heap.pop()).toBeUndefined();
    });
  });

  describe('properties', () => {
    configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

    const arbItems = fc
      .array(fc.integer({ min: 0, max: 20 }), { maxLength: 60 })
      .map((times) => times.map((at, seq) => timed(at, seq)));

    it('gives the items back in the order of their time and then their sequence number, whatever order they came in', () => {
      fc.assert(
        fc.property(arbItems, (items) => {
          const heap = createHeap(items);
          const expected = [...items].sort((a, b) => a.at - b.at || a.seq - b.seq);

          expect(heap.sorted()).toEqual(expected);
          expect(Array.from({ length: items.length }, () => heap.pop())).toEqual(expected);
        }),
      );
    });

    it('keeps the order after any item is taken out, whichever ones', () => {
      fc.assert(
        fc.property(arbItems, fc.integer({ min: 2, max: 5 }), (items, modulus) => {
          const heap = createHeap(items);
          heap.removeWhere((item) => item.seq % modulus === 0);
          const expected = items
            .filter((item) => item.seq % modulus !== 0)
            .sort((a, b) => a.at - b.at || a.seq - b.seq);

          expect(Array.from({ length: expected.length }, () => heap.pop())).toEqual(expected);
          expect(heap.size).toBe(0);
        }),
      );
    });
  });
});
