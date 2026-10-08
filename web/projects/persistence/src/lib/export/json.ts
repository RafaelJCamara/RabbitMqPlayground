/**
 * The writer of the definitions file (ADR-0079). JSON has one kind of number, and RabbitMQ tells `1` from `1.0` when it imports a file: the first is an integer and the second a float, so a header whose value is
 * the float `1` has to be written `1.0` or the broker would hold the integer, and a binding that matches only a float would match only an integer (ADR-0009). `JSON.stringify` writes `1`. So the file is written
 * by this: the one place where numbers are turned into text. A float is marked as one by being a `Float`, which nothing in a canvas can clash with, and the keys of an object keep the order they were given
 * in, which a JavaScript object does not for a key that looks like a number.
 */

/** A number that is written as a float: with a point, or an exponent. */
export class Float {
  constructor(readonly value: number) {}
}

/** An object whose keys are written in the order they are given. */
export class Fields {
  constructor(readonly entries: readonly (readonly [string, Value])[]) {}
}

export type Value = null | boolean | number | string | Float | Fields | readonly Value[];

/** The text of a float: `1.5`, `1e+21`, `1.0` for one, and `-0.0` for a zero with a sign. A whole number gets the point that JSON leaves out. */
export function floatText(value: number): string {
  if (Object.is(value, -0)) {
    return '-0.0';
  }
  const text = String(value);
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

const INDENT = '  ';

/** The value as JSON text with two spaces of indentation, as `JSON.stringify(value, null, 2)` writes it, except for a `Float`. It has no final newline. */
export function writeValue(value: Value, depth = 0): string {
  if (value instanceof Float) {
    return floatText(value.value);
  }
  if (value instanceof Fields) {
    if (value.entries.length === 0) {
      return '{}';
    }
    const inner = INDENT.repeat(depth + 1);
    const lines = value.entries.map(
      ([key, entry]) => `${inner}${JSON.stringify(key)}: ${writeValue(entry, depth + 1)}`,
    );
    return `{\n${lines.join(',\n')}\n${INDENT.repeat(depth)}}`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }
    const inner = INDENT.repeat(depth + 1);
    const lines = value.map((entry) => `${inner}${writeValue(entry, depth + 1)}`);
    return `[\n${lines.join(',\n')}\n${INDENT.repeat(depth)}]`;
  }
  return JSON.stringify(value);
}
