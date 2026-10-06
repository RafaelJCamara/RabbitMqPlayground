import { LIMITS } from '@rmq/domain';
import {
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { newNodeKey } from '../canvas/model/new-node';
import { createChoices } from './create-choices';

const keys = (document: Parameters<typeof createChoices>[0], source: string) =>
  createChoices(document, source).nodes.map(newNodeKey);

describe('createChoices (ADR-0042)', () => {
  const document = deepFreeze(sampleDocument());

  it('offers a producer each kind of exchange and a queue, which is what a producer may publish to', () => {
    expect(keys(document, 'P1')).toEqual([
      'exchange:direct',
      'exchange:fanout',
      'exchange:topic',
      'exchange:headers',
      'queue',
    ]);
  });

  it('offers an exchange each kind of exchange and a queue, which is what an exchange may be bound to', () => {
    expect(keys(document, 'E1')).toEqual([
      'exchange:direct',
      'exchange:fanout',
      'exchange:topic',
      'exchange:headers',
      'queue',
    ]);
  });

  it('offers a queue a consumer, and nothing else', () => {
    expect(keys(document, 'Q1')).toEqual(['consumer']);
  });

  it('offers a consumer nothing, and says why in the words of the rule', () => {
    const choices = createChoices(document, 'C1');

    expect(choices.nodes).toEqual([]);
    expect(choices.reason).toBe(
      'A consumer is where a message ends: it takes messages from queues, and nothing is linked from it.',
    );
  });

  it('offers nothing for a node that is not on the canvas', () => {
    const choices = createChoices(document, 'gone');

    expect(choices.nodes).toEqual([]);
    expect(choices.reason).toBe('There is nothing on the canvas with that id.');
  });

  it('has no reason when there is something to offer', () => {
    expect(createChoices(document, 'P1').reason).toBeNull();
  });

  it('offers nothing when the canvas is full, and says what the limit is', () => {
    const queues = Object.fromEntries(
      Array.from({ length: LIMITS.elements - 1 }, (_, index) => [`q${index}`, queueRecord(`queue${index}`)]),
    );
    const full = deepFreeze(documentOf({ queues, producers: { p: producerRecord('sender') } }));

    const choices = createChoices(full, 'p');

    expect(choices.nodes).toEqual([]);
    expect(choices.reason).toContain('The canvas is full');
    expect(choices.reason).toContain('2,000');
  });

  it('does not change the canvas, and gives the same answer every time', () => {
    const before = sampleDocument();

    expect(createChoices(before, 'P1')).toEqual(createChoices(before, 'P1'));
    expect(before).toEqual(sampleDocument());
  });

  it('offers what the rules allow for a canvas with a node of each kind, whatever the names are', () => {
    const odd = deepFreeze(
      documentOf({
        exchanges: { x: exchangeRecord('queue1') },
        queues: { q: queueRecord('exchange1') },
        consumers: { c: consumerRecord('producer1') },
      }),
    );

    expect(keys(odd, 'q')).toEqual(['consumer']);
    expect(keys(odd, 'x')).toHaveLength(5);
  });
});
