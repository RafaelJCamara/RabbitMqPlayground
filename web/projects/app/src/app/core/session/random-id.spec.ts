import { describe, expect, it, vi } from 'vitest';
import { randomId, type RandomSource } from './canvas-storage';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** A page that was opened over HTTP: `crypto` has `getRandomValues` and no `randomUUID`. */
const insecure = (fill: number): RandomSource => ({
  getRandomValues: ((array: Uint8Array) => array.fill(fill)) as RandomSource['getRandomValues'],
});

describe('randomId', () => {
  it('is what randomUUID gives when the page is in a secure context', () => {
    const randomUUID = vi.fn(() => '11111111-2222-4333-8444-555555555555' as const);
    expect(randomId({ ...insecure(0), randomUUID })).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('is made from getRandomValues when randomUUID is not there, as a version 4 UUID', () => {
    expect(randomId(insecure(0xff))).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    expect(randomId(insecure(0))).toBe('00000000-0000-4000-8000-000000000000');
  });

  it('is a different UUID each time, with the crypto of this runtime, with or without randomUUID', () => {
    const withoutRandomUuid = { getRandomValues: crypto.getRandomValues.bind(crypto) } satisfies RandomSource;
    for (const source of [crypto, withoutRandomUuid]) {
      const ids = new Set(Array.from({ length: 50 }, () => randomId(source)));
      expect(ids.size).toBe(50);
      for (const id of ids) {
        expect(id).toMatch(UUID_V4);
      }
    }
  });
});
