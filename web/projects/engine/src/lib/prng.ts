/**
 * A small seeded pseudo-random number generator (mulberry32). The same seed gives the same stream on every platform,
 * because it uses only 32-bit integer arithmetic (ADR-0007). It is not suitable for cryptography.
 */
export interface Prng {
  /** The next float in [0, 1). */
  next(): number;
  /** The next integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** The generator's whole state. `createPrng(prng.state())` continues the same stream. */
  state(): number;
}

const UINT32_LIMIT = 0x1_0000_0000;

export function createPrng(seed: number): Prng {
  if (!Number.isInteger(seed) || seed < 0 || seed >= UINT32_LIMIT) {
    throw new RangeError(`A PRNG seed must be an integer from 0 to ${UINT32_LIMIT - 1}, got ${seed}`);
  }

  let state = seed;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32_LIMIT;
  };

  return {
    next,
    nextInt(maxExclusive) {
      if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_LIMIT) {
        throw new RangeError(`maxExclusive must be an integer from 1 to ${UINT32_LIMIT}, got ${maxExclusive}`);
      }
      return Math.floor(next() * maxExclusive);
    },
    state: () => state,
  };
}
