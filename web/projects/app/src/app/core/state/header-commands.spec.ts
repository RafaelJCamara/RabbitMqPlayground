import { applyCommand, formatCommand } from '@rmq/domain';
import { bool, documentOf, entry, float, int, producerRecord, str } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { messageHeadersCommand } from './header-commands';

const ids = { newId: () => 'scratch1' };
const withHeaders = (...headers: ReturnType<typeof entry<ReturnType<typeof str>>>[]) =>
  documentOf({
    producers: {
      p: producerRecord('sender', null, { message: { payload: '', key: '', headers } }),
    },
  });

describe('messageHeadersCommand (ADR-0069)', () => {
  it('is nothing when the table is what the message has, so that leaving a field that was not changed makes no step of undo', () => {
    const current = [entry('a', int(1)), entry('b', str('x'))];

    expect(messageHeadersCommand('sender', current, current)).toBeUndefined();
    expect(messageHeadersCommand('sender', [], [])).toBeUndefined();
  });

  it('is a set of the header that is new, and of the one that has another value, and of nothing else', () => {
    const current = [entry('a', int(1)), entry('b', str('x'))];

    expect(messageHeadersCommand('sender', current, [...current, entry('c', bool(true))])).toEqual({
      type: 'set',
      kind: 'producer',
      name: 'sender',
      changes: { headers: [entry('c', bool(true))] },
    });
    expect(messageHeadersCommand('sender', current, [entry('a', int(2)), entry('b', str('x'))])).toEqual({
      type: 'set',
      kind: 'producer',
      name: 'sender',
      changes: { headers: [entry('a', int(2))] },
    });
  });

  it('is an unset of the header that was taken off', () => {
    expect(messageHeadersCommand('sender', [entry('a', int(1)), entry('b', int(2))], [entry('b', int(2))])).toEqual({
      type: 'unset',
      kind: 'producer',
      name: 'sender',
      headers: ['a'],
    });
  });

  it('is one batch, an unset and a set, for a name that was changed, which is one step of undo', () => {
    expect(messageHeadersCommand('sender', [entry('old', int(1))], [entry('new', int(1))])).toEqual({
      type: 'batch',
      commands: [
        { type: 'unset', kind: 'producer', name: 'sender', headers: ['old'] },
        { type: 'set', kind: 'producer', name: 'sender', changes: { headers: [entry('new', int(1))] } },
      ],
    });
  });

  it('tells a value from the same value of another type, which is what a headers exchange does: 1, 1.0 and "1"', () => {
    const one = [entry('n', int(1))];

    expect(messageHeadersCommand('sender', one, [entry('n', float(1))])).toMatchObject({ type: 'set' });
    expect(messageHeadersCommand('sender', one, [entry('n', str('1'))])).toMatchObject({ type: 'set' });
    expect(messageHeadersCommand('sender', [entry('n', float(-0))], [entry('n', float(0))])).toMatchObject({
      type: 'set',
    });
  });

  it('says the line that a learner would type, for each of them', () => {
    const document = withHeaders(entry('a', int(1)));
    const unset = messageHeadersCommand('sender', [entry('a', int(1))], []);
    const set = messageHeadersCommand('sender', [entry('a', int(1))], [entry('a', str('1'))]);
    const batch = messageHeadersCommand('sender', [entry('a', int(1))], [entry('b', float(1))]);

    expect(unset && formatCommand(unset, document)).toBe('unset sender header:a');
    expect(set && formatCommand(set, document)).toBe('set sender header:a="1"');
    expect(batch && formatCommand(batch, document)).toBe('unset sender header:a; set sender header:b=1.0');
  });

  it('gives the message the table that it was made from when it is applied, with the new names last', () => {
    const current = [entry('a', int(1)), entry('b', int(2))];
    const next = [entry('a', int(5)), entry('c', str('z'))];
    const document = withHeaders(...current);

    const result = applyCommand(document, messageHeadersCommand('sender', current, next)!, ids);

    expect(result.ok && result.value.producers['p']?.message.headers).toEqual([
      entry('a', int(5)),
      entry('c', str('z')),
    ]);
  });
});
