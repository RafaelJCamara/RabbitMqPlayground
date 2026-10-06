import {
  headerValueIssue,
  utf8Length,
  type HeaderArguments,
  type HeaderCondition,
  type HeaderEntry,
  type HeaderValue,
} from '@rmq/engine';
import type { Issue } from './issue';

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

/** Why `value` cannot be the value of the header called `key`, or `null` when it can. */
export function headerValueProblem(key: string, value: HeaderCondition): Issue | null {
  const issue = headerValueIssue(value);
  return issue === null ? null : { kind: 'header', message: `The header '${key}': ${issue}.` };
}

function entriesIssue(entries: readonly HeaderEntry<HeaderCondition>[]): Issue | null {
  const seen = new Set<string>();
  for (const { key, value } of entries) {
    const issue = headerKeyIssue(key) ?? headerValueProblem(key, value);
    if (issue !== null) {
      return issue;
    }
    if (seen.has(key)) {
      return {
        kind: 'header',
        message: `The header '${key}' is there twice. A table of headers has each name once, so give it one value.`,
      };
    }
    seen.add(key);
  }
  return null;
}

/** Why the headers of a message cannot be sent, or `null` when they can. */
export function messageHeadersIssue(headers: readonly HeaderEntry<HeaderValue>[]): Issue | null {
  return entriesIssue(headers);
}

/**
 * Why the arguments of a binding are not arguments that a broker would take, or `null` when they are. `x-match` is the
 * binding's mode and never a condition: a condition with that name would be a second `x-match`.
 */
export function bindingHeadersIssue(headers: HeaderArguments): Issue | null {
  const reserved = headers.args.find(({ key }) => key === X_MATCH);
  if (reserved !== undefined) {
    return {
      kind: 'header',
      message: `'${X_MATCH}' is the mode of a headers binding (all, any, all-with-x or any-with-x), and not a condition. Write it as ${X_MATCH}=any, for example.`,
    };
  }
  return entriesIssue(headers.args);
}

/**
 * The arguments of a binding in their one plain form. A binding with no `x-match` and no conditions has no arguments at
 * all, so it is written without any, and two ways of saying "nothing" are not two bindings.
 */
export function canonicalHeaders(headers: HeaderArguments | undefined): HeaderArguments | undefined {
  return headers === undefined || (headers.xMatch === null && headers.args.length === 0) ? undefined : headers;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What a broker keeps about a binding, as one string: its two ends, its key and its arguments. The order of the arguments
 * does not matter, because a table has none. The ends are ids in a document and names in the engine, and the caller
 * says which, as long as it says the same thing on both sides of a comparison.
 */
export function bindingSignature(
  source: string,
  destinationKind: 'queue' | 'exchange',
  destination: string,
  key: string,
  headers: HeaderArguments | undefined,
): string {
  const canonical = canonicalHeaders(headers);
  const args =
    canonical === undefined
      ? null
      : [
          canonical.xMatch,
          canonical.args
            .map(({ key: name, value }) => [name, value.t, 'v' in value ? value.v : null] as const)
            .sort((a, b) => compareText(a[0], b[0])),
        ];
  return JSON.stringify([source, destinationKind, destination, key, args]);
}
