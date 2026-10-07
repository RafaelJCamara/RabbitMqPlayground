import { describe, expect, it } from 'vitest';
import type { Marker } from './edges';
import { DENSE_PARTS, groupMarkers, SHAPE_LIMIT } from './group';

const marker = (over: Partial<Marker> = {}): Marker => ({
  message: 1,
  key: 'k',
  edge: 'P>E',
  at: 0.5,
  redelivered: false,
  ...over,
});

describe('groupMarkers (ADR-0055)', () => {
  it('is nothing for no messages', () => {
    expect(groupMarkers([])).toEqual([]);
  });

  it('is one shape for one message, with its key and its place', () => {
    expect(groupMarkers([marker({ at: 0.25 })])).toEqual([
      { edge: 'P>E', at: 0.25, count: 1, key: 'k', redelivered: false },
    ]);
  });

  it('is one shape for a burst, which is the messages that are on the same edge in the same place, with how many they are', () => {
    const burst = Array.from({ length: 20 }, (_, index) => marker({ message: index + 1 }));

    expect(groupMarkers(burst)).toEqual([{ edge: 'P>E', at: 0.5, count: 20, key: 'k', redelivered: false }]);
  });

  it('keeps apart messages that are on the same edge in other places, and messages in the same place on other edges', () => {
    const shapes = groupMarkers([
      marker({ message: 1, at: 0.2 }),
      marker({ message: 2, at: 0.6 }),
      marker({ message: 3, at: 0.6, edge: 'E>Q' }),
    ]);

    expect(shapes.map(({ edge, at, count }) => [edge, at, count])).toEqual([
      ['P>E', 0.2, 1],
      ['P>E', 0.6, 1],
      ['E>Q', 0.6, 1],
    ]);
  });

  it('takes places that differ by less than a thousandth of the way to be the same, and a thousandth to be two', () => {
    expect(groupMarkers([marker({ at: 0.5 }), marker({ at: 0.5001 })])).toHaveLength(1);
    expect(groupMarkers([marker({ at: 0.5 }), marker({ at: 0.502 })])).toHaveLength(2);
  });

  it('has no key when the messages do not share one, so that a crowd of mixed messages is not the colour of one of them', () => {
    const [shape] = groupMarkers([marker({ key: 'a' }), marker({ key: 'b' }), marker({ key: 'a' })]);

    expect(shape).toMatchObject({ count: 3, key: null });
  });

  it('keeps the key that the messages share, even when it is no key at all', () => {
    expect(groupMarkers([marker({ key: '' }), marker({ key: '' })])[0]?.key).toBe('');
  });

  it('is redelivered when any of its messages is, so that the ring is not lost in a crowd', () => {
    const [shape] = groupMarkers([marker(), marker({ redelivered: true }), marker()]);

    expect(shape?.redelivered).toBe(true);
  });

  it('keeps the order in which the places were first met', () => {
    const shapes = groupMarkers([marker({ at: 0.9 }), marker({ at: 0.1 }), marker({ at: 0.9 })]);

    expect(shapes.map(({ at }) => at)).toEqual([0.9, 0.1]);
  });

  describe('when there are more shapes than the limit', () => {
    const crowd = Array.from({ length: 40 }, (_, index) => marker({ message: index + 1, at: index / 40 }));

    it('is grouped by edge and by thirty-second of the way, so that a thousand are never more than a few hundred shapes', () => {
      const exact = groupMarkers(crowd, 100);
      const dense = groupMarkers(crowd, 10);

      expect(exact).toHaveLength(40);
      expect(dense.length).toBeLessThanOrEqual(DENSE_PARTS);
      expect(dense.reduce((sum, { count }) => sum + count, 0)).toBe(40);
      expect(dense.every(({ edge }) => edge === 'P>E')).toBe(true);
    });

    it('puts a group at the mean of the places of its messages', () => {
      const [shape] = groupMarkers([marker({ at: 0.01 }), marker({ at: 0.03 })], 0);

      expect(shape).toMatchObject({ count: 2 });
      expect(shape?.at).toBeCloseTo(0.02, 10);
    });

    it('puts the end of an edge in the last part and not in a part of its own', () => {
      const shapes = groupMarkers([marker({ at: 1 }), marker({ at: 0.99 })], 0);

      expect(shapes).toHaveLength(1);
      expect(shapes[0]?.count).toBe(2);
    });

    it('is the limit that the plan says, which is 500 shapes', () => {
      const many = Array.from({ length: SHAPE_LIMIT + 1 }, (_, index) =>
        marker({ message: index, at: (index % 997) / 1_000, edge: `e${Math.floor(index / 997)}` }),
      );

      expect(groupMarkers(many.slice(0, SHAPE_LIMIT))).toHaveLength(SHAPE_LIMIT);
      expect(groupMarkers(many).length).toBeLessThan(SHAPE_LIMIT + 1);
    });
  });
});
