import { arbSeed } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPrng, type Prng } from './prng';

function take(prng: Prng, count: number): number[] {
  return Array.from({ length: count }, () => prng.next());
}

describe('createPrng', () => {
  describe('known answers', () => {
    // Computed with the reference mulberry32 implementation. If these change, saved seeds no longer replay.
    it('matches the reference stream for seed 1', () => {
      expect(take(createPrng(1), 3)).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
    });

    it('matches the reference stream at the top of the seed range', () => {
      expect(take(createPrng(4294967295), 2)).toEqual([0.8964226141106337, 0.189478256739676]);
    });

    it('turns the seed 1 stream into the integers 627, 2 and 527 for a range of 1000', () => {
      const prng = createPrng(1);

      expect([prng.nextInt(1000), prng.nextInt(1000), prng.nextInt(1000)]).toEqual([627, 2, 527]);
    });
  });

  describe('seed validation', () => {
    it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32])('rejects %s', (seed) => {
      expect(() => createPrng(seed)).toThrow(RangeError);
    });

    it.each([0, 1, 2 ** 32 - 1])('accepts %s', (seed) => {
      expect(() => createPrng(seed)).not.toThrow();
    });
  });

  describe('nextInt', () => {
    it.each([0, -1, 1.5, Number.NaN, 2 ** 32 + 1])('rejects a range of %s', (max) => {
      expect(() => createPrng(1).nextInt(max)).toThrow(RangeError);
    });

    it('always returns 0 for a range of 1', () => {
      const prng = createPrng(7);

      expect(Array.from({ length: 20 }, () => prng.nextInt(1))).toEqual(Array(20).fill(0));
    });
  });

  describe('properties', () => {
    it('gives the same stream for the same seed', () => {
      fc.assert(
        fc.property(arbSeed, fc.integer({ min: 1, max: 64 }), (seed, count) => {
          expect(take(createPrng(seed), count)).toEqual(take(createPrng(seed), count));
        }),
      );
    });

    it('only produces floats in [0, 1)', () => {
      fc.assert(
        fc.property(arbSeed, (seed) => {
          for (const value of take(createPrng(seed), 64)) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(1);
          }
        }),
      );
    });

    it('keeps nextInt inside its range', () => {
      fc.assert(
        fc.property(arbSeed, fc.integer({ min: 1, max: 1_000_000 }), (seed, max) => {
          const prng = createPrng(seed);
          for (let i = 0; i < 32; i++) {
            const value = prng.nextInt(max);
            expect(Number.isInteger(value)).toBe(true);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThan(max);
          }
        }),
      );
    });

    it('continues the same stream from a saved state', () => {
      fc.assert(
        fc.property(
          arbSeed,
          fc.integer({ min: 0, max: 32 }),
          fc.integer({ min: 1, max: 32 }),
          (seed, before, after) => {
            const original = createPrng(seed);
            take(original, before);
            const resumed = createPrng(original.state());

            expect(take(resumed, after)).toEqual(take(original, after));
          },
        ),
      );
    });
  });
});
