import { describe, expect, it } from 'vitest';
import {
  headerValueIssue,
  matchHeaders,
  type HeaderArguments,
  type HeaderCondition,
  type HeaderEntry,
  type HeaderValue,
  type XMatch,
} from './headers';

const str = (v: string): HeaderValue => ({ t: 'string', v });
const int = (v: number): HeaderValue => ({ t: 'integer', v });
const float = (v: number): HeaderValue => ({ t: 'float', v });
const bool = (v: boolean): HeaderValue => ({ t: 'boolean', v });
const exists: HeaderCondition = { t: 'exists' };
const entry = <V>(key: string, value: V): HeaderEntry<V> => ({ key, value });
const binding = (xMatch: XMatch | null, ...args: HeaderEntry<HeaderCondition>[]): HeaderArguments => ({ xMatch, args });

describe('headerValueIssue', () => {
  it.each<[string, HeaderCondition]>([
    ['a string', str('')],
    ['an integer', int(0)],
    ['the largest integer that JavaScript can tell from the next', int(Number.MAX_SAFE_INTEGER)],
    ['the smallest', int(Number.MIN_SAFE_INTEGER)],
    ['a negative integer', int(-1)],
    ['a float', float(1.5)],
    ['a float that is a whole number', float(1)],
    ['a boolean', bool(false)],
    ['exists', exists],
  ])('accepts %s', (_name, value) => {
    expect(headerValueIssue(value)).toBeNull();
  });

  it.each<[string, HeaderCondition]>([
    ['an integer one past the largest safe one', int(Number.MAX_SAFE_INTEGER + 1)],
    ['an integer one before the smallest safe one', int(Number.MIN_SAFE_INTEGER - 1)],
    ['an integer that is not whole', int(1.5)],
    ['an integer that is not a number', int(Number.NaN)],
    ['an infinite integer', int(Number.POSITIVE_INFINITY)],
  ])('refuses %s, because a JavaScript number cannot hold an int64 exactly (ADR-0023)', (_name, value) => {
    expect(headerValueIssue(value)).toBe(
      'An integer header must be a whole number from -9007199254740991 to 9007199254740991, because a JavaScript number cannot tell larger ones apart',
    );
  });

  it.each<[string, HeaderCondition]>([
    ['not a number', float(Number.NaN)],
    ['infinity', float(Number.POSITIVE_INFINITY)],
    ['minus infinity', float(Number.NEGATIVE_INFINITY)],
  ])('refuses a float that is %s, because JSON cannot write it', (_name, value) => {
    expect(headerValueIssue(value)).toBe('A float header must be a finite number');
  });
});

describe('matchHeaders: what counts (ADR-0009)', () => {
  it('treats an omitted x-match as all, and says so', () => {
    const match = matchHeaders(binding(null, entry('a', int(1))), [entry('a', int(1))]);

    expect(match).toMatchObject({ xMatch: 'all', omitted: true, requires: 'all', withX: false, matched: true });
  });

  it('treats a binding with no arguments at all as an omitted x-match and nothing to count', () => {
    expect(matchHeaders(undefined, [])).toEqual({
      xMatch: 'all',
      omitted: true,
      requires: 'all',
      withX: false,
      conditions: [],
      counted: 0,
      passed: 0,
      matched: true,
    });
  });

  it.each<[XMatch, 'all' | 'any', boolean]>([
    ['all', 'all', false],
    ['any', 'any', false],
    ['all-with-x', 'all', true],
    ['any-with-x', 'any', true],
  ])('reads x-match=%s as "%s" arguments, with x- keys counted: %s', (xMatch, requires, withX) => {
    expect(matchHeaders(binding(xMatch), [])).toMatchObject({ xMatch, omitted: false, requires, withX });
  });
});

