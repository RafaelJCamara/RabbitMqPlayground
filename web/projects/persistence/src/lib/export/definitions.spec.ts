import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CanvasDocument } from '@rmq/domain';
import {
  arbDocument,
  bindingRecord,
  canvasFromText,
  configureFastCheck,
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  definitionsText,
  exportDefinitions,
  NOT_IN_THE_FILE,
  planDefinitions,
  vhostIssue,
  type ExportedDefinitions,
} from './definitions';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const ROOT = fileURLToPath(new URL('../../../../../fixtures/export/', import.meta.url));

/** The file, or the throw of a spec that expected one. */
function exported(document: CanvasDocument, vhost = '/'): ExportedDefinitions {
  const result = exportDefinitions(document, vhost);
  if (!result.ok) {
    throw new Error(`expected a file, and got: ${result.error.message}`);
  }
  return result.value;
}

interface Parsed {
  readonly vhosts: readonly { name: string }[];
  readonly exchanges: readonly Record<string, unknown>[];
  readonly queues: readonly Record<string, unknown>[];
  readonly bindings: readonly {
    source: string;
    vhost: string;
    destination: string;
    destination_type: string;
    routing_key: string;
    arguments: Record<string, unknown>;
  }[];
}

const parsed = (text: string): Parsed => JSON.parse(text) as Parsed;

/** The numbers of a file as they are written: the text of each one, in the order they come in the text, which `JSON.parse` does not keep (it puts a name like “2” before a name like “10”). Text is skipped, so a number inside a name is not one. */
function numbersOf(text: string): string[] {
  return [...text.matchAll(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)]
    .map(([token]) => token)
    .filter((token) => !token.startsWith('"'));
}

/** The numbers that a file of this canvas has to hold, in order, worked out without the exporter: those of the conditions of the bindings that are not left out. */
function numbersIn(document: CanvasDocument): { float: boolean; value: number }[] {
  const numbers: { float: boolean; value: number }[] = [];
  for (const binding of Object.values(document.bindings)) {
    const source = document.exchanges[binding.source];
    const destination = (binding.dest.kind === 'queue' ? document.queues : document.exchanges)[binding.dest.id];
    const toNamed = binding.dest.kind === 'queue' && document.queues[binding.dest.id]?.serverNamed === true;
    const exists = binding.headers?.args.some(({ value }) => value.t === 'exists') ?? false;
    if (source === undefined || destination === undefined || toNamed || exists) {
      continue;
    }
    for (const { value } of binding.headers?.args ?? []) {
      if (value.t === 'integer' || value.t === 'float') {
        numbers.push({ float: value.t === 'float', value: value.v });
      }
    }
  }
  return numbers;
}

const headersBinding = (
  headers: NonNullable<CanvasDocument['bindings'][string]['headers']>,
  exchange = 'E1',
  queue = 'Q1',
) => bindingRecord(exchange, { kind: 'queue', id: queue }, '', headers);

/** A canvas with a headers exchange `docs`, a queue `archive`, and one binding between them with these arguments. */
const withArguments = (headers: NonNullable<CanvasDocument['bindings'][string]['headers']>): CanvasDocument =>
  documentOf({
    exchanges: { E1: exchangeRecord('docs', 'headers') },
    queues: { Q1: queueRecord('archive') },
    bindings: { B1: headersBinding(headers) },
  });

describe('vhostIssue (ADR-0079)', () => {
  it.each([['/'], ['orders'], [' '], ['a/b'], ['é'], ['a'.repeat(255)], ['é'.repeat(127)], ['😀'.repeat(63)]])(
    'accepts %j',
    (vhost) => {
      expect(vhostIssue(vhost)).toBeNull();
    },
  );

  it('asks for a name, and says what the broker’s own is', () => {
    expect(vhostIssue('')).toBe('A vhost needs a name. The broker’s own is “/”.');
  });

  it('counts the bytes of the name and not its characters, and says how many there are', () => {
    expect(vhostIssue('a'.repeat(256))).toBe('A vhost name can be at most 255 bytes, and this one is 256.');
    expect(vhostIssue('é'.repeat(128))).toBe('A vhost name can be at most 255 bytes, and this one is 256.');
    expect(vhostIssue('😀'.repeat(64))).toBe('A vhost name can be at most 255 bytes, and this one is 256.');
  });
});

