import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isJsonObject, JsonNumber, MAX_JSON_DEPTH, readJson, type JsonValue } from './json';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

/** The value as `JSON.parse` gives it, to compare the two readers: a map is an object, and a number is its value. */
function plain(value: JsonValue): unknown {
  if (value instanceof JsonNumber) {
    return value.value;
  }
  if (Array.isArray(value)) {
    return value.map(plain);
  }
  if (isJsonObject(value)) {
    return Object.fromEntries([...value].map(([key, item]) => [key, plain(item)]));
  }
  return value;
}

const read = (text: string): JsonValue => {
  const result = readJson(text);
  if (!result.ok) {
    throw new Error(`expected JSON, and got: ${result.error}`);
  }
  return result.value;
};

const refused = (text: string): string => {
  const result = readJson(text);
  if (result.ok) {
    throw new Error(`expected a refusal of ${text}`);
  }
  return result.error;
};

describe('readJson (ADR-0111)', () => {
  it('reads what JSON.parse reads, as it reads it', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = JSON.stringify(value, null, 1);
        expect(plain(read(text))).toEqual(JSON.parse(text));
      }),
    );
  });

  it('never throws, whatever the text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        const result = readJson(text);
        expect(typeof result.ok).toBe('boolean');
      }),
    );
  });

  it('keeps apart a whole number and one with a fraction or an exponent', () => {
    expect(read('[1, 1.0, -0.0, 1e2, 1E-7, 0, -3]')).toEqual([
      new JsonNumber(1, false),
      new JsonNumber(1, true),
      new JsonNumber(-0, true),
      new JsonNumber(100, true),
      new JsonNumber(1e-7, true),
      new JsonNumber(0, false),
      new JsonNumber(-3, false),
    ]);
  });

  it('keeps the keys of an object in the order of the file, numbers first or not, and the last value of a key that is there twice', () => {
    const object = read('{"x-match": "any", "10": 1, "2": 2, "a": 1, "a": 3}');

    expect(isJsonObject(object) && [...object.keys()]).toEqual(['x-match', '10', '2', 'a']);
    expect(isJsonObject(object) && object.get('a')).toEqual(new JsonNumber(3, false));
  });

  it('takes __proto__ as a key like any other', () => {
    const object = read('{"__proto__": {"polluted": true}}');

    expect(isJsonObject(object) && isJsonObject(object.get('__proto__'))).toBe(true);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('reads the escapes of a string', () => {
    expect(read(String.raw`"a\"b\\c\/d\b\f\n\r\té\u2028"`)).toBe('a"b\\c/d\b\f\n\r\té\u2028');
  });

  it.each([
    ['', 'the text ends where a value was expected, at character 1'],
    ['[1,]', 'a value was expected, at character 4'],
    ['{"a" 1}', 'a key of an object has to be followed by ":", at character 6'],
    ['{a: 1}', 'a key of an object has to be a string, at character 2'],
    ['[1 2]', 'an array needs "," between its items, and "]" at its end, at character 4'],
    ['{"a": 1 "b": 2}', 'an object needs "," between its members, and "}" at its end, at character 9'],
    ['"open', 'a string is not closed, at character 6'],
    ['"a\u0001"', 'a string cannot have a control character in it unless it is escaped, at character 3'],
    [String.raw`"\x"`, '"\\x" is not an escape of JSON, at character 3'],
    [String.raw`"\u12"`, '\\u has to be followed by four hexadecimal digits, at character 4'],
    ['01', 'there is more after the end of the JSON, at character 2'],
    ['1e400', 'a number is too large, at character 6'],
    ['NaN', 'a value was expected, at character 1'],
    ['{} {}', 'there is more after the end of the JSON, at character 4'],
  ])('refuses %j, and says where', (text, message) => {
    expect(refused(text)).toBe(message);
  });

  it(`reads arrays and objects ${MAX_JSON_DEPTH} deep, and refuses deeper ones without running out of stack`, () => {
    expect(readJson('['.repeat(MAX_JSON_DEPTH) + ']'.repeat(MAX_JSON_DEPTH)).ok).toBe(true);
    expect(refused('['.repeat(100_000))).toBe(
      `it is nested more than ${MAX_JSON_DEPTH} deep, at character ${MAX_JSON_DEPTH + 1}`,
    );
    expect(refused('{"a":'.repeat(MAX_JSON_DEPTH + 1))).toContain('it is nested more than');
  });
});
