import { createEngine, type Engine, type EngineCommand } from '@rmq/engine';
import {
  applyAll,
  bindingRecord,
  canonicalTopology,
  consumerRecord,
  deepFreeze,
  documentHolds,
  documentOf,
  engineHolds,
  entry,
  exchangeEnd,
  exchangeRecord,
  headerArguments,
  int,
  only,
  producerRecord,
  queueEnd,
  queueRecord,
  sampleDocument,
  str,
  ZERO_TIMING,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { DocumentCommand } from './commands/types';
import type { CanvasDocument } from './document/schema';
import { toTopology } from './document/topology';
import { reconcile } from './reconcile';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());

/** Gives an engine the commands, and fails, saying which, if it refuses one: `reconcile` makes only commands that the engine accepts. */
function feed(engine: Engine, commands: readonly EngineCommand[]): Engine {
  for (const command of commands) {
    const result = engine.dispatch(command);
    if (!result.ok) {
      throw new Error(`The engine refused ${JSON.stringify(command)}: ${result.code} ${result.text}`);
    }
  }
  return engine;
}

const newEngine = (vhost: string): Engine => createEngine({ seed: 1, timing: ZERO_TIMING, vhost });

/** The engine that `reconcile` builds from nothing for a document. */
const brokerFor = (document: CanvasDocument): Engine => feed(newEngine(document.vhost), reconcile(null, document));

/** What the engine holds after it follows `reconcile` from one document to the next. */
const follow = (previous: CanvasDocument | null, next: CanvasDocument): Engine =>
  feed(previous === null ? newEngine(next.vhost) : brokerFor(previous), reconcile(previous, next));

/** The topology that an engine holds, which is what `route()` reads. */
const topologyOf = (engine: Engine) => engine.view().topology;

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
      case 'producer.set':
      case 'producer.remove':
        return `${command.op} ${command.producer}`;
      case 'channel.open':
      case 'channel.set':
      case 'channel.close':
        return `${command.op} ${command.channel}`;
      case 'basic.consume':
      case 'basic.cancel':
        return `${command.op} ${command.consumer}`;
      default:
        return command.op;
    }
  });

const change = (document: CanvasDocument, ...commands: DocumentCommand[]): CanvasDocument =>
  deepFreeze(applyAll(document, commands));

/** The command that tells the engine the settings of a document. */
const configure = ({ settings }: CanvasDocument): EngineCommand => ({
  op: 'sim.configure',
  seed: settings.seed,
  timing: { ...settings.timing },
});

/** An engine that has followed the document must hold what it says, in everything: the topology, the settings, the producers and the consumers. */
function expectHeld(engine: Engine, document: CanvasDocument, message?: string): void {
  expect(canonicalTopology(topologyOf(engine)), message).toEqual(canonicalTopology(toTopology(document)));
  expect(engineHolds(engine), message).toEqual(documentHolds(document));
}

/** A fanout exchange with a queue bound to it, and a producer that repeats and sends to the exchange. */
const producerDocument = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('x', 'fanout') },
      queues: { Q: queueRecord('q') },
      bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
      producers: {
        P: producerRecord(
          'p',
          { kind: 'exchange', id: 'E' },
          {
            message: { payload: 'hi', key: 'k', headers: [{ key: 'n', value: int(1) }] },
            burst: 3,
            interval: { everyMs: 250, on: true },
          },
        ),
      },
    }),
  );

/** What the engine is told for the producer of `producerDocument`. */
const PRODUCER_SET = {
  op: 'producer.set',
  producer: 'P',
  target: { kind: 'exchange', name: 'x' },
  key: 'k',
  payload: 'hi',
  headers: [{ key: 'n', value: { t: 'integer', v: 1 } }],
  burst: 3,
  everyMs: 250,
  repeat: true,
} as const;

