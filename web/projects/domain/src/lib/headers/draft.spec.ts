import type { HeaderArguments, HeaderEntry, HeaderValue, XMatch } from '@rmq/engine';
import { arbHeaderArguments, bool, deepFreeze, entry, exists, float, headerArguments, int, str } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { bindingHeadersIssue, canonicalHeaders, messageHeadersIssue } from '../document/headers';
import { countedLine, ignoredLine } from '../explain/headers-words';
import { formatValue } from '../syntax/values';
import {
  draftFromMessage,
  draftOf,
  EMPTY_ROW,
  isBlank,
  newDraft,
  problemAt,
  reportDraft,
  reportMessageRows,
  retypeRow,
  rowsOf,
  rowType,
  sameEntries,
  withText,
  type DraftRow,
  type HeadersDraft,
} from './draft';

const row = (key: string, text: string, rest: Partial<DraftRow> = {}): DraftRow => ({
  key,
  text,
  exists: false,
  ...rest,
});
const draft = (xMatch: XMatch | null, ...rows: DraftRow[]): HeadersDraft => ({ xMatch, rows });

describe('the draft of a set of headers (ADR-0066)', () => {
  it('starts a binding that is being made with the mode `all`, written out, and one empty row', () => {
    expect(newDraft()).toStrictEqual({ xMatch: 'all', rows: [EMPTY_ROW] });
    expect(isBlank(EMPTY_ROW)).toBe(true);
  });

  it('starts from the arguments of a binding that is there: the mode as it has it, and a row for each condition, in order, with the value as a command writes it', () => {
    const headers = headerArguments(
      'any',
      entry('format', str('pdf')),
      entry('n', int(1)),
      entry('f', float(1)),
      entry('s', str('1')),
      entry('ok', bool(true)),
      entry('seen', exists),
      entry('my key', str('a b')),
    );

    expect(draftOf(headers)).toStrictEqual({
      xMatch: 'any',
      rows: [
        row('format', 'pdf'),
        row('n', '1'),
        row('f', '1.0'),
        row('s', '"1"'),
        row('ok', 'true'),
        row('seen', '', { exists: true }),
        row('my key', '"a b"'),
      ],
    });
  });

  it('starts a binding that has no arguments with the mode left out and no rows', () => {
    expect(draftOf(undefined)).toStrictEqual({ xMatch: null, rows: [] });
    expect(draftOf(headerArguments(null))).toStrictEqual({ xMatch: null, rows: [] });
  });

  it('makes the rows of the headers of a message, and a draft of the ticked ones in the order of the message with the types they have', () => {
    const headers: HeaderEntry<HeaderValue>[] = [
      entry('b', str('1')),
      entry('a', int(1)),
      entry('c', float(1)),
      entry('d', bool(false)),
    ];

    expect(rowsOf(headers)).toStrictEqual([row('b', '"1"'), row('a', '1'), row('c', '1.0'), row('d', 'false')]);
    expect(draftFromMessage(headers, new Set(['c', 'b']))).toStrictEqual({
      xMatch: 'all',
      rows: [row('b', '"1"'), row('c', '1.0')],
    });
    expect(draftFromMessage(headers, new Set(), 'any-with-x')).toStrictEqual({ xMatch: 'any-with-x', rows: [] });
  });

  it('says that a row with a name, a value or *exists* is not blank, and a row with nothing is', () => {
    expect(isBlank(row('', ''))).toBe(true);
    expect(isBlank(row('', '   '))).toBe(true);
    expect(isBlank(row('k', ''))).toBe(false);
    expect(isBlank(row('', '1'))).toBe(false);
    expect(isBlank(row('', '', { exists: true }))).toBe(false);
    expect(isBlank(row('', '', { type: 'integer' }))).toBe(true);
  });
});

