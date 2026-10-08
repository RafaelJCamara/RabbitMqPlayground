import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Fields, Float, floatText, writeValue, type Value } from './json';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

/** A tree of JSON as the writer reads it: an object is a list of fields, in the order that `Object.entries` gives them. */
const asValue = (json: unknown): Value =>
  Array.isArray(json)
    ? json.map(asValue)
    : typeof json === 'object' && json !== null
      ? new Fields(Object.entries(json).map(([key, inner]) => [key, asValue(inner)] as const))
      : (json as Value);

describe('floatText (ADR-0079)', () => {
  it.each([
    [1, '1.0'],
    [0, '0.0'],
    [-0, '-0.0'],
    [-1, '-1.0'],
    [42, '42.0'],
    [1.5, '1.5'],
    [-0.5, '-0.5'],
    [0.1 + 0.2, '0.30000000000000004'],
    [0.000001, '0.000001'],
    [1.5e-7, '1.5e-7'],
    [1e21, '1e+21'],
    [-1e21, '-1e+21'],
    [123456789012345680000, '123456789012345680000.0'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991.0'],
    [Number.MAX_VALUE, '1.7976931348623157e+308'],
    [Number.MIN_VALUE, '5e-324'],
    [Number.EPSILON, '2.220446049250313e-16'],
  ])('writes %s as %s', (value, text) => {
    expect(floatText(value)).toBe(text);
  });

  it('writes a number that reads back as the very same float, and always with a point or an exponent, for any finite float', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
        const text = floatText(value);

        expect(Object.is(JSON.parse(text), value), text).toBe(true);
        expect(text).toMatch(/[.eE]/);
      }),
    );
  });
});

describe('writeValue', () => {
  it('writes a float with a point and an integer without one, side by side', () => {
    expect(
      writeValue(
        new Fields([
          ['int', 1],
          ['float', new Float(1)],
        ]),
      ),
    ).toBe('{\n  "int": 1,\n  "float": 1.0\n}');
  });

  it('writes the fields of an object in the order they were given, even when a key looks like a number', () => {
    const fields = new Fields([
      ['10', 'a'],
      ['2', 'b'],
      ['b', 'c'],
      ['1', 'd'],
    ]);

    expect(writeValue(fields)).toBe('{\n  "10": "a",\n  "2": "b",\n  "b": "c",\n  "1": "d"\n}');
    // A JavaScript object would have put them in another order.
    expect(Object.keys({ '10': 'a', '2': 'b', b: 'c', '1': 'd' })).toEqual(['1', '2', '10', 'b']);
  });

  it('writes an empty object as {} and an empty list as [], and nothing but a value for the rest', () => {
    expect(writeValue(new Fields([]))).toBe('{}');
    expect(writeValue([])).toBe('[]');
    expect(writeValue(null)).toBe('null');
    expect(writeValue(true)).toBe('true');
    expect(writeValue(false)).toBe('false');
    expect(writeValue(-3)).toBe('-3');
    expect(writeValue('a')).toBe('"a"');
  });

  it('indents by two spaces for each level, in objects and in lists', () => {
    const value = new Fields([['a', [new Fields([['b', [1, 2]]]), []]]]);

    expect(writeValue(value)).toBe(
      '{\n  "a": [\n    {\n      "b": [\n        1,\n        2\n      ]\n    },\n    []\n  ]\n}',
    );
  });

  it('writes text as JSON does: quotes, backslashes, new lines, control characters, and a lone surrogate that is written as an escape', () => {
    const text = 'a "quoted" \\ line\nbreak\ttab \u0001 \ud800 é 😀';

    expect(writeValue(text)).toBe(JSON.stringify(text));
    expect(JSON.parse(writeValue(text))).toBe(text);
  });

  it('writes the same text as JSON.stringify with two spaces for any tree of JSON, which has no float to tell apart', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (json) => {
        expect(writeValue(asValue(json))).toBe(JSON.stringify(json, null, 2));
      }),
    );
  });

  it('writes JSON that reads back as the tree that was written, with the floats it was given, for any tree', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.double({ noNaN: true, noDefaultInfinity: true }), (json, float) => {
        const read = JSON.parse(
          writeValue(
            new Fields([
              ['tree', asValue(json)],
              ['float', new Float(float)],
            ]),
          ),
        ) as {
          tree: unknown;
          float: number;
        };

        expect(read.tree).toEqual(json);
        expect(Object.is(read.float, float)).toBe(true);
      }),
    );
  });
});
