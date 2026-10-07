import type { EngineCommand } from '@rmq/engine';
import {
  applyAll,
  applyEngineCommands,
  bindingRecord,
  canonicalTopology,
  consumerRecord,
  deepFreeze,
  documentOf,
  emptyBroker,
  entry,
  exchangeEnd,
  exchangeRecord,
  headerArguments,
  int,
  producerRecord,
  queueEnd,
  queueRecord,
  sampleDocument,
  str,
  topologyOf,
  type BrokerState,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { DocumentCommand } from './commands/types';
import type { CanvasDocument } from './document/schema';
import { toTopology } from './document/topology';
import { reconcile } from './reconcile';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());

/** The broker that `reconcile` builds from nothing for a document. */
const brokerFor = (document: CanvasDocument): BrokerState =>
  applyEngineCommands(emptyBroker(document.vhost), reconcile(null, document));

/** What the engine holds after it follows `reconcile` from one document to the next. */
const follow = (previous: CanvasDocument | null, next: CanvasDocument): BrokerState =>
  applyEngineCommands(previous === null ? emptyBroker(next.vhost) : brokerFor(previous), reconcile(previous, next));

/** The ops of a list of commands with the names they are about, for a spec to read. */
const brief = (commands: readonly EngineCommand[]): string[] =>
  commands.map((command) => {
    switch (command.op) {
      case 'exchange.declare':
      case 'queue.declare':
      case 'exchange.delete':
      case 'queue.delete':
        return `${command.op} ${command.name}`;
      case 'bind':
      case 'unbind':
        return `${command.op} ${command.source}>${command.destination.kind[0]}:${command.destination.name}${command.key === '' ? '' : ` '${command.key}'`}`;
      default:
        return command.op;
    }
  });

const change = (document: CanvasDocument, ...commands: DocumentCommand[]): CanvasDocument =>
  deepFreeze(applyAll(document, commands));

