import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyCommand, emptyDocument, type ApplyContext, type CanvasDocument, type IdKind } from '@rmq/domain';
import { arbDocument, configureFastCheck, sampleDocument } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exportDefinitions } from '../export/definitions';
import {
  defaultVhost,
  importBatch,
  importSummaryText,
  planImport,
  readDefinitions,
  type DefinitionsFile,
  type ImportError,
  type ImportPlan,
} from './definitions';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const FIXTURES = fileURLToPath(new URL('../../../../../fixtures/', import.meta.url));
const fixture = (path: string): string => readFileSync(`${FIXTURES}${path}`, 'utf8');
/** A full export of a RabbitMQ 4.3.6 broker, from `GET /api/definitions`, with two vhosts, users, permissions and a policy. */
const BROKER = 'import/broker-4.3.definitions.json';
/** The same broker's export of the vhost `/` alone, from `GET /api/definitions/%2F`, as it wrote it: its entries name no vhost. */
const ONE_VHOST = 'import/broker-4.3-one-vhost.definitions.json';

/** Ids that no canvas made by the specs has: an import may be applied to any canvas. */
function freshIds(): ApplyContext {
  let count = 0;
  return { newId: (kind: IdKind) => `imported${kind.charAt(0)}${(count += 1)}` };
}

function file(text: string): DefinitionsFile {
  const result = readDefinitions(text);
  if (!result.ok) {
    throw new Error(`expected a definitions file, and got: ${result.error.message}`);
  }
  return result.value;
}

function plan(text: string, vhost?: string | null): ImportPlan {
  const read = file(text);
  const chosen = vhost === undefined ? defaultVhost(read) : vhost;
  if (chosen === undefined) {
    throw new Error('the file has several vhosts: the spec has to choose one');
  }
  const result = planImport(read, chosen);
  if (!result.ok) {
    throw new Error(`expected a plan, and got: ${result.error.message}`);
  }
  return result.value;
}

function refusal(text: string, vhost: string | null = null): ImportError {
  const read = readDefinitions(text);
  if (!read.ok) {
    return read.error;
  }
  const planned = planImport(read.value, vhost);
  if (planned.ok) {
    throw new Error('expected the import to be refused');
  }
  return planned.error;
}

/** The canvas that the import makes of `onto`, as the app makes it: one batch. */
function imported(onto: CanvasDocument, planned: ImportPlan): CanvasDocument {
  const result = applyCommand(onto, importBatch(planned), freshIds());
  if (!result.ok) {
    throw new Error(`the batch of an import was refused: ${result.error.message}`);
  }
  return result.value;
}

const notes = (planned: ImportPlan, kind?: string): string[] =>
  planned.notes.filter((note) => kind === undefined || note.kind === kind).map(({ message }) => message);

/** A definitions file of one vhost, with the lists that it is given. */
const definitions = (lists: Record<string, unknown>): string => JSON.stringify({ vhosts: [{ name: '/' }], ...lists });
const exchange = (name: string, type = 'direct', more: Record<string, unknown> = {}) => ({
  name,
  vhost: '/',
  type,
  durable: true,
  auto_delete: false,
  internal: false,
  arguments: {},
  ...more,
});
const queue = (name: string, more: Record<string, unknown> = {}) => ({
  name,
  vhost: '/',
  durable: true,
  auto_delete: false,
  arguments: {},
  ...more,
});
const binding = (source: string, destination: string, more: Record<string, unknown> = {}) => ({
  source,
  vhost: '/',
  destination,
  destination_type: 'queue',
  routing_key: '',
  arguments: {},
  ...more,
});

