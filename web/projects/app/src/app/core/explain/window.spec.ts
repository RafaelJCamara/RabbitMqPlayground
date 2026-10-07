import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { atBottom, OVERSCAN, scrollFor, windowOf } from './window';

describe('windowOf (ADR-0061)', () => {
  it('draws the rows that the scroll shows and a few over at each end, and keeps the rest as a space of the same height', () => {
    // 1,000 rows of 28 pixels, a viewport of 280 (ten rows), scrolled by 28 × 100.
    expect(windowOf(1000, 28, 2800, 280)).toEqual({
      start: 100 - OVERSCAN,
      end: 110 + OVERSCAN,
      before: (100 - OVERSCAN) * 28,
      after: (1000 - 110 - OVERSCAN) * 28,
    });
  });

  it('begins at the first row when it is scrolled to the top, and ends at the last when it is scrolled to the bottom', () => {
    expect(windowOf(1000, 28, 0, 280)).toEqual({
      start: 0,
      end: 10 + OVERSCAN,
      before: 0,
      after: (1000 - 10 - OVERSCAN) * 28,
    });
    expect(windowOf(1000, 28, 1000 * 28 - 280, 280)).toEqual({
      start: 990 - OVERSCAN,
      end: 1000,
      before: (990 - OVERSCAN) * 28,
      after: 0,
    });
  });

  it('draws a row that is half in view, as one that shows', () => {
    expect(windowOf(100, 10, 5, 10, 0)).toEqual({ start: 0, end: 2, before: 0, after: 980 });
    expect(windowOf(100, 10, 10, 10, 0)).toEqual({ start: 1, end: 2, before: 10, after: 980 });
  });

  it('draws every row of a list that is shorter than the viewport, and none of an empty one', () => {
    expect(windowOf(3, 28, 0, 280)).toEqual({ start: 0, end: 3, before: 0, after: 0 });
    expect(windowOf(0, 28, 0, 280)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });

  it('is not thrown by a scroll that is past the end, or before the start, or by a row that has no height yet', () => {
    expect(windowOf(10, 28, 99_999, 280)).toEqual({ start: 10, end: 10, before: 280, after: 0 });
    expect(windowOf(10, 28, -50, 280)).toEqual(windowOf(10, 28, 0, 280));
    expect(windowOf(10, 0, 0, 5, 0)).toEqual({ start: 0, end: 5, before: 0, after: 5 });
    expect(windowOf(10, 28, 0, -5, 0)).toEqual({ start: 0, end: 0, before: 0, after: 280 });
  });

  it('holds, for any list and any scroll: a window inside the list, with every row that shows, and the heights add up to the list', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6000 }),
        fc.integer({ min: 1, max: 80 }),
        fc.integer({ min: 0, max: 600_000 }),
        fc.integer({ min: 0, max: 2000 }),
        (count, height, scroll, viewport) => {
          const { start, end, before, after } = windowOf(count, height, scroll, viewport);

          expect(start).toBeGreaterThanOrEqual(0);
          expect(end).toBeGreaterThanOrEqual(start);
          expect(end).toBeLessThanOrEqual(count);
          expect(before + (end - start) * height + after).toBe(count * height);
          // Every row whose top is in the viewport is drawn.
          for (const row of [Math.floor(scroll / height), Math.ceil((scroll + viewport) / height) - 1]) {
            if (row >= 0 && row < count && row * height < scroll + viewport && (row + 1) * height > scroll) {
              expect(row).toBeGreaterThanOrEqual(start);
              expect(row).toBeLessThan(end);
            }
          }
          // It never draws more than the rows that show and the rows that it keeps over at each end.
          expect(end - start).toBeLessThanOrEqual(Math.ceil(viewport / height) + 1 + 2 * OVERSCAN);
        },
      ),
    );
  });
});

describe('scrollFor', () => {
  it('leaves the scroll as it is when the row shows, and brings in a row that is above or below by the least that it takes', () => {
    expect(scrollFor(10, 28, 280, 280)).toBe(280);
    expect(scrollFor(19, 28, 280, 280)).toBe(280);
    expect(scrollFor(5, 28, 280, 280)).toBe(140);
    expect(scrollFor(20, 28, 280, 280)).toBe(20 * 28 + 28 - 280);
    expect(scrollFor(0, 28, 280, 280)).toBe(0);
  });
});

describe('atBottom', () => {
  it('says that the list is scrolled to its end, to a couple of pixels, and that an empty list and a short one are', () => {
    expect(atBottom(100, 28, 100 * 28 - 280, 280)).toBe(true);
    expect(atBottom(100, 28, 100 * 28 - 282, 280)).toBe(true);
    expect(atBottom(100, 28, 100 * 28 - 283, 280)).toBe(false);
    expect(atBottom(0, 28, 0, 280)).toBe(true);
    expect(atBottom(5, 28, 0, 280)).toBe(true);
    expect(atBottom(100, 28, 0, 280)).toBe(false);
  });
});