describe('the type of a row (ADR-0067)', () => {
  it('is the type of what is typed, *exists* for a row that is one, and what was chosen while nothing is typed', () => {
    expect(rowType(row('k', '1'))).toBe('integer');
    expect(rowType(row('k', '"1"'))).toBe('string');
    expect(rowType(row('k', '1.0'))).toBe('float');
    expect(rowType(row('k', 'true'))).toBe('boolean');
    expect(rowType(row('k', 'pdf'))).toBe('string');
    expect(rowType(row('k', '1', { exists: true }))).toBe('exists');
    expect(rowType(row('k', ''))).toBe('string');
    expect(rowType(row('k', '  ', { type: 'float' }))).toBe('float');
    expect(rowType(row('k', '"abc'))).toBe('string');
  });

  it('is the type of the text, whatever was chosen once something is typed', () => {
    expect(rowType(row('k', '1', { type: 'boolean' }))).toBe('integer');
  });

  it('drops the preference of a type when something is typed', () => {
    expect(withText(row('k', '', { type: 'integer' }), '7')).toStrictEqual(row('k', '7'));
    expect(withText(row('k', 'x', { exists: true }), 'y')).toStrictEqual(row('k', 'y', { exists: true }));
  });

  describe('changed by the control', () => {
    it('rewrites the text so that it says the type', () => {
      expect(retypeRow(row('n', '1'), 'string')).toStrictEqual({ ok: true, value: row('n', '"1"') });
      expect(retypeRow(row('n', '"1"'), 'integer')).toStrictEqual({ ok: true, value: row('n', '1') });
      expect(retypeRow(row('n', '1'), 'float')).toStrictEqual({ ok: true, value: row('n', '1.0') });
      expect(retypeRow(row('n', '"true"'), 'boolean')).toStrictEqual({ ok: true, value: row('n', 'true') });
    });

    it('leaves the row as it was, with a reason, when the change has no meaning', () => {
      const refused = retypeRow(row('n', 'pdf'), 'integer');

      expect(refused.ok).toBe(false);
      expect(refused.ok ? '' : refused.error.message).toMatch(/^"pdf" is not a whole number/u);
    });

    it('keeps a preference when the value is empty, and changes no text', () => {
      expect(retypeRow(row('n', ''), 'integer')).toStrictEqual({ ok: true, value: row('n', '', { type: 'integer' }) });
      expect(retypeRow(row('n', '  ', { type: 'float' }), 'boolean')).toStrictEqual({
        ok: true,
        value: row('n', '  ', { type: 'boolean' }),
      });
    });

    it('takes the value away for *exists* and keeps its text, so that choosing a type gives it back', () => {
      const gone = retypeRow(row('n', '"1"'), 'exists');
      expect(gone).toStrictEqual({ ok: true, value: row('n', '"1"', { exists: true }) });

      const back = retypeRow(gone.ok ? gone.value : EMPTY_ROW, 'string');
      expect(back).toStrictEqual({ ok: true, value: row('n', '"1"') });
    });

    it('starts the value again for a row that leaves *exists* with text that is not that type, because the text was only kept', () => {
      expect(retypeRow(row('n', 'pdf', { exists: true }), 'integer')).toStrictEqual({
        ok: true,
        value: row('n', '', { type: 'integer' }),
      });
      expect(retypeRow(row('n', '', { exists: true }), 'boolean')).toStrictEqual({
        ok: true,
        value: row('n', '', { type: 'boolean' }),
      });
    });

    it('keeps the preference of a row that becomes *exists*', () => {
      expect(retypeRow(row('n', '', { type: 'float' }), 'exists')).toStrictEqual({
        ok: true,
        value: row('n', '', { type: 'float', exists: true }),
      });
    });
  });
});

