import { applyCommand, findId, lookup, NODE_SIZE, validateDocument, type CanvasDocument } from '@rmq/domain';
import { deepFreeze, documentOf, exchangeRecord, queueRecord, sequentialIds } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { addNode } from './add-node';

const empty = (): CanvasDocument => deepFreeze(documentOf());

const made = (document: CanvasDocument, ...args: Parameters<typeof addNode>) => {
  const addition = addNode(args[0], args[1], args[2]);
  const result = applyCommand(document, addition.command, sequentialIds());
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return { addition, document: result.value };
};

describe('addNode', () => {
  it.each([
    ['a producer', { kind: 'producer' }, 'producer', 'producer1'],
    ['a consumer', { kind: 'consumer' }, 'consumer', 'consumer1'],
    ['a queue', { kind: 'queue' }, 'queue', 'queue1'],
    ['a direct exchange', { kind: 'exchange', exchangeType: 'direct' }, 'exchange', 'exchange1'],
    ['a headers exchange', { kind: 'exchange', exchangeType: 'headers' }, 'exchange', 'exchange1'],
  ] as const)('adds %s, with a name that the kind and a number make', (_what, node, kind, name) => {
    const { addition, document } = made(empty(), empty(), node);

    expect(addition).toMatchObject({ kind, name });
    expect(findId(document, kind, name)).toBeDefined();
    expect(validateDocument(document)).toEqual([]);
  });

  it('adds each type of exchange as one of that type, durable, and neither auto-delete nor internal', () => {
    for (const exchangeType of ['direct', 'fanout', 'topic', 'headers'] as const) {
      const { document } = made(empty(), empty(), { kind: 'exchange', exchangeType });

      expect(Object.values(document.exchanges)).toEqual([
        { name: 'exchange1', type: exchangeType, durable: true, autoDelete: false, internal: false },
      ]);
    }
  });

  it('adds a queue that is durable, because a broker refuses one that is not', () => {
    const { document } = made(empty(), empty(), { kind: 'queue' });

    expect(Object.values(document.queues)).toEqual([{ name: 'queue1', serverNamed: false, durable: true }]);
  });

  it('takes the next name that is free for its kind, and a queue and an exchange may share a number', () => {
    const before = deepFreeze(
      documentOf({
        queues: { a: queueRecord('queue1'), b: queueRecord('queue2') },
        exchanges: { c: exchangeRecord('queue3') },
      }),
    );

    expect(addNode(before, { kind: 'queue' }).name).toBe('queue3');
    expect(addNode(before, { kind: 'exchange', exchangeType: 'fanout' }).name).toBe('exchange1');
  });

  it('puts a node that is clicked where its kind goes, which is the domain’s default, as one plain command', () => {
    const { addition, document } = made(empty(), empty(), { kind: 'queue' });

    expect(addition.command.type).toBe('declare-queue');
    expect(Object.values(document.layout.nodes)).toEqual([{ x: 640, y: 0 }]);
  });

  it('puts a node that is dropped with its middle where the pointer was, as one batch, so that it is one step of undo', () => {
    const { addition, document } = made(empty(), empty(), { kind: 'queue' }, { x: 500, y: 300 });
    const id = findId(document, 'queue', 'queue1') ?? '';

    expect(addition.command.type).toBe('batch');
    expect(lookup(document.layout.nodes, id)).toEqual({
      x: 500 - NODE_SIZE.queue.width / 2,
      y: 300 - NODE_SIZE.queue.height / 2,
    });
  });

  it('puts a drop at whole numbers, and uses the size of the kind that is dropped', () => {
    const { document } = made(empty(), empty(), { kind: 'producer' }, { x: 100.4, y: 50.6 });

    expect(Object.values(document.layout.nodes)).toEqual([
      { x: Math.round(100.4 - NODE_SIZE.producer.width / 2), y: Math.round(50.6 - NODE_SIZE.producer.height / 2) },
    ]);
  });

  it('does not change the document that it is given', () => {
    const before = empty();

    addNode(before, { kind: 'queue' }, { x: 1, y: 2 });

    expect(before).toEqual(documentOf());
  });
});
