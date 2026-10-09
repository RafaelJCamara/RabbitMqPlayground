import { describe, expect, it } from 'vitest';
import { type FpsRecord, type PowerState, type Rate, TARGET_FPS } from './fps';
import { checkDrift, parseRecord, RECORDS_END, RECORDS_START, renderTable, replaceTable } from './render';

function rate(cpuThrottle: number, medianFps: number, overrides: Partial<Rate> = {}): Rate {
  return {
    cpuThrottle,
    stats: {
      frames: 1200,
      seconds: 20,
      averageFps: medianFps - 0.5,
      medianFps,
      lowFps: medianFps - 10,
      worstFrameMs: 41.7,
      longFrames: 3,
    },
    travelling: { min: 588, mean: 603.4 },
    meets: cpuThrottle === 1 ? medianFps >= 45 : null,
    ...overrides,
  };
}

function record(overrides: Partial<FpsRecord> = {}): FpsRecord {
  return {
    schema: 1,
    date: '2026-10-09T14:03:22.123Z',
    commit: '8dfe728',
    dirty: false,
    scenario: { nodes: 200, edges: 500, messagesTarget: 500, seconds: 20 },
    machine: {
      cpu: 'Intel(R) Core(TM) i9-14900HX',
      cores: 24,
      memoryGb: 31.7,
      platform: 'win32',
      release: '10.0.26300',
      arch: 'x64',
      gpu: 'NVIDIA GeForce RTX 4070 Laptop GPU',
      browser: 'Chromium 141.0.7390.37',
      displayHz: 143.9,
      devicePixelRatio: 1.25,
      screen: '2560x1600',
    },
    power: { charging: true, level: 1, plan: 'Balanced' },
    rates: [rate(1, 61.2), rate(4, 38.4), rate(6, 22.1)],
    ...overrides,
  };
}

const withMachine = (changes: Partial<FpsRecord['machine']>, rates: Rate[] = [rate(1, 61.2)]): FpsRecord => {
  const base = record();
  return record({ machine: { ...base.machine, ...changes }, rates });
};

const HEADER =
  '| Date | Machine | Power | CPU throttle | Median fps | 1% low | Messages in flight (min) | Meets 45 fps |';
const ALIGNMENT = '| --- | --- | --- | --- | ---: | ---: | ---: | --- |';
const MACHINE = 'Intel(R) Core(TM) i9-14900HX, NVIDIA GeForce RTX 4070 Laptop GPU, 24 cores, 32 GB, 144 Hz';

/** The cells of the rows of a table, without the header and the line under it. */
const cellsOf = (table: string): string[][] =>
  table
    .split('\n')
    .slice(2)
    .map((row) => row.slice(2, -2).split(' | '));

/** The processor of each row: the machine cell starts with it. */
const cpusOf = (table: string): (string | undefined)[] => cellsOf(table).map((cells) => cells[1]?.split(', ')[0]);

