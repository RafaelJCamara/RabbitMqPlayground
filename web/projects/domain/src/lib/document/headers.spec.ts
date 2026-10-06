import { headerValueIssue, type HeaderArguments, type HeaderCondition } from '@rmq/engine';
import { bool, deepFreeze, entry, exists, float, headerArguments, int, str } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import {
  bindingHeadersIssue,
  bindingSignature,
  canonicalHeaders,
  HEADER_KEY_MAX_BYTES,
  headerKeyIssue,
  headerValueProblem,
  messageHeadersIssue,
  X_MATCH,
} from './headers';

describe('headerKeyIssue', () => {
  it('is 255 bytes, because AMQP writes the name of a header as a short string', () => {
    expect(HEADER_KEY_MAX_BYTES).toBe(255);
  });

  it('accepts an ordinary name, one of 255 bytes, and an x- name', () => {
    expect(headerKeyIssue('format')).toBeNull();
    expect(headerKeyIssue('x-retry')).toBeNull();
    expect(headerKeyIssue('a'.repeat(255))).toBeNull();
    expect(headerKeyIssue(`${'é'.repeat(127)}a`)).toBeNull();
  });

  it('refuses no name, and says that a header needs one', () => {
    expect(headerKeyIssue('')).toEqual({ kind: 'header', message: 'A header needs a name.' });
  });

  it('refuses a name of more than 255 bytes, counted in bytes, and says how long it is', () => {
    expect(headerKeyIssue('a'.repeat(256))).toMatchObject({ kind: 'header' });
    expect(headerKeyIssue('é'.repeat(128))?.message).toContain('is 256');
    expect(headerKeyIssue('é'.repeat(128))?.message).toContain('at most 255 bytes');
  });
});

describe('headerValueProblem', () => {
  it('accepts every kind of value that the engine accepts, and a condition that only asks for the header', () => {
    for (const value of [str(''), str('1'), int(0), int(Number.MAX_SAFE_INTEGER), float(1.5), bool(false), exists]) {
      expect(headerValueProblem('k', value), JSON.stringify(value)).toBeNull();
    }
  });

  it('gives the engine’s reason for a value that cannot be exact, and names the header (ADR-0023)', () => {
    const unsafe = int(Number.MAX_SAFE_INTEGER + 2);
    const problem = headerValueProblem('count', unsafe);

    expect(problem).toEqual({ kind: 'header', message: `The header 'count': ${headerValueIssue(unsafe)}.` });
    expect(headerValueProblem('count', int(1.5))?.message).toContain("The header 'count'");
    expect(headerValueProblem('ratio', float(Number.NaN))?.message).toBe(
      "The header 'ratio': A float header must be a finite number.",
    );
    expect(headerValueProblem('ratio', float(Number.POSITIVE_INFINITY))).not.toBeNull();
  });
});

describe('messageHeadersIssue', () => {
  it('accepts no headers, and headers with distinct names, whatever the names', () => {
    expect(messageHeadersIssue([])).toBeNull();
    expect(messageHeadersIssue([entry('a', str('1')), entry('b', int(1)), entry(X_MATCH, str('all'))])).toBeNull();
  });

  it('refuses a name that is empty or too long, and a value that cannot be exact, whichever comes first', () => {
    expect(messageHeadersIssue([entry('', str('1'))])?.message).toBe('A header needs a name.');
    expect(messageHeadersIssue([entry('a'.repeat(256), str('1'))])?.kind).toBe('header');
    expect(messageHeadersIssue([entry('a', str('1')), entry('b', int(2 ** 53))])?.message).toContain("The header 'b'");
  });

  it('refuses a name that appears twice, because a table of headers has each name once', () => {
    expect(messageHeadersIssue([entry('a', str('1')), entry('b', str('1')), entry('a', int(2))])).toEqual({
      kind: 'header',
      message: "The header 'a' is there twice. A table of headers has each name once, so give it one value.",
    });
  });

  it('finds the first problem in the order of the headers', () => {
    expect(messageHeadersIssue([entry('a', int(2 ** 53)), entry('', str('1'))])?.message).toContain("The header 'a'");
  });
});

describe('bindingHeadersIssue', () => {
  it('accepts the arguments of a binding: any mode, any conditions, and x- names that a mode may ignore', () => {
    expect(bindingHeadersIssue(headerArguments(null))).toBeNull();
    expect(
      bindingHeadersIssue(headerArguments('any', entry('a', str('1')), entry('b', exists), entry('x-c', int(1)))),
    ).toBeNull();
  });

  it('refuses a condition called x-match, which would be a second mode, and says how to write the mode', () => {
    const issue = bindingHeadersIssue(headerArguments('all', entry('a', str('1')), entry(X_MATCH, str('any'))));

    expect(issue?.kind).toBe('header');
    expect(issue?.message).toContain("'x-match' is the mode of a headers binding");
    expect(issue?.message).toContain('x-match=any');
  });

  it('refuses what a message header may not be either: an empty name, a repeat, a value that cannot be exact', () => {
    expect(bindingHeadersIssue(headerArguments('all', entry('', exists)))?.message).toBe('A header needs a name.');
    expect(bindingHeadersIssue(headerArguments('all', entry('a', exists), entry('a', str('1'))))?.message).toContain(
      'twice',
    );
    expect(bindingHeadersIssue(headerArguments('all', entry('a', int(2 ** 53))))?.message).toContain("The header 'a'");
  });
});

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
