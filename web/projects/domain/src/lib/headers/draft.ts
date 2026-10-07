import type { HeaderArguments, HeaderCondition, HeaderEntry, HeaderValue, XMatch } from '@rmq/engine';
import {
  duplicateHeaderIssue,
  headerKeyIssue,
  reservedHeaderIssue,
  tooManyEntriesIssue,
  X_MATCH,
} from '../document/headers';
import { ok, type Issue, type Result } from '../document/issue';
import { countedLine, describeHeaders, ignoredLine } from '../explain/headers-words';
import { formatValue, inferValue, needsValueOf, readType, retypeValue, type ValueType } from '../syntax/values';

/**
 * The draft of a set of headers, as the editor holds it while the rows are typed (ADR-0066, ADR-0067, ADR-0068): a mode and rows, each row a name, the text of a value as a command writes it, and whether it is an
 * *exists* condition. Nothing here is a document: the draft is turned into arguments only when it is committed, and until then it is read to say what is wrong with each row, what the binding asks and which
 * conditions it has so far. The same rows, without *exists*, are the table of a producer's message.
 */

/** What the select of a row shows: the type of its value, or *exists*, which has none. */
export type RowType = ValueType | 'exists';

export interface DraftRow {
  readonly key: string;
  /** The value as a command writes it after the `=`, and what it was while the row is *exists*, so that choosing a type again gives it back. */
  readonly text: string;
  readonly exists: boolean;
  /** The type that the learner chose while the value is empty, which is a preference until something is typed (ADR-0067). */
  readonly type?: ValueType;
}

export interface HeadersDraft {
  /** `null` is a mode that was left out, which a broker reads as `all`. */
  readonly xMatch: XMatch | null;
  readonly rows: readonly DraftRow[];
}

export const EMPTY_ROW: DraftRow = { key: '', text: '', exists: false };

/** The draft of a binding that is being made: the mode `all`, written out, and one empty row to type in. */
export const newDraft = (): HeadersDraft => ({ xMatch: 'all', rows: [EMPTY_ROW] });

function rowOf(key: string, condition: HeaderCondition): DraftRow {
  return condition.t === 'exists'
    ? { key, text: '', exists: true }
    : { key, text: formatValue(condition), exists: false };
}

/** The draft of the arguments of a binding that is there: the mode as it has it, and a row for each condition, in order. */
export function draftOf(headers: HeaderArguments | undefined): HeadersDraft {
  return { xMatch: headers?.xMatch ?? null, rows: (headers?.args ?? []).map(({ key, value }) => rowOf(key, value)) };
}

/** The rows of the headers of a message, for the table of a producer. */
export const rowsOf = (headers: readonly HeaderEntry<HeaderValue>[]): DraftRow[] =>
  headers.map(({ key, value }) => rowOf(key, value));

/**
 * The draft of a binding made from the headers of a message (ADR-0070): a row for each header that is ticked, in the order of the message, with its name and its value exactly as the message has them, so
 * that `1`, `1.0`, `"1"` and `true` stay what they were.
 */
export function draftFromMessage(
  headers: readonly HeaderEntry<HeaderValue>[],
  ticked: ReadonlySet<string>,
  xMatch: XMatch = 'all',
): HeadersDraft {
  return { xMatch, rows: rowsOf(headers.filter(({ key }) => ticked.has(key))) };
}

/** Whether a row has nothing typed in it: it is not a condition, and is left out when the draft is committed. */
export const isBlank = (row: DraftRow): boolean => row.key === '' && !row.exists && row.text.trim() === '';

/** The type that the select of a row shows: *exists*, or the type of what is typed, or what was chosen while nothing is, or a string. */
export function rowType(row: DraftRow): RowType {
  if (row.exists) {
    return 'exists';
  }
  return row.text.trim() === '' ? (row.type ?? 'string') : (readType(row.text) ?? 'string');
}