describe('renderTable', () => {
  it('is a header and a row that says so when there is no record', () => {
    expect(renderTable([])).toBe([HEADER, ALIGNMENT, '| No record yet. | | | | | | | |'].join('\n'));
  });

  it('has the columns of the page, and the line of the plan in the last one', () => {
    expect(renderTable([]).split('\n')[0]).toBe(HEADER);
    expect(HEADER).toContain(`Meets ${TARGET_FPS} fps`);
  });

  it('is a row for each rate of a record, with no throttle first, and a data point for each throttled rate', () => {
    const table = renderTable([record({ rates: [rate(6, 22.1), rate(1, 61.2), rate(4, 38.4)] })]);

    expect(table).toBe(
      [
        HEADER,
        ALIGNMENT,
        `| 2026-10-09 | ${MACHINE} | AC, Balanced | none | 61.2 | 51.2 | 588 | yes |`,
        `| 2026-10-09 | ${MACHINE} | AC, Balanced | 4x | 38.4 | 28.4 | 588 | data point |`,
        `| 2026-10-09 | ${MACHINE} | AC, Balanced | 6x | 22.1 | 12.1 | 588 | data point |`,
      ].join('\n'),
    );
  });

  it('puts the newest record first, whatever the order of the files and the offset of the dates', () => {
    const at = (date: string, cpu: string): FpsRecord => ({ ...withMachine({ cpu }), date });
    const table = renderTable([
      at('2026-10-09T10:00:00.000Z', 'oldest'),
      at('2026-10-10T01:00:00Z', 'middle'),
      at('2026-10-09T23:30:00-03:00', 'newest'),
    ]);

    expect(cpusOf(table)).toEqual(['newest', 'middle', 'oldest']);
    expect(cellsOf(table).map((cells) => cells[0])).toEqual(['2026-10-09', '2026-10-10', '2026-10-09']);
  });

  it('keeps the order of the files for records of the same moment', () => {
    const table = renderTable([withMachine({ cpu: 'first' }), withMachine({ cpu: 'second' })]);

    expect(cpusOf(table)).toEqual(['first', 'second']);
  });

  it('does not change the records it is given', () => {
    const rates = Object.freeze([rate(6, 22.1), rate(1, 61.2)]);
    const records = Object.freeze([record({ rates }), record({ date: '2026-10-10T10:00:00Z', rates })]);

    expect(() => renderTable(records)).not.toThrow();
    expect(rates.map((one) => one.cpuThrottle)).toEqual([6, 1]);
  });

  it.each<{ name: string; power: PowerState; cell: string }>([
    { name: 'the charger', power: { charging: true, level: 1, plan: null }, cell: 'AC' },
    {
      name: 'the charger and a plan',
      power: { charging: true, level: 1, plan: 'Best performance' },
      cell: 'AC, Best performance',
    },
    {
      name: 'the battery and a plan',
      power: { charging: false, level: 0.4, plan: 'Balanced' },
      cell: 'Battery, Balanced',
    },
    {
      name: 'a power state that is not known, and a plan',
      power: { charging: null, level: null, plan: 'Balanced' },
      cell: 'Unknown, Balanced',
    },
    { name: 'a power state that is not known', power: { charging: null, level: null, plan: null }, cell: 'Unknown' },
    { name: 'a plan with no name', power: { charging: false, level: null, plan: '' }, cell: 'Battery' },
  ])('says $cell for $name', ({ power, cell }) => {
    expect(cellsOf(renderTable([record({ power, rates: [rate(1, 61.2)] })]))[0]?.[2]).toBe(cell);
  });

  it.each([
    { cpuThrottle: 1, meets: true, throttle: 'none', verdict: 'yes' },
    { cpuThrottle: 1, meets: false, throttle: 'none', verdict: 'no' },
    { cpuThrottle: 4, meets: null, throttle: '4x', verdict: 'data point' },
    { cpuThrottle: 2.5, meets: null, throttle: '2.5x', verdict: 'data point' },
  ])('says $throttle and $verdict for a run with a throttle of $cpuThrottle and meets $meets', (row) => {
    const cells = cellsOf(renderTable([record({ rates: [rate(row.cpuThrottle, 50, { meets: row.meets })] })]))[0];

    expect(cells?.[3]).toBe(row.throttle);
    expect(cells?.[7]).toBe(row.verdict);
  });

  it.each([
    { value: 61.2, shown: '61.2' },
    { value: 45, shown: '45.0' },
    { value: 45.04, shown: '45.0' },
    { value: 44.96, shown: '44.9' },
    { value: 1000 / 22.5, shown: '44.4' },
    { value: 144, shown: '144.0' },
  ])('cuts $value fps to $shown, so that nothing below 45 reads as 45.0', ({ value, shown }) => {
    const cells = cellsOf(renderTable([record({ rates: [rate(4, value, { meets: null })] })]))[0];

    expect(cells?.[4]).toBe(shown);
  });

  it('rounds the messages in flight, the memory and the refresh rate to whole numbers', () => {
    const base = record();
    const table = renderTable([
      record({
        machine: { ...base.machine, memoryGb: 15.6, displayHz: 59.94 },
        rates: [rate(1, 61.2, { travelling: { min: 599.6, mean: 640 } })],
      }),
    ]);

    expect(cellsOf(table)[0]?.[1]).toContain('24 cores, 16 GB, 60 Hz');
    expect(cellsOf(table)[0]?.[6]).toBe('600');
  });

  it('leaves out a name that the machine could not give, rather than a stray comma', () => {
    expect(cellsOf(renderTable([withMachine({ gpu: '' })]))[0]?.[1]).toBe(
      'Intel(R) Core(TM) i9-14900HX, 24 cores, 32 GB, 144 Hz',
    );
    expect(cellsOf(renderTable([withMachine({ cpu: '', gpu: '' })]))[0]?.[1]).toBe('24 cores, 32 GB, 144 Hz');
  });

  it('keeps a pipe in a name inside its cell, and a line break a space', () => {
    const table = renderTable([withMachine({ gpu: 'ANGLE (A | B)', cpu: 'Odd\n   CPU' })]);
    const row = table.split('\n')[2] ?? '';

    expect(row).toContain('Odd CPU, ANGLE (A \\| B), 24 cores');
    // 8 cells are 9 pipes: the escaped one is not one of them.
    expect(row.split(/(?<!\\)\|/)).toHaveLength(10);
  });
});

