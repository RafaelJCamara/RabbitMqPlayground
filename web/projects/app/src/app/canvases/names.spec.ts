import { SIZE_CAPS } from '@rmq/persistence';
import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { copyName, nameProblem, UNTITLED, uniqueName } from './names';

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

describe('nameProblem (ADR-0028)', () => {
  it.each(['', ' ', '   ', '\t', '\n \r\n'])('refuses %j, which has nothing in it, and says what to do', (name) => {
    expect(nameProblem(name)).toBe('A canvas needs a name, and this one is blank. Type a name.');
  });

  it('accepts a name that has something in it, with white space round it or inside it', () => {
    expect(nameProblem('a')).toBeNull();
    expect(nameProblem('  Orders flow  ')).toBeNull();
    expect(nameProblem('日本語')).toBeNull();
  });

  it('accepts a name of exactly the longest length, and refuses one character more, with the number of them', () => {
    expect(nameProblem('x'.repeat(SIZE_CAPS.name))).toBeNull();
    expect(nameProblem('x'.repeat(SIZE_CAPS.name + 1))).toBe(
      'The name has 201 characters, and a name can have at most 200. Shorten the name.',
    );
  });

  it('counts characters as the persistence library does, so that a name it accepts is a name it keeps', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 260 }), (name) => {
        expect(nameProblem(name) === null).toBe(/\S/.test(name) && name.length <= SIZE_CAPS.name);
      }),
    );
  });
});
