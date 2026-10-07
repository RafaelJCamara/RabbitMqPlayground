import { matchHeaders, type HeaderArguments, type HeaderEntry, type HeaderValue } from '@rmq/engine';
import { bool, entry, exists, float, headerArguments, int, str } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import {
  conditionLine,
  countedLine,
  describeHeaders,
  headersWords,
  ignoredLine,
  ignoredNote,
  modeText,
  nothingCountsText,
} from './headers-words';
import { SHORT_MOST } from './words';

const judged = (binding: HeaderArguments | undefined, ...headers: HeaderEntry<HeaderValue>[]) =>
  headersWords(matchHeaders(binding, headers));

describe('what a headers binding says of a message (ADR-0009, ADR-0060)', () => {
  it('says, for each condition, whether it holds and why not: missing, a value that differs, a type that differs', () => {
    const lines = judged(
      headerArguments(
        'all',
        entry('format', str('pdf')),
        entry('n', int(1)),
        entry('v', str('1')),
        entry('seen', exists),
      ),
      entry('format', str('doc')),
      entry('n', float(1)),
      entry('v', int(1)),
    ).conditions;

    expect(lines.map(({ key, wanted, found, outcome }) => ({ key, wanted, found, outcome }))).toEqual([
      { key: 'format', wanted: '"pdf"', found: '"doc"', outcome: 'fail' },
      { key: 'n', wanted: '1', found: '1.0', outcome: 'fail' },
      { key: 'v', wanted: '"1"', found: '1', outcome: 'fail' },
      { key: 'seen', wanted: 'exists', found: null, outcome: 'fail' },
    ]);
    expect(lines.map(({ text }) => text)).toEqual([
      'The header format is "doc", and the binding asks for "pdf".',
      'The header n is 1.0, a float, and the binding asks for 1, an integer: values of different types are never equal.',
      'The header v is 1, an integer, and the binding asks for "1", a string: values of different types are never equal.',
      'The header seen is missing from the message.',
    ]);
  });

  it('says what a condition that holds found, and that an exists condition only asks for the header to be there', () => {
    const lines = judged(
      headerArguments('all', entry('format', str('pdf')), entry('seen', exists), entry('ok', bool(true))),
      entry('format', str('pdf')),
      entry('seen', int(7)),
      entry('ok', bool(true)),
    ).conditions;

    expect(lines.map(({ text }) => text)).toEqual([
      'The header format is "pdf", as the binding asks.',
      'The header seen is there, as the binding asks.',
      'The header ok is true, as the binding asks.',
    ]);
    expect(lines.map(({ outcome }) => outcome)).toEqual(['pass', 'pass', 'pass']);
  });

  it('says that an argument that starts with x- is not counted, unless the mode counts it', () => {
    const line = conditionLine(matchHeaders(headerArguments('all', entry('x-trace', str('1'))), []).conditions[0]!);

    expect(line).toEqual({
      key: 'x-trace',
      wanted: '"1"',
      found: null,
      outcome: 'ignored',
      text: 'The header x-trace is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x.',
    });
    expect(
      conditionLine(matchHeaders(headerArguments('all-with-x', entry('x-trace', str('1'))), []).conditions[0]!).outcome,
    ).toBe('fail');
  });

  it('writes the name of a header in quotes when it could be read as something else', () => {
    const line = judged(headerArguments('all', entry('a b', str('x'))), entry('a b', str('y'))).conditions[0];

    expect(line?.text).toBe('The header "a b" is "y", and the binding asks for "x".');
  });

  it.each<[string, HeaderArguments | undefined, HeaderEntry<HeaderValue>[], string, string]>([
    [
      'all hold',
      headerArguments('all', entry('a', str('1')), entry('b', int(2))),
      [entry('a', str('1')), entry('b', int(2))],
      'x-match=all: all 2 conditions hold.',
      '2 of 2 hold',
    ],
    [
      'the one condition holds',
      headerArguments('all', entry('a', str('1'))),
      [entry('a', str('1'))],
      'x-match=all: its one condition holds.',
      '1 of 1 hold',
    ],
    [
      'one of any holds',
      headerArguments('any', entry('a', str('1')), entry('b', int(2))),
      [entry('b', int(2))],
      'x-match=any: b holds, and one is enough.',
      '1 of 2 hold',
    ],
    [
      'two of any hold',
      headerArguments('any', entry('a', str('1')), entry('b', int(2)), entry('c', int(3))),
      [entry('a', str('1')), entry('c', int(3))],
      'x-match=any: a and c hold, and one is enough.',
      '2 of 3 hold',
    ],
    [
      'one of all fails',
      headerArguments('all', entry('a', str('1')), entry('b', int(2))),
      [entry('a', str('1'))],
      'x-match=all: every condition has to hold, and b does not.',
      '1 of 2 hold, all needed',
    ],
    [
      'two of all fail',
      headerArguments('all', entry('a', str('1')), entry('b', int(2)), entry('c', int(3))),
      [entry('a', str('1'))],
      'x-match=all: every condition has to hold, and b and c do not.',
      '1 of 3 hold, all needed',
    ],
    [
      'none of any holds',
      headerArguments('any', entry('a', str('1')), entry('b', int(2))),
      [],
      'x-match=any: at least one condition has to hold, and none of the 2 does.',
      'none of 2 hold',
    ],
    [
      'the one condition of any fails',
      headerArguments('any', entry('a', str('1'))),
      [],
      'x-match=any: at least one condition has to hold, and the one that counts does not.',
      'none of 1 hold',
    ],
    [
      'the mode is left out',
      headerArguments(null, entry('a', str('1'))),
      [entry('a', str('1'))],
      'x-match=all (left out, so all): its one condition holds.',
      '1 of 1 hold',
    ],
    [
      'nothing counts under all',
      headerArguments('all'),
      [entry('a', str('1'))],
      'x-match=all and no condition counts, so it matches every message.',
      'no conditions: matches all',
    ],
    [
      'nothing counts under any',
      headerArguments('any'),
      [entry('a', str('1'))],
      'x-match=any and no condition counts, so it matches no message.',
      'no conditions: matches none',
    ],
    [
      'a binding with no arguments at all',
      undefined,
      [],
      'x-match=all (left out, so all) and no condition counts, so it matches every message.',
      'no conditions: matches all',
    ],
    [
      'only an x- argument under all',
      headerArguments('all', entry('x-a', str('1'))),
      [],
      'x-match=all and no condition counts, so it matches every message. 1 argument starts with "x-" and is not counted.',
      'no conditions: matches all',
    ],
    [
      'an x- argument next to one that counts',
      headerArguments('any', entry('x-a', str('1')), entry('b', int(2)), entry('x-c', int(3))),
      [entry('b', int(2))],
      'x-match=any: b holds, and one is enough. 2 arguments start with "x-" and are not counted.',
      '1 of 1 hold',
    ],
  ])('says it when %s', (_name, binding, headers, text, short) => {
    expect(judged(binding, ...headers)).toMatchObject({ text, short });
  });

  it('keeps every short reason within the room that an edge has', () => {
    const many = headerArguments('any', ...Array.from({ length: 12 }, (_, index) => entry(`h${index}`, int(index))));

    expect([...judged(many).short].length).toBeLessThanOrEqual(SHORT_MOST);
  });
});

