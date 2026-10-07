import type { EngineEvent } from '@rmq/engine';
import { consumerRecord, documentOf, producerRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { describeEvent, describeStep, namesOf, type Names } from './sentences';

const names: Names = {
  producer: (id) => (id === null ? null : id === 'P' ? 'sender' : id),
  consumer: (channel) => (channel === 'C' ? 'worker' : channel),
};

const at = { seq: 1, at: 0 };
const message = { id: 3, producer: 'P', exchange: 'orders', key: 'k', headers: [], payload: 'x' };
const handled = { ...at, message: 3, queue: 'billing', consumer: 'C/billing', channel: 'C' };

describe('describeEvent', () => {
  it.each<[string, EngineEvent, string]>([
    [
      'a message that a producer sent',
      { ...at, type: 'published', message, arrivesAt: 5 },
      'sender published message 3',
    ],
    [
      'a message that a command sent',
      { ...at, type: 'published', message: { ...message, producer: null }, arrivesAt: 5 },
      'you published message 3',
    ],
    [
      'a message that was routed to one queue',
      {
        ...at,
        type: 'routed',
        message: 3,
        exchange: 'orders',
        queues: ['billing'],
        paths: [],
        trace: { exchange: 'orders', visits: [] },
        enqueueAt: 8,
      },
      'message 3 was routed to billing',
    ],
    [
      'a message that was routed to three',
      {
        ...at,
        type: 'routed',
        message: 3,
        exchange: 'orders',
        queues: ['a', 'b', 'c'],
        paths: [],
        trace: { exchange: 'orders', visits: [] },
        enqueueAt: 8,
      },
      'message 3 was routed to a, b and c',
    ],
    [
      'a message that no queue got',
      { ...at, type: 'unroutable', message: 3, exchange: 'orders', trace: { exchange: 'orders', visits: [] } },
      'message 3 reached orders and found no queue to go to',
    ],
    [
      'a message that no queue got, sent to the default exchange',
      { ...at, type: 'unroutable', message: 3, exchange: '', trace: { exchange: '', visits: [] } },
      'message 3 reached the default exchange and found no queue to go to',
    ],
    [
      'a message that the broker refused',
      { ...at, type: 'refused', message: 3, exchange: 'hidden', code: 403, text: 'ACCESS_REFUSED' },
      'message 3 was refused at hidden (403 ACCESS_REFUSED)',
    ],
    [
      'a copy that came into a queue',
      { ...at, type: 'enqueued', message: 3, queue: 'billing', depth: 1 },
      'message 3 is in billing',
    ],
    [
      'a copy that came to a queue that is gone',
      { ...at, type: 'dropped', message: 3, queue: 'billing' },
      'message 3 was dropped, because billing is gone',
    ],
    [
      'a message that a queue gave to a consumer',
      { ...handled, type: 'delivered', redelivered: false, autoAck: false, arrivesAt: 9 },
      'billing gave message 3 to worker',
    ],
    [
      'a message that a queue gave again',
      { ...handled, type: 'delivered', redelivered: true, autoAck: false, arrivesAt: 9 },
      'billing gave message 3 to worker again',
    ],
    ['a message that reached a consumer', { ...handled, type: 'received' }, 'worker received message 3'],
    ['a message that a consumer finished', { ...handled, type: 'processed' }, 'worker finished message 3'],
    ['a message that a consumer acknowledged', { ...handled, type: 'acked' }, 'worker acknowledged message 3'],
    ['a message that went back', { ...handled, type: 'requeued' }, 'message 3 went back to billing'],
    [
      'a consumer that was cancelled',
      { ...at, type: 'consumer.cancelled', consumer: 'C/billing', channel: 'C', queue: 'billing', reason: 'cancelled' },
      'worker stopped consuming from billing',
    ],
    [
      'a consumer whose queue was deleted',
      {
        ...at,
        type: 'consumer.cancelled',
        consumer: 'C/billing',
        channel: 'C',
        queue: 'billing',
        reason: 'queue-deleted',
      },
      'billing was deleted, so worker stopped consuming from it',
    ],
    [
      'a channel that was closed with nothing to give back',
      { ...at, type: 'channel.closed', channel: 'C', reason: { kind: 'closed' }, requeued: 0 },
      'worker was closed, and 0 messages went back to their queues',
    ],
    [
      'a channel that was closed with one message',
      { ...at, type: 'channel.closed', channel: 'C', reason: { kind: 'closed' }, requeued: 1 },
      'worker was closed, and 1 message went back to its queue',
    ],
    [
      'a channel that was closed with several',
      { ...at, type: 'channel.closed', channel: 'C', reason: { kind: 'closed' }, requeued: 4 },
      'worker was closed, and 4 messages went back to their queues',
    ],
    [
      'a queue that was purged of one',
      { ...at, type: 'queue.purged', queue: 'billing', count: 1 },
      '1 message was purged from billing',
    ],
    [
      'a queue that was purged of several',
      { ...at, type: 'queue.purged', queue: 'billing', count: 5 },
      '5 messages were purged from billing',
    ],
    [
      'a queue that was deleted',
      { ...at, type: 'queue.deleted', queue: 'billing', ready: 2, unacked: 1 },
      'billing was deleted with 3 messages in it',
    ],
    [
      'a queue that was deleted with one',
      { ...at, type: 'queue.deleted', queue: 'billing', ready: 1, unacked: 0 },
      'billing was deleted with 1 message in it',
    ],
    [
      'messages that were cleared',
      { ...at, type: 'cleared', travelling: 1, ready: 0, unacked: 0, buffered: 0 },
      'the messages were cleared',
    ],
    ['counters that were reset', { ...at, type: 'counters.reset' }, 'the counters were reset'],
  ])('says %s', (_, event, sentence) => {
    expect(describeEvent(event, names)).toBe(sentence);
  });

  it('says what a message that no producer sent has no name for, as the producer that it has when it has one', () => {
    expect(
      describeEvent({ ...at, type: 'published', message: { ...message, producer: 'X' }, arrivesAt: 1 }, names),
    ).toBe('X published message 3');
  });
});

describe('describeStep', () => {
  const published: EngineEvent = { ...at, type: 'published', message, arrivesAt: 5 };
  const routed: EngineEvent = {
    ...at,
    type: 'routed',
    message: 3,
    exchange: 'orders',
    queues: ['billing'],
    paths: [],
    trace: { exchange: 'orders', visits: [] },
    enqueueAt: 8,
  };
  const enqueued: EngineEvent = { ...at, type: 'enqueued', message: 3, queue: 'billing', depth: 1 };

  it('says what the one event was, as a sentence', () => {
    expect(describeStep([enqueued], names)).toBe('Stepped: message 3 is in billing.');
  });

  it('says what several events were, in order, and as many as three', () => {
    expect(describeStep([published, routed, enqueued], names)).toBe(
      'Stepped: sender published message 3; message 3 was routed to billing; message 3 is in billing.',
    );
  });

  it('counts one more, when a step said four', () => {
    expect(describeStep([published, routed, enqueued, enqueued], names)).toBe(
      'Stepped: sender published message 3; message 3 was routed to billing; message 3 is in billing; and 1 more.',
    );
  });

  it('counts the rest, when a step said more than three', () => {
    expect(describeStep([published, routed, enqueued, enqueued, enqueued], names)).toBe(
      'Stepped: sender published message 3; message 3 was routed to billing; message 3 is in billing; and 2 more.',
    );
  });
});

describe('namesOf', () => {
  const document = documentOf({
    producers: { P: producerRecord('sender') },
    consumers: { C: consumerRecord('worker') },
  });

  it('gives the name of a producer and of a consumer by the id that the engine knows it by', () => {
    const known = namesOf(document);

    expect(known.producer('P')).toBe('sender');
    expect(known.consumer('C')).toBe('worker');
  });

  it('has no name for a message that no producer sent, and gives the id for what is not on the canvas, so that a sentence is never empty', () => {
    const known = namesOf(document);

    expect(known.producer(null)).toBeNull();
    expect(known.producer('gone')).toBe('gone');
    expect(known.consumer('gone')).toBe('gone');
  });
});
