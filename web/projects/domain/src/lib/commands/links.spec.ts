import { internalExchangeReply } from '@rmq/engine';
import {
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
import type { CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { applyLink, applySubscribe, applyUnlink, applyUnsubscribe } from './links';
import type { Link, Subscribe, Unlink, Unsubscribe } from './types';

const link = (producer: string, kind: 'exchange' | 'queue', name: string): Link => ({
  type: 'link',
  producer,
  target: { kind, name },
});
const unlink = (producer: string): Unlink => ({ type: 'unlink', producer });
const subscribe = (consumer: string, queue: string): Subscribe => ({ type: 'subscribe', consumer, queue });
const unsubscribe = (consumer: string, queue: string): Unsubscribe => ({ type: 'unsubscribe', consumer, queue });

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
/** Producers with and without a target, and consumers with and without queues. */
const canvas = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E1: exchangeRecord('open'), E2: exchangeRecord('hidden', 'fanout', { internal: true }) },
      queues: { Q1: queueRecord('one'), Q2: queueRecord('two') },
      producers: { P1: producerRecord('idle'), P2: producerRecord('busy', { kind: 'exchange', id: 'E1' }) },
      consumers: { C1: consumerRecord('none'), C2: consumerRecord('some', ['Q1']) },
      labels: { 'P2>E1': { at: 0.25 }, 'Q1>C2': { at: 0.75 } },
    }),
  );

describe('link', () => {
  it('points a producer at an exchange, and at a queue, which is the default exchange with the queue’s name as the key', () => {
    const exchange = applyLink(canvas(), link('idle', 'exchange', 'open'));
    const queue = applyLink(canvas(), link('idle', 'queue', 'one'));

    expect(exchange.ok && exchange.value.producers['P1']?.target).toEqual({ kind: 'exchange', id: 'E1' });
    expect(queue.ok && queue.value.producers['P1']?.target).toEqual({ kind: 'queue', id: 'Q1' });
    expect(exchange.ok && validateDocument(exchange.value)).toEqual([]);
  });

  it('points a producer that has a target at another, since a producer has one, and takes the label of the old edge', () => {
    const result = applyLink(canvas(), link('busy', 'queue', 'two'));

    expect(result.ok && result.value.producers['P2']?.target).toEqual({ kind: 'queue', id: 'Q2' });
    expect(result.ok && result.value.layout.labels).toEqual({ 'Q1>C2': { at: 0.75 } });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
  });

  it('changes nothing when the producer is already pointed there, and returns the same document', () => {
    const before = canvas();
    const result = applyLink(before, link('busy', 'exchange', 'open'));

    expect(result.ok && result.value).toBe(before);
  });

  it('tells an exchange from a queue of the same name', () => {
    const document = deepFreeze(
      documentOf({
        exchanges: { E: exchangeRecord('same') },
        queues: { Q: queueRecord('same') },
        producers: { P: producerRecord('p', { kind: 'exchange', id: 'E' }) },
      }),
    );
    const result = applyLink(document, link('p', 'queue', 'same'));

    expect(result.ok && result.value.producers['P']?.target).toEqual({ kind: 'queue', id: 'Q' });
    expect(result.ok && result.value).not.toBe(document);
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = canvas();
    const result = applyLink(before, link('idle', 'exchange', 'open'));

    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.queues).toBe(before.queues);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && result.value.layout).toBe(before.layout);
    expect(result.ok && result.value.producers['P2']).toBe(before.producers['P2']);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  describe('refuses', () => {
    it('a producer that is not there, and says what was probably meant', () => {
      const result = applyLink(canvas(), link('idel', 'exchange', 'open'));

      expect(!result.ok && result.error.kind).toBe('missing-element');
      expect(!result.ok && result.error.message).toBe("There is no producer named 'idel'. Did you mean 'idle'?");
      expect(!result.ok && result.error.suggestions).toEqual(['idle']);
    });

    it('a target that is not there, of the kind it was asked for, and says when the other kind has it', () => {
      expect(applyLink(canvas(), link('idle', 'exchange', 'one'))).toMatchObject({
        error: {
          kind: 'missing-element',
          message: "There is no exchange named 'one'. There is a queue with that name.",
        },
      });
      expect(applyLink(canvas(), link('idle', 'queue', 'open'))).toMatchObject({
        error: { message: "There is no queue named 'open'. There is an exchange with that name." },
      });
      expect(applyLink(canvas(), link('idle', 'queue', 'nowhere'))).toMatchObject({
        error: { kind: 'missing-element' },
      });
    });

    it('an internal exchange, with the 403 that the broker gives a producer that publishes to one', () => {
      const result = applyLink(canvas(), link('idle', 'exchange', 'hidden'));

      expect(!result.ok && result.error.kind).toBe('internal-exchange');
      expect(!result.ok && result.error.refusal).toEqual(internalExchangeReply('hidden', '/'));
    });

    it('a queue that has the name of an internal exchange, which is not the exchange', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { E: exchangeRecord('x', 'direct', { internal: true }) },
          queues: { Q: queueRecord('x') },
          producers: { P: producerRecord('p') },
        }),
      );

      expect(applyLink(document, link('p', 'queue', 'x')).ok).toBe(true);
    });
  });
});

