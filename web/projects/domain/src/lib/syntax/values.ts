import type { HeaderCondition, HeaderValue } from '@rmq/engine';
import { headerValueProblem } from '../document/headers';
import { fail, ok, type Issue, type Result } from '../document/issue';
import { tokenize, type Segment } from './tokenizer';
import { anyQuoted, isBareSafe, quote, textOf, wordText } from './words';

/**
 * Typed values in a typed command (ADR-0009, ADR-0025). A header value is always typed, and the type is read from how it is
 * written, the way that the editor reads it: `"1"` is a string, `1` is an integer, `1.0` is a float and `true` is a
 * boolean. Anything else that is bare is a string, and anything in quotes is a string whatever it looks like.
 *
 * One reader serves the grammar and the fields of the editor (ADR-0067): `readValue` reads the pieces of a word and refuses
 * what the engine and the limits refuse, `inferValue` reads the text of a field as a word first, and `retypeValue` writes
 * the text that says another type.
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

/**
 * The value that the pieces of a word say, or why the engine or the limits refuse it (ADR-0023, ADR-0029): the reader of `name=value` and `header:name=value`
 * in a command. A field that has no name yet asks with `null` for the name, and gets the sentence without it.
 */
export function readValue(segments: readonly Segment[], key: string | null): Result<HeaderValue> {
  const value = parseValue(segments);
  const problem = headerValueProblem(key, value);
  return problem === null ? ok(value) : fail(problem);
}

/** A value that has not been given, as a field says it. After an `=` on a command line nothing is the empty string, because the `=` was typed. */
const needsValue = (hint: string): Issue => ({ kind: 'header', message: `A header needs a value: ${hint}.` });

/** What is expected of an empty field, in a sentence that follows "A header needs a value:", for each type that a learner may have chosen, and for none. */
const EXPECTED: Readonly<Record<ValueType | 'any', string>> = {
  any: 'write one, such as pdf, 7, 1.5 or true, or "" for an empty text',
  string: 'a string, such as pdf, or "" for an empty text',
  integer: 'an integer, such as 7',
  float: 'a float, such as 1.5',
  boolean: 'true or false',
};

/** The sentence for a field that is empty, which says what is expected when a type was chosen for it (ADR-0067). */
export const needsValueOf = (type?: ValueType): Issue => needsValue(EXPECTED[type ?? 'any']);

/** What a field's text is, as a word and before anything is asked of the engine: text with spaces outside quotes is a string as it was typed, and not two words. */
function readText(text: string): Result<HeaderValue> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return fail(needsValueOf());
  }
  const tokens = tokenize(trimmed);
  if (!tokens.ok) {
    return fail(tokens.error);
  }
  const [only, ...rest] = tokens.tokens;
  return only?.kind === 'word' && rest.length === 0 ? ok(parseValue(only.segments)) : ok({ t: 'string', v: trimmed });
}

/**
 * The value that the text of a field says (ADR-0067): the text of a value as a command writes it after the `=`, with the spaces round it dropped, and text with
 * spaces inside it a string as it was typed. Nothing is a value that has not been given, and `""` is the empty string. A value that the engine or the limits refuse
 * is refused, with the sentence that a command gives. `key` is the name of the header, for the sentence, or `null` when there is none yet.
 */
export function inferValue(text: string, key: string | null = null): Result<HeaderValue> {
  const read = readText(text);
  if (!read.ok) {
    return read;
  }
  const problem = headerValueProblem(key, read.value);
  return problem === null ? read : fail(problem);
}

/** The type that a field's text reads as, before the engine is asked anything of it, or `null` when it says nothing yet or cannot be read. */
export function readType(text: string): ValueType | null {
  const read = readText(text);
  return read.ok ? read.value.t : null;
}

/** The types that a value of a header can have. */
export type ValueType = HeaderValue['t'];

export const VALUE_TYPES: readonly ValueType[] = ['string', 'integer', 'float', 'boolean'];

const refuse = (message: string): Result<never> => fail({ kind: 'invalid-value', message });

/**
 * The text that says the same thing in another type (ADR-0067): `1` as a string is `"1"`, `"1"` as an integer is `1`, `1` as a float is `1.0`, `1.0` as an integer
 * is `1`, `"true"` as a boolean is `true`. A change that has no meaning, `"pdf"` as an integer or `1.5` as an integer, is refused, and a number is never rounded to be
 * changed: digits are rewritten as digits. A text that is already that type is returned as it was typed, and a text that is empty is, because it says nothing yet.
 */
export function retypeValue(text: string, to: ValueType): Result<string> {
  const trimmed = text.trim();
  if (trimmed === '') {
    return ok(text);
  }
  const read = readText(trimmed);
  if (!read.ok) {
    return read;
  }
  const from = read.value;
  if (from.t === to) {
    return ok(trimmed);
  }
  // What the text says in the other type: a string says its characters (the quotes are not part of it), a number or a boolean says what was typed.
  const content = from.t === 'string' ? from.v : trimmed;
  const shown = from.t === 'string' ? quote(content) : content;

  switch (to) {
    case 'string':
      return ok(formatValue({ t: 'string', v: content }));
    case 'integer': {
      if (INTEGER.test(content)) {
        return ok(BigInt(content).toString());
      }
      if (FLOAT.test(content) && Number.isInteger(Number(content))) {
        const whole = Number(content) + 0;
        return Number.isSafeInteger(whole)
          ? ok(String(whole))
          : refuse(
              `${shown} is a whole number, but an integer header must be from ${Number.MIN_SAFE_INTEGER} to ${Number.MAX_SAFE_INTEGER}. Use a string for a larger number.`,
            );
      }
      return refuse(
        `${shown} is not a whole number, so it cannot be an integer. An integer is digits, such as 7 or -3.`,
      );
    }
    case 'float':
      if (INTEGER.test(content)) {
        return ok(formatFloat(Number(content) + 0));
      }
      return FLOAT.test(content)
        ? ok(content)
        : refuse(
            `${shown} is not a number, so it cannot be a float. A float has a point or an exponent, such as 1.5 or 1e3.`,
          );
    case 'boolean':
      return content === 'true' || content === 'false'
        ? ok(content)
        : refuse(`${shown} is not true or false, so it cannot be a boolean.`);
  }
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
