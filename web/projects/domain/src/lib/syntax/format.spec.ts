import {
  bool,
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeEnd,
  exchangeRecord,
  exists,
  float,
  headerArguments,
  int,
  producerRecord,
  queueEnd,
  queueRecord,
  sampleDocument,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { Command } from '../commands/types';
import type { CanvasDocument } from '../document/schema';
import { formatCommand } from './format';
import { parseCommand } from './parse';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const twins = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('same'), F: exchangeRecord('other') },
      queues: { Q: queueRecord('same') },
      producers: { P: producerRecord('same') },
      consumers: { C: consumerRecord('same') },
    }),
  );
const ref = <Kind extends 'exchange' | 'queue' | 'producer' | 'consumer'>(kind: Kind, name: string) => ({ kind, name });

describe('formatCommand', () => {
  describe('writes each command the way that it is typed', () => {
    it.each<[string, Command, string]>([
      [
        'a declared exchange, with only what is not the default',
        {
          type: 'declare-exchange',
          name: 'events',
          exchangeType: 'topic',
          durable: true,
          autoDelete: false,
          internal: false,
        },
        'declare exchange events type=topic',
      ],
      [
        'a declared exchange with every flag away from its default',
        {
          type: 'declare-exchange',
          name: 'e',
          exchangeType: 'headers',
          durable: false,
          autoDelete: true,
          internal: true,
        },
        'declare exchange e type=headers durable=false auto-delete=true internal=true',
      ],
      ['a declared queue', { type: 'declare-queue', name: 'jobs', durable: true }, 'declare queue jobs'],
      [
        'a declared queue that is not durable',
        { type: 'declare-queue', name: 'jobs', durable: false },
        'declare queue jobs durable=false',
      ],
      ['a producer', { type: 'add-producer', name: 'clock' }, 'add producer clock'],
      ['a consumer', { type: 'add-consumer', name: 'logger' }, 'add consumer logger'],
      [
        'a binding with a key',
        { type: 'bind', source: 'orders', destination: queueEnd('billing'), key: 'order.*' },
        'bind orders -> billing key=order.*',
      ],
      [
        'a binding to an exchange, with no key',
        { type: 'bind', source: 'orders', destination: exchangeEnd('hidden'), key: '' },
        'bind orders -> hidden',
      ],
      [
        'a binding with every type of condition, and the mode',
        {
          type: 'bind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: '',
          headers: headerArguments(
            'any-with-x',
            entry('s', str('1')),
            entry('i', int(1)),
            entry('f', float(1)),
            entry('b', bool(true)),
            entry('e', exists),
          ),
        },
        'bind docs -> archive x-match=any-with-x s="1" i=1 f=1.0 b=true exists(e)',
      ],
      [
        'a binding with conditions and no mode',
        {
          type: 'bind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: 'k',
          headers: headerArguments(null, entry('a', str('pdf'))),
        },
        'bind docs -> archive key=k a=pdf',
      ],
      [
        'a binding with no arguments written as none',
        { type: 'bind', source: 'docs', destination: queueEnd('archive'), key: '', headers: headerArguments(null) },
        'bind docs -> archive',
      ],
      [
        'a binding with a mode and no conditions',
        { type: 'bind', source: 'docs', destination: queueEnd('archive'), key: '', headers: headerArguments('any') },
        'bind docs -> archive x-match=any',
      ],
      [
        'a binding with headers called key and x-match, which have their names quoted',
        {
          type: 'bind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: 'k',
          headers: headerArguments('all', entry('key', int(1)), entry('x-match', str('a')), entry('keys', int(2))),
        },
        'bind docs -> archive key=k x-match=all "key"=1 "x-match"=a keys=2',
      ],
      [
        'an unbinding',
        { type: 'unbind', source: 'orders', destination: queueEnd('billing'), key: 'order.*' },
        'unbind orders -> billing key=order.*',
      ],
      [
        'a link to an exchange, and to a queue',
        { type: 'link', producer: 'sender', target: ref('exchange', 'orders') },
        'link sender -> orders',
      ],
      [
        'a link to a queue',
        { type: 'link', producer: 'sender', target: ref('queue', 'billing') },
        'link sender -> billing',
      ],
      ['an unlink', { type: 'unlink', producer: 'sender' }, 'unlink sender'],
      ['a subscription', { type: 'subscribe', consumer: 'worker', queue: 'archive' }, 'subscribe worker archive'],
      [
        'an unsubscription',
        { type: 'unsubscribe', consumer: 'worker', queue: 'billing' },
        'unsubscribe worker billing',
      ],
      [
        'the attributes of an exchange, in the order of the table',
        {
          type: 'set',
          kind: 'exchange',
          name: 'orders',
          changes: { internal: true, exchangeType: 'direct', autoDelete: false, durable: false },
        },
        'set orders type=direct durable=false auto-delete=false internal=true',
      ],
      [
        'the durability of a queue',
        { type: 'set', kind: 'queue', name: 'billing', changes: { durable: true } },
        'set billing durable=true',
      ],
      [
        'a producer’s attributes, with no headers',
        { type: 'set', kind: 'producer', name: 'sender', changes: { burst: 2 } },
        'set sender burst=2',
      ],
      [
        'a producer’s attributes and headers',
        {
          type: 'set',
          kind: 'producer',
          name: 'sender',
          changes: {
            repeat: true,
            everyMs: 500,
            burst: 3,
            key: 'a.b',
            payload: 'Hello, world',
            headers: [
              entry('format', str('pdf')),
              entry('n', int(1)),
              entry('my key', float(1.5)),
              entry('ok', bool(false)),
            ],
          },
        },
        'set sender payload="Hello, world" key=a.b burst=3 every=500 repeat=true header:format=pdf header:n=1 header:"my key"=1.5 header:ok=false',
      ],
      [
        'a consumer’s attributes',
        { type: 'set', kind: 'consumer', name: 'worker', changes: { processingMs: 250, prefetch: 0, ack: 'manual' } },
        'set worker ack=manual prefetch=0 processing=250',
      ],
      [
        'the settings of the canvas',
        {
          type: 'set',
          kind: 'canvas',
          changes: { deliverMs: 3, brokerMs: 2, publishMs: 1, seed: 7, showDefaultExchange: true },
        },
        'set canvas default-exchange=true seed=7 publish-ms=1 broker-ms=2 deliver-ms=3',
      ],
      [
        'headers taken off a producer',
        { type: 'unset', kind: 'producer', name: 'sender', headers: ['a', 'b c'] },
        'unset sender header:a header:"b c"',
      ],
      [
        'a move along both axes',
        { type: 'move', target: ref('queue', 'billing'), x: 640, y: -12.5 },
        'move billing x=640 y=-12.5',
      ],
      ['a move along one axis', { type: 'move', target: ref('producer', 'sender'), y: 0 }, 'move sender y=0'],
      [
        'a label',
        { type: 'move-label', from: ref('exchange', 'orders'), to: ref('queue', 'billing'), at: 0.25 },
        'move label orders -> billing at=0.25',
      ],
      ['a rename', { type: 'rename', target: ref('queue', 'billing'), name: 'invoices' }, 'rename billing invoices'],
      ['a delete', { type: 'delete', target: ref('consumer', 'worker') }, 'delete worker'],
      ['a clear', { type: 'clear' }, 'clear'],
      ['a layout', { type: 'layout' }, 'layout'],
      ['an undo', { type: 'undo' }, 'undo'],
      ['a redo', { type: 'redo' }, 'redo'],
      ['a help', { type: 'help' }, 'help'],
      ['a help for a command of two words', { type: 'help', command: 'declare queue' }, 'help declare queue'],
    ])('for %s', (_what, command, text) => {
      expect(formatCommand(command, sample())).toBe(text);
    });
  });

  describe('puts the kind of an element in front only where its name does not say which it is', () => {
    it('for the destination of a binding, when a queue and an exchange have the same name', () => {
      expect(formatCommand({ type: 'bind', source: 'other', destination: queueEnd('same'), key: '' }, twins())).toBe(
        'bind other -> queue:same',
      );
      expect(formatCommand({ type: 'bind', source: 'other', destination: exchangeEnd('same'), key: '' }, twins())).toBe(
        'bind other -> exchange:same',
      );
    });

    it('not for the source, which is an exchange by its place, and not for a producer, a consumer or a queue by theirs', () => {
      expect(formatCommand({ type: 'bind', source: 'same', destination: queueEnd('same'), key: '' }, twins())).toBe(
        'bind same -> queue:same',
      );
      expect(formatCommand({ type: 'unlink', producer: 'same' }, twins())).toBe('unlink same');
      expect(formatCommand({ type: 'subscribe', consumer: 'same', queue: 'same' }, twins())).toBe(
        'subscribe same same',
      );
    });

    it('for an element of any kind, when more than one kind has the name', () => {
      expect(formatCommand({ type: 'delete', target: ref('queue', 'same') }, twins())).toBe('delete queue:same');
      expect(formatCommand({ type: 'delete', target: ref('consumer', 'same') }, twins())).toBe('delete consumer:same');
      expect(formatCommand({ type: 'rename', target: ref('exchange', 'same'), name: 'x' }, twins())).toBe(
        'rename exchange:same x',
      );
      expect(formatCommand({ type: 'move', target: ref('producer', 'same'), x: 1 }, twins())).toBe(
        'move producer:same x=1',
      );
      expect(formatCommand({ type: 'set', kind: 'queue', name: 'same', changes: { durable: true } }, twins())).toBe(
        'set queue:same durable=true',
      );
    });

    it('for an element that is not there, since the name alone would not be read as it', () => {
      expect(formatCommand({ type: 'delete', target: ref('queue', 'nope') }, sample())).toBe('delete queue:nope');
      expect(formatCommand({ type: 'bind', source: 'orders', destination: queueEnd('nope'), key: '' }, sample())).toBe(
        'bind orders -> queue:nope',
      );
    });

    it('for an element of the wrong kind, as it is written, so that it is read as what it was said to be', () => {
      expect(formatCommand({ type: 'delete', target: ref('exchange', 'billing') }, sample())).toBe(
        'delete exchange:billing',
      );
    });

    it('for an element called canvas, because the word alone is the canvas', () => {
      const document = deepFreeze(documentOf({ queues: { Q: queueRecord('canvas') } }));

      expect(formatCommand({ type: 'set', kind: 'queue', name: 'canvas', changes: { durable: true } }, document)).toBe(
        'set queue:canvas durable=true',
      );
      expect(formatCommand({ type: 'set', kind: 'canvas', changes: { seed: 1 } }, document)).toBe('set canvas seed=1');
    });

    it('in front of a name that has to be quoted', () => {
      const document = deepFreeze(
        documentOf({ exchanges: { E: exchangeRecord('my x') }, queues: { Q: queueRecord('my x') } }),
      );

      expect(formatCommand({ type: 'delete', target: ref('queue', 'my x') }, document)).toBe('delete queue:"my x"');
    });
  });

  describe('quotes what has to be quoted', () => {
    it.each<[string, string]>([
      ['', '""'],
      ['my queue', '"my queue"'],
      ['a=b', '"a=b"'],
      ['a;b', '"a;b"'],
      ['a->b', '"a->b"'],
      ['a"b', '"a\\"b"'],
      ['queue:x', '"queue:x"'],
      ['(x)', '"(x)"'],
      ['\n', '"\\n"'],
      ['plain', 'plain'],
      ['a.b.c', 'a.b.c'],
      ['order-events', 'order-events'],
    ])('the name %j as %s', (name, written) => {
      expect(formatCommand({ type: 'declare-queue', name, durable: true }, sample())).toBe(`declare queue ${written}`);
      expect(formatCommand({ type: 'add-producer', name }, sample())).toBe(`add producer ${written}`);
    });

    it('a key, a payload and a header, and gives them back when it is read', () => {
      const command: Command = {
        type: 'bind',
        source: 'docs',
        destination: queueEnd('archive'),
        key: 'a b',
        headers: headerArguments('all', entry('x y', str('p q')), entry('n', str('5'))),
      };

      expect(formatCommand(command, sample())).toBe('bind docs -> archive key="a b" x-match=all "x y"="p q" n="5"');
    });
  });

  describe('a batch', () => {
    it('is its commands with ; between them', () => {
      expect(
        formatCommand(
          {
            type: 'batch',
            commands: [
              { type: 'declare-queue', name: 'jobs', durable: true },
              { type: 'bind', source: 'orders', destination: queueEnd('jobs'), key: 'job.#' },
            ],
          },
          sample(),
        ),
      ).toBe('declare queue jobs; bind orders -> jobs key=job.#');
    });

    it('writes each command against the canvas that the ones before it made, so a name that a command declared is read as it is', () => {
      const document = twins();

      expect(
        formatCommand(
          {
            type: 'batch',
            commands: [
              { type: 'declare-queue', name: 'fresh', durable: true },
              { type: 'bind', source: 'other', destination: queueEnd('fresh'), key: '' },
              {
                type: 'declare-exchange',
                name: 'fresh',
                exchangeType: 'direct',
                durable: true,
                autoDelete: false,
                internal: false,
              },
              { type: 'bind', source: 'other', destination: exchangeEnd('fresh'), key: '' },
              { type: 'bind', source: 'other', destination: queueEnd('fresh'), key: 'k' },
            ],
          },
          document,
        ),
      ).toBe(
        [
          'declare queue fresh',
          'bind other -> fresh',
          'declare exchange fresh type=direct',
          'bind other -> exchange:fresh',
          'bind other -> queue:fresh key=k',
        ].join('; '),
      );
    });

    it('goes on with the canvas as it was when a command in it would be refused, and does not throw', () => {
      expect(
        formatCommand(
          {
            type: 'batch',
            commands: [
              { type: 'declare-queue', name: 'amq.x', durable: true },
              { type: 'declare-queue', name: 'a', durable: true },
            ],
          },
          sample(),
        ),
      ).toBe('declare queue amq.x; declare queue a');
    });

    it('is the text of the command when there is only one, and nothing for none', () => {
      expect(formatCommand({ type: 'batch', commands: [{ type: 'clear' }] }, sample())).toBe('clear');
      expect(formatCommand({ type: 'batch', commands: [] }, sample())).toBe('');
    });

    it('writes a batch in a batch as its commands, one after the other', () => {
      expect(
        formatCommand(
          {
            type: 'batch',
            commands: [{ type: 'batch', commands: [{ type: 'clear' }, { type: 'layout' }] }, { type: 'layout' }],
          },
          sample(),
        ),
      ).toBe('clear; layout; layout');
    });
  });

  describe('reads back as the same command', () => {
    const commands: Command[] = [
      {
        type: 'declare-exchange',
        name: 'e x',
        exchangeType: 'fanout',
        durable: false,
        autoDelete: true,
        internal: true,
      },
      { type: 'declare-queue', name: '', durable: false },
      { type: 'bind', source: '', destination: exchangeEnd(''), key: '' },
      { type: 'bind', source: 'orders', destination: queueEnd('billing'), key: 'a b;c=d' },
      {
        type: 'bind',
        source: 'docs',
        destination: queueEnd('archive'),
        key: '',
        headers: headerArguments(
          'all-with-x',
          entry('e', exists),
          entry('a', str('')),
          entry('z', float(-0)),
          entry('big', int(Number.MAX_SAFE_INTEGER)),
        ),
      },
      {
        type: 'set',
        kind: 'producer',
        name: 'sender',
        changes: { payload: '', key: '', headers: [entry('true', str('true'))] },
      },
      { type: 'move', target: ref('queue', 'billing'), x: 1e-7, y: -1e6 },
      { type: 'rename', target: ref('queue', 'billing'), name: 'queue:x' },
    ];

    it.each(commands.map((command) => [formatCommand(command, sample()), command] as const))('%s', (text, command) => {
      expect(parseCommand(text, sample())).toEqual({ ok: true, value: command });
    });
  });
});
