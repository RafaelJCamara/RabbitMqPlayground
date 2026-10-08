import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCompress, deflate, inflate } from './compress';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

afterEach(() => vi.unstubAllGlobals());

describe('canCompress (ADR-0077)', () => {
  it('is true where the platform has both streams, and false where it lacks either', () => {
    expect(canCompress()).toBe(true);

    vi.stubGlobal('CompressionStream', undefined);
    expect(canCompress()).toBe(false);
    vi.unstubAllGlobals();

    vi.stubGlobal('DecompressionStream', undefined);
    expect(canCompress()).toBe(false);
  });
});

describe('deflate and inflate', () => {
  it('give back the bytes that they were given, for any bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 2_000 }), async (bytes) => {
        const packed = await deflate(bytes);

        const unpacked = await inflate(packed, 10_000);

        expect(unpacked.ok && [...unpacked.bytes]).toEqual([...bytes]);
      }),
    );
  });

  it('make a text that repeats smaller, and a text that is empty a few bytes', async () => {
    const text = new TextEncoder().encode('{"queue":"orders"}'.repeat(500));

    expect((await deflate(text)).length).toBeLessThan(text.length / 10);
    expect((await deflate(new Uint8Array())).length).toBeLessThan(8);
  });

  it('inflate the bytes that the platform itself made, which is what a link made by a browser is', async () => {
    const original = new TextEncoder().encode('hello hello hello hello');
    const packed = new Uint8Array(
      await new Response(
        new Blob([original as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')),
      ).arrayBuffer(),
    );

    const unpacked = await inflate(packed, 1_000);

    expect(unpacked.ok && new TextDecoder().decode(unpacked.bytes)).toBe('hello hello hello hello');
  });
});

describe('inflate, against input that is hostile', () => {
  it('stops at the limit, and says it was stopped, for a bomb of 50 MB that is 48 KB when packed', async () => {
    const bomb = await deflate(new Uint8Array(50_000_000));
    expect(bomb.length).toBeLessThan(100_000);

    const started = Date.now();
    const result = await inflate(bomb, 2_000_000);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('too-large');
    expect(!result.ok && result.reason === 'too-large' && result.seen).toBeGreaterThan(2_000_000);
    // It does not make the 50 MB: it stops after a chunk or two beyond the limit.
    expect(!result.ok && result.reason === 'too-large' && result.seen).toBeLessThan(10_000_000);
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('lets through what is exactly the limit, and stops at one byte more', async () => {
    const packed = await deflate(new Uint8Array(1_000));

    const exactly = await inflate(packed, 1_000);
    const one = await inflate(packed, 999);

    expect(exactly.ok && exactly.bytes.length).toBe(1_000);
    expect(!one.ok && one.reason).toBe('too-large');
  });

  it('says that a stream that is not deflate is damaged, and what the platform said', async () => {
    const result = await inflate(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), 1_000);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('damaged');
    expect(!result.ok && result.reason === 'damaged' && result.detail.length).toBeGreaterThan(0);
  });

  it('says that a stream that is cut short is damaged, at any place that it is cut', async () => {
    const packed = await deflate(
      new TextEncoder().encode(JSON.stringify({ a: Array.from({ length: 200 }, (_, i) => `item ${i}`) })),
    );

    for (const keep of [1, 2, Math.floor(packed.length / 2), packed.length - 1]) {
      const result = await inflate(packed.slice(0, keep), 100_000);

      expect(result.ok).toBe(false);
    }
  });

  it.each([
    ['its words, without the full stop and the spaces that end them', new Error('Bad header. '), 'Bad header'],
    ['words of its own, when it said nothing', new Error(''), 'the stream could not be inflated'],
    ['words of its own, when it threw what is not an error', 'oops', 'the stream could not be inflated'],
    ['words of its own, when all it said was a full stop', new Error('...'), 'the stream could not be inflated'],
  ])('says %s', async (_what, thrown, detail) => {
    vi.stubGlobal(
      'DecompressionStream',
      class {
        constructor() {
          throw thrown;
        }
      },
    );

    expect(await inflate(new Uint8Array([1, 2, 3]), 1_000)).toEqual({ ok: false, reason: 'damaged', detail });
  });
});
