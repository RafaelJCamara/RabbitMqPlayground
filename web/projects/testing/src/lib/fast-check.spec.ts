import * as fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';
import { arbSeed } from './arbitraries';
import { DEFAULT_FC_NUM_RUNS, DEFAULT_FC_SEED, configureFastCheck, readFastCheckSettings } from './fast-check';

describe('readFastCheckSettings', () => {
  it('uses a fixed seed and the fast-check default run count when nothing is set', () => {
    expect(readFastCheckSettings({})).toEqual({ seed: DEFAULT_FC_SEED, numRuns: DEFAULT_FC_NUM_RUNS });
  });

  it('reads FC_SEED and FC_NUM_RUNS', () => {
    expect(readFastCheckSettings({ FC_SEED: '1234', FC_NUM_RUNS: '5000' })).toEqual({ seed: 1234, numRuns: 5000 });
  });

  it('treats an empty value as not set', () => {
    expect(readFastCheckSettings({ FC_SEED: '', FC_NUM_RUNS: '  ' })).toEqual({
      seed: DEFAULT_FC_SEED,
      numRuns: DEFAULT_FC_NUM_RUNS,
    });
  });

  it('accepts a seed of 0 and a timestamp-sized seed', () => {
    expect(readFastCheckSettings({ FC_SEED: '0' }).seed).toBe(0);
    expect(readFastCheckSettings({ FC_SEED: '1790000000000' }).seed).toBe(1790000000000);
  });

  it.each(['abc', '1.5', '-1', 'NaN', 'Infinity', '1e400'])('rejects FC_SEED=%s', (value) => {
    expect(() => readFastCheckSettings({ FC_SEED: value })).toThrow(/FC_SEED must be an integer of at least 0/);
  });

  it.each(['0', '-5', 'ten', '2.5'])('rejects FC_NUM_RUNS=%s', (value) => {
    expect(() => readFastCheckSettings({ FC_NUM_RUNS: value })).toThrow(/FC_NUM_RUNS must be an integer of at least 1/);
  });
});

describe('configureFastCheck', () => {
  const before = fc.readConfigureGlobal();
  afterEach(() => {
    fc.resetConfigureGlobal();
    fc.configureGlobal(before);
  });

  it('applies the settings to every property in the file', () => {
    const settings = configureFastCheck({ FC_SEED: '99', FC_NUM_RUNS: '7' });

    expect(settings).toEqual({ seed: 99, numRuns: 7 });
    expect(fc.readConfigureGlobal()).toMatchObject({ seed: 99, numRuns: 7 });
  });

  it('makes a property replay the same cases for the same seed', () => {
    const run = () => {
      const seen: number[] = [];
      configureFastCheck({ FC_SEED: '42', FC_NUM_RUNS: '5' });
      fc.assert(
        fc.property(fc.integer(), (n) => {
          seen.push(n);
        }),
      );
      return seen;
    };

    expect(run()).toEqual(run());
  });
});

describe('the Vitest setup file', () => {
  it('has applied FC_SEED and FC_NUM_RUNS from the environment before any test runs', () => {
    expect(fc.readConfigureGlobal()).toMatchObject(readFastCheckSettings(process.env));
  });
});

describe('arbSeed', () => {
  it('only produces unsigned 32-bit integers', () => {
    fc.assert(
      fc.property(arbSeed, (seed) => {
        expect(Number.isInteger(seed)).toBe(true);
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThanOrEqual(0xffffffff);
      }),
    );
  });
});