describe('what a draft says about its rows (ADR-0068)', () => {
  it('has nothing to say about a row that is empty, and leaves it out', () => {
    const report = reportDraft(draft('all', row('', ''), row('format', 'pdf'), EMPTY_ROW));

    expect(report.rows.map(({ blank }) => blank)).toEqual([true, false, true]);
    expect(report.rows[0]).toStrictEqual({
      blank: true,
      type: 'string',
      condition: null,
      keyProblem: null,
      valueProblem: null,
      notes: [],
    });
    expect(report.headers).toStrictEqual(headerArguments('all', entry('format', str('pdf'))));
    expect(report.ok).toBe(true);
    expect(report.problem).toBeNull();
  });

  it('makes a condition of each row that is complete, with the type of what is typed', () => {
    const report = reportDraft(
      draft(
        'any',
        row('s', '"1"'),
        row('n', '1'),
        row('f', '1.0'),
        row('b', 'true'),
        row('p', 'pdf'),
        row('seen', '', { exists: true }),
      ),
    );

    expect(report.headers).toStrictEqual(
      headerArguments(
        'any',
        entry('s', str('1')),
        entry('n', int(1)),
        entry('f', float(1)),
        entry('b', bool(true)),
        entry('p', str('pdf')),
        entry('seen', exists),
      ),
    );
    expect(report.rows.map(({ type }) => type)).toEqual(['string', 'integer', 'float', 'boolean', 'string', 'exists']);
    expect(report.hasExists).toBe(true);
    expect(reportDraft(draft('all', row('a', '1'))).hasExists).toBe(false);
  });

  describe('problems, which stop the commit', () => {
    const problems = (...rows: DraftRow[]) =>
      reportDraft(draft('all', ...rows)).rows.map(({ keyProblem, valueProblem }) => [
        keyProblem?.message ?? null,
        valueProblem?.message ?? null,
      ]);

    it('says that a value needs a name, root cause first', () => {
      expect(problems(row('', '1'))).toEqual([['A header needs a name.', null]]);
      expect(problems(row('', '', { exists: true }))).toEqual([['A header needs a name.', null]]);
    });

    it('says that a name is too long', () => {
      const key = problems(row('k'.repeat(256), '1'))[0]?.[0];

      expect(key).toMatch(/^The name of a header is at most 255 bytes of UTF-8/u);
    });

    it('says that `x-match` is the mode and not a condition, and sends the learner to the control', () => {
      const key = problems(row('x-match', 'any'))[0]?.[0];

      expect(key).toBe(
        "'x-match' is the mode of a headers binding (all, any, all-with-x or any-with-x), and not a condition. Choose it with the x-match control.",
      );
    });

    it('says that a name is there twice, on every row that has it', () => {
      const twice = "The header 'format' is there twice. A table of headers has each name once, so give it one value.";

      expect(problems(row('format', 'pdf'), row('n', '1'), row('format', 'doc'))).toEqual([
        [twice, null],
        [null, null],
        [twice, null],
      ]);
      expect(problems(row('format', 'pdf'), row('format', '', { exists: true }))).toEqual([
        [twice, null],
        [twice, null],
      ]);
    });

    it('does not count an empty row as a copy of another, nor two names that differ in case', () => {
      expect(problems(row('a', '1'), row('', ''), row('', ''), row('A', '2'))).toEqual([
        [null, null],
        [null, null],
        [null, null],
        [null, null],
      ]);
    });

    it('says that a value is missing, and what was chosen for it', () => {
      expect(problems(row('n', ''))).toEqual([
        [null, 'A header needs a value: write one, such as pdf, 7, 1.5 or true, or "" for an empty text.'],
      ]);
      expect(problems(row('n', '   ', { type: 'integer' }))).toEqual([
        [null, 'A header needs a value: an integer, such as 7.'],
      ]);
    });

    it('says why a value cannot be read, with the name of the header, and none when the name is not typed yet', () => {
      expect(problems(row('n', '9007199254740993'))[0]?.[1]).toMatch(/^The header 'n': An integer header must be/u);
      expect(problems(row('', '9007199254740993'))[0]).toEqual([
        'A header needs a name.',
        expect.stringMatching(/^An integer header must be/u),
      ]);
      expect(problems(row('n', '"abc'))[0]?.[1]).toBe('A quoted text is not closed: add the closing ".');
    });

    it('makes no condition of a row that has a problem, and keeps the others', () => {
      const report = reportDraft(draft('all', row('ok', '1'), row('bad', '"x'), row('dup', '1'), row('dup', '2')));

      expect(report.headers.args).toEqual([entry('ok', int(1))]);
      expect(report.ok).toBe(false);
      expect(report.rows.map(({ condition }) => condition)).toEqual([int(1), null, null, null]);
    });

    it('gives the first problem of the draft, row by row and the name before the value', () => {
      const report = reportDraft(draft('all', row('a', '1'), row('', 'x"'), row('b', '')));

      expect(report.problem?.message).toBe('A header needs a name.');
      expect(problemAt(report)).toEqual({ row: 1, field: 'key' });
      expect(problemAt(reportDraft(draft('all', row('a', ''))))).toEqual({ row: 0, field: 'value' });
      expect(problemAt(reportDraft(draft('all', row('a', '1'))))).toBeNull();
    });

    it('says that there are too many conditions, once, and counts only the rows that are not empty', () => {
      const rows = Array.from({ length: 101 }, (_, index) => row(`h${index}`, '1'));
      const report = reportDraft(draft('all', ...rows, EMPTY_ROW));

      expect(report.ok).toBe(false);
      expect(report.problem?.message).toBe(
        'The arguments of one binding are at most 100, and there are 101. Take some off.',
      );
      expect(problemAt(report)).toBeNull();
      expect(reportDraft(draft('all', ...rows.slice(0, 100), EMPTY_ROW)).ok).toBe(true);
    });
  });

  describe('notes, which do not', () => {
    const notes = (xMatch: XMatch | null, ...rows: DraftRow[]) =>
      reportDraft(draft(xMatch, ...rows)).rows.map((report) => report.notes);

    it('says that an `x-` name is not counted by `all` and `any`, and that it is by `all-with-x` and `any-with-x`', () => {
      const ignored = [ignoredLine('x-trace')];

      expect(notes('all', row('x-trace', '1'))).toEqual([ignored]);
      expect(notes('any', row('x-trace', '1'))).toEqual([ignored]);
      expect(notes(null, row('x-trace', '1'))).toEqual([ignored]);
      expect(notes('all-with-x', row('x-trace', '1'))).toEqual([[countedLine('x-trace', 'all-with-x')]]);
      expect(notes('any-with-x', row('x-trace', '1'))).toEqual([[countedLine('x-trace', 'any-with-x')]]);
    });

    it('says it of an *exists* condition too, and of a name that has a problem', () => {
      expect(notes('all', row('x-seen', '', { exists: true }))).toEqual([[ignoredLine('x-seen')]]);
      expect(notes('all', row('x-a', '1'), row('x-a', '2'))).toEqual([[ignoredLine('x-a')], [ignoredLine('x-a')]]);
    });

    it('says nothing of a name that does not start with `x-` in lower case', () => {
      expect(notes('all', row('X-trace', '1'), row('a-x-b', '1'), row('x', '1'))).toEqual([[], [], []]);
    });

    it('says that a space at either end of a name is part of it, and does not trim it', () => {
      const space = 'The name of this header starts or ends with a space, which is part of the name.';
      const report = reportDraft(draft('all', row(' a', '1'), row('b ', '2'), row('c d', '3')));

      expect(report.rows.map(({ notes: found }) => found)).toEqual([[space], [space], []]);
      expect(report.headers.args.map(({ key }) => key)).toEqual([' a', 'b ', 'c d']);
    });

    it('says nothing of a blank row', () => {
      expect(notes('all', EMPTY_ROW)).toEqual([[]]);
    });
  });

  describe('the sentence of the draft', () => {
    it('says what the binding asks, of the conditions that have no problem', () => {
      expect(reportDraft(draft('all', row('format', 'pdf'), row('type', 'report'))).sentence).toBe(
        'x-match=all: a message matches when all 2 conditions hold (format and type).',
      );
      expect(reportDraft(draft('all', row('format', 'pdf'), row('', 'x'))).sentence).toBe(
        'x-match=all: a message matches when its one condition holds (format).',
      );
    });

    it('says that a binding with nothing that counts matches every message, or none', () => {
      expect(reportDraft(draft('all')).sentence).toBe(
        'x-match=all and no condition counts, so it matches every message.',
      );
      expect(reportDraft(draft('any', row('x-a', '1'))).sentence).toBe(
        'x-match=any and no condition counts, so it matches no message. 1 argument starts with "x-" and is not counted.',
      );
      expect(reportDraft(draft(null)).sentence).toBe(
        'x-match=all (left out, so all) and no condition counts, so it matches every message.',
      );
    });
  });
});

