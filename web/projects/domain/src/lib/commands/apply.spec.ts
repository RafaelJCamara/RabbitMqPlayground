import { deepFreeze, documentOf, queueEnd, sampleDocument, sequentialIds, undoRedoProblems } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { applyCommand } from './apply';
import type { DocumentCommand } from './types';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const empty = (): CanvasDocument => deepFreeze(documentOf());

/** One command of every type, each of which changes the sample canvas. */
const EVERY_COMMAND: readonly [string, DocumentCommand][] = [
  [
    'declare-exchange',
    {
      type: 'declare-exchange',
      name: 'new',
      exchangeType: 'fanout',
      durable: true,
      autoDelete: false,
      internal: false,
    },
  ],
  ['declare-queue', { type: 'declare-queue', name: 'new', durable: true }],
  ['add-producer', { type: 'add-producer', name: 'new' }],
  ['add-consumer', { type: 'add-consumer', name: 'new' }],
  ['bind', { type: 'bind', source: 'orders', destination: queueEnd('archive'), key: 'k' }],
  ['unbind', { type: 'unbind', source: 'orders', destination: queueEnd('billing'), key: 'order.*' }],
  ['link', { type: 'link', producer: 'sender', target: { kind: 'queue', name: 'billing' } }],
  ['unlink', { type: 'unlink', producer: 'sender' }],
  ['subscribe', { type: 'subscribe', consumer: 'worker', queue: 'archive' }],
  ['unsubscribe', { type: 'unsubscribe', consumer: 'worker', queue: 'billing' }],
  ['set', { type: 'set', kind: 'queue', name: 'billing', changes: {} }],
  ['unset', { type: 'unset', kind: 'producer', name: 'sender', headers: ['n'] }],
  ['move', { type: 'move', target: { kind: 'queue', name: 'billing' }, x: 1, y: 2 }],
  [
    'move-label',
    { type: 'move-label', from: { kind: 'exchange', name: 'orders' }, to: { kind: 'queue', name: 'billing' }, at: 0.1 },
  ],
  ['rename', { type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'invoices' }],
  ['delete', { type: 'delete', target: { kind: 'queue', name: 'billing' } }],
  ['clear', { type: 'clear' }],
  ['layout', { type: 'layout' }],
];