describe('reconcile', () => {
  describe('when nothing changed', () => {
    it('has nothing to do for the same document, and for a copy of it', () => {
      const document = sample();

      expect(reconcile(document, document)).toEqual([]);
      expect(reconcile(document, sample())).toEqual([]);
    });

    it('has nothing to do for a canvas with nothing on it, loaded or not', () => {
      expect(reconcile(null, deepFreeze(documentOf()))).toEqual([]);
      expect(reconcile(deepFreeze(documentOf()), deepFreeze(documentOf()))).toEqual([]);
    });

    it('has nothing to do for what the engine does not hold: where things are, what producers and consumers do, the settings', () => {
      const before = sample();
      const after = change(
        before,
        { type: 'move', target: { kind: 'queue', name: 'billing' }, x: 5, y: 5 },
        {
          type: 'move-label',
          from: { kind: 'exchange', name: 'orders' },
          to: { kind: 'queue', name: 'billing' },
          at: 0.9,
        },
        { type: 'set', kind: 'producer', name: 'sender', changes: { payload: 'new', burst: 9 } },
        { type: 'set', kind: 'consumer', name: 'worker', changes: { prefetch: 9 } },
        { type: 'set', kind: 'canvas', changes: { seed: 77, showDefaultExchange: true } },
        { type: 'link', producer: 'sender', target: { kind: 'queue', name: 'archive' } },
        { type: 'subscribe', consumer: 'worker', queue: 'archive' },
        { type: 'add-producer', name: 'another' },
        { type: 'add-consumer', name: 'other' },
        { type: 'layout' },
      );

      expect(reconcile(before, after)).toEqual([]);
    });
  });

  describe('when the engine has nothing, as after a load', () => {
    it('declares every exchange, then every queue, then makes every binding, in the order that the document has them', () => {
      expect(brief(reconcile(null, sample()))).toEqual([
        'exchange.declare orders',
        'exchange.declare docs',
        'exchange.declare hidden',
        'queue.declare billing',
        'queue.declare archive',
        "bind orders>q:billing 'order.*'",
        'bind docs>q:archive',
        "bind orders>e:hidden '#'",
      ]);
    });

    it('declares each exchange with every flag written out, and each queue with its durability', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { E: exchangeRecord('e', 'headers', { durable: false, autoDelete: true, internal: true }) },
          queues: { Q: queueRecord('q') },
        }),
      );

      expect(reconcile(null, document)).toEqual([
        { op: 'exchange.declare', name: 'e', type: 'headers', durable: false, autoDelete: true, internal: true },
        { op: 'queue.declare', name: 'q', durable: true },
      ]);
    });

    it('binds with the key and the arguments, and with no arguments when there are none to say', () => {
      const withHeaders = headerArguments('any', entry('format', str('pdf')));
      const document = deepFreeze(
        documentOf({
          exchanges: { E: exchangeRecord('e', 'headers') },
          queues: { Q: queueRecord('q'), R: queueRecord('r') },
          bindings: {
            B1: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'k', withHeaders),
            B2: bindingRecord('E', { kind: 'queue', id: 'R' }, '', headerArguments(null)),
          },
        }),
      );
      const binds = reconcile(null, document).filter((command) => command.op === 'bind');

      expect(binds).toEqual([
        { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'q' }, key: 'k', headers: withHeaders },
        { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'r' }, key: '' },
      ]);
      expect('headers' in (binds[1] as object)).toBe(false);
    });

    it('builds the topology of the document, and of a canvas of any size', () => {
      expect(canonicalTopology(topologyOf(follow(null, sample())))).toEqual(canonicalTopology(toTopology(sample())));
    });
  });

  describe('when something is added', () => {
    it('declares a new exchange and a new queue, and nothing else', () => {
      const before = sample();

      expect(
        brief(
          reconcile(
            before,
            change(before, {
              type: 'declare-exchange',
              name: 'fresh',
              exchangeType: 'fanout',
              durable: true,
              autoDelete: false,
              internal: false,
            }),
          ),
        ),
      ).toEqual(['exchange.declare fresh']);
      expect(brief(reconcile(before, change(before, { type: 'declare-queue', name: 'fresh', durable: true })))).toEqual(
        ['queue.declare fresh'],
      );
    });

    it('declares before it binds, so that a binding to something new has both of its ends', () => {
      const before = sample();
      const after = change(
        before,
        { type: 'declare-queue', name: 'fresh', durable: true },
        {
          type: 'declare-exchange',
          name: 'extra',
          exchangeType: 'direct',
          durable: true,
          autoDelete: false,
          internal: false,
        },
        { type: 'bind', source: 'extra', destination: queueEnd('fresh'), key: 'a' },
        { type: 'bind', source: 'orders', destination: exchangeEnd('extra'), key: 'b' },
      );

      expect(brief(reconcile(before, after))).toEqual([
        'exchange.declare extra',
        'queue.declare fresh',
        "bind extra>q:fresh 'a'",
        "bind orders>e:extra 'b'",
      ]);
    });

    it('makes a new binding between two things that were there', () => {
      const before = sample();
      const after = change(before, { type: 'bind', source: 'orders', destination: queueEnd('archive'), key: 'late' });

      expect(brief(reconcile(before, after))).toEqual(["bind orders>q:archive 'late'"]);
    });
  });

  describe('when something is removed', () => {
    it('unbinds a binding that went while both of its ends stay', () => {
      const before = sample();
      const after = change(before, {
        type: 'unbind',
        source: 'orders',
        destination: queueEnd('billing'),
        key: 'order.*',
      });

      expect(brief(reconcile(before, after))).toEqual(["unbind orders>q:billing 'order.*'"]);
    });

    it('deletes an exchange without unbinding what is bound from it or to it, which a broker deletes with it', () => {
      const before = sample();
      const after = change(before, { type: 'delete', target: { kind: 'exchange', name: 'orders' } });

      expect(brief(reconcile(before, after))).toEqual(['exchange.delete orders']);
      expect(canonicalTopology(topologyOf(follow(before, after)))).toEqual(canonicalTopology(toTopology(after)));
    });

    it('deletes a queue without unbinding what is bound to it', () => {
      const before = sample();
      const after = change(before, { type: 'delete', target: { kind: 'queue', name: 'billing' } });

      expect(brief(reconcile(before, after))).toEqual(['queue.delete billing']);
      expect(canonicalTopology(topologyOf(follow(before, after)))).toEqual(canonicalTopology(toTopology(after)));
    });

    it('unbinds a binding of two things that stay, while it deletes another thing', () => {
      const before = sample();
      const after = change(
        before,
        {
          type: 'unbind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: '',
          headers: headerArguments('any', entry('format', str('pdf'))),
        },
        { type: 'delete', target: { kind: 'queue', name: 'billing' } },
      );

      expect(brief(reconcile(before, after))).toEqual(['unbind docs>q:archive', 'queue.delete billing']);
    });

    it('takes everything away for a clear: the exchanges and the queues, and no unbinding', () => {
      const before = sample();
      const after = change(before, { type: 'clear' });

      expect(brief(reconcile(before, after))).toEqual([
        'exchange.delete orders',
        'exchange.delete docs',
        'exchange.delete hidden',
        'queue.delete billing',
        'queue.delete archive',
      ]);
      expect(follow(before, after).exchanges).toEqual([]);
    });
  });

  describe('when something is changed', () => {
    it('deletes and declares again for a rename, and binds again what was bound, under the new name', () => {
      const before = sample();
      const after = change(before, { type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'invoices' });

      expect(brief(reconcile(before, after))).toEqual([
        'queue.delete billing',
        'queue.declare invoices',
        "bind orders>q:invoices 'order.*'",
      ]);
    });

    it('does the same for an exchange, binding again what started from it and what ended at it', () => {
      const before = sample();
      const after = change(before, { type: 'rename', target: { kind: 'exchange', name: 'orders' }, name: 'sales' });

      expect(brief(reconcile(before, after))).toEqual([
        'exchange.delete orders',
        'exchange.declare sales',
        "bind sales>q:billing 'order.*'",
        "bind sales>e:hidden '#'",
      ]);
      expect(canonicalTopology(topologyOf(follow(before, after)))).toEqual(canonicalTopology(toTopology(after)));
    });

    it('deletes and declares again for a change of type or of a flag, and binds again what the engine lost', () => {
      const before = sample();
      const type = change(before, { type: 'set', kind: 'exchange', name: 'docs', changes: { exchangeType: 'direct' } });
      const flag = change(before, { type: 'set', kind: 'exchange', name: 'hidden', changes: { autoDelete: true } });

      expect(brief(reconcile(before, type))).toEqual([
        'exchange.delete docs',
        'exchange.declare docs',
        'bind docs>q:archive',
      ]);
      expect(brief(reconcile(before, flag))).toEqual([
        'exchange.delete hidden',
        'exchange.declare hidden',
        "bind orders>e:hidden '#'",
      ]);
      expect(follow(before, flag).exchanges.find(({ name }) => name === 'hidden')?.autoDelete).toBe(true);
    });

    it('does the same when the exchange is what a binding ends at', () => {
      const before = sample();
      const after = change(before, { type: 'set', kind: 'exchange', name: 'hidden', changes: { internal: false } });

      expect(brief(reconcile(before, after))).toEqual([
        'exchange.delete hidden',
        'exchange.declare hidden',
        "bind orders>e:hidden '#'",
      ]);
    });

    it('changes nothing for a binding whose two ends are the same exchange and queue, however the document was rebuilt', () => {
      const before = sample();
      const rebuilt = deepFreeze(
        documentOf({
          exchanges: {
            A: exchangeRecord('orders', 'topic'),
            B: exchangeRecord('docs', 'headers'),
            C: exchangeRecord('hidden', 'fanout', { internal: true }),
          },
          queues: { X: queueRecord('billing'), Y: queueRecord('archive') },
          bindings: {
            b1: bindingRecord('A', { kind: 'queue', id: 'X' }, 'order.*'),
            b2: bindingRecord('B', { kind: 'queue', id: 'Y' }, '', headerArguments('any', entry('format', str('pdf')))),
            b3: bindingRecord('A', { kind: 'exchange', id: 'C' }, '#'),
          },
        }),
      );

      expect(reconcile(before, rebuilt)).toEqual([]);
    });

    it('unbinds and binds again for another key, another mode or another condition', () => {
      const before = sample();
      const key = change(
        before,
        { type: 'unbind', source: 'orders', destination: queueEnd('billing'), key: 'order.*' },
        { type: 'bind', source: 'orders', destination: queueEnd('billing'), key: 'order.#' },
      );
      const mode = change(
        before,
        {
          type: 'unbind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: '',
          headers: headerArguments('any', entry('format', str('pdf'))),
        },
        {
          type: 'bind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: '',
          headers: headerArguments('all', entry('format', str('pdf'))),
        },
      );
      const value = change(
        before,
        {
          type: 'unbind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: '',
          headers: headerArguments('any', entry('format', str('pdf'))),
        },
        {
          type: 'bind',
          source: 'docs',
          destination: queueEnd('archive'),
          key: '',
          headers: headerArguments('any', entry('format', int(1))),
        },
      );

      expect(brief(reconcile(before, key))).toEqual([
        "unbind orders>q:billing 'order.*'",
        "bind orders>q:billing 'order.#'",
      ]);
      expect(brief(reconcile(before, mode))).toEqual(['unbind docs>q:archive', 'bind docs>q:archive']);
      expect(brief(reconcile(before, value))).toEqual(['unbind docs>q:archive', 'bind docs>q:archive']);
    });

    it('does nothing for the same arguments in another order, or for none written another way', () => {
      const one = headerArguments('all', entry('a', int(1)), entry('b', int(2)));
      const other = headerArguments('all', entry('b', int(2)), entry('a', int(1)));
      const build = (headers: typeof one | undefined) =>
        deepFreeze(
          documentOf({
            exchanges: { E: exchangeRecord('e', 'headers') },
            queues: { Q: queueRecord('q') },
            bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, '', headers) },
          }),
        );

      expect(reconcile(build(one), build(other))).toEqual([]);
      expect(reconcile(build(undefined), build(headerArguments(null)))).toEqual([]);
    });

    it('keeps a queue and an exchange that share a name apart', () => {
      const before = deepFreeze(
        documentOf({ exchanges: { E: exchangeRecord('same') }, queues: { Q: queueRecord('same') } }),
      );
      const after = change(before, { type: 'delete', target: { kind: 'queue', name: 'same' } });

      expect(brief(reconcile(before, after))).toEqual(['queue.delete same']);
    });

    it('swaps two names, which is nothing to the engine when the two are declared the same way', () => {
      const before = deepFreeze(documentOf({ exchanges: { A: exchangeRecord('one'), B: exchangeRecord('two') } }));
      const after = deepFreeze(documentOf({ exchanges: { A: exchangeRecord('two'), B: exchangeRecord('one') } }));

      expect(reconcile(before, after)).toEqual([]);
    });
  });

  describe('as the one path for do, undo, redo, load and clear', () => {
    it('undoes what it did: following a change and then following back leaves the engine as it was', () => {
      const before = sample();
      const after = change(
        before,
        { type: 'rename', target: { kind: 'exchange', name: 'orders' }, name: 'sales' },
        { type: 'delete', target: { kind: 'queue', name: 'archive' } },
        { type: 'declare-queue', name: 'late', durable: true },
        { type: 'bind', source: 'sales', destination: queueEnd('late'), key: 'x' },
        { type: 'set', kind: 'exchange', name: 'docs', changes: { exchangeType: 'fanout' } },
      );
      const there = follow(before, after);
      const back = applyEngineCommands(there, reconcile(after, before));

      expect(canonicalTopology(topologyOf(there))).toEqual(canonicalTopology(toTopology(after)));
      expect(canonicalTopology(topologyOf(back))).toEqual(canonicalTopology(toTopology(before)));
    });

    it('loads a canvas over another: the commands are valid for the engine as it is, and leave it as the new canvas', () => {
      const other = deepFreeze(
        documentOf({
          exchanges: { A: exchangeRecord('orders', 'direct'), Z: exchangeRecord('new', 'fanout') },
          queues: { Q: queueRecord('archive'), W: queueRecord('other') },
          bindings: {
            B: bindingRecord('A', { kind: 'queue', id: 'Q' }, 'k'),
            C: bindingRecord('Z', { kind: 'exchange', id: 'A' }),
          },
        }),
      );
      const result = follow(sample(), other);

      expect(canonicalTopology(topologyOf(result))).toEqual(canonicalTopology(toTopology(other)));
    });

    it('is valid for the engine however a canvas goes to another, the commands applying without a refusal', () => {
      const documents = [
        sample(),
        change(sample(), { type: 'clear' }),
        change(sample(), { type: 'delete', target: { kind: 'exchange', name: 'hidden' } }),
        change(sample(), { type: 'rename', target: { kind: 'queue', name: 'archive' }, name: 'billing2' }),
        deepFreeze(documentOf({ queues: { Q: queueRecord('billing') } })),
      ];
      for (const from of documents) {
        for (const to of documents) {
          expect(() => follow(from, to), `${from === to}`).not.toThrow();
          expect(canonicalTopology(topologyOf(follow(from, to)))).toEqual(canonicalTopology(toTopology(to)));
        }
      }
    });
  });

  it('leaves out a binding that names something that is not on the canvas, as toTopology does', () => {
    const broken = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('e') },
        queues: { Q: queueRecord('q') },
        bindings: {
          ok: bindingRecord('E', { kind: 'queue', id: 'Q' }),
          noSource: bindingRecord('gone', { kind: 'queue', id: 'Q' }),
          noQueue: bindingRecord('E', { kind: 'queue', id: 'gone' }),
          noExchange: bindingRecord('E', { kind: 'exchange', id: 'gone' }),
        },
      }),
    );

    expect(brief(reconcile(null, broken))).toEqual(['exchange.declare e', 'queue.declare q', 'bind e>q:q']);
  });

  it('does not change the documents it is given, or ask the engine for anything twice', () => {
    const before = sample();
    const after = change(before, { type: 'rename', target: { kind: 'exchange', name: 'orders' }, name: 'sales' });
    const commands = reconcile(before, after);

    expect(new Set(commands.map((command) => JSON.stringify(command))).size).toBe(commands.length);
    expect(before).toEqual(sampleDocument());
  });

  it('does not look at the vhost, which does not change within a canvas', () => {
    const before = deepFreeze(documentOf({ vhost: 'a', queues: { Q: queueRecord('q') } }));
    const after = deepFreeze(documentOf({ vhost: 'b', queues: { Q: queueRecord('q') } }));

    expect(reconcile(before, after)).toEqual([]);
  });

  it('knows nothing of producers and consumers yet, which have no command until the simulation can run them', () => {
    const document = deepFreeze(
      documentOf({ producers: { P: producerRecord('p') }, consumers: { C: consumerRecord('c') } }),
    );

    expect(reconcile(null, document)).toEqual([]);
  });
});