describe('the pieces that the sentences of a binding share (ADR-0068)', () => {
  it('says the mode, and that a mode that was left out is all', () => {
    expect(modeText('any', false)).toBe('x-match=any');
    expect(modeText('all', true)).toBe('x-match=all (left out, so all)');
  });

  it('says how many arguments are not counted, for one and for many, and nothing for none', () => {
    expect(ignoredNote(0)).toBe('');
    expect(ignoredNote(1)).toBe(' 1 argument starts with "x-" and is not counted.');
    expect(ignoredNote(3)).toBe(' 3 arguments start with "x-" and are not counted.');
  });

  it('says that nothing counts, and what that makes of every message', () => {
    expect(nothingCountsText('x-match=all', 'all', '')).toBe(
      'x-match=all and no condition counts, so it matches every message.',
    );
    expect(nothingCountsText('x-match=any', 'any', ' Note.')).toBe(
      'x-match=any and no condition counts, so it matches no message. Note.',
    );
  });

  it('says a condition that is not counted, and one that is, with the name quoted when it has to be', () => {
    expect(ignoredLine('x-a')).toBe(
      'The header x-a is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x.',
    );
    expect(ignoredLine('x a')).toContain('The header "x a" is not counted');
    expect(countedLine('x-a', 'any-with-x')).toBe('The header x-a is counted, because x-match is any-with-x.');
    expect(conditionLine(matchHeaders(headerArguments('all', entry('x-a', str('1'))), []).conditions[0]!).text).toBe(
      ignoredLine('x-a'),
    );
  });
});

describe('what a binding asks (ADR-0068)', () => {
  it.each<[string, HeaderArguments | undefined, string]>([
    [
      'all of two',
      headerArguments('all', entry('format', str('pdf')), entry('type', str('report'))),
      'x-match=all: a message matches when all 2 conditions hold (format and type).',
    ],
    [
      'any of three',
      headerArguments('any', entry('a', int(1)), entry('b', int(2)), entry('c', int(3))),
      'x-match=any: a message matches when at least one of the 3 conditions holds (a, b and c).',
    ],
    [
      'one condition, whatever the mode',
      headerArguments('any', entry('a', int(1))),
      'x-match=any: a message matches when its one condition holds (a).',
    ],
    [
      'a mode that is left out',
      headerArguments(null, entry('a', int(1)), entry('b', exists)),
      'x-match=all (left out, so all): a message matches when all 2 conditions hold (a and b).',
    ],
    [
      'a name that needs quotes',
      headerArguments('all', entry('a b', int(1)), entry('c', int(1))),
      'x-match=all: a message matches when all 2 conditions hold ("a b" and c).',
    ],
    [
      'an x- argument that is not counted',
      headerArguments('all', entry('x-a', int(1)), entry('b', int(1))),
      'x-match=all: a message matches when its one condition holds (b). 1 argument starts with "x-" and is not counted.',
    ],
    [
      'an x- argument that is counted',
      headerArguments('all-with-x', entry('x-a', int(1)), entry('b', int(1))),
      'x-match=all-with-x: a message matches when all 2 conditions hold (x-a and b).',
    ],
    [
      'nothing that counts under all',
      headerArguments('all', entry('x-a', int(1)), entry('x-b', int(1))),
      'x-match=all and no condition counts, so it matches every message. 2 arguments start with "x-" and are not counted.',
    ],
    [
      'nothing that counts under any',
      headerArguments('any'),
      'x-match=any and no condition counts, so it matches no message.',
    ],
    [
      'no arguments at all',
      undefined,
      'x-match=all (left out, so all) and no condition counts, so it matches every message.',
    ],
  ])('says it for %s', (_name, headers, sentence) => {
    expect(describeHeaders(headers)).toBe(sentence);
  });

  it('says for a binding with nothing that counts what it says of the same binding judging a message', () => {
    for (const headers of [headerArguments('all'), headerArguments('any', entry('x-a', int(1))), undefined]) {
      expect(describeHeaders(headers)).toBe(headersWords(matchHeaders(headers, [entry('a', int(1))])).text);
    }
  });
});
