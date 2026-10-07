import { entry, exchangeRecord, documentOf, int, str } from '@rmq/testing';
import { describe, expect, it, vi } from 'vitest';
import { Cursor } from './cursor';
import { parseCommand } from './parse';
import { parseMessageText } from './message';

describe('parseMessageText (ADR-0060, ADR-0064)', () => {
  it('reads nothing as a message with no key, no payload and no headers', () => {
    expect(parseMessageText('')).toEqual({ ok: true, value: { key: '', payload: '', headers: [] } });
    expect(parseMessageText('   ')).toEqual({ ok: true, value: { key: '', payload: '', headers: [] } });
  });

  it('reads the key, the payload and the headers, with the types that a command gives them', () => {
    const result = parseMessageText(
      'key=order.created payload=hello header:format=pdf header:n=1 header:v="1" header:f=1.0 header:ok=true',
    );

    expect(result).toEqual({
      ok: true,
      value: {
        key: 'order.created',
        payload: 'hello',
        headers: [
          entry('format', str('pdf')),
          entry('n', int(1)),
          entry('v', str('1')),
          entry('f', { t: 'float', v: 1 }),
          entry('ok', { t: 'boolean', v: true }),
        ],
      },
    });
  });

  it('reads a text in quotes whole, spaces and equal signs included', () => {
    expect(parseMessageText('key="a b" payload="x=y" header:"my header"="a b"')).toEqual({
      ok: true,
      value: { key: 'a b', payload: 'x=y', headers: [entry('my header', str('a b'))] },
    });
  });

  it('refuses an option that is not one, with the one that was probably meant', () => {
    const result = parseMessageText('kee=a');

    expect(result).toMatchObject({ ok: false, error: { kind: 'unknown-option', suggestions: ['key'] } });
    expect(result.ok ? '' : result.error.message).toBe(
      "There is no option 'kee' here. Its options are key and payload. Did you mean 'key'?",
    );
  });

  it.each<[string, RegExp]>([
    ['key=a key=b', /key is there twice/],
    ['hello', /Write 'hello' as name=value/],
    ['key=a ; key=b', /A message is one line, so leave out the ';'\./],
    ['key="a', /A quoted text is not closed/],
    ['header:n=9007199254740993', /whole number/],
    ['key=a -> key=b', /Unexpected '->'/],
  ])('refuses %j, and says why', (text, message) => {
    const result = parseMessageText(text);

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error.message).toMatch(message);
  });

  it('says where in the text the refusal is, and that it is of the syntax: a message is one line, which the batch of commands is not', () => {
    const result = parseMessageText('key=a ; key=b');

    expect(result.ok ? undefined : result.error.at).toEqual({ start: 6, end: 7 });
    expect(result).toMatchObject({ ok: false, error: { kind: 'syntax' } });
  });

  it('does not swallow an error that is not a refusal: a bug is a bug', () => {
    const broken = vi.spyOn(Cursor.prototype, 'options').mockImplementation(() => {
      throw new Error('not a refusal');
    });

    try {
      expect(() => parseMessageText('key=a')).toThrow('not a refusal');
    } finally {
      broken.mockRestore();
    }
  });

  it('reads what publish reads after an exchange: the same key, payload and headers', () => {
    const document = documentOf({ exchanges: { e1: exchangeRecord('orders', 'topic') } });
    const tail = 'key=order.created payload="a b" header:format=pdf header:n=1 header:f=2.5 header:ok=false';
    const command = parseCommand(`publish orders ${tail}`, document);
    const message = parseMessageText(tail);

    expect(command.ok && command.value).toMatchObject({ type: 'publish' });
    expect(message.ok && message.value).toEqual({
      key: command.ok && command.value.type === 'publish' ? command.value.key : undefined,
      payload: command.ok && command.value.type === 'publish' ? command.value.payload : undefined,
      headers: command.ok && command.value.type === 'publish' ? command.value.headers : undefined,
    });
  });
});
