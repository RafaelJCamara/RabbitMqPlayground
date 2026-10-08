import { SIZE_CAPS } from '@rmq/persistence';
import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { backupFileName, canvasFileName, copyName, slug, UNTITLED, uniqueName } from './names';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

describe('uniqueName (ADR-0072)', () => {
  it('is the name itself when nobody has it', () => {
    expect(uniqueName(UNTITLED, [])).toBe('Untitled canvas');
    expect(uniqueName(UNTITLED, ['Orders'])).toBe('Untitled canvas');
  });

  it('adds a number from 2 when the name is taken, and the first number that is free', () => {
    expect(uniqueName(UNTITLED, ['Untitled canvas'])).toBe('Untitled canvas 2');
    expect(uniqueName(UNTITLED, ['Untitled canvas', 'Untitled canvas 2'])).toBe('Untitled canvas 3');
    expect(uniqueName(UNTITLED, ['Untitled canvas', 'Untitled canvas 3'])).toBe('Untitled canvas 2');
  });

  it('takes the names from any iterable, once', () => {
    function* taken() {
      yield 'Untitled canvas';
      yield 'Untitled canvas 2';
    }

    expect(uniqueName(UNTITLED, taken())).toBe('Untitled canvas 3');
    expect(uniqueName(UNTITLED, new Set(['Untitled canvas']))).toBe('Untitled canvas 2');
  });

  it('is a name that nobody has and that begins with the one it was given, for any names', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('A', 'A 2', 'A 3', 'A 4', 'B'), { maxLength: 6 }), (taken) => {
        const name = uniqueName('A', taken);

        expect(taken).not.toContain(name);
        expect(name.startsWith('A')).toBe(true);
      }),
    );
  });
});

describe('copyName (ADR-0072)', () => {
  it('is the name and "(copy)" when nobody has that', () => {
    expect(copyName('Orders', ['Orders'])).toBe('Orders (copy)');
  });

  it('counts the copies from 2, and takes the first number that is free', () => {
    expect(copyName('Orders', ['Orders', 'Orders (copy)'])).toBe('Orders (copy 2)');
    expect(copyName('Orders', ['Orders (copy)', 'Orders (copy 2)'])).toBe('Orders (copy 3)');
    expect(copyName('Orders', ['Orders (copy)', 'Orders (copy 3)'])).toBe('Orders (copy 2)');
  });

  it('cuts a name that is too long so that the whole stays inside the cap, and still tells the copies apart', () => {
    const name = 'x'.repeat(SIZE_CAPS.name);

    const first = copyName(name, [name]);
    const second = copyName(name, [name, first]);

    expect(first).toHaveLength(SIZE_CAPS.name);
    expect(first.endsWith(' (copy)')).toBe(true);
    expect(second).toHaveLength(SIZE_CAPS.name);
    expect(second.endsWith(' (copy 2)')).toBe(true);
    expect(second).not.toBe(first);
  });

  it('keeps a name whole when the whole fits to the last character', () => {
    const name = 'x'.repeat(SIZE_CAPS.name - ' (copy)'.length);

    expect(copyName(name, [])).toBe(`${name} (copy)`);
    expect(copyName(`${name}x`, [])).toBe(`${name} (copy)`);
  });

  it('is a name that nobody has and that is within the cap, for any names', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: SIZE_CAPS.name }), fc.nat(5), (name, others) => {
        const taken = new Set<string>([name]);
        for (let count = 0; count <= others; count += 1) {
          const copy = copyName(name, taken);

          expect(taken.has(copy)).toBe(false);
          expect(copy.length).toBeLessThanOrEqual(SIZE_CAPS.name);
          taken.add(copy);
        }
      }),
    );
  });
});

describe('slug (ADR-0075)', () => {
  it.each([
    ['Orders flow', 'orders-flow'],
    ['  Orders   flow  ', 'orders-flow'],
    ['A/B:C?"D"', 'a-b-c-d'],
    ['..\\..\\evil', 'evil'],
    ['Café société', 'café-société'],
    ['日本語 キャンバス', '日本語-キャンバス'],
    ['Canvas 2', 'canvas-2'],
    ['', 'canvas'],
    ['   ', 'canvas'],
    ['***', 'canvas'],
    ['😀', 'canvas'],
  ])('writes %j as %j', (name, expected) => {
    expect(slug(name)).toBe(expected);
  });

  it('keeps at most 60 characters, and no hyphen at the end of what it keeps', () => {
    expect(slug('a'.repeat(100))).toBe('a'.repeat(60));
    expect(slug(`${'a'.repeat(59)} b`)).toBe('a'.repeat(59));
    expect(slug(`${'a'.repeat(60)}b`)).toBe('a'.repeat(60));
  });

  it('does not cut a character in half', () => {
    const name = `${'a'.repeat(59)}𠀀 and more`;

    const text = slug(name);

    expect(Array.from(text)).toHaveLength(60);
    expect(text).toBe(`${'a'.repeat(59)}𠀀`);
  });

  it('is only letters, digits and hyphens, never begins or ends with a hyphen, and is never empty, for any name', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (name) => {
        const text = slug(name);

        expect(text).toMatch(/^[\p{L}\p{N}]+(-[\p{L}\p{N}]+)*$/u);
        expect(Array.from(text).length).toBeLessThanOrEqual(60);
      }),
    );
  });
});

describe('file names (ADR-0075)', () => {
  it('ends the file of a canvas in .rmq.json', () => {
    expect(canvasFileName('Orders flow')).toBe('orders-flow.rmq.json');
    expect(canvasFileName('')).toBe('canvas.rmq.json');
  });

  it('names a backup by the day that it was made, as the learner counts days', () => {
    expect(backupFileName(new Date(2026, 9, 8, 23, 59, 59).getTime())).toBe('rmq-playground-backup-2026-10-08.json');
    expect(backupFileName(new Date(2026, 0, 5, 0, 0, 1).getTime())).toBe('rmq-playground-backup-2026-01-05.json');
    expect(backupFileName(new Date(2026, 11, 31, 12).getTime())).toBe('rmq-playground-backup-2026-12-31.json');
  });
});