describe('unlink', () => {
  it('takes the target off a producer, and the label of its edge', () => {
    const before = canvas();
    const result = applyUnlink(before, unlink('busy'));

    expect(result.ok && result.value.producers['P2']?.target).toBeNull();
    expect(result.ok && result.value.layout.labels).toEqual({ 'Q1>C2': { at: 0.75 } });
    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.consumers).toBe(before.consumers);
    expect(result.ok && validateDocument(result.value)).toEqual([]);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('refuses a producer that is not linked, and one that is not there', () => {
    expect(applyUnlink(canvas(), unlink('idle'))).toMatchObject({
      error: { kind: 'not-linked', message: "The producer 'idle' is not linked to anything." },
    });
    expect(applyUnlink(canvas(), unlink('nobody'))).toMatchObject({ error: { kind: 'missing-element' } });
  });
});

describe('subscribe', () => {
  it('lets a consumer consume from a queue, and from another as well', () => {
    const first = applySubscribe(canvas(), subscribe('none', 'one'));
    const second = first.ok ? applySubscribe(first.value, subscribe('none', 'two')) : first;

    expect(first.ok && first.value.consumers['C1']?.queues).toEqual(['Q1']);
    expect(second.ok && second.value.consumers['C1']?.queues).toEqual(['Q1', 'Q2']);
    expect(second.ok && validateDocument(second.value)).toEqual([]);
  });

  it('changes nothing when the consumer already consumes from the queue, and returns the same document', () => {
    const before = canvas();
    const result = applySubscribe(before, subscribe('some', 'one'));

    expect(result.ok && result.value).toBe(before);
  });

  it('keeps what it did not touch, and can be undone and redone', () => {
    const before = sample();
    const result = applySubscribe(before, subscribe('worker', 'archive'));

    expect(result.ok && result.value.consumers['C1']?.queues).toEqual(['Q1', 'Q2']);
    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.queues).toBe(before.queues);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.layout).toBe(before.layout);
    expect(result.ok && undoRedoProblems(before, result.value)).toEqual([]);
  });

  it('refuses a consumer that is not there, and a queue that is not there, and says what was probably meant', () => {
    expect(applySubscribe(canvas(), subscribe('nobody', 'one'))).toMatchObject({ error: { kind: 'missing-element' } });
    expect(applySubscribe(canvas(), subscribe('none', 'on'))).toMatchObject({
      error: { message: "There is no queue named 'on'. Did you mean 'one'?" },
    });
    expect(applySubscribe(canvas(), subscribe('none', 'open'))).toMatchObject({
      error: { message: "There is no queue named 'open'. There is an exchange with that name." },
    });
  });
});

describe('unsubscribe', () => {
  it('takes a queue off a consumer, keeps its others, and takes the label of the edge', () => {
    const document = deepFreeze(
      documentOf({
        queues: { Q1: queueRecord('one'), Q2: queueRecord('two') },
        consumers: { C: consumerRecord('both', ['Q1', 'Q2']) },
        labels: { 'Q1>C': { at: 0.5 }, 'Q2>C': { at: 0.5 } },
      }),
    );
    const result = applyUnsubscribe(document, unsubscribe('both', 'one'));

    expect(result.ok && result.value.consumers['C']?.queues).toEqual(['Q2']);
    expect(result.ok && result.value.layout.labels).toEqual({ 'Q2>C': { at: 0.5 } });
    expect(result.ok && validateDocument(result.value)).toEqual([]);
    expect(result.ok && undoRedoProblems(document, result.value)).toEqual([]);
  });

  it('keeps what it did not touch', () => {
    const before = canvas();
    const result = applyUnsubscribe(before, unsubscribe('some', 'one'));

    expect(result.ok && result.value.consumers['C2']?.queues).toEqual([]);
    expect(result.ok && result.value.exchanges).toBe(before.exchanges);
    expect(result.ok && result.value.producers).toBe(before.producers);
    expect(result.ok && result.value.bindings).toBe(before.bindings);
    expect(result.ok && result.value.consumers['C1']).toBe(before.consumers['C1']);
  });

  it('refuses a consumer that does not consume from the queue, and a consumer or a queue that is not there', () => {
    expect(applyUnsubscribe(canvas(), unsubscribe('none', 'one'))).toMatchObject({
      error: { kind: 'not-subscribed', message: "The consumer 'none' does not consume from the queue 'one'." },
    });
    expect(applyUnsubscribe(canvas(), unsubscribe('nobody', 'one'))).toMatchObject({
      error: { kind: 'missing-element' },
    });
    expect(applyUnsubscribe(canvas(), unsubscribe('some', 'nowhere'))).toMatchObject({
      error: { kind: 'missing-element' },
    });
  });
});
