import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { editDistance, suggest } from './suggest';

describe('editDistance', () => {
  it.each<[string, string, number]>([
    ['', '', 0],
    ['abc', 'abc', 0],
    ['abc', '', 3],
    ['', 'abc', 3],
    ['abc', 'abd', 1],
    ['abc', 'ab', 1],
    ['abc', 'abcd', 1],
    ['abc', 'acb', 1],
    ['ab', 'ba', 1],
    ['kitten', 'sitting', 3],
    ['bnd', 'bind', 1],
    ['exchage', 'exchange', 1],
    ['subcribe', 'subscribe', 1],
    ['declare', 'declre', 1],
    ['abc', 'xyz', 3],
    ['ca', 'abc', 3],
  ])('is the number of edits between %j and %j: %i', (a, b, edits) => {
    expect(editDistance(a, b)).toBe(edits);
  });

  it('does not care about case', () => {
    expect(editDistance('Orders', 'orders')).toBe(0);
    expect(editDistance('ORDERS', 'ordres')).toBe(1);
  });

  it('counts a character outside the basic plane as one', () => {
    expect(editDistance('a😀b', 'a😁b')).toBe(1);
    expect(editDistance('😀', '')).toBe(1);
  });

  it('is symmetric, zero only for texts that are the same but for case, and at most the longer length', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), fc.string({ maxLength: 12 }), (a, b) => {
        expect(editDistance(a, b)).toBe(editDistance(b, a));
        expect(editDistance(a, a)).toBe(0);
        expect(editDistance(a, b)).toBeLessThanOrEqual(Math.max([...a].length, [...b].length));
        expect(editDistance(a, b) === 0).toBe(a.toLowerCase() === b.toLowerCase());
      }),
    );
  });

  it('obeys the triangle inequality when no swap is involved, as far as one extra edit', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 }), fc.string({ maxLength: 8 }), (a, b, c) => {
        expect(editDistance(a, c)).toBeLessThanOrEqual(editDistance(a, b) + editDistance(b, c) + 1);
      }),
    );
  });
});

describe('suggest', () => {
  const verbs = ['bind', 'unbind', 'link', 'unlink', 'subscribe', 'unsubscribe', 'declare', 'delete', 'rename'];

  it('offers the names that are an edit or two away, closest first', () => {
    expect(suggest('bnd', verbs)).toEqual(['bind']);
    expect(suggest('declar', verbs)).toEqual(['declare']);
    expect(suggest('subcribe', verbs)).toEqual(['subscribe']);
    expect(suggest('delet', verbs)).toEqual(['delete']);
    expect(suggest('rename', ['rename', 'renamed'])).toEqual(['renamed']);
  });

  it('offers a swap of two letters', () => {
    // `bind` is two edits from `blnid`, and a word of five letters is allowed one.
    expect(suggest('blnid', ['blind', 'bind'])).toEqual(['blind']);
    expect(suggest('lnik', verbs)).toEqual(['link']);
  });

  it('puts the closest first, and orders the ones that are as close alphabetically', () => {
    expect(suggest('abcd', ['abce', 'abcf', 'abc', 'abcde', 'zzzz'])).toEqual(['abc', 'abcde', 'abce']);
    expect(suggest('abcd', ['abcf', 'abce'])).toEqual(['abce', 'abcf']);
  });

  it('offers at most three, or as many as it is asked for', () => {
    const many = ['order1', 'order2', 'order3', 'order4', 'order5'];

    expect(suggest('order', many)).toEqual(['order1', 'order2', 'order3']);
    expect(suggest('order', many, 2)).toEqual(['order1', 'order2']);
    expect(suggest('order', many, 10)).toHaveLength(5);
    expect(suggest('order', many, 0)).toEqual([]);
  });

  it('offers a name that starts with what was typed, from two characters on, however long it is', () => {
    expect(suggest('bi', ['billing', 'archive'])).toEqual(['billing']);
    expect(suggest('bil', ['billing-events', 'billing', 'bill'])).toEqual(['bill', 'billing', 'billing-events']);
    expect(suggest('b', ['billing'])).toEqual([]);
  });

  it('is blind to case, and offers a name that differs from the input only in case', () => {
    expect(suggest('Orders', ['orders'])).toEqual(['orders']);
    expect(suggest('ORD', ['orders', 'Orders'])).toEqual(['Orders', 'orders']);
  });

  it('does not offer the input itself, or the empty name, or a name twice', () => {
    expect(suggest('bind', verbs)).toEqual([]);
    expect(suggest('bind', ['bind', 'bind', 'bin', 'bin'])).toEqual(['bin']);
    expect(suggest('bin', ['', 'bind'])).toEqual(['bind']);
  });

  it('offers nothing for nothing, and nothing for a word that is far from every name', () => {
    expect(suggest('', verbs)).toEqual([]);
    expect(suggest('zzzzzz', verbs)).toEqual([]);
    expect(suggest('x', ['y', 'z'])).toEqual([]);
    expect(suggest('abc', [])).toEqual([]);
  });

  it('allows more edits to a longer word: none up to two letters, one to five, two to eight, three beyond', () => {
    expect(suggest('ab', ['ac'])).toEqual([]);
    expect(suggest('abc', ['abd'])).toEqual(['abd']);
    expect(suggest('abc', ['axx'])).toEqual([]);
    expect(suggest('abcdef', ['abcdxx'])).toEqual(['abcdxx']);
    expect(suggest('abcdef', ['abcxxx'])).toEqual([]);
    expect(suggest('abcdefghi', ['abcdefgxxx'])).toEqual(['abcdefgxxx']);
    expect(suggest('abcdefghi', ['abcdefxxxx'])).toEqual([]);
    expect(suggest('abcdefghijklmnop', ['abcdefghijklmxxx'])).toEqual(['abcdefghijklmxxx']);
    expect(suggest('abcdefghijklmnop', ['abcdefghijklxxxx'])).toEqual([]);
  });

  it('does not change what it is given', () => {
    const candidates = Object.freeze(['b', 'a', 'ab']);

    expect(() => suggest('aa', candidates)).not.toThrow();
    expect(candidates).toEqual(['b', 'a', 'ab']);
  });

  it('is the same every time, and offers only candidates it was given', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 8 }),
        fc.array(fc.string({ maxLength: 8 }), { maxLength: 10 }),
        (input, candidates) => {
          const found = suggest(input, candidates);

          expect(found).toEqual(suggest(input, candidates));
          expect(found.length).toBeLessThanOrEqual(3);
          for (const name of found) {
            expect(candidates).toContain(name);
            expect(name).not.toBe(input);
          }
        },
      ),
    );
  });
});