/** What is typed in the value field of a row: the text of a value is a value that has not been typed, and a preference of type goes. */
export const withText = (row: DraftRow, text: string): DraftRow => ({ key: row.key, text, exists: row.exists });

/**
 * A row with another type chosen for it (ADR-0067): *exists* takes the value away and keeps its text, a type rewrites the text so that it says that type, and a type for an empty value is kept as a preference.
 * A change that has no meaning is refused, and the row stays as it was; but a row that leaves *exists* with text that cannot be read in the new type starts its value again, because that text was only kept.
 */
export function retypeRow(row: DraftRow, to: RowType): Result<DraftRow> {
  if (to === 'exists') {
    return ok({ ...row, exists: true });
  }
  if (row.text.trim() === '') {
    return ok({ key: row.key, text: row.text, exists: false, type: to });
  }
  const retyped = retypeValue(row.text, to);
  if (retyped.ok) {
    return ok({ key: row.key, text: retyped.value, exists: false });
  }
  return row.exists ? ok({ key: row.key, text: '', exists: false, type: to }) : retyped;
}

/** What is wrong with a row, and what to know about it. */
export interface RowReport {
  /** Nothing is typed in it. It says nothing and is not a condition. */
  readonly blank: boolean;
  /** What the select shows. */
  readonly type: RowType;
  /** The condition it makes: complete, and nothing in it is refused. */
  readonly condition: HeaderCondition | null;
  /** What is wrong with the name, which stops the commit. */
  readonly keyProblem: Issue | null;
  /** What is wrong with the value, which stops the commit. */
  readonly valueProblem: Issue | null;
  /** What will surprise, which does not (ADR-0068). */
  readonly notes: readonly string[];
}

/** Which kind of rows these are: the conditions of a binding, which have a mode, or the headers of a message. */
type Kind = { readonly kind: 'condition'; readonly xMatch: XMatch | null } | { readonly kind: 'message' };

const SPACE_NOTE = 'The name of this header starts or ends with a space, which is part of the name.';

function reportRow(row: DraftRow, of: Kind, copies: ReadonlyMap<string, number>): RowReport {
  const type = rowType(row);
  if (isBlank(row)) {
    return { blank: true, type, condition: null, keyProblem: null, valueProblem: null, notes: [] };
  }
  const isCondition = of.kind === 'condition';
  let keyProblem = headerKeyIssue(row.key);
  if (keyProblem === null && isCondition && row.key === X_MATCH) {
    keyProblem = reservedHeaderIssue('Choose it with the x-match control.');
  }
  // Every row that is not blank was counted, so its name is in the map.
  if (keyProblem === null && (copies.get(row.key) as number) > 1) {
    keyProblem = duplicateHeaderIssue(row.key);
  }

  let condition: HeaderCondition | null = null;
  let valueProblem: Issue | null = null;
  if (row.exists && isCondition) {
    condition = { t: 'exists' };
  } else if (row.text.trim() === '') {
    valueProblem = needsValueOf(row.type);
  } else {
    const read = inferValue(row.text, row.key === '' ? null : row.key);
    if (read.ok) {
      condition = read.value;
    } else {
      valueProblem = read.error;
    }
  }

  const notes: string[] = [];
  if (row.key !== row.key.trim()) {
    notes.push(SPACE_NOTE);
  }
  if (isCondition && row.key.startsWith('x-')) {
    const { xMatch } = of;
    notes.push(
      xMatch === 'all-with-x' || xMatch === 'any-with-x' ? countedLine(row.key, xMatch) : ignoredLine(row.key),
    );
  }
  return {
    blank: false,
    type,
    condition: keyProblem === null && valueProblem === null ? condition : null,
    keyProblem,
    valueProblem,
    notes,
  };
}

function reportRows(draft: readonly DraftRow[], of: Kind): RowReport[] {
  // A blank row has the name '', which no other row is asked about: a row that has a value and no name has its own problem before it is asked whether it has a twin.
  const copies = new Map<string, number>();
  for (const row of draft) {
    copies.set(row.key, (copies.get(row.key) ?? 0) + 1);
  }
  return draft.map((row) => reportRow(row, of, copies));
}

