import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ReadyList, type Entry } from './ready';

const entry = (order: number, redelivered = false): Entry<string> => ({ message: `m${order}`, order, redelivered });
const orders = (list: ReadyList<string>): number[] => list.toArray().map(({ order }) => order);

describe('ReadyList', () => {
  it('is empty to begin with', () => {
    const list = new ReadyList<string>();

    expect(list.length).toBe(0);
    expect(list.shift()).toBeUndefined();
    expect(list.toArray()).toEqual([]);
  });

  it('is first in, first out', () => {
    const list = new ReadyList<string>();
    for (const order of [1, 2, 3]) {
      list.push(entry(order));
    }

    expect(list.length).toBe(3);
    expect([list.shift()?.order, list.shift()?.order, list.shift()?.order, list.shift()]).toEqual([1, 2, 3, undefined]);
  });

  it('starts from the entries that it is given, in their order, without keeping the array that held them', () => {
    const given = [entry(1), entry(2)];
    const list = new ReadyList(given);
    given.pop();

    expect(orders(list)).toEqual([1, 2]);
  });

  describe('insert', () => {
    it('puts a copy that is given back in the place that its order says, among those that came after it', () => {
      const list = new ReadyList([entry(4), entry(5), entry(8)]);

      list.insert(entry(2));
      list.insert(entry(6));
      list.insert(entry(9));

      expect(orders(list)).toEqual([2, 4, 5, 6, 8, 9]);
    });

    it('puts several copies that are given back in their old order, ahead of what came after them', () => {
      const list = new ReadyList([entry(4), entry(5)]);
      for (const order of [1, 2, 3]) {
        list.insert(entry(order, true));
      }

      expect(orders(list)).toEqual([1, 2, 3, 4, 5]);
    });

    it('works at the front of a list whose front has moved on', () => {
      const list = new ReadyList([entry(1), entry(2), entry(5)]);
      list.shift();
      list.shift();

      list.insert(entry(2));

      expect(orders(list)).toEqual([2, 5]);
    });
  });

  it('empties, and says how many it held', () => {
    const list = new ReadyList([entry(1), entry(2)]);
    list.shift();

    expect(list.clear()).toBe(1);
    expect(list.length).toBe(0);
    expect(list.toArray()).toEqual([]);
    list.push(entry(3));
    expect(orders(list)).toEqual([3]);
  });

  it('does not cost the length of the list to take from the front: it is made smaller after a long run, and nothing is lost', () => {
    const list = new ReadyList<string>();
    for (let order = 1; order <= 3000; order += 1) {
      list.push(entry(order));
    }
    const taken: number[] = [];
    for (let count = 0; count < 2500; count += 1) {
      taken.push((list.shift() as Entry<string>).order);
    }

    expect(taken).toEqual(Array.from({ length: 2500 }, (_, index) => index + 1));
    expect(list.length).toBe(500);
    expect(orders(list)).toEqual(Array.from({ length: 500 }, (_, index) => 2501 + index));
    list.insert(entry(2400, true));
    expect(list.toArray()[0]?.order).toBe(2400);
  });

  describe('what it keeps in memory', () => {
    it('lets go of what was taken from the front when that is at least 1,024 and half of what it keeps, and not before', () => {
      const list = new ReadyList<string>();
      for (let order = 1; order <= 2048; order += 1) {
        list.push(entry(order));
      }
      for (let count = 0; count < 1023; count += 1) {
        list.shift();
      }
      expect(list.retained).toBe(2048);

      list.shift();

      expect([list.retained, list.length]).toEqual([1024, 1024]);
    });

    it('does not let go while less than half of what it keeps has been taken, however far the front has gone', () => {
      const list = new ReadyList<string>();
      for (let order = 1; order <= 4000; order += 1) {
        list.push(entry(order));
      }
      for (let count = 0; count < 1500; count += 1) {
        list.shift();
      }

      expect([list.retained, list.length]).toEqual([4000, 2500]);
    });

    it('does not let go of a short list that has been used a little, which is not worth the copy', () => {
      const list = new ReadyList<string>();
      for (const order of [1, 2, 3, 4]) {
        list.push(entry(order));
      }
      for (let count = 0; count < 3; count += 1) {
        list.shift();
      }

      expect([list.retained, list.length]).toEqual([4, 1]);
    });
  });

  it('gives a copy that is given back its redelivered flag as it was set', () => {
    const list = new ReadyList<string>();
    list.insert(entry(1, true));

    expect(list.toArray()[0]?.redelivered).toBe(true);
  });

  describe('properties', () => {
    configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

    it('keeps the copies sorted by order, whatever is pushed, taken and given back', () => {
      fc.assert(
        fc.property(fc.array(fc.nat({ max: 40 }), { maxLength: 60 }), fc.nat({ max: 60 }), (given, takes) => {
          const list = new ReadyList<string>();
          const reference: number[] = [];
          let next = 1;
          const taken: Entry<string>[] = [];
          for (const step of given) {
            if (step % 3 === 0 && taken.length > 0) {
              const back = taken.pop() as Entry<string>;
              list.insert(back);
              reference.push(back.order);
              reference.sort((a, b) => a - b);
            } else if (step % 3 === 1) {
              list.push(entry(next));
              reference.push(next);
              next += 1;
            } else {
              const first = list.shift();
              if (first !== undefined) {
                taken.push(first);
                reference.shift();
              }
            }
          }
          for (let count = 0; count < takes; count += 1) {
            expect(list.shift()?.order).toBe(reference.shift());
          }

          expect(orders(list)).toEqual(reference);
        }),
      );
    });
  });
});
