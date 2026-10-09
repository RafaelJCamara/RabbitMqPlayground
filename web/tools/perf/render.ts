import { z } from 'zod';
import type { FpsRecord, PowerState } from './fps';

/**
 * The pure half of `npm run perf:render`: a record of `docs/performance/records/` read from its text, the table of
 * the records, and the document with that table in place of the old one. The script around it only reads and writes.
 */

/** The lines of docs/performance.md that the table lives between: everything between them is generated. */
export const RECORDS_START = '<!-- records:start -->';
export const RECORDS_END = '<!-- records:end -->';

const SECTION = new RegExp(`^${RECORDS_START}\\n[\\s\\S]*?^${RECORDS_END}$`, 'm');

const count = z.number().int().nonnegative();
// `z.number()` refuses NaN and infinities, which JSON writes as `null`: a record of a run that divided by zero is not read.
const amount = z.number().nonnegative();

const rate = z
  .object({
    cpuThrottle: z.number().positive(),
    stats: z.object({
      frames: count,
      seconds: amount,
      averageFps: amount,
      medianFps: amount,
      lowFps: amount,
      worstFrameMs: amount,
      longFrames: count,
    }),
    travelling: z.object({ min: amount, mean: amount }),
    meets: z.boolean().nullable(),
  })
  .refine(({ cpuThrottle, meets }) => (cpuThrottle === 1) === (meets !== null), {
    path: ['meets'],
    error: 'must be null for a throttled run, and true or false for a run with no throttle (cpuThrottle 1)',
  });

const record = z.object({
  schema: z.literal(1, { error: 'must be 1, the only schema that this tool reads' }),
  date: z.iso.datetime({ offset: true }),
  commit: z.string(),
  dirty: z.boolean(),
  scenario: z.object({ nodes: count, edges: count, messagesTarget: count, seconds: amount }),
  machine: z.object({
    cpu: z.string(),
    cores: count,
    memoryGb: amount,
    platform: z.string(),
    release: z.string(),
    arch: z.string(),
    gpu: z.string(),
    browser: z.string(),
    displayHz: amount,
    devicePixelRatio: amount,
    screen: z.string(),
  }),
  power: z.object({ charging: z.boolean().nullable(), level: z.number().nullable(), plan: z.string().nullable() }),
  rates: z.array(rate).min(1),
});

/** A record from the text of its file. Throws an `Error` that says what is wrong with it. */
export function parseRecord(text: string): FpsRecord {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`is not JSON (${String(error)})`, { cause: error });
  }
  const result = record.safeParse(json);
  if (!result.success) {
    throw new Error(
      result.error.issues.map((issue) => `${issue.path.join('.') || 'the record'}: ${issue.message}`).join('; '),
    );
  }
  return result.data;
}

const COLUMNS = [
  'Date',
  'Machine',
  'Power',
  'CPU throttle',
  'Median fps',
  '1% low',
  'Messages in flight (min)',
  'Meets 45 fps',
];
const ALIGNMENT = ['---', '---', '---', '---', '---:', '---:', '---:', '---'];

/** The table of the records, newest first, one row for each rate of each record. Without a record it is one row that says so. */
export function renderTable(records: readonly FpsRecord[]): string {
  const rows = [...records]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .flatMap((one) =>
      [...one.rates]
        .sort((a, b) => a.cpuThrottle - b.cpuThrottle)
        .map((rate) => [
          one.date.slice(0, 10),
          machineOf(one.machine),
          powerOf(one.power),
          rate.cpuThrottle === 1 ? 'none' : `${rate.cpuThrottle}x`,
          fps(rate.stats.medianFps),
          fps(rate.stats.lowFps),
          String(Math.round(rate.travelling.min)),
          meetsOf(rate.meets),
        ]),
    );
  return [COLUMNS, ALIGNMENT, ...(rows.length > 0 ? rows : [['No record yet.']])].map(line).join('\n');
}

/** One decimal, cut and not rounded: a median that reads 45.0 is 45 or more, and 44.96 is not shown as 45.0 beside a "no". */
function fps(value: number): string {
  return (Math.floor(value * 10) / 10).toFixed(1);
}

function machineOf({ cpu, gpu, cores, memoryGb, displayHz }: FpsRecord['machine']): string {
  const named = [cpu, gpu].filter((name) => name !== '');
  return [...named, `${cores} cores`, `${Math.round(memoryGb)} GB`, `${Math.round(displayHz)} Hz`].join(', ');
}

function powerOf({ charging, plan }: PowerState): string {
  const state = charging === null ? 'Unknown' : stateOf(charging);
  return plan ? `${state}, ${plan}` : state;
}

function stateOf(charging: boolean): string {
  return charging ? 'AC' : 'Battery';
}

/** A throttled run has no verdict: it is a data point and not an answer. */
function meetsOf(meets: boolean | null): string {
  if (meets === null) {
    return 'data point';
  }
  return meets ? 'yes' : 'no';
}

/** One line of a table. A pipe in a cell is escaped, and a line break in it is a space; an empty cell is left empty. */
function line(cells: readonly string[]): string {
  const filled = [...cells, ...Array.from({ length: COLUMNS.length - cells.length }, () => '')];
  return `|${filled
    .map((cell) => cell.replace(/\s+/g, ' ').trim().replaceAll('|', '\\|'))
    .map((cell) => (cell === '' ? ' |' : ` ${cell} |`))
    .join('')}`;
}

/**
 * The document with the lines between the two markers replaced by the table. The result has LF line endings.
 * Throws when the markers are not there, each on a line of its own and the start first.
 */
export function replaceTable(document: string, table: string): string {
  const text = document.replaceAll('\r\n', '\n');
  if (!SECTION.test(text)) {
    throw new Error(
      `docs/performance.md needs a line ${RECORDS_START} and, further down, a line ${RECORDS_END}, around the table.`,
    );
  }
  // A function, so that a `$` in the table is a `$` and not a replacement pattern.
  return text.replace(SECTION, () => `${RECORDS_START}\n\n${table}\n\n${RECORDS_END}`);
}

export type DriftResult = { readonly upToDate: true } | { readonly upToDate: false; readonly reason: string };

/** Compares the committed document with what the records produce now. */
export function checkDrift(generated: string, committed: string): DriftResult {
  // A checkout with CRLF line endings is the same text, not drift.
  const actual = committed.replaceAll('\r\n', '\n');
  if (actual === generated) {
    return { upToDate: true };
  }
  const expectedLines = generated.split('\n');
  const actualLines = actual.split('\n');
  const differing = expectedLines.findIndex((text, index) => text !== actualLines[index]);
  // No expected line differs: the committed text goes on after the last of them. (One that stops short differs at its end.)
  const first = differing === -1 ? expectedLines.length : differing;
  return {
    upToDate: false,
    reason: `docs/performance.md differs from the table of the records, first at line ${first + 1}.`,
  };
}
