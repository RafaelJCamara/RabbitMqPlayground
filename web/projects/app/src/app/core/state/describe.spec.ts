import type { DocumentCommand } from '@rmq/domain';
import { describe, expect, it } from 'vitest';
import { describeCommand, sentence } from './describe';

const queue = (name: string): DocumentCommand => ({ type: 'declare-queue', name, durable: true });
const move = (name: string): DocumentCommand => ({ type: 'move', target: { kind: 'queue', name }, x: 1, y: 2 });

describe('describeCommand', () => {
  it.each<[string, DocumentCommand, string]>([
    [
      'an exchange',
      {
        type: 'declare-exchange',
        name: 'orders',
        exchangeType: 'topic',
        durable: true,
        autoDelete: false,
        internal: false,
      },
      'added topic exchange orders',
    ],
    ['a queue', queue('billing'), 'added queue billing'],
    ['a producer', { type: 'add-producer', name: 'sender' }, 'added producer sender'],
    ['a consumer', { type: 'add-consumer', name: 'worker' }, 'added consumer worker'],
    [
      'a binding',
      { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'a' },
      'bound exchange orders to queue billing',
    ],
    [
      'a binding to an exchange',
      { type: 'bind', source: 'orders', destination: { kind: 'exchange', name: 'hidden' }, key: '' },
      'bound exchange orders to exchange hidden',
    ],
    [
      'an unbind',
      { type: 'unbind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'a' },
      'removed the binding from exchange orders to queue billing',
    ],
    [
      'a link',
      { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
      'linked producer sender to exchange orders',
    ],
    ['an unlink', { type: 'unlink', producer: 'sender' }, 'unlinked producer sender'],
    [
      'a subscription',
      { type: 'subscribe', consumer: 'worker', queue: 'billing' },
      'subscribed consumer worker to queue billing',
    ],
    [
      'an unsubscribe',
      { type: 'unsubscribe', consumer: 'worker', queue: 'billing' },
      'unsubscribed consumer worker from queue billing',
    ],
    [
      'headers taken off',
      { type: 'unset', kind: 'producer', name: 'sender', headers: ['a'] },
      'removed headers from producer sender',
    ],
    ['a move', move('billing'), 'moved queue billing'],
    [
      'a label moved',
      { type: 'move-label', from: { kind: 'exchange', name: 'a' }, to: { kind: 'queue', name: 'b' }, at: 0.5 },
      'moved the label of an edge',
    ],
    ['a rename', { type: 'rename', target: { kind: 'queue', name: 'a' }, name: 'b' }, 'renamed queue a to b'],
    ['a delete', { type: 'delete', target: { kind: 'exchange', name: 'orders' } }, 'deleted exchange orders'],
    ['a clear', { type: 'clear' }, 'cleared the canvas'],
    ['a layout', { type: 'layout' }, 'arranged the canvas'],
  ])('says what %s did', (_what, command, expected) => {
    expect(describeCommand(command)).toBe(expected);
  });

  describe('a set', () => {
    it('says which attributes of which element', () => {
      expect(
        describeCommand({ type: 'set', kind: 'exchange', name: 'orders', changes: { exchangeType: 'fanout' } }),
      ).toBe('changed the type of exchange orders');
      expect(
        describeCommand({
          type: 'set',
          kind: 'exchange',
          name: 'orders',
          changes: { durable: false, autoDelete: true, internal: true },
        }),
      ).toBe('changed the durable flag, the auto-delete flag and the internal flag of exchange orders');
      expect(describeCommand({ type: 'set', kind: 'queue', name: 'billing', changes: { durable: true } })).toBe(
        'changed the durable flag of queue billing',
      );
      expect(
        describeCommand({
          type: 'set',
          kind: 'producer',
          name: 'sender',
          changes: { payload: 'x', key: 'k', burst: 2, everyMs: 5, repeat: true, headers: [] },
        }),
      ).toBe(
        'changed the payload, the routing key, the burst, the interval, the repeat setting and the headers of producer sender',
      );
      expect(
        describeCommand({
          type: 'set',
          kind: 'consumer',
          name: 'worker',
          changes: { ack: 'manual', prefetch: 1, processingMs: 5 },
        }),
      ).toBe('changed the acknowledgement, the prefetch and the processing time of consumer worker');
      expect(describeCommand({ type: 'set', kind: 'canvas', changes: { seed: 3 } })).toBe(
        'changed the seed of the canvas',
      );
    });

    it('names the attributes of the canvas', () => {
      expect(describeCommand({ type: 'set', kind: 'canvas', changes: { showDefaultExchange: true } })).toBe(
        'changed the default exchange setting of the canvas',
      );
      expect(
        describeCommand({ type: 'set', kind: 'canvas', changes: { publishMs: 1, brokerMs: 2, deliverMs: 3 } }),
      ).toBe('changed the publish time, the broker time and the delivery time of the canvas');
    });

    it('puts an "and" before the last of two attributes, and a comma between the others', () => {
      expect(
        describeCommand({
          type: 'set',
          kind: 'exchange',
          name: 'orders',
          changes: { durable: true, autoDelete: false },
        }),
      ).toBe('changed the durable flag and the auto-delete flag of exchange orders');
    });

    it('ignores an attribute that is not given', () => {
      expect(describeCommand({ type: 'set', kind: 'queue', name: 'billing', changes: { durable: undefined } })).toBe(
        'changed queue billing',
      );
    });
  });

  describe('a batch', () => {
    it('says what its one command did, whatever it is', () => {
      expect(describeCommand({ type: 'batch', commands: [queue('billing')] })).toBe('added queue billing');
      expect(
        describeCommand({
          type: 'batch',
          commands: [{ type: 'set', kind: 'queue', name: 'billing', changes: { durable: true } }],
        }),
      ).toBe('changed the durable flag of queue billing');
      expect(
        describeCommand({ type: 'batch', commands: [{ type: 'delete', target: { kind: 'queue', name: 'billing' } }] }),
      ).toBe('deleted queue billing');
    });

    it('is the adding, when what it does besides adding is putting that thing in its place (a drop from the toolbox)', () => {
      expect(describeCommand({ type: 'batch', commands: [queue('billing'), move('billing')] })).toBe(
        'added queue billing',
      );
    });

    it('is a count of items deleted, when all it does is take things away', () => {
      expect(
        describeCommand({
          type: 'batch',
          commands: [
            { type: 'unlink', producer: 'sender' },
            { type: 'unsubscribe', consumer: 'worker', queue: 'billing' },
            { type: 'delete', target: { kind: 'queue', name: 'billing' } },
          ],
        }),
      ).toBe('deleted 3 items');
    });

    it('is a count of changes, otherwise', () => {
      expect(describeCommand({ type: 'batch', commands: [queue('a'), queue('b'), move('a')] })).toBe('3 changes');
      expect(describeCommand({ type: 'batch', commands: [move('a'), move('b')] })).toBe('2 changes');
    });

    it('is a count of changes when the adding comes with something that is not putting it in its place', () => {
      const bind: DocumentCommand = {
        type: 'bind',
        source: 'orders',
        destination: { kind: 'queue', name: 'billing' },
        key: 'a',
      };

      expect(describeCommand({ type: 'batch', commands: [queue('billing'), bind] })).toBe('2 changes');
    });

    it('is a count of changes when the taking away comes with something that is not', () => {
      expect(
        describeCommand({
          type: 'batch',
          commands: [{ type: 'delete', target: { kind: 'queue', name: 'old' } }, queue('billing')],
        }),
      ).toBe('2 changes');
    });
  });
});

describe('sentence', () => {
  it('starts with a capital letter and ends with a full stop', () => {
    expect(sentence('added queue billing')).toBe('Added queue billing.');
  });

  it('does not stop twice', () => {
    expect(sentence('moved the canvas.')).toBe('Moved the canvas.');
  });

  it('is empty for nothing', () => {
    expect(sentence('')).toBe('');
  });
});
