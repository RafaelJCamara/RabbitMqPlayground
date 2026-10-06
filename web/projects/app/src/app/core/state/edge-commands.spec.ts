import { applyCommand, edgeKeys, type CanvasDocument, type DocumentCommand } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  headerArguments,
  producerRecord,
  queueRecord,
  sequentialIds,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { removeEdgeCommands } from './edge-commands';

const document = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { x1: exchangeRecord('orders', 'topic'), x2: exchangeRecord('docs', 'headers') },
      queues: { q1: queueRecord('billing'), q2: queueRecord('archive') },
      bindings: {
        b1: bindingRecord('x1', { kind: 'queue', id: 'q1' }, 'order.*'),
        b2: bindingRecord('x1', { kind: 'queue', id: 'q1' }, 'invoice.#'),
        b3: bindingRecord('x1', { kind: 'exchange', id: 'x2' }, '#'),
        b4: bindingRecord('x2', { kind: 'queue', id: 'q2' }, '', headerArguments('any', entry('format', str('pdf')))),
      },
      producers: { p1: producerRecord('sender', { kind: 'exchange', id: 'x1' }), p2: producerRecord('idle') },
      consumers: { c1: consumerRecord('worker', ['q1']) },
    }),
  );

const apply = (before: CanvasDocument, commands: readonly DocumentCommand[]): CanvasDocument => {
  const result = applyCommand(before, { type: 'batch', commands }, sequentialIds());
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe('removeEdgeCommands', () => {
  it('unbinds every binding between the two ends, with its key, so that the edge goes', () => {
    const before = document();
    const commands = removeEdgeCommands(before, 'x1>q1');

    // Exactly these: a binding that has no arguments is unbound without saying that it has none.
    expect(commands).toStrictEqual([
      { type: 'unbind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'order.*' },
      { type: 'unbind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'invoice.#' },
    ]);
    expect(edgeKeys(apply(before, commands)).has('x1>q1')).toBe(false);
  });

  it('unbinds a binding to an exchange, and one that has arguments, which it has to say as they are', () => {
    const before = document();

    expect(removeEdgeCommands(before, 'x1>x2')).toEqual([
      { type: 'unbind', source: 'orders', destination: { kind: 'exchange', name: 'docs' }, key: '#' },
    ]);
    const commands = removeEdgeCommands(before, 'x2>q2');
    expect(commands).toEqual([
      {
        type: 'unbind',
        source: 'docs',
        destination: { kind: 'queue', name: 'archive' },
        key: '',
        headers: { xMatch: 'any', args: [{ key: 'format', value: { t: 'string', v: 'pdf' } }] },
      },
    ]);
    expect(edgeKeys(apply(before, commands)).has('x2>q2')).toBe(false);
  });

  it('unlinks the producer, whose edge it is', () => {
    const before = document();
    const commands = removeEdgeCommands(before, 'p1>x1');

    expect(commands).toEqual([{ type: 'unlink', producer: 'sender' }]);
    expect(edgeKeys(apply(before, commands)).has('p1>x1')).toBe(false);
  });

  it('unsubscribes the consumer from the queue, whose edge it is', () => {
    const before = document();
    const commands = removeEdgeCommands(before, 'q1>c1');

    expect(commands).toEqual([{ type: 'unsubscribe', consumer: 'worker', queue: 'billing' }]);
    expect(edgeKeys(apply(before, commands)).has('q1>c1')).toBe(false);
  });

  it('is nothing for an edge that is not on the canvas, or for a key that is not an edge', () => {
    const before = document();

    expect(removeEdgeCommands(before, 'x1>q2')).toEqual([]);
    expect(removeEdgeCommands(before, 'p2>x1')).toEqual([]);
    expect(removeEdgeCommands(before, 'q2>c1')).toEqual([]);
    expect(removeEdgeCommands(before, 'gone>x1')).toEqual([]);
    expect(removeEdgeCommands(before, 'nonsense')).toEqual([]);
  });

  it('is nothing from a consumer, which nothing is linked from', () => {
    expect(removeEdgeCommands(document(), 'c1>q1')).toEqual([]);
  });

  it('does not take the edge of a producer that is linked somewhere else', () => {
    expect(removeEdgeCommands(document(), 'p1>q1')).toEqual([]);
  });
});
