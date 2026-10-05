import { expect, test } from 'vitest';
import { createPrng } from './prng';

/**
 * A benchmark fails only on a gross regression (ADR-0015, M1 plan section 4). These limits are about twenty times below
 * what a laptop measures, because CI runners are shared and noisy. They catch an accidental O(n) in a hot path, not a
 * 10% change.
 */
const GROSS_LIMIT_OPS_PER_SECOND = 1_000_000;

test('prng', async ({ bench }) => {
  const prng = createPrng(1);

  const results = await bench.compare(
    bench('next()', () => {
      prng.next();
    }),
    bench('nextInt(100)', () => {
      prng.nextInt(100);
    }),
    { time: 300, warmupTime: 100 },
  );

  expect(results.get('next()').throughput.mean).toBeGreaterThan(GROSS_LIMIT_OPS_PER_SECOND);
  expect(results.get('nextInt(100)').throughput.mean).toBeGreaterThan(GROSS_LIMIT_OPS_PER_SECOND);
});
