import type { Issue } from '@rmq/domain';
import { summarise } from './errors';

/**
 * Checks of the shapes that persistence reads by hand: the record, the canvas file and the backup (ADR-0027). Persistence
 * may not import `zod` (ADR-0018), and these are a handful of fields, so each check says what is wrong in the same words as
 * the document's schema does: where it is, then what. A shape is strict, as the document is: a key that it does not have
 * is named.
 */

export type Raw = Readonly<Record<string, unknown>>;

/** An object that holds fields: not `null`, and not a list. */
export const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An id is 1 to 64 letters, digits, `.`, `:`, `_` or `-`, starting with a letter or a digit. */
export const CANVAS_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

const where = (path: readonly string[], whole: string): string => (path.length === 0 ? whole : path.join('.'));

/** A problem with the shape of the data, at `path`, as the document's own schema words it. */
export const shapeIssue = (path: readonly string[], whole: string, message: string): Issue => ({
  kind: 'schema',
  message: `${where(path, whole)}: ${message}`,
  path,
});

/** The keys that `raw` lacks, and the keys that it has and should not. `whole` says what `raw` is, for a problem with all of it. */
export function keyIssues(
  raw: Raw,
  required: readonly string[],
  optional: readonly string[],
  whole: string,
  path: readonly string[] = [],
): Issue[] {
  const missing = required
    .filter((key) => !Object.hasOwn(raw, key))
    .map((key) => shapeIssue([...path, key], whole, 'this is missing.'));
  const unknown = Object.keys(raw)
    .filter((key) => !required.includes(key) && !optional.includes(key))
    .map((key) => shapeIssue(path, whole, `Unrecognized key: "${key}"`));
  return [...missing, ...unknown];
}

export function idIssues(value: unknown, path: readonly string[], whole: string): Issue[] {
  return typeof value === 'string' && CANVAS_ID_PATTERN.test(value)
    ? []
    : [
        shapeIssue(
          path,
          whole,
          `an id is 1 to 64 letters, digits, dots, colons, hyphens or underscores, and this is ${summarise(value)}.`,
        ),
      ];
}

/** A name that is text and is not blank. How long it may be is a cap, and is checked apart (`checkName`). */
export function nameIssues(value: unknown, path: readonly string[], whole: string): Issue[] {
  if (typeof value !== 'string') {
    return [shapeIssue(path, whole, `a name is text, and this is ${summarise(value)}.`)];
  }
  return value.trim() === ''
    ? [{ kind: 'empty-name', message: `${where(path, whole)}: A canvas needs a name.`, path }]
    : [];
}

/** A time is a number of milliseconds since 1970, and is not before it. */
export function timeIssues(value: unknown, path: readonly string[], whole: string): Issue[] {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? []
    : [
        shapeIssue(
          path,
          whole,
          `a time is a number of milliseconds since 1970, from 0, and this is ${summarise(value)}.`,
        ),
      ];
}
