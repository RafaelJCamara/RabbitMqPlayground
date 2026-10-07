import {
  bindingSignature,
  headerValueIssue,
  utf8Length,
  type HeaderArguments,
  type HeaderCondition,
  type HeaderEntry,
  type HeaderValue,
} from '@rmq/engine';
import { thousands } from './capacity';
import type { Issue } from './issue';
import { LIMITS } from './schema';

/**
 * The rules about headers that a canvas keeps (ADR-0009, ADR-0023). What a value may be is the engine's rule, and is not
 * repeated here: `headerValueIssue` is called for every value that a command or a document brings.
 */

/** AMQP writes the name of a header, like every name in a table, as a short string. */
export const HEADER_KEY_MAX_BYTES = 255;

/** The argument that sets the mode of a headers binding. It is the binding's `xMatch`, and never one of its conditions. */
export const X_MATCH = 'x-match';

/** Why `key` cannot be the name of a header, or `null` when it can. */
export function headerKeyIssue(key: string): Issue | null {
  if (key === '') {
    return { kind: 'header', message: 'A header needs a name.' };
  }
  const bytes = utf8Length(key);
  if (bytes > HEADER_KEY_MAX_BYTES) {
    return {
      kind: 'header',
      message: `The name of a header is at most ${HEADER_KEY_MAX_BYTES} bytes of UTF-8, because AMQP writes it as a short string, and '${key}' is ${bytes}.`,
    };
  }
  return null;
}

/**
 * Why `value` cannot be the value of the header called `key`, or `null` when it can. What a value may be is the engine's
 * rule, and a value that is text is also kept to `LIMITS.textLength` characters (ADR-0029). A field that has no name yet asks
 * with `null`, and gets the sentence without the name.
 */
export function headerValueProblem(key: string | null, value: HeaderCondition): Issue | null {
  const issue =
    headerValueIssue(value) ??
    (value.t === 'string' && value.v.length > LIMITS.textLength
      ? `a value that is text is at most ${thousands(LIMITS.textLength)} characters, and this one has ${thousands(value.v.length)}`
      : null);
  if (issue === null) {
    return null;
  }
  return {
    kind: 'header',
    message: key === null ? `${issue.charAt(0).toUpperCase()}${issue.slice(1)}.` : `The header '${key}': ${issue}.`,
  };
}

/** The sentence for a name that a table of headers has twice, which the commands and the rows of the editor both say (ADR-0068). */
export const duplicateHeaderIssue = (key: string): Issue => ({
  kind: 'header',
  message: `The header '${key}' is there twice. A table of headers has each name once, so give it one value.`,
});

/**
 * The sentence for the name `x-match` used as a condition: it is the mode of the binding. The advice differs by where it is said, and the cause
 * does not: a command is told to write `x-match=any`, and a row of the editor to use the control.
 */
export const reservedHeaderIssue = (advice: string): Issue => ({
  kind: 'header',
  message: `'${X_MATCH}' is the mode of a headers binding (all, any, all-with-x or any-with-x), and not a condition. ${advice}`,
});

/** Why a message cannot have this many headers, or a binding this many arguments, or `null` when it can (ADR-0029). */
export function tooManyEntriesIssue(whose: 'message' | 'binding', count: number): Issue | null {
  return count > LIMITS.headerEntries
    ? {
        kind: 'header',
        message: `The ${whose === 'message' ? 'headers of one message' : 'arguments of one binding'} are at most ${LIMITS.headerEntries}, and there are ${count}. Take some off.`,
      }
    : null;
}

function entriesIssue(whose: 'message' | 'binding', entries: readonly HeaderEntry<HeaderCondition>[]): Issue | null {
  const tooMany = tooManyEntriesIssue(whose, entries.length);
  if (tooMany !== null) {
    return tooMany;
  }
  const seen = new Set<string>();
  for (const { key, value } of entries) {
    const issue = headerKeyIssue(key) ?? headerValueProblem(key, value);
    if (issue !== null) {
      return issue;
    }
    if (seen.has(key)) {
      return duplicateHeaderIssue(key);
    }
    seen.add(key);
  }
  return null;
}

/** Why the headers of a message cannot be sent, or `null` when they can. */
export function messageHeadersIssue(headers: readonly HeaderEntry<HeaderValue>[]): Issue | null {
  return entriesIssue('message', headers);
}

/**
 * Why the arguments of a binding are not arguments that a broker would take, or `null` when they are. `x-match` is the
 * binding's mode and never a condition: a condition with that name would be a second `x-match`.
 */
export function bindingHeadersIssue(headers: HeaderArguments): Issue | null {
  const reserved = headers.args.find(({ key }) => key === X_MATCH);
  if (reserved !== undefined) {
    return reservedHeaderIssue(`Write it as ${X_MATCH}=any, for example.`);
  }
  return entriesIssue('binding', headers.args);
}

// A binding is the same binding for the engine and for the canvas, so the question is the engine's (ADR-0051).
export { bindingSignature, canonicalHeaders } from '@rmq/engine';

/** Whether two sets of arguments are the same binding's: the same mode and the same conditions, in any order (ADR-0051). */
export const sameHeaders = (a: HeaderArguments | undefined, b: HeaderArguments | undefined): boolean =>
  bindingSignature('', 'queue', '', '', a) === bindingSignature('', 'queue', '', '', b);
