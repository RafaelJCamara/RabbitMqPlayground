import type { ConditionResult, HeadersMatch } from '@rmq/engine';
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

export function conditionLine(result: ConditionResult): ConditionLine {
  const { expected, actual } = result;
  const wanted = expected.t === 'exists' ? 'exists' : valueText(expected);
  const found = actual === undefined ? null : valueText(actual);
  const name = `The header ${headerName(result.key)}`;
  const line = (text: string): ConditionLine => ({ key: result.key, wanted, found, outcome: result.outcome, text });

  if (result.outcome === 'ignored') {
    return line(
      `${name} is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x.`,
    );
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
  const mode = `x-match=${result.xMatch}${result.omitted ? ' (left out, so all)' : ''}`;
  const passing = conditions.filter(({ outcome }) => outcome === 'pass').map(({ key }) => headerName(key));
  const failing = conditions.filter(({ outcome }) => outcome === 'fail').map(({ key }) => headerName(key));
  const ignored = conditions.length - result.counted;
  const ignoredNote =
    ignored === 0
      ? ''
      : ` ${ignored === 1 ? '1 argument starts' : `${ignored} arguments start`} with "x-" and ${ignored === 1 ? 'is' : 'are'} not counted.`;

  if (result.counted === 0) {
    const everything = result.requires === 'all';
    return {
      text: `${mode} and no condition counts, so it matches ${everything ? 'every message' : 'no message'}.${ignoredNote}`,
      short: everything ? 'no conditions: matches all' : 'no conditions: matches none',
      conditions,
    };
  }
  if (result.matched) {
    return {
      text:
        result.requires === 'all'
          ? `${mode}: ${result.counted === 1 ? 'its one condition holds' : `all ${result.counted} conditions hold`}.${ignoredNote}`
          : `${mode}: ${listOf(passing)} ${passing.length === 1 ? 'holds' : 'hold'}, and one is enough.${ignoredNote}`,
      short: `${result.passed} of ${result.counted} hold`,
      conditions,
    };
  }
  return {
    text:
      result.requires === 'all'
        ? `${mode}: every condition has to hold, and ${listOf(failing)} ${failing.length === 1 ? 'does' : 'do'} not.${ignoredNote}`
        : `${mode}: at least one condition has to hold, and ${result.counted === 1 ? 'the one that counts does not' : `none of the ${result.counted} does`}.${ignoredNote}`,
    short: shorten(
      result.requires === 'all'
        ? `${result.passed} of ${result.counted} hold, all needed`
        : `none of ${result.counted} hold`,
    ),
    conditions,
  };
}
