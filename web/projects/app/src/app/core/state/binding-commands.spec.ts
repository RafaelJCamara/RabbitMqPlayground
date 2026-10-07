import { applyCommand, type CanvasDocument } from '@rmq/domain';
import type { HeaderArguments } from '@rmq/engine';
import {
  entry,
  exchangeRecord,
  bindingRecord,
  documentOf,
  headerArguments,
  queueRecord,
  sampleDocument,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { bindingRows, rebindCommand, rebindHeadersCommand, unbindCommand } from './binding-commands';

const ids = { newId: () => 'scratch1' };
const orders = (): CanvasDocument =>
  documentOf({
    exchanges: { x: exchangeRecord('orders', 'topic'), y: exchangeRecord('docs', 'headers') },
    queues: { q: queueRecord('billing') },
    bindings: {
      b1: bindingRecord('x', { kind: 'queue', id: 'q' }, 'order.*'),
      b2: bindingRecord('x', { kind: 'queue', id: 'q' }, 'invoice.#'),
      b3: bindingRecord('y', { kind: 'queue', id: 'q' }, '', headerArguments('any', entry('format', str('pdf')))),
      b4: bindingRecord('x', { kind: 'exchange', id: 'y' }, '#'),
    },
  });

describe('bindingRows (ADR-0044)', () => {
  it('lists the bindings of an edge, in the order that they were made, with their keys', () => {
    expect(bindingRows(orders(), 'x>q')).toEqual([
      { id: 'b1', key: 'order.*', hasArguments: false },
      { id: 'b2', key: 'invoice.#', hasArguments: false },
    ]);
  });

  it('says which of them has header arguments', () => {
    expect(bindingRows(orders(), 'y>q')).toEqual([
      {
        id: 'b3',
        key: '',
        hasArguments: true,
        headers: headerArguments('any', entry('format', str('pdf'))),
      },
    ]);
  });

  it('carries the arguments of each, for the editor of the conditions, and nothing for a binding that has none (ADR-0066)', () => {
    const [keyed] = bindingRows(orders(), 'x>q');

    expect(keyed?.headers).toBeUndefined();
    expect(Object.hasOwn(keyed ?? {}, 'headers')).toBe(true);
  });

  it('lists the bindings between two exchanges as well', () => {
    expect(bindingRows(orders(), 'x>y')).toEqual([{ id: 'b4', key: '#', hasArguments: false }]);
  });

  it('is empty for an edge that has no binding, a link, and a key that is not an edge', () => {
    expect(bindingRows(orders(), 'q>x')).toEqual([]);
    expect(bindingRows(sampleDocument(), 'P1>E1')).toEqual([]);
    expect(bindingRows(orders(), 'nonsense')).toEqual([]);
  });
});

describe('unbindCommand', () => {
  it('names the binding exactly as the document has it, by kind and name, with its key', () => {
    expect(unbindCommand(orders(), 'b1')).toEqual({
      type: 'unbind',
      source: 'orders',
      destination: { kind: 'queue', name: 'billing' },
      key: 'order.*',
    });
  });

  it('carries the arguments of a headers binding, because an unbind says the binding exactly', () => {
    expect(unbindCommand(orders(), 'b3')).toMatchObject({
      type: 'unbind',
      source: 'docs',
      key: '',
      headers: { xMatch: 'any' },
    });
  });

  it('names an exchange that is bound to an exchange as one', () => {
    expect(unbindCommand(orders(), 'b4')).toMatchObject({ destination: { kind: 'exchange', name: 'docs' } });
  });

  it('takes the binding off when it is applied', () => {
    const document = orders();

    const result = applyCommand(document, unbindCommand(document, 'b1')!, ids);

    expect(result.ok && Object.keys(result.value.bindings)).toEqual(['b2', 'b3', 'b4']);
  });

  it('is nothing for a binding that is not there', () => {
    expect(unbindCommand(orders(), 'gone')).toBeUndefined();
    expect(unbindCommand(orders(), 'constructor')).toBeUndefined();
  });
});

describe('rebindCommand', () => {
  it('is an unbind and a bind, in one batch, which is one step of undo, with the key that is given', () => {
    expect(rebindCommand(orders(), 'b1', 'order.new')).toEqual({
      type: 'batch',
      commands: [
        { type: 'unbind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'order.*' },
        { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'order.new' },
      ],
    });
  });

  it('gives the binding its new key when it is applied, and keeps its place among the others by making it last', () => {
    const document = orders();

    const result = applyCommand(document, rebindCommand(document, 'b1', 'order.new')!, ids);

    expect(result.ok && Object.values(result.value.bindings).map(({ key }) => key)).toEqual([
      'invoice.#',
      '',
      '#',
      'order.new',
    ]);
  });

  it('keeps the header arguments of the binding', () => {
    const command = rebindCommand(orders(), 'b3', 'k');

    expect(command).toMatchObject({
      type: 'batch',
      commands: [
        { type: 'unbind', headers: { xMatch: 'any' } },
        { type: 'bind', key: 'k', headers: { xMatch: 'any' } },
      ],
    });
  });

  it('is nothing when the key is the one that it has, because it would change nothing', () => {
    expect(rebindCommand(orders(), 'b1', 'order.*')).toBeUndefined();
  });

  it('is nothing for a binding that is not there', () => {
    expect(rebindCommand(orders(), 'gone', 'k')).toBeUndefined();
  });

  it('is refused by the domain when the new key is not allowed, and the batch changes nothing', () => {
    const document = orders();

    const result = applyCommand(document, rebindCommand(document, 'b1', '#.#.#')!, ids);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe('topic-wildcards');
  });
});

describe('rebindHeadersCommand (ADR-0066)', () => {
  const OTHER: HeaderArguments = headerArguments('all', entry('format', str('doc')), entry('n', str('1')));

  it('is an unbind and a bind, in one batch, which is one step of undo, with the other arguments and the same key', () => {
    expect(rebindHeadersCommand(orders(), 'b3', OTHER)).toEqual({
      type: 'batch',
      commands: [
        {
          type: 'unbind',
          source: 'docs',
          destination: { kind: 'queue', name: 'billing' },
          key: '',
          headers: headerArguments('any', entry('format', str('pdf'))),
        },
        { type: 'bind', source: 'docs', destination: { kind: 'queue', name: 'billing' }, key: '', headers: OTHER },
      ],
    });
  });

  it('gives the binding its other arguments when it is applied, last among the bindings, and keeps its ends', () => {
    const document = orders();

    const result = applyCommand(document, rebindHeadersCommand(document, 'b3', OTHER)!, ids);

    const bindings = result.ok ? Object.values(result.value.bindings) : [];
    expect(bindings.map(({ key }) => key)).toEqual(['order.*', 'invoice.#', '#', '']);
    expect(bindings.at(-1)).toMatchObject({ dest: { kind: 'queue' }, headers: OTHER });
  });

  it('keeps the key of a binding that has one, which a headers exchange does not read', () => {
    const document = documentOf({
      exchanges: { y: exchangeRecord('docs', 'headers') },
      queues: { q: queueRecord('billing') },
      bindings: { b: bindingRecord('y', { kind: 'queue', id: 'q' }, 'order.*', headerArguments('all')) },
    });

    expect(rebindHeadersCommand(document, 'b', OTHER)).toMatchObject({
      commands: [
        { type: 'unbind', key: 'order.*' },
        { type: 'bind', key: 'order.*' },
      ],
    });
  });

  it('makes a binding that has no arguments out of arguments that say nothing, and takes the arguments off the command', () => {
    const command = rebindHeadersCommand(orders(), 'b3', undefined);

    expect(command).toMatchObject({ commands: [{ type: 'unbind' }, { type: 'bind', key: '' }] });
    expect(command && command.type === 'batch' && 'headers' in command.commands[1]!).toBe(false);
  });

  it('is nothing when the arguments are the ones that the binding has, in any order, because it would change nothing', () => {
    const same = headerArguments('any', entry('format', str('pdf')));

    expect(rebindHeadersCommand(orders(), 'b3', same)).toBeUndefined();
    const two = documentOf({
      exchanges: { y: exchangeRecord('docs', 'headers') },
      queues: { q: queueRecord('billing') },
      bindings: {
        b: bindingRecord(
          'y',
          { kind: 'queue', id: 'q' },
          '',
          headerArguments('all', entry('a', str('1')), entry('b', str('2'))),
        ),
      },
    });
    expect(
      rebindHeadersCommand(two, 'b', headerArguments('all', entry('b', str('2')), entry('a', str('1')))),
    ).toBeUndefined();
  });

  it('is something when only the mode differs, or when a mode that was left out is written', () => {
    expect(rebindHeadersCommand(orders(), 'b3', headerArguments('all', entry('format', str('pdf'))))).toBeDefined();
    const left = documentOf({
      exchanges: { y: exchangeRecord('docs', 'headers') },
      queues: { q: queueRecord('billing') },
      bindings: { b: bindingRecord('y', { kind: 'queue', id: 'q' }, '', headerArguments(null, entry('a', str('1')))) },
    });
    expect(rebindHeadersCommand(left, 'b', headerArguments('all', entry('a', str('1'))))).toBeDefined();
  });

  it('is nothing for a binding that is not there', () => {
    expect(rebindHeadersCommand(orders(), 'gone', OTHER)).toBeUndefined();
  });

  it('is refused by the domain when the arguments are not allowed, and the batch changes nothing', () => {
    const document = orders();
    const twice = headerArguments('all', entry('a', str('1')), entry('a', str('2')));

    const result = applyCommand(document, rebindHeadersCommand(document, 'b3', twice)!, ids);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toMatch(/there twice/u);
  });

  it('is one binding, and not two, when the new arguments are another binding’s between the same ends', () => {
    const document = documentOf({
      exchanges: { y: exchangeRecord('docs', 'headers') },
      queues: { q: queueRecord('billing') },
      bindings: {
        a: bindingRecord('y', { kind: 'queue', id: 'q' }, '', headerArguments('all', entry('a', str('1')))),
        b: bindingRecord('y', { kind: 'queue', id: 'q' }, '', headerArguments('all', entry('b', str('2')))),
      },
    });

    const result = applyCommand(
      document,
      rebindHeadersCommand(document, 'a', headerArguments('all', entry('b', str('2'))))!,
      ids,
    );

    expect(result.ok && Object.keys(result.value.bindings)).toEqual(['b']);
  });
});