describe('the import of a definitions file (ADR-0111)', () => {
  describe('the export of this app, read back', () => {
    const golden = readdirSync(`${FIXTURES}export`).filter((name) => name.endsWith('.definitions.json'));

    it.each(golden)(
      '%s makes a canvas that exports the same file, on an empty canvas and over one that has things',
      (name) => {
        const text = fixture(`export/${name}`);
        const planned = plan(text);

        for (const onto of [emptyDocument(), sampleDocument()]) {
          const canvas = imported(onto, planned);
          const again = exportDefinitions(canvas, planned.vhost ?? '/');
          expect(again.ok && again.value.text).toBe(text);
        }
        expect(planned.notes).toEqual([]);
      },
    );
  });

  describe('for any canvas that commands can make', () => {
    const arbVhost = fc.oneof(fc.constant('/'), fc.string({ minLength: 1, maxLength: 60 }));

    it('imports its export onto any canvas, which then has the vhost and nothing else, and exports the same file', () => {
      fc.assert(
        fc.property(arbDocument, arbDocument, arbVhost, (document, onto, vhost) => {
          const exported = exportDefinitions(document, vhost);
          fc.pre(exported.ok);
          if (!exported.ok) {
            return;
          }
          const planned = plan(exported.value.text);
          expect(planned.vhost).toBe(vhost);
          expect(planned.summary).toEqual(exported.value.summary);
          expect(planned.notes).toEqual([]);

          const canvas = imported(onto, planned);
          expect(canvas.vhost).toBe(vhost);
          expect(canvas.settings).toEqual(onto.settings);
          expect(Object.keys(canvas.producers)).toEqual([]);
          expect(Object.keys(canvas.consumers)).toEqual([]);
          const again = exportDefinitions(canvas, vhost);
          expect(again.ok && again.value.text).toBe(exported.value.text);
        }),
      );
    });

    it('never throws on a file that has been damaged anywhere, and either refuses it in words or plans an import that the canvas takes', () => {
      fc.assert(
        fc.property(arbDocument, fc.jsonValue(), fc.nat(), (document, damage, where) => {
          const exported = exportDefinitions(document, '/');
          fc.pre(exported.ok);
          if (!exported.ok) {
            return;
          }
          // Puts the damage in place of one of the values of the file, whichever it is, or at the top.
          const data = JSON.parse(exported.value.text) as unknown;
          const holders: { parent: Record<string, unknown> | unknown[]; key: string | number }[] = [];
          const collect = (value: unknown): void => {
            if (Array.isArray(value)) {
              value.forEach((item, index) => {
                holders.push({ parent: value, key: index });
                collect(item);
              });
            } else if (typeof value === 'object' && value !== null) {
              for (const [key, item] of Object.entries(value)) {
                holders.push({ parent: value as Record<string, unknown>, key });
                collect(item);
              }
            }
          };
          collect(data);
          const holder = holders[where % (holders.length + 1)];
          if (holder !== undefined) {
            (holder.parent as Record<string | number, unknown>)[holder.key] = damage;
          }

          const read = readDefinitions(JSON.stringify(holder === undefined ? damage : data));
          if (!read.ok) {
            expect(read.error.message.length).toBeGreaterThan(0);
            return;
          }
          const vhost = defaultVhost(read.value) ?? read.value.vhosts[0] ?? null;
          const planned = planImport(read.value, vhost);
          if (!planned.ok) {
            expect(planned.error.message.length).toBeGreaterThan(0);
            return;
          }
          const canvas = applyCommand(document, importBatch(planned.value), freshIds());
          expect(canvas.ok).toBe(true);
        }),
      );
    });
  });

  describe('a file that RabbitMQ 4.3 exported', () => {
    it('names its vhosts, and asks which one to import when there are several', () => {
      const read = file(fixture(BROKER));

      expect(read.vhosts).toEqual(['shop', '/']);
      expect(defaultVhost(read)).toBeUndefined();
      expect(refusal(fixture(BROKER))).toEqual({
        kind: 'vhost',
        message: 'Choose which vhost to import: this file has “shop” and “/”.',
      });
      expect(refusal(fixture(BROKER), 'nowhere').message).toBe(
        'This file has no vhost “nowhere”. It has “shop” and “/”.',
      );
    });

    it('imports the exchanges, the queues and the bindings of the vhost that is chosen, in the order of the file', () => {
      const planned = plan(fixture(BROKER), '/');
      const canvas = imported(emptyDocument(), planned);

      expect(planned.summary).toEqual({ exchanges: 3, queues: 4, bindings: 5 });
      expect(Object.values(canvas.exchanges).map(({ name, type }) => `${type} ${name}`)).toEqual([
        'fanout audit',
        'headers docs',
        'topic orders',
      ]);
      expect(Object.values(canvas.queues).map(({ name }) => name)).toEqual([
        'billing',
        'history',
        'archive',
        'shipping',
      ]);
      expect(canvas.vhost).toBe('/');
      expect(importSummaryText(planned.summary)).toBe('3 exchanges, 4 queues and 5 bindings');
    });

    it('keeps a header value of 1.0 a float and 10 an integer, as the broker does', () => {
      const planned = plan(fixture(BROKER), '/');
      const headers = planned.commands.flatMap((command) => (command.type === 'bind' ? [command.headers] : []));

      expect(headers.filter((each) => each !== undefined)).toEqual([
        {
          xMatch: 'any',
          args: [
            { key: 'draft', value: { t: 'boolean', v: false } },
            { key: 'format', value: { t: 'string', v: 'pdf' } },
            { key: 'pages', value: { t: 'integer', v: 10 } },
            { key: 'ratio', value: { t: 'float', v: 1 } },
          ],
        },
      ]);
    });

    it('says what it left out and what it changed, in words', () => {
      const planned = plan(fixture(BROKER), '/');

      expect(notes(planned, 'left-out')).toEqual([
        'The users (2), permissions (3) and policies (1) of the file are not imported: a canvas has exchanges, queues and bindings only.',
        'The exchanges (1), queues (1) and bindings (1) of the other vhosts of the file are not imported: a canvas is one vhost.',
        'The exchanges that a broker makes itself (“amq.rabbitmq.log”) are not imported: every broker has them, and a canvas cannot declare a name that starts with “amq.”.',
      ]);
      expect(notes(planned, 'changed')).toEqual([
        'The exchange “audit” is imported without its arguments (“alternate-exchange”): the simulator does not model them.',
        'The queue “history” is imported as a classic queue: its type is “stream”, and the simulator models classic queues only.',
        'The queue “archive” is imported without its arguments (“x-message-ttl”): the simulator does not model them.',
        'The queue “shipping” is imported as a classic queue: its type is “quorum”, and the simulator models classic queues only.',
      ]);
      expect(notes(planned, 'refused')).toEqual([
        expect.stringMatching(
          /^The binding from the exchange “amq\.topic” to the queue “billing” is not imported: 'amq\.topic' is one of the exchanges that RabbitMQ has built in\./,
        ),
      ]);
    });

    it('imports the other vhost when it is chosen, and leaves out what the broker keeps for itself', () => {
      const planned = plan(fixture(BROKER), 'shop');

      expect(planned.summary).toEqual({ exchanges: 1, queues: 1, bindings: 1 });
      expect(imported(sampleDocument(), planned).vhost).toBe('shop');
    });

    it('imports the export of one vhost, which names none, and the canvas keeps its own vhost', () => {
      const planned = plan(fixture(ONE_VHOST));
      const canvas = imported(emptyDocument({ vhost: '/mine' }), planned);

      expect(planned.vhost).toBeNull();
      expect(planned.summary).toEqual({ exchanges: 3, queues: 4, bindings: 5 });
      expect(canvas.vhost).toBe('/mine');
      expect(notes(planned, 'left-out')[0]).toBe(
        'The policies (1) of the file are not imported: a canvas has exchanges, queues and bindings only.',
      );
    });
  });

  describe('what replaces the canvas', () => {
    it('is one batch that clears the canvas, gives it the vhost, makes what the file has and lays it out, and says what it is', () => {
      const planned = plan(definitions({ exchanges: [exchange('orders')], queues: [queue('billing')] }));
      const batch = importBatch(planned);

      expect(batch.label).toBe('imported 1 exchange and 1 queue from a definitions file');
      expect(batch.commands.map(({ type }) => type)).toEqual([
        'clear',
        'set',
        'declare-exchange',
        'declare-queue',
        'layout',
      ]);
    });

    it('takes off everything that was on the canvas, producers and consumers too, and keeps its settings', () => {
      const before = sampleDocument();
      const canvas = imported(before, plan(definitions({ queues: [queue('fresh')] })));

      expect(Object.values(canvas.queues).map(({ name }) => name)).toEqual(['fresh']);
      expect(canvas.exchanges).toEqual({});
      expect(canvas.producers).toEqual({});
      expect(canvas.consumers).toEqual({});
      expect(canvas.bindings).toEqual({});
      expect(canvas.settings).toEqual(before.settings);
      expect(Object.keys(canvas.layout.nodes)).toEqual(Object.keys(canvas.queues));
    });
  });

  describe('a file that is not one, or not all of one', () => {
    it.each([
      ['{', 'This file is not JSON: the text ends before the object does, at character 2.'],
      ['[]', 'This is not a RabbitMQ definitions file'],
      ['{"users": []}', 'This is not a RabbitMQ definitions file'],
      [
        '{"format": "rmq-playground/canvas", "version": 1}',
        'This is a file of this app, not a RabbitMQ definitions file.',
      ],
      ['{"queues": {}}', 'This definitions file cannot be read: "queues" has to be a list, and it is not.'],
    ])('refuses %s, in words', (text, message) => {
      expect(refusal(text).message).toContain(message);
    });

    it('refuses a text that is longer than a file can be, before it reads it', () => {
      expect(refusal(' '.repeat(50_000_001))).toMatchObject({ kind: 'too-large' });
    });

    it('reads a file that starts with a byte order mark', () => {
      expect(plan(`${String.fromCharCode(0xfeff)}${definitions({ queues: [queue('billing')] })}`).summary.queues).toBe(
        1,
      );
    });

    it('does not crash on a binding that is null, and says that it left it out (the crash of earlier simulators)', () => {
      const planned = plan(definitions({ queues: [queue('billing')], bindings: [null, 7, 'binding'] }));

      expect(planned.summary).toEqual({ exchanges: 0, queues: 1, bindings: 0 });
      expect(notes(planned)).toEqual([
        '3 items of the list of bindings are not imported: they do not have the fields that a definitions file has, of the right kinds.',
      ]);
    });

    it('leaves out an item that lacks a field or has one of the wrong kind, and imports the rest', () => {
      const planned = plan(
        definitions({
          exchanges: [{ vhost: '/', type: 'direct' }, exchange('orders', 'direct', { durable: 'yes' }), exchange('ok')],
          queues: [queue('q', { arguments: [] }), queue('fine')],
          bindings: [binding('ok', 'fine', { destination_type: 'stream' })],
        }),
      );

      expect(planned.summary).toEqual({ exchanges: 1, queues: 1, bindings: 0 });
      expect(notes(planned)).toEqual([
        '2 items of the list of exchanges are not imported: they do not have the fields that a definitions file has, of the right kinds.',
        '1 item of the list of queues is not imported: it does not have the fields that a definitions file has, of the right kinds.',
        '1 item of the list of bindings is not imported: it does not have the fields that a definitions file has, of the right kinds.',
      ]);
    });

    it('leaves out an exchange of a type that the simulator does not have, and the bindings that need it', () => {
      const planned = plan(
        definitions({
          exchanges: [exchange('hash', 'x-consistent-hash'), exchange('plain')],
          queues: [queue('billing')],
          bindings: [binding('hash', 'billing'), binding('plain', 'hash', { destination_type: 'exchange' })],
        }),
      );

      expect(planned.summary).toEqual({ exchanges: 1, queues: 1, bindings: 0 });
      expect(notes(planned, 'left-out')).toEqual([
        'The exchange “hash” is not imported: its type “x-consistent-hash” is not one of the four that the simulator has: direct, fanout, topic and headers.',
        'The binding from the exchange “hash” to the queue “billing” is not imported: the exchange “hash” is not on the canvas, since it is not imported.',
        'The binding from the exchange “plain” to the exchange “hash” is not imported: the exchange “hash” is not on the canvas, since it is not imported.',
      ]);
    });

    it('leaves out a binding of the default exchange, and one whose arguments the simulator cannot hold', () => {
      const planned = plan(
        definitions({
          exchanges: [exchange('docs', 'headers')],
          queues: [queue('billing')],
          bindings: [
            binding('', 'billing', { routing_key: 'billing' }),
            binding('docs', 'billing', { arguments: { 'x-match': 'some' } }),
            binding('docs', 'billing', { arguments: { tags: ['a'] } }),
            binding('docs', 'billing', { arguments: { nothing: null } }),
            binding('docs', 'billing', { arguments: { nested: { a: 1 } } }),
          ],
        }),
      );

      expect(planned.summary.bindings).toBe(0);
      expect(notes(planned, 'left-out')).toEqual([
        'The binding from the default exchange to the queue “billing” is not imported: a broker makes the bindings of the default exchange itself.',
        'The binding from the exchange “docs” to the queue “billing” is not imported: its x-match is not one of “all”, “any”, “all-with-x” and “any-with-x”.',
        'The binding from the exchange “docs” to the queue “billing” is not imported: its argument “tags” cannot be held by the simulator: it is a list.',
        'The binding from the exchange “docs” to the queue “billing” is not imported: its argument “nothing” cannot be held by the simulator: it has no value.',
        'The binding from the exchange “docs” to the queue “billing” is not imported: its argument “nested” cannot be held by the simulator: it is a table.',
      ]);
    });

    it('says what the canvas refuses, with the reason that it gives, and imports the rest', () => {
      const planned = plan(
        definitions({
          exchanges: [exchange('orders', 'topic')],
          queues: [queue('transient', { durable: false }), queue('billing'), queue('auto', { auto_delete: true })],
          bindings: [binding('orders', 'billing', { routing_key: '#.#.#' }), binding('orders', 'billing')],
        }),
      );

      expect(planned.summary).toEqual({ exchanges: 1, queues: 2, bindings: 1 });
      expect(notes(planned, 'changed')).toEqual([
        'The queue “auto” is imported as one that is not auto-delete: the simulator does not model it.',
      ]);
      expect(notes(planned, 'refused')).toEqual([
        expect.stringMatching(/^The queue “transient” is not imported: .*durable/),
        expect.stringMatching(/^The binding from the exchange “orders” to the queue “billing” is not imported: .*#/),
      ]);
    });

    it('counts what is there twice once, and says nothing of it', () => {
      const planned = plan(definitions({ queues: [queue('billing'), queue('billing')] }));

      expect(planned.summary.queues).toBe(1);
      expect(planned.notes).toEqual([]);
    });

    it('refuses a file that has nothing that a canvas can hold, and says why each thing was left out', () => {
      const error = refusal(definitions({ exchanges: [exchange('amq.direct')], queues: [] }), '/');

      expect(error).toMatchObject({
        kind: 'empty',
        message:
          'Nothing in this file can go on a canvas for the vhost “/”: it has no exchange, no queue and no binding that the simulator can hold.',
      });
      expect(error.kind === 'empty' && error.notes.map(({ kind }) => kind)).toEqual(['left-out']);
    });

    it('refuses a vhost that a canvas cannot have', () => {
      expect(refusal(JSON.stringify({ vhosts: [{ name: '' }], queues: [queue('q', { vhost: '' })] }), '')).toEqual({
        kind: 'vhost',
        message:
          'The vhost of this file cannot be the vhost of a canvas. A vhost needs a name. The broker’s own is “/”.',
      });
    });
  });
});
