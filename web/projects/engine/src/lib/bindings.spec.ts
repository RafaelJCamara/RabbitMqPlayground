import { bool, deepFreeze, entry, exists, float, headerArguments, int, str } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { bindingSignature, canonicalHeaders } from './bindings';
import type { HeaderArguments, HeaderCondition } from './headers';

describe('canonicalHeaders', () => {
  it('says that a binding with no x-match and no conditions has no arguments', () => {
    expect(canonicalHeaders(undefined)).toBeUndefined();
    expect(canonicalHeaders(headerArguments(null))).toBeUndefined();
  });

  it('keeps everything else as it is, including an x-match with no conditions and conditions with no x-match', () => {
    const modeOnly = headerArguments('any');
    const conditionsOnly = headerArguments(null, entry('a', str('1')));

    expect(canonicalHeaders(modeOnly)).toBe(modeOnly);
    expect(canonicalHeaders(conditionsOnly)).toBe(conditionsOnly);
  });
});

describe('bindingSignature', () => {
  const sign = (headers?: HeaderArguments, key = 'k') => bindingSignature('ex', 'queue', 'q', key, headers);
  const args = (...entries: [string, HeaderCondition][]) =>
    headerArguments('all', ...entries.map(([key, value]) => entry(key, value)));

  it('does not depend on the order of the arguments, because a table has none', () => {
    expect(sign(args(['a', str('1')], ['b', exists]))).toBe(sign(args(['b', exists], ['a', str('1')])));
  });

  it('does not depend on the order of any number of arguments, in any of its orders', () => {
    const permutations = <T>(items: readonly T[]): T[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, at) =>
            permutations([...items.slice(0, at), ...items.slice(at + 1)]).map((rest) => [item, ...rest]),
          );
    const entries: [string, HeaderCondition][] = [
      ['a', str('1')],
      ['b', int(2)],
      ['c', exists],
      ['d', bool(true)],
    ];
    const orders = permutations(entries);

    expect(orders).toHaveLength(24);
    expect(new Set(orders.map((order) => sign(args(...order)))).size).toBe(1);
  });

  it('is the same for no arguments and for an empty list with no x-match', () => {
    expect(sign(undefined)).toBe(sign(headerArguments(null)));
    expect(sign(undefined)).not.toBe(sign(headerArguments('all')));
  });

  it('tells apart everything that a broker tells apart', () => {
    const base = args(['a', str('1')]);
    const signatures = new Set([
      sign(base),
      sign({ ...base, xMatch: 'any' }),
      sign({ ...base, xMatch: null }),
      sign(args(['a', int(1)])),
      sign(args(['a', float(1)])),
      sign(args(['a', bool(true)])),
      sign(args(['a', str('2')])),
      sign(args(['a', exists])),
      sign(args(['b', str('1')])),
      sign(args(['a', str('1')], ['b', str('1')])),
      sign(base, 'other'),
      sign(undefined),
      bindingSignature('other', 'queue', 'q', 'k', base),
      bindingSignature('ex', 'exchange', 'q', 'k', base),
      bindingSignature('ex', 'queue', 'other', 'k', base),
    ]);

    expect(signatures.size).toBe(15);
  });

  it('keeps a string, an integer, a float and a boolean that look alike apart: "1", 1, 1.0 and true', () => {
    const signatures = [str('1'), int(1), float(1), bool(true), str('true')].map((value) => sign(args(['a', value])));

    expect(new Set(signatures).size).toBe(5);
  });

  it('does not change what it is given', () => {
    const frozen = deepFreeze(args(['b', str('1')], ['a', str('2')]));

    expect(() => sign(frozen)).not.toThrow();
    expect(frozen.args.map(({ key }) => key)).toEqual(['b', 'a']);
  });
});