describe('what a draft says about the headers of a message (ADR-0069)', () => {
  it('has no reserved name and no *exists*: a message may carry a header called x-match, and every header has a value', () => {
    const report = reportMessageRows([row('x-match', 'any'), row('seen', '1', { exists: true })]);

    expect(report.ok).toBe(true);
    expect(report.entries).toStrictEqual([entry('x-match', str('any')), entry('seen', int(1))]);
  });

  it('says what is wrong with a row as a binding does, and makes no header of it', () => {
    const report = reportMessageRows([
      row('a', '1'),
      row('a', '2'),
      row('', 'x'),
      row('b', ''),
      row('c', '1'),
      row('x-a', '1'),
    ]);

    expect(report.ok).toBe(false);
    expect(report.rows.map((found) => found.keyProblem?.message ?? found.valueProblem?.message ?? null)).toEqual([
      "The header 'a' is there twice. A table of headers has each name once, so give it one value.",
      "The header 'a' is there twice. A table of headers has each name once, so give it one value.",
      'A header needs a name.',
      'A header needs a value: write one, such as pdf, 7, 1.5 or true, or "" for an empty text.',
      null,
      null,
    ]);
    expect(report.entries).toStrictEqual([entry('c', int(1)), entry('x-a', int(1))]);
    expect(report.problem?.message).toMatch(/^The header 'a' is there twice/u);
    expect(problemAt(report)).toEqual({ row: 0, field: 'key' });
  });

  it('has no note for an `x-` name, because only a binding ignores it', () => {
    expect(reportMessageRows([row('x-a', '1')]).rows[0]?.notes).toEqual([]);
    expect(reportMessageRows([row(' a', '1')]).rows[0]?.notes).toHaveLength(1);
  });

  it('says that there are too many headers', () => {
    const rows = Array.from({ length: 101 }, (_, index) => row(`h${index}`, '1'));

    expect(reportMessageRows(rows).problem?.message).toBe(
      'The headers of one message are at most 100, and there are 101. Take some off.',
    );
    expect(reportMessageRows(rows.slice(1)).ok).toBe(true);
  });

  it('compares two lists of headers by name, type and value, in order', () => {
    const a = [entry('a', int(1)), entry('b', float(-0))];

    expect(sameEntries(a, [entry('a', int(1)), entry('b', float(-0))])).toBe(true);
    expect(sameEntries(a, [entry('b', float(-0)), entry('a', int(1))])).toBe(false);
    expect(sameEntries(a, [entry('a', float(1)), entry('b', float(-0))])).toBe(false);
    expect(sameEntries(a, [entry('a', int(1)), entry('b', float(0))])).toBe(false);
    expect(sameEntries(a, [entry('a', int(1))])).toBe(false);
    expect(sameEntries([], [])).toBe(true);
  });
});