describe('exportDefinitions', () => {
  describe('the file', () => {
    const document = documentOf({
      vhost: 'ignored',
      exchanges: {
        E1: exchangeRecord('orders', 'topic'),
        E2: exchangeRecord('audit', 'fanout', { durable: false, autoDelete: true, internal: true }),
      },
      queues: { Q1: queueRecord('billing'), Q2: queueRecord('archive') },
      bindings: {
        B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'order.*'),
        B2: bindingRecord('E1', { kind: 'exchange', id: 'E2' }, '#'),
        B3: bindingRecord('E2', { kind: 'queue', id: 'Q2' }),
      },
    });

    it('is JSON with two spaces of indentation and a final newline, with the four keys of a definitions file in this order', () => {
      const { text } = exported(document, '/shop');

      expect(text.endsWith('}\n')).toBe(true);
      expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
      expect(Object.keys(parsed(text))).toEqual(['vhosts', 'exchanges', 'queues', 'bindings']);
    });

    it('names the vhost that was chosen, and not the one of the canvas, in the list of vhosts and in everything', () => {
      const file = parsed(exported(document, '/shop').text);

      expect(file.vhosts).toEqual([{ name: '/shop' }]);
      for (const item of [...file.exchanges, ...file.queues, ...file.bindings]) {
        expect(item['vhost']).toBe('/shop');
      }
    });

    it('writes an exchange as the broker names its parts, in this order, with the flags of the canvas and no arguments', () => {
      const { exchanges } = parsed(exported(document).text);

      expect(exchanges.map((exchange) => Object.keys(exchange))).toEqual([
        ['name', 'vhost', 'type', 'durable', 'auto_delete', 'internal', 'arguments'],
        ['name', 'vhost', 'type', 'durable', 'auto_delete', 'internal', 'arguments'],
      ]);
      expect(exchanges[0]).toEqual({
        name: 'orders',
        vhost: '/',
        type: 'topic',
        durable: true,
        auto_delete: false,
        internal: false,
        arguments: {},
      });
      expect(exchanges[1]).toEqual({
        name: 'audit',
        vhost: '/',
        type: 'fanout',
        durable: false,
        auto_delete: true,
        internal: true,
        arguments: {},
      });
    });

    it('writes a queue as durable, not auto-delete, with no type and no arguments, so that the broker’s own default is the one used', () => {
      const { queues } = parsed(exported(document).text);

      expect(queues).toEqual([
        { name: 'billing', vhost: '/', durable: true, auto_delete: false, arguments: {} },
        { name: 'archive', vhost: '/', durable: true, auto_delete: false, arguments: {} },
      ]);
      expect(Object.keys(queues[0]!)).toEqual(['name', 'vhost', 'durable', 'auto_delete', 'arguments']);
    });

    it('writes a binding to a queue and a binding to an exchange, with the key as the canvas has it', () => {
      const { bindings } = parsed(exported(document).text);

      expect(bindings).toEqual([
        {
          source: 'orders',
          vhost: '/',
          destination: 'billing',
          destination_type: 'queue',
          routing_key: 'order.*',
          arguments: {},
        },
        {
          source: 'orders',
          vhost: '/',
          destination: 'audit',
          destination_type: 'exchange',
          routing_key: '#',
          arguments: {},
        },
        {
          source: 'audit',
          vhost: '/',
          destination: 'archive',
          destination_type: 'queue',
          routing_key: '',
          arguments: {},
        },
      ]);
      expect(Object.keys(bindings[0]!)).toEqual([
        'source',
        'vhost',
        'destination',
        'destination_type',
        'routing_key',
        'arguments',
      ]);
    });

    it('keeps the order of the records of the canvas, whichever it is, and gives the same text for the same canvas', () => {
      const shuffled = {
        ...document,
        exchanges: { E2: document.exchanges['E2']!, E1: document.exchanges['E1']! },
      } as CanvasDocument;

      const first = exported(document).text;

      expect(exported(document).text).toBe(first);
      expect(parsed(exported(shuffled).text).exchanges.map((exchange) => exchange['name'])).toEqual([
        'audit',
        'orders',
      ]);
    });

    it('does not put the default exchange in the file, nor the simulator’s settings, nor any key a broker does not take from this app', () => {
      const withDefault = { ...document, settings: { ...document.settings, showDefaultExchange: true } };

      const { text } = exported(withDefault);

      expect(parsed(text).exchanges.map((exchange) => exchange['name'])).toEqual(['orders', 'audit']);
      expect(text).not.toMatch(/seed|timing|layout|rabbit_version|users|permissions|policies/);
    });

    it('reads a canvas that is frozen, and does not change it', () => {
      const frozen = deepFreeze(
        documentOf({ exchanges: { E1: exchangeRecord('x') }, queues: { Q1: queueRecord('q') } }),
      );

      expect(exportDefinitions(frozen, '/').ok).toBe(true);
      expect(frozen.exchanges['E1']!.name).toBe('x');
    });

    it('writes the names of things as the text that they are: quotes, backslashes, new lines, and letters of any script', () => {
      const names = ['say "hi"', 'back\\slash', 'new\nline', '日本語', '😀', 'tab\there'];
      const odd = documentOf({
        exchanges: { E1: exchangeRecord(names[0]!), E2: exchangeRecord(names[1]!) },
        queues: {
          Q1: queueRecord(names[2]!),
          Q2: queueRecord(names[3]!),
          Q3: queueRecord(names[4]!),
          Q4: queueRecord(names[5]!),
        },
        bindings: { B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, names[5]!) },
      });

      const file = parsed(exported(odd, 'v h"ost').text);

      expect(file.exchanges.map((exchange) => exchange['name'])).toEqual([names[0], names[1]]);
      expect(file.queues.map((queue) => queue['name'])).toEqual(names.slice(2));
      expect(file.bindings[0]!.routing_key).toBe(names[5]);
      expect(file.vhosts).toEqual([{ name: 'v h"ost' }]);
    });
  });

  describe('the arguments of a binding of a headers exchange', () => {
    it('are the mode first, when the canvas names one, and then each condition in the order of the canvas', () => {
      const document = withArguments({
        xMatch: 'any-with-x',
        args: [
          { key: 'format', value: { t: 'string', v: 'pdf' } },
          { key: 'x-region', value: { t: 'string', v: 'eu' } },
          { key: 'size', value: { t: 'integer', v: 10 } },
        ],
      });

      const [binding] = parsed(exported(document).text).bindings;

      expect(Object.entries(binding!.arguments)).toEqual([
        ['x-match', 'any-with-x'],
        ['format', 'pdf'],
        ['x-region', 'eu'],
        ['size', 10],
      ]);
    });

    it.each(['all', 'any', 'all-with-x', 'any-with-x'] as const)(
      'write the mode %s as the broker names it',
      (xMatch) => {
        const [binding] = parsed(exported(withArguments({ xMatch, args: [] })).text).bindings;

        expect(binding!.arguments).toEqual({ 'x-match': xMatch });
      },
    );

    it('leave the mode out when the canvas names none, because the broker’s default is all, and a file says what the canvas says', () => {
      const [binding] = parsed(
        exported(withArguments({ xMatch: null, args: [{ key: 'a', value: { t: 'boolean', v: true } }] })).text,
      ).bindings;

      expect(binding!.arguments).toEqual({ a: true });
      expect(Object.keys(binding!.arguments)).not.toContain('x-match');
    });

    it('are empty for a binding of a headers exchange that has no conditions and names no mode', () => {
      const [binding] = parsed(exported(withArguments({ xMatch: null, args: [] })).text).bindings;

      expect(binding!.arguments).toEqual({});
    });

    it('write a string, an integer, a float and a boolean as what they are: a whole number has no point, and a float always has one', () => {
      const { text } = exported(
        withArguments({
          xMatch: 'all',
          args: [
            { key: 's', value: { t: 'string', v: '1' } },
            { key: 'i', value: { t: 'integer', v: 1 } },
            { key: 'f', value: { t: 'float', v: 1 } },
            { key: 'g', value: { t: 'float', v: 0.5 } },
            { key: 'z', value: { t: 'float', v: -0 } },
            { key: 'n', value: { t: 'integer', v: -7 } },
            { key: 't', value: { t: 'boolean', v: true } },
            { key: 'u', value: { t: 'boolean', v: false } },
          ],
        }),
      );

      expect(text).toContain('"s": "1"');
      expect(text).toContain('"i": 1,');
      expect(text).toContain('"f": 1.0,');
      expect(text).toContain('"g": 0.5,');
      expect(text).toContain('"z": -0.0,');
      expect(text).toContain('"n": -7,');
      expect(text).toContain('"t": true,');
      expect(text).toContain('"u": false\n');
      expect(numbersOf(text)).toEqual(['1', '1.0', '0.5', '-0.0', '-7']);
    });

    it('keep the order of headers that are called like numbers, and that a JavaScript object would put in another', () => {
      const { text } = exported(
        withArguments({
          xMatch: null,
          args: [
            { key: '10', value: { t: 'integer', v: 1 } },
            { key: '2', value: { t: 'float', v: 1 } },
            { key: 'b', value: { t: 'string', v: 'x' } },
            { key: '1', value: { t: 'boolean', v: false } },
          ],
        }),
      );

      expect(text.indexOf('"10"')).toBeLessThan(text.indexOf('"2"'));
      expect(text.indexOf('"2"')).toBeLessThan(text.indexOf('"b"'));
      expect(text.indexOf('"b"')).toBeLessThan(text.indexOf('"1"'));
    });

    it('are written for a binding of any other exchange too, because a broker keeps them, and two bindings that differ by them are two', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('orders', 'topic') },
        queues: { Q1: queueRecord('billing') },
        bindings: {
          B1: headersBinding({ xMatch: 'all', args: [{ key: 'a', value: { t: 'string', v: 'b' } }] }, 'E1'),
          B2: headersBinding({ xMatch: null, args: [{ key: 'a', value: { t: 'string', v: 'c' } }] }, 'E1'),
        },
      });

      const result = exported(document);

      expect(parsed(result.text).bindings.map((binding) => binding.arguments)).toEqual([
        { 'x-match': 'all', a: 'b' },
        { a: 'c' },
      ]);
      expect(result.warnings).toEqual([]);
    });

    it('leave a binding out of the file, with a word, when one of them is a header that has to exist, whatever the exchange is', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('orders', 'direct') },
        queues: { Q1: queueRecord('billing') },
        bindings: { B1: headersBinding({ xMatch: null, args: [{ key: 'c', value: { t: 'exists' } }] }, 'E1') },
      });

      const result = exported(document);

      expect(result.summary.bindings).toBe(0);
      expect(result.warnings.map(({ kind }) => kind)).toEqual(['exists']);
    });
  });

  describe('what it leaves out, and says so', () => {
    const docs = (extra: Partial<Parameters<typeof documentOf>[0]> = {}) =>
      documentOf({
        exchanges: { E1: exchangeRecord('docs', 'headers'), E2: exchangeRecord('events', 'topic') },
        queues: { Q1: queueRecord('archive') },
        ...extra,
      });

    it('has nothing to say, and says it with no warnings, for a canvas that is all in the file', () => {
      const result = exported(docs({ bindings: { B1: bindingRecord('E2', { kind: 'queue', id: 'Q1' }, 'a.#') } }));

      expect(result.warnings).toEqual([]);
      expect(result.summary).toEqual({ exchanges: 2, queues: 1, bindings: 1 });
    });

    it('leaves a binding with a condition that a header exists out of the file, and names its two ends', () => {
      const result = exported(
        docs({
          bindings: {
            B1: headersBinding({
              xMatch: 'all',
              args: [
                { key: 'format', value: { t: 'string', v: 'pdf' } },
                { key: 'author', value: { t: 'exists' } },
              ],
            }),
            B2: headersBinding({ xMatch: null, args: [{ key: 'format', value: { t: 'string', v: 'pdf' } }] }),
          },
        }),
      );

      expect(result.summary.bindings).toBe(1);
      expect(parsed(result.text).bindings).toHaveLength(1);
      expect(result.warnings).toEqual([
        {
          kind: 'exists',
          message:
            'The binding from the exchange “docs” to the queue “archive” is not in the file: it has a condition that a header exists, and RabbitMQ does not accept a header with no value in a definitions file.',
        },
      ]);
    });

    it('says “to the exchange” when the binding that is left out ends at an exchange', () => {
      const result = exported(
        docs({
          bindings: {
            B1: bindingRecord('E1', { kind: 'exchange', id: 'E2' }, '', {
              xMatch: null,
              args: [{ key: 'author', value: { t: 'exists' } }],
            }),
          },
        }),
      );

      expect(result.warnings[0]!.message).toContain('to the exchange “events”');
    });

    it.each([
      [
        ['sender'],
        [],
        'The producer “sender” is not in the file: it is the simulator’s, and a broker has clients instead.',
      ],
      [
        [],
        ['worker'],
        'The consumer “worker” is not in the file: it is the simulator’s, and a broker has clients instead.',
      ],
      [
        ['a', 'b'],
        [],
        'The producers “a” and “b” are not in the file: they are the simulator’s, and a broker has clients instead.',
      ],
      [
        ['sender'],
        ['worker'],
        'The producer “sender” and the consumer “worker” are not in the file: they are the simulator’s, and a broker has clients instead.',
      ],
      [
        ['a', 'b', 'c'],
        ['w'],
        'The producers “a”, “b” and “c” and the consumer “w” are not in the file: they are the simulator’s, and a broker has clients instead.',
      ],
      [
        ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'],
        [],
        'The producers “p1”, “p2”, “p3”, “p4”, “p5” and 1 more are not in the file: they are the simulator’s, and a broker has clients instead.',
      ],
      [
        ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
        ['c1', 'c2'],
        'The producers “p1”, “p2”, “p3”, “p4”, “p5” and 2 more and the consumers “c1” and “c2” are not in the file: they are the simulator’s, and a broker has clients instead.',
      ],
    ])(
      'names the producers %j and the consumers %j of the simulator as one warning',
      (producers, consumers, message) => {
        const document = docs({
          producers: Object.fromEntries(producers.map((name, index) => [`P${index + 1}`, producerRecord(name)])),
          consumers: Object.fromEntries(consumers.map((name, index) => [`C${index + 1}`, consumerRecord(name)])),
        });

        const { warnings, summary } = exported(document);

        expect(warnings).toEqual([{ kind: 'simulator', message }]);
        expect(summary).toEqual({ exchanges: 2, queues: 1, bindings: 0 });
      },
    );

    it('leaves a queue that a broker named out of the file, with the bindings that end at it, and counts them', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('orders', 'topic') },
        queues: {
          Q1: queueRecord('billing'),
          Q2: queueRecord('amq.gen-abc', { serverNamed: true }),
          Q3: queueRecord('amq.gen-def', { serverNamed: true }),
        },
        bindings: {
          B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'a'),
          B2: bindingRecord('E1', { kind: 'queue', id: 'Q2' }, 'b'),
          B3: bindingRecord('E1', { kind: 'queue', id: 'Q2' }, 'c'),
          B4: bindingRecord('E1', { kind: 'queue', id: 'Q3' }, 'd'),
        },
      });

      const result = exported(document);

      expect(parsed(result.text).queues.map((queue) => queue['name'])).toEqual(['billing']);
      expect(parsed(result.text).bindings.map((binding) => binding.destination)).toEqual(['billing']);
      expect(result.summary).toEqual({ exchanges: 1, queues: 1, bindings: 1 });
      expect(result.warnings).toEqual([
        {
          kind: 'server-named',
          message:
            'The queue “amq.gen-abc” is not in the file: a broker chose its name, and a client cannot declare a name that starts with “amq.”. 2 bindings that end at it are left out with it.',
        },
        {
          kind: 'server-named',
          message:
            'The queue “amq.gen-def” is not in the file: a broker chose its name, and a client cannot declare a name that starts with “amq.”. 1 binding that ends at it is left out with it.',
        },
      ]);
    });

    it('says only that a queue that a broker named is left out, when nothing ends at it', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('orders') },
        queues: { Q1: queueRecord('amq.gen-abc', { serverNamed: true }) },
      });

      const { warnings } = exported(document);

      expect(warnings).toEqual([
        {
          kind: 'server-named',
          message:
            'The queue “amq.gen-abc” is not in the file: a broker chose its name, and a client cannot declare a name that starts with “amq.”.',
        },
      ]);
    });

    it('counts a binding with a condition that a header exists, which ends at a queue that a broker named, with the queue and not twice', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('docs', 'headers') },
        queues: { Q1: queueRecord('amq.gen-abc', { serverNamed: true }) },
        bindings: { B1: headersBinding({ xMatch: null, args: [{ key: 'a', value: { t: 'exists' } }] }) },
      });

      expect(exported(document).warnings.map(({ kind }) => kind)).toEqual(['server-named']);
    });

    it('lists the warnings in this order: the bindings that cannot be said, the simulator, the queues that a broker named', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('docs', 'headers') },
        queues: { Q1: queueRecord('archive'), Q2: queueRecord('amq.gen-abc', { serverNamed: true }) },
        bindings: { B1: headersBinding({ xMatch: null, args: [{ key: 'a', value: { t: 'exists' } }] }) },
        producers: { P1: producerRecord('sender') },
      });

      expect(exported(document).warnings.map(({ kind }) => kind)).toEqual(['exists', 'simulator', 'server-named']);
    });

    it('skips, without a word, a binding whose end is not on the canvas, because the file would not load with it', () => {
      const document = documentOf({
        exchanges: { E1: exchangeRecord('orders') },
        queues: { Q1: queueRecord('billing') },
        bindings: {
          B1: bindingRecord('E1', { kind: 'queue', id: 'Q9' }),
          B2: bindingRecord('E9', { kind: 'queue', id: 'Q1' }),
          B3: bindingRecord('constructor', { kind: 'queue', id: 'Q1' }),
        },
      });

      const result = exported(document);

      expect(parsed(result.text).bindings).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('has a sentence to say about what is never in a file, whatever the canvas', () => {
      expect(NOT_IN_THE_FILE).toBe(
        'The layout, the seed and the latencies of the simulation are not in the file either: the canvas file keeps them.',
      );
    });
  });

  describe('a canvas, or a vhost, that cannot be exported', () => {
    it('refuses a vhost that cannot be one, in the words of vhostIssue, before it looks at the canvas', () => {
      expect(exportDefinitions(documentOf({}), '')).toEqual({
        ok: false,
        error: { kind: 'vhost', message: 'A vhost needs a name. The broker’s own is “/”.' },
      });
      expect(exportDefinitions(documentOf({ exchanges: { E1: exchangeRecord('x') } }), 'a'.repeat(256))).toMatchObject({
        ok: false,
        error: { kind: 'vhost' },
      });
    });

    it('refuses a canvas that has nothing that a broker holds, and says why', () => {
      const message =
        'Nothing on the canvas can go in a definitions file: it has no exchange, no queue and no binding that a broker could hold.';

      expect(exportDefinitions(documentOf({}), '/')).toEqual({ ok: false, error: { kind: 'empty', message } });
      expect(
        exportDefinitions(
          documentOf({ producers: { P1: producerRecord('sender') }, consumers: { C1: consumerRecord('worker') } }),
          '/',
        ),
      ).toEqual({ ok: false, error: { kind: 'empty', message } });
      expect(
        exportDefinitions(documentOf({ queues: { Q1: queueRecord('amq.gen-x', { serverNamed: true }) } }), '/'),
      ).toEqual({ ok: false, error: { kind: 'empty', message } });
    });

    it('exports a canvas that has a single exchange, or a single queue, and nothing else', () => {
      expect(exportDefinitions(documentOf({ exchanges: { E1: exchangeRecord('x') } }), '/').ok).toBe(true);
      expect(exportDefinitions(documentOf({ queues: { Q1: queueRecord('q') } }), '/').ok).toBe(true);
    });
  });

  describe('the plan', () => {
    it('is the same for any vhost, and the text of the file is made from it with the vhost that is chosen', () => {
      const document = documentOf({ exchanges: { E1: exchangeRecord('x') }, queues: { Q1: queueRecord('q') } });
      const plan = planDefinitions(document);

      expect(definitionsText(plan, '/a')).toBe(exported(document, '/a').text);
      expect(definitionsText(plan, '/b')).toBe(exported(document, '/b').text);
      expect(definitionsText(plan, '/a')).not.toBe(definitionsText(plan, '/b'));
      expect(plan.summary).toEqual({ exchanges: 1, queues: 1, bindings: 0 });
    });
  });
});

