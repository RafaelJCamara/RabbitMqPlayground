import type { HeaderCondition, HeaderValue } from '@rmq/engine';
import { anyQuoted, isBareSafe, quote, textOf, wordText } from './words';
import type { Segment } from './tokenizer';

/**
 * Typed values in a typed command (ADR-0009, ADR-0025). A header value is always typed, and the type is read from how it is
 * written, the way that the editor reads it: `"1"` is a string, `1` is an integer, `1.0` is a float and `true` is a
 * boolean. Anything else that is bare is a string, and anything in quotes is a string whatever it looks like.
 */

const INTEGER = /^-?\d+$/;
const FLOAT = /^-?\d+\.\d+$|^-?\d+(\.\d+)?[eE][+-]?\d+$/;

/** Whether bare text would be read as a number. */
export const looksLikeNumber = (text: string): boolean => INTEGER.test(text) || FLOAT.test(text);

/** Reads the value from the segments of a word: quoted is a string, and bare is what it looks like. */
export function parseValue(segments: readonly Segment[]): HeaderValue {
  const text = textOf(segments);
  if (anyQuoted(segments)) {
    return { t: 'string', v: text };
  }
  if (text === 'true' || text === 'false') {
    return { t: 'boolean', v: text === 'true' };
  }
  if (INTEGER.test(text)) {
    // `-0` is the integer 0: an integer has no sign of zero.
    return { t: 'integer', v: Number(text) + 0 };
  }
  if (FLOAT.test(text)) {
    return { t: 'float', v: Number(text) };
  }
  return { t: 'string', v: text };
}

/** A float, written so that it reads back as a float: `1.0` and not `1`, and the sign of a zero kept. */
export function formatFloat(value: number): string {
  if (Object.is(value, -0)) {
    return '-0.0';
  }
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/** The value as it is written in a command, so that reading it gives the same value back. */
export function formatValue(value: HeaderValue): string {
  switch (value.t) {
    case 'string':
      return isBareSafe(value.v) && !looksLikeNumber(value.v) && value.v !== 'true' && value.v !== 'false'
        ? value.v
        : quote(value.v);
    case 'integer':
      return String(value.v);
    case 'float':
      return formatFloat(value.v);
    case 'boolean':
      return value.v ? 'true' : 'false';
  }
}

/**
 * A condition of a binding as it is written: `name=value`, or `exists(name)`. A name that is also one of the command's own
 * options is quoted, which is how a header is told from an option.
 */
export function formatCondition(key: string, condition: HeaderCondition, optionNames: readonly string[]): string {
  if (condition.t === 'exists') {
    return `exists(${wordText(key)})`;
  }
  const name = optionNames.includes(key) ? quote(key) : wordText(key);
  return `${name}=${formatValue(condition)}`;
}
