import { defaultExchangeReply, reservedNameReply, transientQueueReply } from '@rmq/engine';
import { deepFreeze, documentOf, sampleDocument, sequentialIds, undoRedoProblems } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { COLUMN_X, ROW_HEIGHT } from './helpers';
import {
  applyAddConsumer,
  applyAddProducer,
  applyDeclareExchange,
  applyDeclareQueue,
  NEW_CONSUMER,
  NEW_PRODUCER,
} from './declare';
import type { AddConsumer, AddProducer, DeclareExchange, DeclareQueue } from './types';

const exchange = (name: string, overrides: Partial<DeclareExchange> = {}): DeclareExchange => ({
  type: 'declare-exchange',
  name,
  exchangeType: 'direct',
  durable: true,
  autoDelete: false,
  internal: false,
  ...overrides,
});
const queue = (name: string, durable = true): DeclareQueue => ({ type: 'declare-queue', name, durable });
const producer = (name: string): AddProducer => ({ type: 'add-producer', name });
const consumer = (name: string): AddConsumer => ({ type: 'add-consumer', name });

const empty = (): CanvasDocument => deepFreeze(documentOf());
const sample = (): CanvasDocument => deepFreeze(sampleDocument());

describe('declare exchange', () => {
  it('puts an exchange on the canvas with the flags it was given, and a position', () => {
    const before = empty();
    const result = applyDeclareExchange(
      before,
      exchange('orders', { exchangeType: 'topic', durable: false, autoDelete: true, internal: true }),
      sequentialIds(),
    );

    expect(result.ok && result.value.exchanges).toEqual({
      x1: { name: 'orders', type: 'topic', durable: false, autoDelete: true, internal: true },
    });
    expect(result.ok && result.value.layout.nodes).toEqual({ x1: { x: COLUMN_X.exchange, y: 0 } });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('declares each type of exchange', () => {
    for (const exchangeType of ['direct', 'fanout', 'topic', 'headers'] as const) {
      const result = applyDeclareExchange(empty(), exchange('e', { exchangeType }), sequentialIds());

      expect(result.ok && result.value.exchanges['x1']?.type).toBe(exchangeType);
    }
  });

  it('puts a new exchange in the exchange column, below the lowest one, whatever its siblings were moved to', () => {
    const before = deepFreeze(
      documentOf({
        ...{ exchanges: sampleDocument().exchanges },
        nodes: { E1: { x: 0, y: 40 }, E2: { x: 0, y: 500 }, E3: { x: 0, y: 70 } },
      }),
    );
    const result = applyDeclareExchange(before, exchange('next'), sequentialIds());

    expect(result.ok && result.value.layout.nodes['x1']).toEqual({ x: COLUMN_X.exchange, y: 500 + ROW_HEIGHT });
  });

  it('shares what it did not touch with the document before', () => {
    const before = sample();
    const result = applyDeclareExchange(before, exchange('fresh'), sequentialIds());

    expect(result.ok && result.value.queues).toBe(before.queues);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && result.value.layout.labels).toBe(before.layout.labels);
    expect(result.ok && result.value.settings).toBe(before.settings);
    expect(result.ok && result.value.exchanges['E1']).toBe(before.exchanges['E1']);
    expect(result.ok && result.value).not.toBe(before);
  });

  it('can be undone and redone', () => {
    const before = sample();
    const result = applyDeclareExchange(before, exchange('fresh'), sequentialIds());

    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  describe('refuses', () => {
    it.each(['amq.mine', 'amq.', 'amq.direct'])(
      'the name %j, with the 403 that the broker gave and a message that says why',
      (name) => {
        const result = applyDeclareExchange(empty(), exchange(name), sequentialIds());

        expect(!result.ok && result.error).toMatchObject({
          kind: 'reserved-name',
          refusal: reservedNameReply('exchange', name),
        });
        expect(!result.ok && result.error.message).toContain("starts with 'amq.'");
      },
    );

    it('the default exchange, which has no name, with the 403 that the broker gave', () => {
      const result = applyDeclareExchange(empty(), exchange(''), sequentialIds());

      expect(!result.ok && result.error).toMatchObject({ kind: 'default-exchange', refusal: defaultExchangeReply() });
      expect(!result.ok && result.error.message).toContain('cannot be declared');
    });

    it('a name of more than 255 bytes', () => {
      const result = applyDeclareExchange(empty(), exchange('x'.repeat(256)), sequentialIds());

      expect(!result.ok && result.error.kind).toBe('name-too-long');
    });

    it('a name that another exchange has, and says so in the simulator’s words and not in the broker’s', () => {
      const result = applyDeclareExchange(sample(), exchange('orders'), sequentialIds());

      expect(!result.ok && result.error).toEqual({
        kind: 'duplicate-name',
        message: "There is already an exchange named 'orders'. Names are unique within a kind.",
      });
    });

    it('nothing else: a queue or a producer may have the same name', () => {
      expect(applyDeclareExchange(sample(), exchange('billing'), sequentialIds()).ok).toBe(true);
      expect(applyDeclareExchange(sample(), exchange('sender'), sequentialIds()).ok).toBe(true);
    });

    it('a name with a difference of case or a space, which is another name', () => {
      expect(applyDeclareExchange(sample(), exchange('Orders'), sequentialIds()).ok).toBe(true);
      expect(applyDeclareExchange(sample(), exchange('orders '), sequentialIds()).ok).toBe(true);
    });

    it('and a refusal changes nothing', () => {
      const before = sample();
      applyDeclareExchange(before, exchange('amq.x'), sequentialIds());

      expect(before).toEqual(sampleDocument());
    });
  });
});

describe('declare queue', () => {
  it('puts a durable queue on the canvas, with a position in the queue column', () => {
    const result = applyDeclareQueue(empty(), queue('jobs'), sequentialIds());

    expect(result.ok && result.value.queues).toEqual({ q1: { name: 'jobs', serverNamed: false, durable: true } });
    expect(result.ok && result.value.layout.nodes).toEqual({ q1: { x: COLUMN_X.queue, y: 0 } });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('shares what it did not touch with the document before, and can be undone and redone', () => {
    const before = sample();
    const result = applyDeclareQueue(before, queue('jobs'), sequentialIds());

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  describe('refuses a queue that is not durable (ADR-0021, ADR-0024)', () => {
    it('with the 541 that the broker gave, and says at its root why: a feature that is switched off', () => {
      const result = applyDeclareQueue(empty(), queue('jobs', false), sequentialIds());

      expect(!result.ok && result.error.kind).toBe('transient-queue');
      expect(!result.ok && result.error.refusal).toEqual(transientQueueReply());
      expect(!result.ok && result.error.message).toContain("Queue 'jobs' is not durable.");
      expect(!result.ok && result.error.message).toContain('neither durable nor exclusive');
      expect(!result.ok && result.error.message).toContain('deprecated feature');
      expect(!result.ok && result.error.message).toContain('every queue has to be durable');
    });

    it('and leaves the canvas as it was', () => {
      const before = sample();
      const result = applyDeclareQueue(before, queue('jobs', false), sequentialIds());

      expect(result.ok).toBe(false);
      expect(before).toEqual(sampleDocument());
    });

    it('whether or not the name is taken, because the durability is read before the name is looked up', () => {
      expect(!applyDeclareQueue(sample(), queue('billing', false), sequentialIds()).ok).toBe(true);
      expect(applyDeclareQueue(sample(), queue('billing', false), sequentialIds())).toMatchObject({
        error: { kind: 'transient-queue' },
      });
    });

    it('but only after the name, which a broker reads first', () => {
      expect(applyDeclareQueue(empty(), queue('amq.x', false), sequentialIds())).toMatchObject({
        error: { kind: 'reserved-name' },
      });
      expect(applyDeclareQueue(empty(), queue('', false), sequentialIds())).toMatchObject({
        error: { kind: 'empty-name' },
      });
    });
  });

  describe('refuses', () => {
    it.each(['amq.mine', 'amq.gen-x'])('the name %j with the 403 that the broker gave for a queue', (name) => {
      const result = applyDeclareQueue(empty(), queue(name), sequentialIds());

      expect(!result.ok && result.error.refusal).toEqual(reservedNameReply('queue', name));
    });

    it('no name: a broker would make a queue with a name of its own, which the simulator does not', () => {
      const result = applyDeclareQueue(empty(), queue(''), sequentialIds());

      expect(!result.ok && result.error).toEqual({ kind: 'empty-name', message: 'A queue needs a name.' });
    });

    it('a name of more than 255 bytes, and accepts one of exactly 255', () => {
      expect(applyDeclareQueue(empty(), queue('q'.repeat(256)), sequentialIds())).toMatchObject({
        error: { kind: 'name-too-long' },
      });
      expect(applyDeclareQueue(empty(), queue('q'.repeat(255)), sequentialIds()).ok).toBe(true);
    });

    it('a name that another queue has, and not one that an exchange has', () => {
      expect(applyDeclareQueue(sample(), queue('billing'), sequentialIds())).toMatchObject({
        error: {
          kind: 'duplicate-name',
          message: "There is already a queue named 'billing'. Names are unique within a kind.",
        },
      });
      expect(applyDeclareQueue(sample(), queue('orders'), sequentialIds()).ok).toBe(true);
    });
  });
});

describe('add producer', () => {
  it('puts a producer on the canvas that publishes to nothing, once, with an empty message', () => {
    const result = applyAddProducer(empty(), producer('sender'), sequentialIds());

    expect(result.ok && result.value.producers).toEqual({
      p1: {
        name: 'sender',
        target: null,
        message: { payload: '', key: '', headers: [] },
        burst: 1,
        interval: { everyMs: 1000, on: false },
      },
    });
    expect(result.ok && result.value.layout.nodes).toEqual({ p1: { x: COLUMN_X.producer, y: 0 } });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('gives each producer a message and an interval of its own, so that changing one never changes another', () => {
    const first = applyAddProducer(empty(), producer('one'), sequentialIds());
    const second = first.ok ? applyAddProducer(first.value, producer('two'), { newId: () => 'p2' }) : first;

    expect(second.ok && second.value.producers['p1']?.message).not.toBe(
      second.ok && second.value.producers['p2']?.message,
    );
    expect(second.ok && second.value.producers['p1']?.message.headers).not.toBe(
      second.ok && second.value.producers['p2']?.message.headers,
    );
    expect(second.ok && second.value.producers['p1']?.interval).not.toBe(
      second.ok && second.value.producers['p2']?.interval,
    );
    expect(NEW_PRODUCER.message.headers).toEqual([]);
  });

  it('shares what it did not touch with the document before, and can be undone and redone', () => {
    const before = sample();
    const result = applyAddProducer(before, producer('another'), sequentialIds());

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.queues).toBe(before.queues);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('refuses an empty name, a name of more than 255 bytes and a name that another producer has, and takes amq.', () => {
    expect(applyAddProducer(empty(), producer(''), sequentialIds())).toMatchObject({
      error: { kind: 'empty-name', message: 'A producer needs a name.' },
    });
    expect(applyAddProducer(empty(), producer('p'.repeat(256)), sequentialIds())).toMatchObject({
      error: { kind: 'name-too-long' },
    });
    expect(applyAddProducer(sample(), producer('sender'), sequentialIds())).toMatchObject({
      error: {
        kind: 'duplicate-name',
        message: "There is already a producer named 'sender'. Names are unique within a kind.",
      },
    });
    expect(applyAddProducer(sample(), producer('amq.sender'), sequentialIds()).ok).toBe(true);
    expect(applyAddProducer(sample(), producer('billing'), sequentialIds()).ok).toBe(true);
  });
});

describe('add consumer', () => {
  it('puts a consumer on the canvas that consumes from nothing, with automatic acknowledgements', () => {
    const result = applyAddConsumer(empty(), consumer('worker'), sequentialIds());

    expect(result.ok && result.value.consumers).toEqual({
      c1: { name: 'worker', queues: [], ack: 'auto', prefetch: 0, processingMs: 500 },
    });
    expect(NEW_CONSUMER).toEqual({ ack: 'auto', prefetch: 0, processingMs: 500 });
    expect(result.ok && result.value.layout.nodes).toEqual({ c1: { x: COLUMN_X.consumer, y: 0 } });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('shares what it did not touch with the document before, and can be undone and redone', () => {
    const before = sample();
    const result = applyAddConsumer(before, consumer('another'), sequentialIds());

    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('refuses an empty name, a name of more than 255 bytes and a name that another consumer has', () => {
    expect(applyAddConsumer(empty(), consumer(''), sequentialIds())).toMatchObject({
      error: { kind: 'empty-name', message: 'A consumer needs a name.' },
    });
    expect(applyAddConsumer(empty(), consumer('c'.repeat(256)), sequentialIds())).toMatchObject({
      error: { kind: 'name-too-long' },
    });
    expect(applyAddConsumer(sample(), consumer('worker'), sequentialIds())).toMatchObject({
      error: {
        kind: 'duplicate-name',
        message: "There is already a consumer named 'worker'. Names are unique within a kind.",
      },
    });
  });
});

describe('ids', () => {
  it('come from the context, so that the same command on the same document gives the same document', () => {
    const one = applyDeclareQueue(sample(), queue('jobs'), sequentialIds());
    const other = applyDeclareQueue(sample(), queue('jobs'), sequentialIds());

    expect(one).toEqual(other);
  });

  it('are asked for the kind of thing that is being made', () => {
    const asked: string[] = [];
    const context = { newId: (kind: string) => (asked.push(kind), `n${asked.length}`) };

    applyDeclareExchange(empty(), exchange('a'), context);
    applyDeclareQueue(empty(), queue('b'), context);
    applyAddProducer(empty(), producer('c'), context);
    applyAddConsumer(empty(), consumer('d'), context);

    expect(asked).toEqual(['exchange', 'queue', 'producer', 'consumer']);
  });

  it('are asked for only once something is to be made, and not for a command that is refused', () => {
    const asked: string[] = [];
    const context = { newId: (kind: string) => (asked.push(kind), 'n1') };

    applyDeclareExchange(empty(), exchange('amq.x'), context);
    applyDeclareQueue(empty(), queue('q', false), context);
    applyAddProducer(sample(), producer('sender'), context);

    expect(asked).toEqual([]);
  });

  it('are refused when the generator gives one that is taken, or that is not an id, and nothing is changed', () => {
    const before = sample();

    expect(() => applyDeclareQueue(before, queue('jobs'), { newId: () => 'Q1' })).toThrow(
      "The id generator gave 'Q1' for a new queue, which is already used on the canvas.",
    );
    expect(() => applyDeclareExchange(before, exchange('fresh'), { newId: () => 'P1' })).toThrow('already used');
    expect(() => applyAddProducer(before, producer('fresh'), { newId: () => 'B2' })).toThrow('already used');
    expect(() => applyAddConsumer(before, consumer('fresh'), { newId: () => '1x' })).toThrow('not a valid id');
    expect(() => applyAddConsumer(before, consumer('fresh'), { newId: () => '__proto__' })).toThrow('not a valid id');
    expect(before).toEqual(sampleDocument());
  });
});
