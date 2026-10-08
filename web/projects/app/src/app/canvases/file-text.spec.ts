import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, readText, tooBigToRead } from './file-text';

describe('tooBigToRead (ADR-0075)', () => {
  it('is 200 MB: four bytes for each of the 50,000,000 characters that a file may have', () => {
    expect(MAX_FILE_BYTES).toBe(200_000_000);
  });

  it('lets a file of exactly the longest length be read, and refuses one byte more, with its size and the cap', () => {
    expect(tooBigToRead({ size: MAX_FILE_BYTES })).toBeNull();
    expect(tooBigToRead({ size: MAX_FILE_BYTES + 1 })).toBe(
      'This file is 190.7 MB, which is more than a canvas file or a backup of this app can be (at most 47.7 MB of text). It was not read, so that a file that is not one of ours cannot make the page run out of memory.',
    );
  });

  it('lets an ordinary file be read, and an empty one', () => {
    expect(tooBigToRead({ size: 0 })).toBeNull();
    expect(tooBigToRead({ size: 12_345 })).toBeNull();
  });
});

describe('readText', () => {
  it('gives the text of a file', async () => {
    await expect(readText(new File(['{"a": 1}\n'], 'orders.json'))).resolves.toBe('{"a": 1}\n');
  });

  it('reads UTF-8, including what is not ASCII', async () => {
    await expect(readText(new File(['Café 日本語 😀'], 'names.json'))).resolves.toBe('Café 日本語 😀');
  });
});