/** The first thing that stops a commit, row by row, name before value, and then the count. */
function firstProblem(rows: readonly RowReport[], count: Issue | null): Issue | null {
  return (
    rows.flatMap(({ keyProblem, valueProblem }) => [keyProblem, valueProblem]).find((issue) => issue !== null) ?? count
  );
}

/** Where the first problem is, for the focus: the row and the field. */
export function problemAt(report: {
  readonly rows: readonly RowReport[];
}): { readonly row: number; readonly field: 'key' | 'value' } | null {
  for (const [row, { keyProblem, valueProblem }] of report.rows.entries()) {
    if (keyProblem !== null) {
      return { row, field: 'key' };
    }
    if (valueProblem !== null) {
      return { row, field: 'value' };
    }
  }
  return null;
}

export interface DraftReport {
  readonly rows: readonly RowReport[];
  /** The arguments that the rows without a problem make, in order: what the sentence, the lint and the table are about while the draft is still being typed. */
  readonly headers: HeaderArguments;
  /** Whether the draft can be committed: no row has a problem, and there are not too many. */
  readonly ok: boolean;
  /** The first thing that stops it. */
  readonly problem: Issue | null;
  /** What the binding asks, in a sentence (ADR-0068). */
  readonly sentence: string;
  /** Some row is an *exists* condition, which cannot be exported (ADR-0009). */
  readonly hasExists: boolean;
}

/** Reads a draft: what is wrong with each row, the arguments it makes so far, whether it can be committed, and what the binding asks. */
export function reportDraft(draft: HeadersDraft): DraftReport {
  const rows = reportRows(draft.rows, { kind: 'condition', xMatch: draft.xMatch });
  const args = draft.rows.flatMap(({ key }, index): HeaderEntry<HeaderCondition>[] => {
    const condition = (rows[index] as RowReport).condition;
    return condition === null ? [] : [{ key, value: condition }];
  });
  const headers: HeaderArguments = { xMatch: draft.xMatch, args };
  const problem = firstProblem(rows, tooManyEntriesIssue('binding', rows.filter(({ blank }) => !blank).length));
  return {
    rows,
    headers,
    ok: problem === null,
    problem,
    sentence: describeHeaders(headers),
    hasExists: args.some(({ value }) => value.t === 'exists'),
  };
}

export interface MessageReport {
  readonly rows: readonly RowReport[];
  /** The headers that the rows without a problem make, in order. */
  readonly entries: readonly HeaderEntry<HeaderValue>[];
  readonly ok: boolean;
  readonly problem: Issue | null;
}

/** Reads the rows of a message's table (ADR-0069): the same checks as a binding's rows, without a mode, without *exists* and without a reserved name. */
export function reportMessageRows(draft: readonly DraftRow[]): MessageReport {
  const rows = reportRows(draft, { kind: 'message' });
  const entries = draft.flatMap(({ key }, index): HeaderEntry<HeaderValue>[] => {
    const condition = (rows[index] as RowReport).condition;
    return condition === null || condition.t === 'exists' ? [] : [{ key, value: condition }];
  });
  const problem = firstProblem(rows, tooManyEntriesIssue('message', rows.filter(({ blank }) => !blank).length));
  return { rows, entries, ok: problem === null, problem };
}

/** Whether two lists of headers are the same, in order: the same names, types and values. */
export const sameEntries = (a: readonly HeaderEntry<HeaderValue>[], b: readonly HeaderEntry<HeaderValue>[]): boolean =>
  a.length === b.length &&
  a.every((left, index) => {
    const right = b[index] as HeaderEntry<HeaderValue>;
    return left.key === right.key && left.value.t === right.value.t && Object.is(left.value.v, right.value.v);
  });
