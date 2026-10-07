import { matchHeaders, type ConditionResult, type HeaderArguments, type HeadersMatch, type XMatch } from '@rmq/engine';
import { wordText as headerName } from '../syntax/words';
import { listOf, shorten, typeText, valueText } from './words';

/**
 * What a headers binding made of a message, in words (ADR-0009, ADR-0060): a line for each condition of the binding, ✓ or ✗ with the reason (missing, a value that differs, a type that
 * differs), and the sentence for the binding as a whole, which says the mode of `x-match` and how many of the conditions held. S8 deepens it, with the table that edits them.
 */

/** One condition of a binding, judged on its own. */
export interface ConditionLine {
  readonly key: string;
  /** What the binding asks of the header, as a command writes it: `"pdf"`, `1`, `1.0`, or `exists`. */
  readonly wanted: string;
  /** What the message has under that key, written the same way, or `null` for nothing. */
  readonly found: string | null;
  readonly outcome: 'pass' | 'fail' | 'ignored';
  /** A sentence about this condition. */
  readonly text: string;
}

export interface HeadersWords {
  readonly text: string;
  readonly short: string;
  readonly conditions: readonly ConditionLine[];
}

/** The mode of a binding in a sentence: `x-match=all`, and `(left out, so all)` when the binding did not say. */
export const modeText = (xMatch: XMatch, omitted: boolean): string =>
  `x-match=${xMatch}${omitted ? ' (left out, so all)' : ''}`;

/** How many arguments start with `x-` and are not counted, as a sentence to follow another, or nothing when there are none. */
export const ignoredNote = (ignored: number): string =>
  ignored === 0
    ? ''
    : ` ${ignored === 1 ? '1 argument starts' : `${ignored} arguments start`} with "x-" and ${ignored === 1 ? 'is' : 'are'} not counted.`;

/** What a binding makes of every message when no condition counts: `all` matches them all and `any` none (ADR-0009). */
export const nothingCountsText = (mode: string, requires: 'all' | 'any', note: string): string =>
  `${mode} and no condition counts, so it matches ${requires === 'all' ? 'every message' : 'no message'}.${note}`;

/** The line for a condition that the mode does not count, which the message inspector, the table and the rows of the editor say. */
export const ignoredLine = (key: string): string =>
  `The header ${headerName(key)} is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x.`;

/** The line for an `x-` condition that the mode counts (ADR-0068): it is judged like any other. */
export const countedLine = (key: string, xMatch: XMatch): string =>
  `The header ${headerName(key)} is counted, because x-match is ${xMatch}.`;

export function conditionLine(result: ConditionResult): ConditionLine {
  const { expected, actual } = result;
  const wanted = expected.t === 'exists' ? 'exists' : valueText(expected);
  const found = actual === undefined ? null : valueText(actual);
  const name = `The header ${headerName(result.key)}`;
  const line = (text: string): ConditionLine => ({ key: result.key, wanted, found, outcome: result.outcome, text });

  if (result.outcome === 'ignored') {
    return line(ignoredLine(result.key));
  }
  if (result.outcome === 'pass') {
    return line(`${name} is ${expected.t === 'exists' ? 'there' : found}, as the binding asks.`);
  }
  switch (result.reason) {
    case 'missing':
      return line(`${name} is missing from the message.`);
    case 'type-differs':
      return line(
        `${name} is ${found}, ${typeText((actual as NonNullable<typeof actual>).t)}, and the binding asks for ${wanted}, ${typeText((expected as Exclude<typeof expected, { t: 'exists' }>).t)}: values of different types are never equal.`,
      );
    default:
      return line(`${name} is ${found}, and the binding asks for ${wanted}.`);
  }
}

/** The sentence and the short reason for a headers binding as a whole, with a line for each of its conditions. */
export function headersWords(result: HeadersMatch): HeadersWords {
  const conditions = result.conditions.map(conditionLine);
  const mode = modeText(result.xMatch, result.omitted);
  const passing = conditions.filter(({ outcome }) => outcome === 'pass').map(({ key }) => headerName(key));
  const failing = conditions.filter(({ outcome }) => outcome === 'fail').map(({ key }) => headerName(key));
  const ignored = conditions.length - result.counted;
  const note = ignoredNote(ignored);

  if (result.counted === 0) {
    return {
      text: nothingCountsText(mode, result.requires, note),
      short: result.requires === 'all' ? 'no conditions: matches all' : 'no conditions: matches none',
      conditions,
    };
  }
  if (result.matched) {
    return {
      text:
        result.requires === 'all'
          ? `${mode}: ${result.counted === 1 ? 'its one condition holds' : `all ${result.counted} conditions hold`}.${note}`
          : `${mode}: ${listOf(passing)} ${passing.length === 1 ? 'holds' : 'hold'}, and one is enough.${note}`,
      short: `${result.passed} of ${result.counted} hold`,
      conditions,
    };
  }
  return {
    text:
      result.requires === 'all'
        ? `${mode}: every condition has to hold, and ${listOf(failing)} ${failing.length === 1 ? 'does' : 'do'} not.${note}`
        : `${mode}: at least one condition has to hold, and ${result.counted === 1 ? 'the one that counts does not' : `none of the ${result.counted} does`}.${note}`,
    short: shorten(
      result.requires === 'all'
        ? `${result.passed} of ${result.counted} hold, all needed`
        : `none of ${result.counted} hold`,
    ),
    conditions,
  };
}

/**
 * What a binding asks, in a sentence, without a message (ADR-0068): the mode, how many conditions count and which, and how many arguments are not counted. It is the sentence of the draft in the editor, and says
 * for a binding with nothing that counts what `headersWords` says of it.
 */
export function describeHeaders(headers: HeaderArguments | undefined): string {
  const result = matchHeaders(headers, []);
  const mode = modeText(result.xMatch, result.omitted);
  const note = ignoredNote(result.conditions.length - result.counted);
  if (result.counted === 0) {
    return nothingCountsText(mode, result.requires, note);
  }
  const names = listOf(
    result.conditions.filter(({ outcome }) => outcome !== 'ignored').map(({ key }) => headerName(key)),
  );
  const holds =
    result.counted === 1
      ? 'its one condition holds'
      : result.requires === 'all'
        ? `all ${result.counted} conditions hold`
        : `at least one of the ${result.counted} conditions holds`;
  return `${mode}: a message matches when ${holds} (${names}).${note}`;
}