describe('properties of a draft', () => {
  const arbRow: fc.Arbitrary<DraftRow> = fc.record({
    key: fc.oneof(fc.constantFrom('', 'a', 'b', 'x-c', 'x-match', ' a', 'a b'), fc.string({ maxLength: 4 })),
    text: fc.oneof(
      fc.constantFrom('', '1', '"1"', '1.0', 'true', 'pdf', '"x', '9007199254740993', ' 7 ', '"a b"'),
      fc.string({ maxLength: 6 }),
    ),
    exists: fc.boolean(),
  });
  const arbDraft: fc.Arbitrary<HeadersDraft> = fc.record({
    xMatch: fc.constantFrom<XMatch | null>(null, 'all', 'any', 'all-with-x', 'any-with-x'),
    rows: fc.array(arbRow, { maxLength: 6 }),
  });

  it('is the same arguments after a trip through the rows, for any arguments', () => {
    fc.assert(
      fc.property(arbHeaderArguments, (headers) => {
        const report = reportDraft(draftOf(headers));

        expect(report.ok).toBe(true);
        // The records of the arbitrary have no prototype, which `toStrictEqual` tells from the plain objects of the report.
        expect(report.headers).toEqual(headers);
        expect(report.rows.every(({ notes }) => notes.every((note) => note.includes('x-')))).toBe(true);
      }),
    );
  });

  it('never makes arguments that a command would refuse, when the draft says that it can be committed', () => {
    fc.assert(
      fc.property(arbDraft, (value) => {
        const report = reportDraft(deepFreeze(value));
        const args = report.headers;

        if (report.ok) {
          expect(bindingHeadersIssue(args)).toBeNull();
          expect(canonicalHeaders(args)).toEqual(args.xMatch === null && args.args.length === 0 ? undefined : args);
        }
        // Whatever it says, what it makes of the rows without a problem has no duplicate and no reserved name.
        expect(new Set(args.args.map(({ key }) => key)).size).toBe(args.args.length);
        expect(args.args.some(({ key }) => key === 'x-match')).toBe(false);
      }),
    );
  });

  it('never makes headers that a message would refuse, when the draft says that it can be sent', () => {
    fc.assert(
      fc.property(fc.array(arbRow, { maxLength: 6 }), (rows) => {
        const report = reportMessageRows(rows);

        if (report.ok) {
          expect(messageHeadersIssue(report.entries)).toBeNull();
        }
        expect(new Set(report.entries.map(({ key }) => key)).size).toBe(report.entries.length);
      }),
    );
  });

  it('writes the value of a row as it reads it, for any message', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom('a', 'b', 'c'), { maxLength: 3 }).chain((keys) =>
          fc.tuple(
            ...keys.map((key) =>
              fc
                .oneof(
                  fc.string({ maxLength: 8 }).map((v): HeaderValue => str(v)),
                  fc.integer({ min: -1000, max: 1000 }).map((v): HeaderValue => int(v)),
                  fc.double({ noNaN: true, noDefaultInfinity: true }).map((v): HeaderValue => float(v)),
                  fc.boolean().map((v): HeaderValue => bool(v)),
                )
                .map((value) => entry(key, value)),
            ),
          ),
        ),
        (headers) => {
          const rows = rowsOf(headers);
          const report = reportMessageRows(rows);

          expect(report.entries).toStrictEqual(headers);
          expect(sameEntries(report.entries, headers)).toBe(true);
          expect(rows.map((found) => found.text)).toEqual(headers.map(({ value }) => formatValue(value)));
        },
      ),
    );
  });

  it('keeps the rows of a message that were ticked, whatever the order of the ticks', () => {
    fc.assert(
      fc.property(fc.subarray(['a', 'b', 'c', 'd']), (ticks) => {
        const headers = [entry('a', int(1)), entry('b', str('1')), entry('c', float(1)), entry('d', bool(true))];
        const made = draftFromMessage(headers, new Set(ticks));

        expect(made.rows.map(({ key }) => key)).toEqual(['a', 'b', 'c', 'd'].filter((key) => ticks.includes(key)));
      }),
    );
  });

  it('is the arguments of the binding after a mode is written out, for any binding', () => {
    fc.assert(
      fc.property(arbHeaderArguments, (headers: HeaderArguments) => {
        const made = draftOf(headers);

        expect(made.xMatch).toBe(headers.xMatch);
        expect(made.rows).toHaveLength(headers.args.length);
      }),
    );
  });
});