describe('parseRecord', () => {
  const parse = (value: unknown) => parseRecord(JSON.stringify(value));

  it('reads what the tool writes', () => {
    expect(parse(record())).toEqual(record());
  });

  it('reads a date with an offset, a power state that is not known, and a record with another key in it', () => {
    const odd = record({ date: '2026-10-09T23:30:00-03:00', power: { charging: null, level: null, plan: null } });

    expect(parse({ ...odd, somethingNew: 1 })).toEqual(odd);
  });

  /** What the file would hold if something had gone wrong when it was written: a copy of the record, changed. */
  type Change = (value: FpsRecord) => unknown;
  const rateChange =
    (index: number, change: object): Change =>
    (value) => ({ ...value, rates: value.rates.map((one, at) => (at === index ? { ...one, ...change } : one)) });
  const statsChange =
    (index: number, change: object): Change =>
    (value) =>
      rateChange(index, { stats: { ...value.rates[index]?.stats, ...change } })(value);

  it.each<{ name: string; change: Change; message: RegExp }>([
    { name: 'another schema', change: (value) => ({ ...value, schema: 2 }), message: /^schema: must be 1/ },
    { name: 'no commit', change: (value) => ({ ...value, commit: undefined }), message: /^commit: / },
    { name: 'a date that is a word', change: (value) => ({ ...value, date: 'yesterday' }), message: /^date: / },
    { name: 'a date with no zone', change: (value) => ({ ...value, date: '2026-10-09T14:03:22' }), message: /^date: / },
    {
      name: 'cores that are text',
      change: (value) => ({ ...value, machine: { ...value.machine, cores: '24' } }),
      message: /^machine\.cores: /,
    },
    {
      name: 'a charging that is text',
      change: (value) => ({ ...value, power: { ...value.power, charging: 'yes' } }),
      message: /^power\.charging: /,
    },
    { name: 'no rate', change: (value) => ({ ...value, rates: [] }), message: /^rates: / },
    { name: 'a throttle of zero', change: rateChange(0, { cpuThrottle: 0 }), message: /^rates\.0\.cpuThrottle: / },
    {
      name: 'a median that was infinite (JSON writes null)',
      change: statsChange(0, { medianFps: Number.POSITIVE_INFINITY }),
      message: /^rates\.0\.stats\.medianFps: /,
    },
    { name: 'a negative frame rate', change: statsChange(1, { lowFps: -1 }), message: /^rates\.1\.stats\.lowFps: / },
    {
      name: 'a verdict for a throttled run',
      change: rateChange(1, { meets: true }),
      message: /^rates\.1\.meets: must be null for a throttled run/,
    },
    {
      name: 'no verdict for a run with no throttle',
      change: rateChange(0, { meets: null }),
      message: /^rates\.0\.meets: must be null for a throttled run, and true or false/,
    },
  ])('refuses $name and says where', ({ change, message }) => {
    expect(() => parse(change(record()))).toThrow(message);
  });

  it('says all that is wrong, not only the first', () => {
    expect(() => parse({ ...record(), commit: 1, dirty: 'no' })).toThrow(/commit: .*; dirty: /);
  });

  it.each([
    { name: 'text that is not JSON', text: 'not json {', message: /^is not JSON \(SyntaxError/ },
    { name: 'a file with nothing in it', text: '', message: /^is not JSON/ },
    { name: 'JSON that is null', text: 'null', message: /^the record: / },
    { name: 'JSON that is a list', text: '[]', message: /^the record: / },
  ])('refuses $name', ({ text, message }) => {
    expect(() => parseRecord(text)).toThrow(message);
  });
});

describe('replaceTable', () => {
  const page = (inside: string) =>
    ['# Performance', '', 'Words.', '', RECORDS_START, inside, RECORDS_END, '', 'More words.', ''].join('\n');

  it('puts the table between the markers and leaves the rest of the page as it is', () => {
    expect(replaceTable(page('the old table'), '| table |')).toBe(
      ['# Performance', '', 'Words.', '', RECORDS_START, '', '| table |', '', RECORDS_END, '', 'More words.', ''].join(
        '\n',
      ),
    );
  });

  it('gives the same page when it is run again, and for a section that was empty', () => {
    const once = replaceTable(page('the old table'), '| table |');

    expect(replaceTable(once, '| table |')).toBe(once);
    expect(replaceTable(page(''), '| table |')).toBe(once);
  });

  it('writes LF line endings, also into a page that has CRLF ones', () => {
    const result = replaceTable(page('old').replaceAll('\n', '\r\n'), '| table |');

    expect(result).not.toContain('\r');
    expect(result).toBe(replaceTable(page('old'), '| table |'));
  });

  it('does not read a `$` of the table as a replacement pattern', () => {
    expect(replaceTable(page('old'), 'costs $& and $1 and $$')).toContain('\ncosts $& and $1 and $$\n');
  });

  it('does not take the markers named in a sentence for the markers', () => {
    const sentence = `A sentence names ${RECORDS_START} and ${RECORDS_END} in the middle of a line.`;
    const result = replaceTable(`${sentence}\n${page('old')}`, '| table |');

    expect(result.startsWith(`${sentence}\n# Performance`)).toBe(true);
    expect(result).toContain('| table |');
    expect(result).not.toContain('old');
  });

  it('does not take a sentence that ends with a marker for the start, or one that names the end for the end', () => {
    const before = `The table starts at ${RECORDS_START}\n`;
    const result = replaceTable(before + page(`old\nand it ends at ${RECORDS_END} says a line of it`), '| table |');

    expect(result.startsWith(`${before}# Performance`)).toBe(true);
    expect(result).toContain(`${RECORDS_START}\n\n| table |\n\n${RECORDS_END}\n\nMore words.`);
    expect(result).not.toContain('old');
    expect(result).not.toContain('says a line');
  });

  it.each([
    { name: 'no marker', text: '# Performance\n\nWords.\n' },
    { name: 'only the start', text: `Words.\n${RECORDS_START}\n| table |\n` },
    { name: 'only the end', text: `Words.\n| table |\n${RECORDS_END}\n` },
    { name: 'the end before the start', text: `${RECORDS_END}\n| table |\n${RECORDS_START}\n` },
  ])('throws for $name, and says which markers it needs', ({ text }) => {
    expect(() => replaceTable(text, '| table |')).toThrow(
      new RegExp(`needs a line ${RECORDS_START}.*a line ${RECORDS_END}`),
    );
  });
});

describe('checkDrift', () => {
  const generated = '# Performance\n\n| table |\n\nline five\n';

  it('accepts the same text', () => {
    expect(checkDrift(generated, generated)).toEqual({ upToDate: true });
  });

  it('accepts the same text with CRLF line endings, which a Windows checkout can produce', () => {
    expect(checkDrift(generated, generated.replaceAll('\n', '\r\n'))).toEqual({ upToDate: true });
  });

  it('names the first line that differs', () => {
    expect(checkDrift(generated, '# Performance\n\n| EDITED |\n\nline five\n')).toEqual({
      upToDate: false,
      reason: 'docs/performance.md differs from the table of the records, first at line 3.',
    });
  });

  it('notices a file that was cut short, and one with extra lines, and names the line', () => {
    const reason = (committed: string, text = generated) => {
      const result = checkDrift(text, committed);
      return result.upToDate ? 'up to date' : result.reason;
    };

    expect(reason('# Performance\n')).toContain('first at line 3.');
    expect(reason(`${generated}extra\n`)).toContain('first at line 6.');
    // With no newline at the end, the lines of the generated text are all there and the extra one follows them.
    expect(reason('a\nb\nc', 'a\nb')).toContain('first at line 3.');
  });

  it('notices a change in whitespace alone', () => {
    expect(checkDrift(generated, generated.replace('| table |', '| table | ')).upToDate).toBe(false);
  });
});
