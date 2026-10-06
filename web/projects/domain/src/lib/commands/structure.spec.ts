import {
  bindingRecord,
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
  undoRedoProblems,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { defaultExchangeReply, reservedNameReply } from '@rmq/engine';
import { findId } from '../document/elements';
import type { ElementKind } from '../document/issue';
import { emptyDocument, type CanvasDocument } from '../document/schema';
import { toTopology } from '../document/topology';
import { validateDocument } from '../document/validate';
import { applyClear, applyDelete, applyRename } from './structure';
import type { Delete, Rename } from './types';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const rename = (kind: ElementKind, name: string, to: string): Rename => ({
  type: 'rename',
  target: { kind, name },
  name: to,
});
const remove = (kind: ElementKind, name: string): Delete => ({ type: 'delete', target: { kind, name } });

describe('rename', () => {
  it.each<[ElementKind, string, string, 'exchanges' | 'queues' | 'producers' | 'consumers', string]>([
    ['exchange', 'orders', 'sales', 'exchanges', 'E1'],
    ['queue', 'billing', 'invoices', 'queues', 'Q1'],
    ['producer', 'sender', 'emitter', 'producers', 'P1'],
    ['consumer', 'worker', 'handler', 'consumers', 'C1'],
  ])('renames a %s %j to %j, and the id stays', (kind, from, to, collection, id) => {
    const before = sample();
    const result = applyRename(before, rename(kind, from, to));

    expect(result.ok && result.value[collection][id]?.name).toBe(to);
    // The record is what it was with another name, and has nothing that its kind does not have.
    expect(result.ok && result.value[collection][id]).toEqual({ ...before[collection][id], name: to });
    expect(result.ok && Object.keys(result.value[collection][id] ?? {})).toEqual(
      Object.keys(before[collection][id] ?? {}),
    );
    expect(result.ok && findId(result.value, kind, to)).toBe(id);
    expect(result.ok && findId(result.value, kind, from)).toBeUndefined();
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('keeps every reference to the element, because they are ids: the bindings, the link, the subscription and the label', () => {
    const before = sample();
    const exchange = applyRename(before, rename('exchange', 'orders', 'sales'));
    const queue = applyRename(before, rename('queue', 'billing', 'invoices'));

    expect(exchange.ok && exchange.value.bindings).toBe(before.bindings);
    expect(exchange.ok && exchange.value.producers).toBe(before.producers);
    expect(exchange.ok && exchange.value.layout).toBe(before.layout);
    expect(queue.ok && queue.value.consumers).toBe(before.consumers);
    expect(queue.ok && toTopology(queue.value).bindings[0]?.destination).toEqual({ kind: 'queue', name: 'invoices' });
    expect(exchange.ok && toTopology(exchange.value).bindings[0]?.source).toBe('sales');
  });

  it('shares what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applyRename(before, rename('queue', 'billing', 'invoices'));

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.queues['Q2']).toBe(before.queues['Q2']);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('changes nothing when the name is the one it has, and returns the same document', () => {
    const before = sample();

    expect(applyRename(before, rename('queue', 'billing', 'billing'))).toEqual({ ok: true, value: before });
    expect((applyRename(before, rename('queue', 'billing', 'billing')) as { value: unknown }).value).toBe(before);
  });

  it('takes a name that a queue has, for an exchange, and the other way round, since names are unique within a kind', () => {
    expect(applyRename(sample(), rename('exchange', 'orders', 'billing')).ok).toBe(true);
    expect(applyRename(sample(), rename('queue', 'billing', 'orders')).ok).toBe(true);
    expect(applyRename(sample(), rename('producer', 'sender', 'worker')).ok).toBe(true);
  });

  it('makes a queue that a broker named one that a client named, which may not start with amq.', () => {
    const document = deepFreeze(documentOf({ queues: { Q: queueRecord('amq.gen-x', { serverNamed: true }) } }));
    const result = applyRename(document, rename('queue', 'amq.gen-x', 'mine'));

    expect(result.ok && result.value.queues['Q']).toEqual({ name: 'mine', serverNamed: false, durable: true });
    expect(applyRename(document, rename('queue', 'amq.gen-x', 'amq.gen-y'))).toMatchObject({
      error: { kind: 'reserved-name' },
    });
  });

  describe('refuses', () => {
    it.each<[ElementKind, string]>([
      ['exchange', 'orders'],
      ['queue', 'billing'],
    ])('a new name of a %s that starts with amq., with the 403 that the broker gave', (kind, name) => {
      const result = applyRename(sample(), rename(kind, name, 'amq.new'));

      expect(!result.ok && result.error.kind).toBe('reserved-name');
      expect(!result.ok && result.error.refusal).toEqual(reservedNameReply(kind as 'exchange' | 'queue', 'amq.new'));
    });

    it('amq. as the new name of a producer or a consumer, which are not the broker’s', () => {
      expect(applyRename(sample(), rename('producer', 'sender', 'amq.sender')).ok).toBe(true);
      expect(applyRename(sample(), rename('consumer', 'worker', 'amq.worker')).ok).toBe(true);
    });

    it('an empty name: for an exchange that is the default exchange, and for the others it is a name that is missing', () => {
      expect(applyRename(sample(), rename('exchange', 'orders', ''))).toMatchObject({
        error: { kind: 'default-exchange', refusal: defaultExchangeReply() },
      });
      expect(applyRename(sample(), rename('queue', 'billing', ''))).toMatchObject({ error: { kind: 'empty-name' } });
      expect(applyRename(sample(), rename('producer', 'sender', ''))).toMatchObject({ error: { kind: 'empty-name' } });
      expect(applyRename(sample(), rename('consumer', 'worker', ''))).toMatchObject({ error: { kind: 'empty-name' } });
    });

    it('a name of more than 255 bytes', () => {
      expect(applyRename(sample(), rename('queue', 'billing', 'q'.repeat(256)))).toMatchObject({
        error: { kind: 'name-too-long' },
      });
      expect(applyRename(sample(), rename('queue', 'billing', 'q'.repeat(255))).ok).toBe(true);
    });

    it('a name that another element of the kind has', () => {
      expect(applyRename(sample(), rename('queue', 'billing', 'archive'))).toEqual({
        ok: false,
        error: {
          kind: 'duplicate-name',
          message: "There is already a queue named 'archive'. Names are unique within a kind.",
        },
      });
      expect(applyRename(sample(), rename('exchange', 'orders', 'docs'))).toMatchObject({
        error: { kind: 'duplicate-name' },
      });
    });

    it('an element that is not there, and says what was probably meant', () => {
      expect(applyRename(sample(), rename('queue', 'billng', 'x'))).toMatchObject({
        error: { kind: 'missing-element', message: "There is no queue named 'billng'. Did you mean 'billing'?" },
      });
      expect(applyRename(sample(), rename('exchange', 'billing', 'x'))).toMatchObject({
        error: { message: "There is no exchange named 'billing'. There is a queue with that name." },
      });
    });

    it('and changes nothing', () => {
      const before = sample();
      applyRename(before, rename('queue', 'billing', 'archive'));

      expect(before).toEqual(sampleDocument());
    });
  });
});

describe('delete', () => {
  it('deletes an exchange, its position, its bindings from and to it, and the link of a producer that publishes to it', () => {
    const before = sample();
    const result = applyDelete(before, remove('exchange', 'orders'));

    expect(result.ok && Object.keys(result.value.exchanges)).toEqual(['E2', 'E3']);
    expect(result.ok && Object.keys(result.value.bindings)).toEqual(['B2']);
    expect(result.ok && result.value.producers['P1']?.target).toBeNull();
    expect(result.ok && Object.keys(result.value.layout.nodes)).not.toContain('E1');
    expect(result.ok && result.value.layout.labels).toEqual({});
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('deletes the bindings that end at an exchange as well as the ones that start from it', () => {
    const result = applyDelete(sample(), remove('exchange', 'hidden'));

    expect(result.ok && Object.keys(result.value.bindings)).toEqual(['B1', 'B2']);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('deletes a queue, its position, the bindings to it, and the queue from the consumers that consume from it', () => {
    const before = sample();
    const result = applyDelete(before, remove('queue', 'billing'));

    expect(result.ok && Object.keys(result.value.queues)).toEqual(['Q2']);
    expect(result.ok && Object.keys(result.value.bindings)).toEqual(['B2', 'B3']);
    expect(result.ok && result.value.consumers['C1']?.queues).toEqual([]);
    expect(result.ok && result.value.layout.labels).toEqual({});
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('unlinks a producer that publishes to the queue through the default exchange', () => {
    const document = deepFreeze(
      documentOf({
        queues: { Q: queueRecord('q') },
        producers: { P: producerRecord('p', { kind: 'queue', id: 'Q' }), O: producerRecord('other') },
      }),
    );
    const result = applyDelete(document, remove('queue', 'q'));

    expect(result.ok && result.value.producers['P']?.target).toBeNull();
    expect(result.ok && result.value.producers['O']).toBe(document.producers['O']);
  });

  it('leaves a producer that publishes to a queue alone when an exchange of the same name goes, and the other way round', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('same') },
        queues: { Q: queueRecord('same') },
        producers: { P: producerRecord('p', { kind: 'queue', id: 'Q' }) },
        consumers: { C: consumerRecord('c', ['Q']) },
      }),
    );
    const exchange = applyDelete(document, remove('exchange', 'same'));
    const queue = applyDelete(document, remove('queue', 'same'));

    expect(exchange.ok && exchange.value.producers).toBe(document.producers);
    expect(exchange.ok && exchange.value.consumers).toBe(document.consumers);
    expect(queue.ok && queue.value.producers['P']?.target).toBeNull();
  });

  it('deletes a producer and a consumer, and what they link to is left as it is', () => {
    const before = sample();
    const producer = applyDelete(before, remove('producer', 'sender'));
    const consumer = applyDelete(before, remove('consumer', 'worker'));

    expect(producer.ok && producer.value.producers).toEqual({});
    expect(producer.ok && producer.value.exchanges).toBe(before.exchanges);
    expect(producer.ok && producer.value.bindings).toBe(before.bindings);
    expect(consumer.ok && consumer.value.consumers).toEqual({});
    expect(consumer.ok && consumer.value.queues).toBe(before.queues);
    expect(consumer.ok && consumer.value.layout.labels).toEqual({ 'E1>Q1': { at: 0.5 } });
    expect(producer.ok && validateDocument(producer.value)).toEqual([]);
    expect(consumer.ok && validateDocument(consumer.value)).toEqual([]);
  });

  it('takes a queue from a consumer that consumes from several, and leaves it the others', () => {
    const document = deepFreeze(
      documentOf({
        queues: { Q: queueRecord('a'), R: queueRecord('b'), S: queueRecord('c') },
        consumers: { C: consumerRecord('c', ['Q', 'R', 'S']), D: consumerRecord('d', ['R']) },
      }),
    );
    const result = applyDelete(document, remove('queue', 'b'));

    expect(result.ok && result.value.consumers['C']?.queues).toEqual(['Q', 'S']);
    expect(result.ok && result.value.consumers['D']?.queues).toEqual([]);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('keeps the bindings, the producers and the consumers as they were when nothing hangs on what it deletes', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('lonely'), F: exchangeRecord('busy') },
        queues: { Q: queueRecord('lonely'), R: queueRecord('busy') },
        bindings: { B: bindingRecord('F', { kind: 'queue', id: 'R' }, 'k') },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'F' }) },
        consumers: { C: consumerRecord('c', ['R']) },
      }),
    );
    const exchange = applyDelete(document, remove('exchange', 'lonely'));
    const queue = applyDelete(document, remove('queue', 'lonely'));

    for (const result of [exchange, queue]) {
      expect(result.ok && result.value.bindings).toBe(document.bindings);
      expect(result.ok && result.value.producers).toBe(document.producers);
      expect(result.ok && result.value.consumers).toBe(document.consumers);
      expect(result.ok && result.value.layout.labels).toBe(document.layout.labels);
    }
  });

  it('takes the labels of the edges that went, and keeps the ones that did not', () => {
    const before = sample();
    const result = applyDelete(before, remove('consumer', 'worker'));

    expect(result.ok && result.value.layout.labels).toBe(before.layout.labels);
  });

  it('shares what it did not touch, and can be undone and redone, with everything that went with it', () => {
    const before = sample();
    const result = applyDelete(before, remove('queue', 'archive'));

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && result.value.queues['Q1']).toBe(before.queues['Q1']);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
    const everything = applyDelete(before, remove('exchange', 'orders'));

    expect(everything.ok && undoRedoProblems(before, everything.value)).toEqual([]);
  });

  it('refuses an element that is not there, and says what was probably meant', () => {
    expect(applyDelete(sample(), remove('exchange', 'oders'))).toMatchObject({
      error: { kind: 'missing-element', message: "There is no exchange named 'oders'. Did you mean 'orders'?" },
    });
    expect(applyDelete(sample(), remove('consumer', 'orders'))).toMatchObject({
      error: { message: "There is no consumer named 'orders'. There is an exchange with that name." },
    });
  });

  it('leaves an empty canvas when the last element goes', () => {
    const document = deepFreeze(documentOf({ queues: { Q: queueRecord('q') } }));
    const result = applyDelete(document, remove('queue', 'q'));

    expect(result.ok && result.value).toEqual(emptyDocument());
  });
});

