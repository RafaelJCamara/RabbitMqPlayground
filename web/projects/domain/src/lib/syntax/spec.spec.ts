import { consumerRecord, deepFreeze, documentOf, exchangeRecord, producerRecord, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import { refText } from './spec';

const twins = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('same'), F: exchangeRecord('orders') },
      queues: { Q: queueRecord('same'), R: queueRecord('my queue') },
      producers: { P: producerRecord('same') },
      consumers: { C: consumerRecord('same') },
    }),
  );

describe('refText', () => {
  it('is the name alone where only one kind goes, because the place says what it is, whatever else has the name', () => {
    expect(refText(twins(), { kind: 'queue', name: 'same' }, ['queue'])).toBe('same');
    expect(refText(twins(), { kind: 'exchange', name: 'same' }, ['exchange'])).toBe('same');
    expect(refText(twins(), { kind: 'producer', name: 'same' }, ['producer'])).toBe('same');
  });

  it('is the name alone where only one kind goes, even when the canvas has nothing of that name yet', () => {
    expect(refText(documentOf(), { kind: 'queue', name: 'jobs' }, ['queue'])).toBe('jobs');
  });

  it('is the name alone where several kinds go and only the kind that is meant has it', () => {
    expect(refText(twins(), { kind: 'exchange', name: 'orders' }, ['exchange', 'queue'])).toBe('orders');
    expect(refText(twins(), { kind: 'queue', name: 'my queue' }, ['exchange', 'queue'])).toBe('"my queue"');
  });

  it('has the kind in front where several kinds go and more than one has the name, whichever is meant', () => {
    expect(refText(twins(), { kind: 'queue', name: 'same' }, ['exchange', 'queue'])).toBe('queue:same');
    expect(refText(twins(), { kind: 'exchange', name: 'same' }, ['exchange', 'queue'])).toBe('exchange:same');
    expect(refText(twins(), { kind: 'consumer', name: 'same' }, ['producer', 'consumer'])).toBe('consumer:same');
  });

  it('has the kind in front where several kinds go and the canvas has no such element, as it has when a batch makes it', () => {
    expect(refText(documentOf(), { kind: 'queue', name: 'jobs' }, ['exchange', 'queue'])).toBe('queue:jobs');
  });

  it('has the kind in front where several kinds go and the name belongs to another kind than the one that is meant', () => {
    expect(refText(twins(), { kind: 'queue', name: 'orders' }, ['exchange', 'queue'])).toBe('queue:orders');
  });

  it('writes a name that has to be quoted in quotes, after the kind', () => {
    expect(refText(twins(), { kind: 'queue', name: 'my queue' }, ['queue'])).toBe('"my queue"');
    expect(refText(documentOf(), { kind: 'queue', name: 'my queue' }, ['exchange', 'queue'])).toBe('queue:"my queue"');
  });
});
