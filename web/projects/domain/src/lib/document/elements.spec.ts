import { consumerRecord, deepFreeze, documentOf, exchangeRecord, producerRecord, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { COLLECTION, elements, findId, kindOf, lookup, nameOf, recordOf } from './elements';

const document = deepFreeze(
  documentOf({
    exchanges: { ex1: exchangeRecord('orders'), ex2: exchangeRecord('shared', 'fanout') },
    queues: { q1: queueRecord('billing'), q2: queueRecord('shared') },
    producers: { p1: producerRecord('sender') },
    consumers: { c1: consumerRecord('worker'), c2: consumerRecord('shared') },
  }),
);

describe('lookup', () => {
  const record = { a: 1, constructor: 2 };

  it('finds an entry by its id', () => {
    expect(lookup(record, 'a')).toBe(1);
  });

  it('finds nothing for an id that is not there', () => {
    expect(lookup(record, 'b')).toBeUndefined();
    expect(lookup({}, 'a')).toBeUndefined();
  });

  it('counts only what the record has itself, and not what every object has', () => {
    for (const id of ['toString', 'hasOwnProperty', 'valueOf', '__proto__', 'isPrototypeOf']) {
      expect(lookup({}, id), id).toBeUndefined();
    }
  });

  it('finds an entry whose id is the name of something that every object has, when the record has it itself', () => {
    expect(lookup(record, 'constructor')).toBe(2);
  });
});

describe('recordOf and COLLECTION', () => {
  it('give the collection of each kind', () => {
    expect(COLLECTION).toEqual({
      exchange: 'exchanges',
      queue: 'queues',
      producer: 'producers',
      consumer: 'consumers',
    });
    expect(recordOf(document, 'exchange')).toBe(document.exchanges);
    expect(recordOf(document, 'queue')).toBe(document.queues);
    expect(recordOf(document, 'producer')).toBe(document.producers);
    expect(recordOf(document, 'consumer')).toBe(document.consumers);
  });
});

describe('findId', () => {
  it('finds the element of a kind by its name', () => {
    expect(findId(document, 'exchange', 'orders')).toBe('ex1');
    expect(findId(document, 'queue', 'billing')).toBe('q1');
    expect(findId(document, 'producer', 'sender')).toBe('p1');
    expect(findId(document, 'consumer', 'worker')).toBe('c1');
  });

  it('tells apart elements of different kinds that have the same name', () => {
    expect(findId(document, 'exchange', 'shared')).toBe('ex2');
    expect(findId(document, 'queue', 'shared')).toBe('q2');
    expect(findId(document, 'consumer', 'shared')).toBe('c2');
    expect(findId(document, 'producer', 'shared')).toBeUndefined();
  });

  it('finds nothing for a name that no element of that kind has, and compares the whole name and its case', () => {
    expect(findId(document, 'queue', 'orders')).toBeUndefined();
    expect(findId(document, 'exchange', 'Orders')).toBeUndefined();
    expect(findId(document, 'exchange', 'order')).toBeUndefined();
    expect(findId(document, 'exchange', '')).toBeUndefined();
  });
});

describe('nameOf and kindOf', () => {
  it('give the name of an element and its kind from its id', () => {
    expect(nameOf(document, 'queue', 'q2')).toBe('shared');
    expect(nameOf(document, 'queue', 'ex1')).toBeUndefined();
    expect(nameOf(document, 'consumer', 'constructor')).toBeUndefined();
    expect(kindOf(document, 'ex2')).toBe('exchange');
    expect(kindOf(document, 'q1')).toBe('queue');
    expect(kindOf(document, 'p1')).toBe('producer');
    expect(kindOf(document, 'c2')).toBe('consumer');
    expect(kindOf(document, 'nope')).toBeUndefined();
    expect(kindOf(document, 'toString')).toBeUndefined();
  });
});

describe('elements', () => {
  it('lists every element, grouped by kind as exchange, queue, producer, consumer, in the order they were made', () => {
    expect(elements(document).map(({ kind, id, name }) => `${kind}:${id}:${name}`)).toEqual([
      'exchange:ex1:orders',
      'exchange:ex2:shared',
      'queue:q1:billing',
      'queue:q2:shared',
      'producer:p1:sender',
      'consumer:c1:worker',
      'consumer:c2:shared',
    ]);
  });

  it('lists nothing for an empty canvas', () => {
    expect(elements(documentOf())).toEqual([]);
  });
});