describe('matchHeaders: the four modes', () => {
  // [mode, binding arguments, message headers, matches]. Each row is a rule of ADR-0009.
  type Row = [string, XMatch | null, HeaderEntry<HeaderCondition>[], HeaderEntry<HeaderValue>[], boolean];
  const a1 = entry('a', int(1));
  const b2 = entry('b', int(2));
  const xfoo = entry('x-foo', int(1));

  it.each<Row>([
    ['all: every argument matches', 'all', [a1, b2], [a1, b2], true],
    ['all: one argument is missing', 'all', [a1, b2], [a1], false],
    ['all: one argument differs', 'all', [a1, b2], [a1, entry('b', int(3))], false],
    ['all: the message has more headers than the binding asks about', 'all', [a1], [a1, b2], true],
    ['any: one argument matches', 'any', [a1, b2], [b2], true],
    ['any: no argument matches', 'any', [a1, b2], [entry('a', int(2)), entry('b', int(3))], false],
    ['any: every argument matches', 'any', [a1, b2], [a1, b2], true],
    ['all: an x- argument is ignored, so it does not have to match', 'all', [a1, xfoo], [a1], true],
    ['any: an x- argument is ignored, so it cannot make a match', 'any', [a1, xfoo], [xfoo], false],
    ['all-with-x: an x- argument counts, and is missing', 'all-with-x', [a1, xfoo], [a1], false],
    ['all-with-x: an x- argument counts, and matches', 'all-with-x', [a1, xfoo], [a1, xfoo], true],
    ['any-with-x: an x- argument can make a match alone', 'any-with-x', [a1, xfoo], [xfoo], true],
    ['any-with-x: nothing matches', 'any-with-x', [a1, xfoo], [entry('x-foo', int(2))], false],
    ['omitted: acts as all', null, [a1, b2], [a1], false],
    ['omitted: acts as all, and matches', null, [a1, b2], [a1, b2], true],
  ])('%s', (_name, xMatch, args, headers, matches) => {
    expect(matchHeaders(binding(xMatch, ...args), headers).matched).toBe(matches);
  });

  it.each<[string, XMatch | null, boolean]>([
    ['all', 'all', true],
    ['omitted', null, true],
    ['all-with-x', 'all-with-x', true],
    ['any', 'any', false],
    ['any-with-x', 'any-with-x', false],
  ])('with nothing to count, %s matches every message: %s', (_name, xMatch, matches) => {
    for (const headers of [[], [entry('a', int(1))]]) {
      expect(matchHeaders(binding(xMatch), headers)).toMatchObject({ counted: 0, passed: 0, matched: matches });
    }
  });

  it.each<[string, XMatch | null, boolean]>([
    ['all', 'all', true],
    ['omitted', null, true],
    ['any', 'any', false],
  ])('with only x- arguments, %s has nothing to count and matches: %s', (_name, xMatch, matches) => {
    const match = matchHeaders(binding(xMatch, xfoo, entry('x-bar', str('1'))), []);

    expect(match).toMatchObject({ counted: 0, passed: 0, matched: matches });
    expect(match.conditions.map((condition) => condition.outcome)).toEqual(['ignored', 'ignored']);
  });

  it.each<[string, XMatch, boolean]>([
    ['all-with-x', 'all-with-x', false],
    ['any-with-x', 'any-with-x', false],
  ])(
    'with only x- arguments, %s counts them, so a message without them does not match: %s',
    (_name, xMatch, matches) => {
      expect(matchHeaders(binding(xMatch, xfoo), [])).toMatchObject({ counted: 1, passed: 0, matched: matches });
    },
  );
});

describe('matchHeaders: how values compare (ADR-0009)', () => {
  const matches = (expected: HeaderCondition, actual: HeaderValue) =>
    matchHeaders(binding('all', entry('n', expected)), [entry('n', actual)]).matched;

  it.each<[string, HeaderCondition, HeaderValue, boolean]>([
    ['the same string', str('1'), str('1'), true],
    ['another string', str('1'), str('2'), false],
    ['strings of different case', str('a'), str('A'), false],
    ['the empty string and another', str(''), str(' '), false],
    ['the same integer', int(1), int(1), true],
    ['another integer', int(1), int(2), false],
    ['a negative integer', int(-1), int(-1), true],
    ['an integer and its negative', int(1), int(-1), false],
    ['the same float', float(1.5), float(1.5), true],
    ['another float', float(1.5), float(2.5), false],
    ['a float and a whole float that are equal', float(1), float(1), true],
    ['an integer and a float of the same value: 1 is not 1.0', int(1), float(1), false],
    ['a float and an integer of the same value: 1.0 is not 1', float(1), int(1), false],
    ['zero and a float zero', int(0), float(0), false],
    ['a string and a number: "1" is not 1', str('1'), int(1), false],
    ['a number and a string', int(1), str('1'), false],
    ['a string and a float: "1.0" is not 1.0', str('1.0'), float(1), false],
    ['true and true', bool(true), bool(true), true],
    ['true and false', bool(true), bool(false), false],
    ['true and the integer 1', bool(true), int(1), false],
    ['false and the integer 0', bool(false), int(0), false],
    ['false and a float zero', bool(false), float(0), false],
    ['true and the string "true"', bool(true), str('true'), false],
    ['the string "true" and true', str('true'), bool(true), false],
    ['the integer 1 and true', int(1), bool(true), false],
    ['exists and a string', exists, str('x'), true],
    ['exists and an integer', exists, int(0), true],
    ['exists and a float', exists, float(0), true],
    ['exists and a boolean that is false', exists, bool(false), true],
    ['exists and the empty string', exists, str(''), true],
  ])('%s', (_name, expected, actual, result) => {
    expect(matches(expected, actual)).toBe(result);
  });
});