describe('applyCommand', () => {
  it.each(EVERY_COMMAND.filter(([type]) => type !== 'set'))(
    'applies a %s command, and the result is a valid canvas',
    (_type, command) => {
      const before = sample();
      const result = applyCommand(before, command, sequentialIds());

      expect(result.ok).toBe(true);
      expect(result.ok && result.value).not.toBe(before);
      expect(result.ok && validateDocument(result.value)).toEqual([]);
      expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
    },
  );

  it('applies a set command, which is refused when it says nothing', () => {
    expect(
      applyCommand(
        sample(),
        { type: 'set', kind: 'queue', name: 'billing', changes: { durable: true } },
        sequentialIds(),
      ),
    ).toMatchObject({
      ok: true,
    });
    expect(
      applyCommand(sample(), { type: 'set', kind: 'queue', name: 'billing', changes: {} }, sequentialIds()),
    ).toMatchObject({
      ok: false,
      error: { kind: 'nothing-to-change' },
    });
  });

  it('never changes the document that it is given, for any command, whether it is refused or not', () => {
    for (const [, command] of EVERY_COMMAND) {
      const before = sample();
      applyCommand(before, command, sequentialIds());
      applyCommand(empty(), command, sequentialIds());

      expect(before).toEqual(sampleDocument());
    }
  });

  it('gives the same result for the same command, the same document and the same ids', () => {
    for (const [, command] of EVERY_COMMAND) {
      expect(applyCommand(sample(), command, sequentialIds())).toEqual(
        applyCommand(sample(), command, sequentialIds()),
      );
    }
  });

  it('returns the document it was given when a command would change nothing', () => {
    const before = sample();
    const nothing: DocumentCommand[] = [
      { type: 'bind', source: 'orders', destination: queueEnd('billing'), key: 'order.*' },
      { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
      { type: 'subscribe', consumer: 'worker', queue: 'billing' },
      { type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'billing' },
      { type: 'move', target: { kind: 'queue', name: 'billing' }, x: before.layout.nodes['Q1']?.x as number },
      { type: 'set', kind: 'canvas', changes: { seed: before.settings.seed } },
    ];
    for (const command of nothing) {
      const result = applyCommand(before, command, sequentialIds());

      expect(result.ok && result.value, JSON.stringify(command)).toBe(before);
    }
  });
});

describe('batch', () => {
  it('applies the commands in order, each to what the one before made, so that a later one can name what an earlier one made', () => {
    const result = applyCommand(
      empty(),
      {
        type: 'batch',
        commands: [
          {
            type: 'declare-exchange',
            name: 'events',
            exchangeType: 'fanout',
            durable: true,
            autoDelete: false,
            internal: false,
          },
          { type: 'declare-queue', name: 'inbox', durable: true },
          { type: 'bind', source: 'events', destination: queueEnd('inbox'), key: '' },
          { type: 'move', target: { kind: 'queue', name: 'inbox' }, x: 700, y: 20 },
        ],
      },
      sequentialIds(),
    );

    expect(result.ok && Object.keys(result.value.exchanges)).toEqual(['x1']);
    expect(result.ok && Object.keys(result.value.queues)).toEqual(['q1']);
    expect(result.ok && Object.keys(result.value.bindings)).toEqual(['b1']);
    expect(result.ok && result.value.layout.nodes['q1']).toEqual({ x: 700, y: 20 });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('is one change: undo takes all of it back, and redo brings all of it', () => {
    const before = sample();
    const result = applyCommand(
      before,
      {
        type: 'batch',
        commands: [
          { type: 'declare-queue', name: 'fresh', durable: true },
          { type: 'bind', source: 'orders', destination: queueEnd('fresh'), key: 'x' },
          { type: 'subscribe', consumer: 'worker', queue: 'fresh' },
        ],
      },
      sequentialIds(),
    );

    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('is refused whole when one command is, and says which, with the reason of that command', () => {
    const before = sample();
    const result = applyCommand(
      before,
      {
        type: 'batch',
        commands: [
          { type: 'declare-queue', name: 'fresh', durable: true },
          { type: 'declare-queue', name: 'billing', durable: true },
          { type: 'declare-queue', name: 'never', durable: true },
        ],
      },
      sequentialIds(),
    );

    expect(!result.ok && result.error).toEqual({
      kind: 'duplicate-name',
      message: "There is already a queue named 'billing'. Names are unique within a kind.",
      batchIndex: 1,
    });
    expect(before).toEqual(sampleDocument());
  });

  it('says that it was the first command, with index 0, and keeps the broker’s reply of the refusal', () => {
    const result = applyCommand(
      empty(),
      { type: 'batch', commands: [{ type: 'declare-queue', name: 'jobs', durable: false }] },
      sequentialIds(),
    );

    expect(!result.ok && result.error.batchIndex).toBe(0);
    expect(!result.ok && result.error.refusal?.code).toBe(541);
  });

  it('is refused when it is empty, because a change that is nothing is a mistake', () => {
    expect(applyCommand(sample(), { type: 'batch', commands: [] }, sequentialIds())).toEqual({
      ok: false,
      error: { kind: 'batch', message: 'A batch needs at least one command.' },
    });
  });

  it('is the document it was given when every command in it changes nothing', () => {
    const before = sample();
    const result = applyCommand(
      before,
      {
        type: 'batch',
        commands: [
          { type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'billing' },
          { type: 'subscribe', consumer: 'worker', queue: 'billing' },
        ],
      },
      sequentialIds(),
    );

    expect(result.ok && result.value).toBe(before);
  });

  it('may hold a batch, which is flattened in effect', () => {
    const result = applyCommand(
      empty(),
      {
        type: 'batch',
        commands: [
          {
            type: 'batch',
            commands: [
              { type: 'declare-queue', name: 'a', durable: true },
              { type: 'declare-queue', name: 'b', durable: true },
            ],
          },
          { type: 'declare-queue', name: 'c', durable: true },
        ],
      },
      sequentialIds(),
    );

    expect(result.ok && Object.values(result.value.queues).map(({ name }) => name)).toEqual(['a', 'b', 'c']);
  });

  it('reports the position within the nearest batch that holds the command that failed', () => {
    const result = applyCommand(
      empty(),
      {
        type: 'batch',
        commands: [
          { type: 'declare-queue', name: 'a', durable: true },
          {
            type: 'batch',
            commands: [
              { type: 'declare-queue', name: 'b', durable: true },
              { type: 'declare-queue', name: 'a', durable: true },
            ],
          },
        ],
      },
      sequentialIds(),
    );

    expect(!result.ok && result.error.batchIndex).toBe(1);
  });

  it('turns a drag from an exchange onto empty canvas into one change: a new queue, a binding to it, and where it was dropped', () => {
    const before = sample();
    const result = applyCommand(
      before,
      {
        type: 'batch',
        commands: [
          { type: 'declare-queue', name: 'audit', durable: true },
          { type: 'bind', source: 'orders', destination: queueEnd('audit'), key: '#' },
          { type: 'move', target: { kind: 'queue', name: 'audit' }, x: 640, y: 400 },
        ],
      },
      sequentialIds(),
    );

    expect(result.ok && result.value.layout.nodes['q1']).toEqual({ x: 640, y: 400 });
    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });
});