describe('clear', () => {
  it('takes everything off the canvas, and keeps its vhost and its settings', () => {
    const before = deepFreeze({
      ...sampleDocument(),
      vhost: 'prod',
      settings: { showDefaultExchange: true, seed: 9, timing: { publishMs: 1, brokerMs: 2, deliverMs: 3 } },
    });
    const result = applyClear(before, { type: 'clear' });

    expect(result.ok && result.value).toEqual({ ...emptyDocument({ vhost: 'prod' }), settings: before.settings });
    expect(result.ok && result.value.settings).toBe(before.settings);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('changes nothing on a canvas with nothing on it, and returns the same document', () => {
    const before = deepFreeze(emptyDocument());
    const result = applyClear(before, { type: 'clear' });

    expect(result.ok && result.value).toBe(before);
  });

  it('is a change when only a position or a label is left, which the canvas does not otherwise have', () => {
    const odd = deepFreeze({ ...emptyDocument(), layout: { nodes: { X: { x: 1, y: 1 } }, labels: {} } });

    expect(applyClear(odd, { type: 'clear' })).toMatchObject({
      ok: true,
      value: { layout: { nodes: {}, labels: {} } },
    });
  });

  it('can be undone and redone', () => {
    const before = sample();
    const result = applyClear(before, { type: 'clear' });

    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });
});