/** A fanout exchange with two queues bound to it, and a consumer that acknowledges for itself and is subscribed to the first. */
const consumerDocument = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('x', 'fanout') },
      queues: { Q: queueRecord('q'), R: queueRecord('r') },
      bindings: {
        B1: bindingRecord('E', { kind: 'queue', id: 'Q' }),
        B2: bindingRecord('E', { kind: 'queue', id: 'R' }),
      },
      consumers: { C: consumerRecord('c', ['Q'], { ack: 'manual', prefetch: 2, processingMs: 100 }) },
    }),
  );

describe('reconcile', () => {
  describe('when nothing changed', () => {
    it('has nothing to do for the same document, and for a copy of it', () => {
      const document = sample();

      expect(reconcile(document, document)).toEqual([]);
      expect(reconcile(document, sample())).toEqual([]);
    });

    it('has nothing to do for a canvas with nothing on it, but to say the settings when it is loaded', () => {
      expect(reconcile(null, deepFreeze(documentOf()))).toEqual([configure(documentOf())]);
      expect(reconcile(deepFreeze(documentOf()), deepFreeze(documentOf()))).toEqual([]);
    });

    it('has nothing to do for what the engine does not hold: where things are, what the producers and the consumers are called, what is drawn', () => {
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
        { type: 'rename', target: { kind: 'producer', name: 'sender' }, name: 'source' },
        { type: 'rename', target: { kind: 'consumer', name: 'worker' }, name: 'job' },
        { type: 'set', kind: 'canvas', changes: { showDefaultExchange: true } },
        { type: 'layout' },
      );

      expect(reconcile(before, after)).toEqual([]);
    });
  });

  describe('when the engine has nothing, as after a load', () => {
    it('says the settings, then declares every exchange, then every queue, then makes every binding, then opens the consumers and sets the producers, in the order that the document has them', () => {
      expect(brief(reconcile(null, sample()))).toEqual([
        'sim.configure',
        'exchange.declare orders',
        'exchange.declare docs',
        'exchange.declare hidden',
        'queue.declare billing',
        'queue.declare archive',
        "bind orders>q:billing 'order.*'",
        'bind docs>q:archive',
        "bind orders>e:hidden '#'",
        'channel.open C1',
        'basic.consume C1/billing',
        'producer.set P1',
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
        configure(document),
        { op: 'exchange.declare', name: 'e', type: 'headers', durable: false, autoDelete: true, internal: true },
        { op: 'queue.declare', name: 'q', durable: true },
      ]);
    });

    it('says that the broker chose the name of a queue that it named, so that the engine takes the amq. that the name starts with', () => {
      const document = deepFreeze(
        documentOf({ queues: { Q: queueRecord('amq.gen-JzTY20BRgKO', { serverNamed: true }), R: queueRecord('r') } }),
      );

      expect(reconcile(null, document)).toEqual([
        configure(document),
        { op: 'queue.declare', name: 'amq.gen-JzTY20BRgKO', durable: true, serverNamed: true },
        { op: 'queue.declare', name: 'r', durable: true },
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

    it('builds what the document says, and of a canvas of any size', () => {
      expectHeld(follow(null, sample()), sample());
      expectHeld(follow(null, deepFreeze(documentOf())), deepFreeze(documentOf()));
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

      // The producer that sent to it is sent to nothing now.
      expect(brief(reconcile(before, after))).toEqual(['exchange.delete orders', 'producer.set P1']);
      expectHeld(follow(before, after), after);
    });

    it('deletes a queue without unbinding what is bound to it, or cancelling the consumers of it, which a broker does with it', () => {
      const before = sample();
      const after = change(before, { type: 'delete', target: { kind: 'queue', name: 'billing' } });

      expect(brief(reconcile(before, after))).toEqual(['queue.delete billing']);
      expectHeld(follow(before, after), after);
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

    it('takes everything away for a clear: the producers and the consumers first, then the exchanges and the queues, and no unbinding', () => {
      const before = sample();
      const after = change(before, { type: 'clear' });

      expect(brief(reconcile(before, after))).toEqual([
        'producer.remove P1',
        'channel.close C1',
        'exchange.delete orders',
        'exchange.delete docs',
        'exchange.delete hidden',
        'queue.delete billing',
        'queue.delete archive',
      ]);
      const engine = follow(before, after);
      expect(engine.snapshot().exchanges).toEqual([]);
      expectHeld(engine, after);
    });
  });

  describe('when something is changed', () => {
    it('deletes and declares again for a rename, and binds again what was bound, under the new name, and has the consumers consume again', () => {
      const before = sample();
      const after = change(before, { type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'invoices' });

      expect(brief(reconcile(before, after))).toEqual([
        'queue.delete billing',
        'queue.declare invoices',
        "bind orders>q:invoices 'order.*'",
        'basic.consume C1/invoices',
      ]);
      expectHeld(follow(before, after), after);
    });

    it('does the same for an exchange, binding again what started from it and what ended at it, and setting the producer that sends to it', () => {
      const before = sample();
      const after = change(before, { type: 'rename', target: { kind: 'exchange', name: 'orders' }, name: 'sales' });

      expect(brief(reconcile(before, after))).toEqual([
        'exchange.delete orders',
        'exchange.declare sales',
        "bind sales>q:billing 'order.*'",
        "bind sales>e:hidden '#'",
        'producer.set P1',
      ]);
      expect(reconcile(before, after).at(-1)).toMatchObject({ target: { kind: 'exchange', name: 'sales' } });
      expectHeld(follow(before, after), after);
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
      expect(
        follow(before, flag)
          .snapshot()
          .exchanges.find(({ name }) => name === 'hidden')?.autoDelete,
      ).toBe(true);
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
          producers: {
            P1: producerRecord(
              'sender',
              { kind: 'exchange', id: 'A' },
              {
                message: { payload: 'hello', key: 'order.new', headers: [entry('n', int(1))] },
                burst: 2,
                interval: { everyMs: 500, on: true },
              },
            ),
          },
          consumers: { C1: consumerRecord('worker', ['X'], { ack: 'manual', prefetch: 3, processingMs: 200 }) },
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

  describe('the settings of the simulation', () => {
    const settings = (document: CanvasDocument) => ({
      seed: document.settings.seed,
      timing: { ...document.settings.timing },
    });

    it('tells the engine the seed and the latencies of a canvas that is loaded, before anything else', () => {
      const document = change(sample(), {
        type: 'set',
        kind: 'canvas',
        changes: { seed: 42, publishMs: 10, brokerMs: 20, deliverMs: 30 },
      });

      expect(reconcile(null, document)[0]).toEqual({
        op: 'sim.configure',
        seed: 42,
        timing: { publishMs: 10, brokerMs: 20, deliverMs: 30 },
      });
    });

    it.each<[string, { seed?: number; publishMs?: number; brokerMs?: number; deliverMs?: number }]>([
      ['the seed', { seed: 7 }],
      ['the time to publish', { publishMs: 1 }],
      ['the time in the broker', { brokerMs: 1 }],
      ['the time to deliver', { deliverMs: 1 }],
    ])('tells the engine again when %s changes, and nothing else', (_, changes) => {
      const before = sample();
      const after = change(before, { type: 'set', kind: 'canvas', changes });

      expect(reconcile(before, after)).toEqual([{ op: 'sim.configure', ...settings(after) }]);
      expect(follow(before, after).snapshot()).toMatchObject(settings(after));
    });

    it('tells the engine first, so that what follows is sent with the new latencies', () => {
      const before = sample();
      const after = change(
        before,
        { type: 'declare-queue', name: 'late', durable: true },
        { type: 'set', kind: 'canvas', changes: { brokerMs: 1 } },
      );

      expect(brief(reconcile(before, after))).toEqual(['sim.configure', 'queue.declare late']);
    });

    it('sends the latencies in a new object, so that the engine does not keep the one of the document', () => {
      const document = sample();
      const { timing } = reconcile(null, document)[0] as { timing: object };

      expect(timing).toEqual(document.settings.timing);
      expect(timing).not.toBe(document.settings.timing);
    });
  });

  describe('the producers', () => {
    it('sets a producer with everything that it needs written out, and the name of what it sends to', () => {
      const commands = reconcile(null, producerDocument()).filter(({ op }) => op === 'producer.set');

      expect(commands).toEqual([PRODUCER_SET]);
    });

    it('names a queue for a producer that sends to a queue, and nothing for one that is not linked', () => {
      const toQueue = change(producerDocument(), { type: 'link', producer: 'p', target: { kind: 'queue', name: 'q' } });
      const alone = change(producerDocument(), { type: 'unlink', producer: 'p' });

      expect(reconcile(null, toQueue).at(-1)).toEqual({ ...PRODUCER_SET, target: { kind: 'queue', name: 'q' } });
      expect(reconcile(null, alone).at(-1)).toEqual({ ...PRODUCER_SET, target: null });
    });

    it('sets a new producer after what it sends to is declared and bound, so that the engine has the target when it is told', () => {
      const before = deepFreeze(documentOf());
      const after = change(
        before,
        { type: 'add-producer', name: 'p' },
        {
          type: 'declare-exchange',
          name: 'x',
          exchangeType: 'fanout',
          durable: true,
          autoDelete: false,
          internal: false,
        },
        { type: 'link', producer: 'p', target: { kind: 'exchange', name: 'x' } },
      );

      expect(brief(reconcile(before, after))).toEqual(['exchange.declare x', 'producer.set p1']);
    });

    it('sets a producer that has no target as well, so that the engine holds every producer of the canvas', () => {
      const before = deepFreeze(documentOf());
      const after = change(before, { type: 'add-producer', name: 'p' });

      expect(reconcile(before, after)).toEqual([
        {
          ...PRODUCER_SET,
          producer: 'p1',
          target: null,
          key: '',
          payload: '',
          headers: [],
          burst: 1,
          everyMs: 1000,
          repeat: false,
        },
      ]);
    });

    it.each<[string, DocumentCommand, Record<string, unknown>]>([
      [
        'the payload',
        { type: 'set', kind: 'producer', name: 'p', changes: { payload: 'other' } },
        { payload: 'other' },
      ],
      ['the routing key', { type: 'set', kind: 'producer', name: 'p', changes: { key: 'other' } }, { key: 'other' }],
      ['the burst', { type: 'set', kind: 'producer', name: 'p', changes: { burst: 9 } }, { burst: 9 }],
      ['the interval', { type: 'set', kind: 'producer', name: 'p', changes: { everyMs: 99 } }, { everyMs: 99 }],
      [
        'whether it repeats',
        { type: 'set', kind: 'producer', name: 'p', changes: { repeat: false } },
        { repeat: false },
      ],
      [
        'a header',
        {
          type: 'set',
          kind: 'producer',
          name: 'p',
          changes: { headers: [{ key: 'n', value: { t: 'integer', v: 2 } }] },
        },
        { headers: [{ key: 'n', value: { t: 'integer', v: 2 } }] },
      ],
      ['a header that goes', { type: 'unset', kind: 'producer', name: 'p', headers: ['n'] }, { headers: [] }],
      [
        'where it sends',
        { type: 'link', producer: 'p', target: { kind: 'queue', name: 'q' } },
        { target: { kind: 'queue', name: 'q' } },
      ],
      ['that it sends nowhere', { type: 'unlink', producer: 'p' }, { target: null }],
    ])('sets the producer again, with all of it, when %s changes, and for nothing else', (_, command, expected) => {
      const before = producerDocument();
      const after = change(before, command);

      expect(reconcile(before, after)).toEqual([{ ...PRODUCER_SET, ...expected }]);
      expectHeld(follow(before, after), after);
    });

    it('removes a producer that went, before it deletes what it sent to', () => {
      const before = producerDocument();

      expect(
        brief(reconcile(before, change(before, { type: 'delete', target: { kind: 'producer', name: 'p' } }))),
      ).toEqual(['producer.remove P']);
      expect(brief(reconcile(before, change(before, { type: 'clear' })))).toEqual([
        'producer.remove P',
        'exchange.delete x',
        'queue.delete q',
      ]);
    });

    it('sets the producer again, sending nowhere, for what it sent to when that is deleted', () => {
      const before = producerDocument();
      const after = change(before, { type: 'delete', target: { kind: 'exchange', name: 'x' } });

      expect(reconcile(before, after)).toEqual([
        { op: 'exchange.delete', name: 'x' },
        { ...PRODUCER_SET, target: null },
      ]);
      expectHeld(follow(before, after), after);
    });

    it('sets the producer again with the new name of what it sends to, after that is declared', () => {
      const before = producerDocument();
      const after = change(before, { type: 'rename', target: { kind: 'exchange', name: 'x' }, name: 'y' });

      expect(reconcile(before, after)).toEqual([
        { op: 'exchange.delete', name: 'x' },
        { op: 'exchange.declare', name: 'y', type: 'fanout', durable: true, autoDelete: false, internal: false },
        { op: 'bind', source: 'y', destination: { kind: 'queue', name: 'q' }, key: '' },
        { ...PRODUCER_SET, target: { kind: 'exchange', name: 'y' } },
      ]);
      expectHeld(follow(before, after), after);
    });

    it('sets the producer again when the queue that it sends to is renamed', () => {
      const before = change(producerDocument(), { type: 'link', producer: 'p', target: { kind: 'queue', name: 'q' } });
      const after = change(before, { type: 'rename', target: { kind: 'queue', name: 'q' }, name: 'r' });

      expect(reconcile(before, after).at(-1)).toEqual({ ...PRODUCER_SET, target: { kind: 'queue', name: 'r' } });
      expectHeld(follow(before, after), after);
    });

    it('does not set a producer for another producer that changes', () => {
      const before = change(producerDocument(), { type: 'add-producer', name: 'other' });
      const after = change(before, { type: 'set', kind: 'producer', name: 'other', changes: { burst: 4 } });

      expect(brief(reconcile(before, after))).toEqual(['producer.set p1']);
    });

    it('makes an engine that publishes from a producer that repeats, and stops when the document says that it does not', () => {
      const before = producerDocument();
      const engine = brokerFor(before);

      // Three messages at a time, now and every 250 ms. Latencies are the document's, so that the messages are still on their way.
      expect(only(engine.advanceTo(500), 'published')).toHaveLength(9);

      feed(
        engine,
        reconcile(before, change(before, { type: 'set', kind: 'producer', name: 'p', changes: { repeat: false } })),
      );

      expect(only(engine.advanceTo(5000), 'published')).toEqual([]);
    });
  });

  describe('the consumers', () => {
    it('opens a channel with the prefetch and the time of the consumer, and has it consume from the queues that it is subscribed to', () => {
      const document = change(consumerDocument(), { type: 'subscribe', consumer: 'c', queue: 'r' });

      expect(reconcile(null, document).filter(({ op }) => op === 'channel.open' || op === 'basic.consume')).toEqual([
        { op: 'channel.open', channel: 'C', prefetch: 2, processingMs: 100 },
        { op: 'basic.consume', channel: 'C', queue: 'q', consumer: 'C/q', ack: 'manual' },
        { op: 'basic.consume', channel: 'C', queue: 'r', consumer: 'C/r', ack: 'manual' },
      ]);
    });

    it('opens the channel of a consumer that is subscribed to nothing, so that the engine holds every consumer of the canvas', () => {
      const before = deepFreeze(documentOf());
      const after = change(before, { type: 'add-consumer', name: 'c' });

      expect(reconcile(before, after)).toEqual([{ op: 'channel.open', channel: 'c1', prefetch: 0, processingMs: 500 }]);
    });

    it('opens a channel and consumes after the exchanges, the queues and the bindings are there', () => {
      const before = deepFreeze(documentOf());
      const after = change(
        before,
        { type: 'declare-queue', name: 'q', durable: true },
        { type: 'add-consumer', name: 'c' },
        { type: 'subscribe', consumer: 'c', queue: 'q' },
      );

      expect(brief(reconcile(before, after))).toEqual(['queue.declare q', 'channel.open c1', 'basic.consume c1/q']);
    });

    it('consumes from a queue that the consumer subscribes to, and cancels the consumer of a queue that it leaves', () => {
      const before = consumerDocument();

      expect(brief(reconcile(before, change(before, { type: 'subscribe', consumer: 'c', queue: 'r' })))).toEqual([
        'basic.consume C/r',
      ]);
      expect(brief(reconcile(before, change(before, { type: 'unsubscribe', consumer: 'c', queue: 'q' })))).toEqual([
        'basic.cancel C/q',
      ]);
      expect(
        brief(
          reconcile(
            before,
            change(
              before,
              { type: 'unsubscribe', consumer: 'c', queue: 'q' },
              { type: 'subscribe', consumer: 'c', queue: 'r' },
            ),
          ),
        ),
      ).toEqual(['basic.cancel C/q', 'basic.consume C/r']);
    });

    it('cancels with the tag that it consumed with, and consumes with the way that the consumer acknowledges', () => {
      const before = consumerDocument();
      const after = change(before, { type: 'unsubscribe', consumer: 'c', queue: 'q' });

      expect(reconcile(before, after)).toEqual([{ op: 'basic.cancel', consumer: 'C/q' }]);
      expect(reconcile(after, before)).toEqual([
        { op: 'basic.consume', channel: 'C', queue: 'q', consumer: 'C/q', ack: 'manual' },
      ]);
    });

    it('changes the prefetch and the time of a channel that stays open, with both values and in one command', () => {
      const before = consumerDocument();

      expect(
        reconcile(before, change(before, { type: 'set', kind: 'consumer', name: 'c', changes: { prefetch: 5 } })),
      ).toEqual([{ op: 'channel.set', channel: 'C', prefetch: 5, processingMs: 100 }]);
      expect(
        reconcile(before, change(before, { type: 'set', kind: 'consumer', name: 'c', changes: { processingMs: 0 } })),
      ).toEqual([{ op: 'channel.set', channel: 'C', prefetch: 2, processingMs: 0 }]);
      expect(
        reconcile(
          before,
          change(before, { type: 'set', kind: 'consumer', name: 'c', changes: { prefetch: 0, processingMs: 7 } }),
        ),
      ).toEqual([{ op: 'channel.set', channel: 'C', prefetch: 0, processingMs: 7 }]);
    });

    it('closes the channel, and opens it again with its subscriptions, when the consumer changes how it acknowledges: that is fixed when it starts to consume', () => {
      const before = change(consumerDocument(), { type: 'subscribe', consumer: 'c', queue: 'r' });
      const after = change(before, { type: 'set', kind: 'consumer', name: 'c', changes: { ack: 'auto', prefetch: 9 } });

      expect(reconcile(before, after)).toEqual([
        { op: 'channel.close', channel: 'C' },
        { op: 'channel.open', channel: 'C', prefetch: 9, processingMs: 100 },
        { op: 'basic.consume', channel: 'C', queue: 'q', consumer: 'C/q', ack: 'auto' },
        { op: 'basic.consume', channel: 'C', queue: 'r', consumer: 'C/r', ack: 'auto' },
      ]);
      expectHeld(follow(before, after), after);
    });

    it('closes the channel before it deletes and declares, and opens it after, when a queue changes at the same time', () => {
      const before = consumerDocument();
      const after = change(
        before,
        { type: 'rename', target: { kind: 'queue', name: 'q' }, name: 'p' },
        { type: 'set', kind: 'consumer', name: 'c', changes: { ack: 'auto' } },
      );

      expect(brief(reconcile(before, after))).toEqual([
        'channel.close C',
        'queue.delete q',
        'queue.declare p',
        'bind x>q:p',
        'channel.open C',
        'basic.consume C/p',
      ]);
      expectHeld(follow(before, after), after);
    });

    it('closes the channel of a consumer that went, and cancels nothing', () => {
      const before = consumerDocument();

      expect(reconcile(before, change(before, { type: 'delete', target: { kind: 'consumer', name: 'c' } }))).toEqual([
        { op: 'channel.close', channel: 'C' },
      ]);
    });

    it('closes the channel of a consumer that went with the queue that it consumed from, before that is deleted', () => {
      const before = consumerDocument();
      const after = change(
        before,
        { type: 'delete', target: { kind: 'consumer', name: 'c' } },
        { type: 'delete', target: { kind: 'queue', name: 'q' } },
      );

      expect(brief(reconcile(before, after))).toEqual(['channel.close C', 'queue.delete q']);
      expectHeld(follow(before, after), after);
    });

    it('cancels nothing for a queue that is deleted, which cancels its own consumers, and leaves the channel open', () => {
      const before = consumerDocument();
      const after = change(before, { type: 'delete', target: { kind: 'queue', name: 'q' } });

      expect(brief(reconcile(before, after))).toEqual(['queue.delete q']);
      const engine = follow(before, after);
      expect(engine.view().channels['C']?.consumers).toEqual([]);
      expectHeld(engine, after);
    });

    it('consumes again from a queue that is renamed, since the engine cancelled the consumer when it deleted the old one', () => {
      const before = consumerDocument();
      const after = change(before, { type: 'rename', target: { kind: 'queue', name: 'q' }, name: 'p' });

      expect(brief(reconcile(before, after))).toEqual([
        'queue.delete q',
        'queue.declare p',
        'bind x>q:p',
        'basic.consume C/p',
      ]);
      expectHeld(follow(before, after), after);
    });

    it('does not change a channel for another consumer that changes', () => {
      const before = change(consumerDocument(), { type: 'add-consumer', name: 'other' });
      const after = change(before, { type: 'set', kind: 'consumer', name: 'other', changes: { prefetch: 4 } });

      expect(brief(reconcile(before, after))).toEqual(['channel.set c1']);
    });

    it('gives back to its queue what a consumer held when it changes how it acknowledges, as redelivered, for the new consumer', () => {
      const before = deepFreeze(
        documentOf({
          exchanges: { E: exchangeRecord('x', 'fanout') },
          queues: { Q: queueRecord('q') },
          bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
          consumers: { C: consumerRecord('c', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 1000 }) },
        }),
      );
      const engine = brokerFor(before);
      feed(engine, [{ op: 'basic.publish', exchange: 'x', body: 'one' }]);
      // The latencies of the document are 500, 300 and 500: the message is with the consumer, which has not finished with it.
      engine.advanceTo(1500);
      expect(engine.view().queues['q']).toMatchObject({ ready: 0, unacked: 1 });

      const events = reconcile(
        before,
        change(before, { type: 'set', kind: 'consumer', name: 'c', changes: { ack: 'auto' } }),
      ).flatMap((command) => {
        const result = engine.dispatch(command);
        return result.ok ? result.events : [];
      });

      expect(only(events, 'requeued')).toHaveLength(1);
      expect(only(events, 'channel.closed')).toMatchObject([{ channel: 'C', requeued: 1 }]);
      expect(only(events, 'delivered')).toMatchObject([{ consumer: 'C/q', redelivered: true, autoAck: true }]);
    });

    it('subscribes again to a queue that it was unsubscribed from while it still held a message, and the engine starts a new consumer under the tag that still holds it (ADR-0088, ADR-0089)', () => {
      // The Nightly of 2026-10-09 found this with a random seed: undo of a subscription cancels the consumer, which holds what it has not finished with, and the redo asks the engine to consume with the same tag.
      const before = deepFreeze(
        documentOf({
          exchanges: { E: exchangeRecord('x', 'fanout') },
          queues: { Q: queueRecord('q') },
          bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }) },
          consumers: { C: consumerRecord('c', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 1000 }) },
        }),
      );
      const engine = brokerFor(before);
      feed(engine, [{ op: 'basic.publish', exchange: 'x', body: 'one' }]);
      engine.advanceTo(1500);
      expect(engine.view().queues['q']).toMatchObject({ ready: 0, unacked: 1 });
      const left = change(before, { type: 'unsubscribe', consumer: 'c', queue: 'q' });

      feed(engine, reconcile(before, left));
      expect(engine.view().channels['C']?.consumers).toMatchObject([{ consumer: 'C/q', cancelled: true, unacked: 1 }]);
      feed(engine, reconcile(left, before));

      expect(engine.view().channels['C']?.consumers).toMatchObject([{ consumer: 'C/q', cancelled: false, unacked: 1 }]);
      engine.advanceTo(5000);
      expect(engine.view().queues['q']).toMatchObject({ ready: 0, unacked: 0 });
      expectHeld(engine, before);
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
        { type: 'set', kind: 'consumer', name: 'worker', changes: { ack: 'auto', prefetch: 0 } },
        { type: 'set', kind: 'producer', name: 'sender', changes: { burst: 7 } },
        { type: 'set', kind: 'canvas', changes: { seed: 9, deliverMs: 1 } },
      );
      const there = follow(before, after);
      expectHeld(there, after);

      expectHeld(feed(there, reconcile(after, before)), before);
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
          producers: { P2: producerRecord('another', { kind: 'queue', id: 'W' }) },
          consumers: { C2: consumerRecord('someone', ['Q', 'W'], { prefetch: 1 }) },
        }),
      );

      expectHeld(follow(sample(), other), other);
    });

    it('is valid for the engine however a canvas goes to another, the commands applying without a refusal', () => {
      const documents = [
        sample(),
        change(sample(), { type: 'clear' }),
        change(sample(), { type: 'delete', target: { kind: 'exchange', name: 'hidden' } }),
        change(sample(), { type: 'rename', target: { kind: 'queue', name: 'archive' }, name: 'billing2' }),
        change(sample(), { type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'invoices' }),
        change(sample(), { type: 'set', kind: 'consumer', name: 'worker', changes: { ack: 'auto' } }),
        change(
          sample(),
          { type: 'unsubscribe', consumer: 'worker', queue: 'billing' },
          { type: 'subscribe', consumer: 'worker', queue: 'archive' },
        ),
        change(sample(), { type: 'unlink', producer: 'sender' }, { type: 'set', kind: 'canvas', changes: { seed: 3 } }),
        deepFreeze(documentOf({ queues: { Q: queueRecord('billing') } })),
      ];
      for (const from of documents) {
        for (const to of documents) {
          expect(() => follow(from, to), `${from === to}`).not.toThrow();
          expectHeld(follow(from, to), to);
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

    expect(brief(reconcile(null, broken))).toEqual([
      'sim.configure',
      'exchange.declare e',
      'queue.declare q',
      'bind e>q:q',
    ]);
  });

  it('leaves out of a producer a target that is not on the canvas, and out of a consumer a queue that is not, as it does for a binding', () => {
    const broken = deepFreeze(
      documentOf({
        queues: { Q: queueRecord('q') },
        producers: {
          P1: producerRecord('lost', { kind: 'exchange', id: 'gone' }),
          P2: producerRecord('also lost', { kind: 'queue', id: 'gone' }),
        },
        consumers: { C: consumerRecord('c', ['gone', 'Q']) },
      }),
    );
    const commands = reconcile(null, broken);

    expect(commands.filter(({ op }) => op === 'producer.set')).toMatchObject([{ target: null }, { target: null }]);
    expect(brief(commands.filter(({ op }) => op === 'basic.consume'))).toEqual(['basic.consume C/q']);
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
});