describe('matchHeaders: the result for every argument', () => {
  it('says, for each argument, whether it passed, and why not: missing, value differs, or type differs', () => {
    const match = matchHeaders(
      binding(
        'all',
        entry('present', int(1)),
        entry('missing', int(1)),
        entry('other', int(1)),
        entry('wrong-type', int(1)),
        entry('also-wrong-type', str('1')),
      ),
      [
        entry('present', int(1)),
        entry('other', int(2)),
        entry('wrong-type', float(1)),
        entry('also-wrong-type', int(1)),
      ],
    );

    expect(match.conditions).toEqual([
      { key: 'present', expected: int(1), actual: int(1), outcome: 'pass' },
      { key: 'missing', expected: int(1), outcome: 'fail', reason: 'missing' },
      { key: 'other', expected: int(1), actual: int(2), outcome: 'fail', reason: 'value-differs' },
      { key: 'wrong-type', expected: int(1), actual: float(1), outcome: 'fail', reason: 'type-differs' },
      { key: 'also-wrong-type', expected: str('1'), actual: int(1), outcome: 'fail', reason: 'type-differs' },
    ]);
    expect(match).toMatchObject({ counted: 5, passed: 1, matched: false });
  });

  it('evaluates every argument, even after the outcome is known, so that an explanation can show them all', () => {
    const all = matchHeaders(binding('all', entry('a', int(1)), entry('b', int(1)), entry('c', int(1))), [
      entry('a', int(2)),
      entry('c', int(1)),
    ]);
    const any = matchHeaders(binding('any', entry('a', int(1)), entry('b', int(1)), entry('c', int(1))), [
      entry('a', int(1)),
      entry('c', int(1)),
    ]);

    expect(all.conditions.map((condition) => condition.outcome)).toEqual(['fail', 'fail', 'pass']);
    expect(any.conditions.map((condition) => condition.outcome)).toEqual(['pass', 'fail', 'pass']);
    expect(any).toMatchObject({ counted: 3, passed: 2, matched: true });
  });

  it('marks an exists argument as passed when the key is there and missing when it is not', () => {
    const match = matchHeaders(binding('all', entry('there', exists), entry('gone', exists)), [
      entry('there', str('')),
    ]);

    expect(match.conditions).toEqual([
      { key: 'there', expected: exists, actual: str(''), outcome: 'pass' },
      { key: 'gone', expected: exists, outcome: 'fail', reason: 'missing' },
    ]);
  });

  it('ignores only a key that starts with x- and not one that merely starts with x', () => {
    const match = matchHeaders(binding('all', entry('xylophone', int(1)), entry('x', int(1))), []);

    expect(match.conditions.map((condition) => condition.outcome)).toEqual(['fail', 'fail']);
    expect(match).toMatchObject({ counted: 2, matched: false });
  });

  it('marks an x- argument as ignored, with what the message had, and does not count it', () => {
    const match = matchHeaders(binding('all', entry('x-note', str('a')), entry('a', int(1))), [
      entry('x-note', str('b')),
      entry('a', int(1)),
    ]);

    expect(match.conditions).toEqual([
      { key: 'x-note', expected: str('a'), actual: str('b'), outcome: 'ignored' },
      { key: 'a', expected: int(1), actual: int(1), outcome: 'pass' },
    ]);
    expect(match).toMatchObject({ counted: 1, passed: 1 });
  });

  it('counts an x- argument when the mode is a with-x mode', () => {
    const match = matchHeaders(binding('any-with-x', entry('x-note', str('a'))), [entry('x-note', str('a'))]);

    expect(match.conditions).toEqual([{ key: 'x-note', expected: str('a'), actual: str('a'), outcome: 'pass' }]);
    expect(match).toMatchObject({ counted: 1, passed: 1, matched: true });
  });

  it('compares a key exactly: case and spaces count, and the key x-match is only a key like any other', () => {
    const match = matchHeaders(binding('all', entry('A', int(1))), [entry('a', int(1)), entry('A ', int(1))]);

    expect(match.conditions).toEqual([{ key: 'A', expected: int(1), outcome: 'fail', reason: 'missing' }]);
  });

  it('uses the first header of a key when a message repeats it, so that the result does not depend on anything else', () => {
    const headers = [entry('a', int(1)), entry('a', int(2))];

    expect(matchHeaders(binding('all', entry('a', int(1))), headers).matched).toBe(true);
    expect(matchHeaders(binding('all', entry('a', int(2))), headers).matched).toBe(false);
  });

  it('can be written as JSON and read back as it was, which the trace needs', () => {
    const match = matchHeaders(binding('any-with-x', entry('x-a', exists), entry('b', int(1)), entry('c', str('x'))), [
      entry('b', float(1)),
    ]);

    expect(JSON.parse(JSON.stringify(match))).toEqual(match);
    expect(
      Object.values(match.conditions).every((condition) => Object.values(condition).every((v) => v !== undefined)),
    ).toBe(true);
  });
});