describe('the golden files (ADR-0079)', () => {
  const names = readdirSync(ROOT)
    .filter((file) => file.endsWith('.commands'))
    .map((file) => file.replace(/\.commands$/, ''))
    .sort();

  it('are there, and there are several: a loop over none cannot pass', () => {
    expect(names).toEqual(['numbers', 'orders', 'warnings']);
  });

  describe.each(names)('%s', (name) => {
    const commands = readFileSync(`${ROOT}${name}.commands`, 'utf8');
    const vhost = /^# export to the vhost (.+)$/m.exec(commands)?.[1] ?? '';

    it('says which vhost it is exported to', () => {
      expect(vhost).not.toBe('');
    });

    it('is exported to the file that a person read and committed, byte for byte', () => {
      const result = exported(canvasFromText(commands), vhost);

      expect(result.text).toBe(readFileSync(`${ROOT}${name}.definitions.json`, 'utf8'));
    });

    it('is exported with the summary and the warnings that a person read and committed', () => {
      const result = exported(canvasFromText(commands), vhost);

      expect({ vhost, summary: result.summary, warnings: result.warnings }).toEqual(
        JSON.parse(readFileSync(`${ROOT}${name}.report.json`, 'utf8')),
      );
    });

    it('is a file that is JSON, whatever the line endings of a checkout', () => {
      const text = readFileSync(`${ROOT}${name}.definitions.json`, 'utf8');

      expect(() => parsed(text)).not.toThrow();
      expect(parsed(text.replaceAll('\n', '\r\n')).vhosts).toEqual([{ name: vhost }]);
    });
  });

  it('write 1 and 1.0 apart, which is what the broker reads apart', () => {
    const text = readFileSync(`${ROOT}numbers.definitions.json`, 'utf8');

    expect(numbersOf(text)).toEqual([
      '1',
      '1.0',
      '1.0',
      '0.0',
      '-0.0',
      '-2.5',
      '7',
      '123456789012345680000.0',
      '0.000001',
      '1.5e-7',
      '1e+21',
    ]);
  });
});

