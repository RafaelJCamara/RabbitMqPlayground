import { describe, expect, it } from 'vitest';
import { bindingArguments, messageHeaders, toAmqpValue } from './headers';

describe('toAmqpValue', () => {
  it('sends a string as a plain string, which amqplib writes as a long string', () => {
    expect(toAmqpValue({ t: 'string', v: '1' })).toBe('1');
  });

  it('sends a boolean as a boolean', () => {
    expect(toAmqpValue({ t: 'boolean', v: true })).toBe(true);
    expect(toAmqpValue({ t: 'boolean', v: false })).toBe(false);
  });

  it('sends a float as a tagged double, because JavaScript cannot tell 1.0 from 1', () => {
    expect(toAmqpValue({ t: 'float', v: 1 })).toEqual({ '!': 'double', value: 1 });
    expect(toAmqpValue({ t: 'float', v: 2.5 })).toEqual({ '!': 'double', value: 2.5 });
  });

  it('sends an integer with no width as a plain number, and lets the client pick the smallest type', () => {
    expect(toAmqpValue({ t: 'integer', v: 1 })).toBe(1);
  });

  it.each([
    [8, 'byte'],
    [16, 'short'],
    [32, 'int'],
    [64, 'long'],
  ] as const)('sends a %i-bit integer as a tagged %s', (width, tag) => {
    expect(toAmqpValue({ t: 'integer', v: 7, width })).toEqual({ '!': tag, value: 7 });
  });

  it('sends an exists condition as null, which amqplib writes as AMQP void', () => {
    expect(toAmqpValue({ t: 'exists' })).toBeNull();
  });
});

describe('messageHeaders', () => {
  it('turns a list of typed headers into a header table', () => {
    expect(
      messageHeaders([
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'pages', value: { t: 'integer', v: 3 } },
        { key: 'ratio', value: { t: 'float', v: 1 } },
      ]),
    ).toEqual({ format: 'pdf', pages: 3, ratio: { '!': 'double', value: 1 } });
  });

  it('gives an empty table for no headers', () => {
    expect(messageHeaders([])).toEqual({});
  });
});

describe('bindingArguments', () => {
  it('puts x-match first, then the conditions', () => {
    const args = bindingArguments({
      xMatch: 'any',
      args: [
        { key: 'a', value: { t: 'string', v: 'x' } },
        { key: 'b', value: { t: 'exists' } },
      ],
    });

    expect(args).toEqual({ 'x-match': 'any', a: 'x', b: null });
    expect(Object.keys(args)).toEqual(['x-match', 'a', 'b']);
  });

  it('leaves x-match out when it is null, which the broker reads as "all"', () => {
    expect(bindingArguments({ xMatch: null, args: [{ key: 'a', value: { t: 'boolean', v: true } }] })).toEqual({
      a: true,
    });
  });

  it.each(['all', 'any', 'all-with-x', 'any-with-x'] as const)('passes x-match=%s through', (xMatch) => {
    expect(bindingArguments({ xMatch, args: [] })).toEqual({ 'x-match': xMatch });
  });
});
