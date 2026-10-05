import * as fc from 'fast-check';

/** A seed for the engine's PRNG: any unsigned 32-bit integer. */
export const arbSeed: fc.Arbitrary<number> = fc.integer({ min: 0, max: 0xffff_ffff });