describe('for any canvas that commands can make and any vhost', () => {
  const arbVhost = fc.oneof(fc.constant('/'), fc.string({ minLength: 1, maxLength: 60 }));

  it('exports a file that has what the canvas has, once, with the vhost, or says that there is nothing to export', () => {
    fc.assert(
      fc.property(arbDocument, arbVhost, (document, vhost) => {
        const result = exportDefinitions(document, vhost);
        const plan = planDefinitions(document);

        if (!result.ok) {
          expect(result.error.kind).toBe('empty');
          expect(plan.summary).toEqual({ exchanges: 0, queues: 0, bindings: 0 });
          return;
        }
        const file = parsed(result.value.text);
        expect(file.vhosts).toEqual([{ name: vhost }]);
        expect(file.exchanges.map((exchange) => exchange['name'])).toEqual(
          Object.values(document.exchanges).map(({ name }) => name),
        );
        expect(file.queues.map((queue) => queue['name'])).toEqual(
          Object.values(document.queues)
            .filter(({ serverNamed }) => !serverNamed)
            .map(({ name }) => name),
        );
        for (const item of [...file.exchanges, ...file.queues, ...file.bindings]) {
          expect(item['vhost']).toBe(vhost);
        }
        expect(file.bindings).toHaveLength(result.value.summary.bindings);
        expect(result.value.summary).toEqual({
          exchanges: file.exchanges.length,
          queues: file.queues.length,
          bindings: file.bindings.length,
        });
      }),
    );
  });

  it('leaves out exactly the bindings that it says it leaves out, and every binding of the canvas is in the file or in a warning', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        const result = exportDefinitions(document, '/');
        if (!result.ok) {
          return;
        }
        const exists = Object.values(document.bindings).filter(
          ({ headers, dest }) =>
            headers?.args.some(({ value }) => value.t === 'exists') &&
            !(dest.kind === 'queue' && document.queues[dest.id]?.serverNamed === true),
        ).length;
        const toNamed = Object.values(document.bindings).filter(
          ({ dest }) => dest.kind === 'queue' && document.queues[dest.id]?.serverNamed === true,
        ).length;

        expect(result.value.warnings.filter(({ kind }) => kind === 'exists')).toHaveLength(exists);
        expect(result.value.summary.bindings + exists + toNamed).toBe(Object.keys(document.bindings).length);
      }),
    );
  });

  it('writes each number of a binding as the kind that it is, in the order of the canvas: a float with a point or an exponent, a whole number without', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        const result = exportDefinitions(document, '/');
        if (!result.ok) {
          return;
        }

        const written = numbersOf(result.value.text);

        expect(written.map((token) => /[.eE]/.test(token))).toEqual(numbersIn(document).map(({ float }) => float));
        expect(written.map(Number)).toEqual(numbersIn(document).map(({ value }) => value));
      }),
    );
  });

  it('gives the same file for the same canvas, and never throws', () => {
    fc.assert(
      fc.property(arbDocument, arbVhost, (document, vhost) => {
        const first = exportDefinitions(document, vhost);

        expect(exportDefinitions(document, vhost)).toEqual(first);
        expect(first.ok || ['empty', 'vhost'].includes(first.error.kind)).toBe(true);
      }),
    );
  });
});
