import { internalExchangeReply } from '@rmq/engine';
import { deepFreeze, documentOf, exchangeRecord, producerRecord, queueRecord, sampleDocument } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import { LIMITS } from '../document/schema';
import { runtimeIssue } from './runtime';
import type { Publish, RuntimeCommand } from './types';

/**
 * What a command that runs the simulation needs of the canvas (ADR-0054): the producer or the exchange or the queue has to be there, a producer needs
 * somewhere to send to, and a message has to be one that a client could send.
 */

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const publish = (from: Publish['from'], rest: Partial<Publish> = {}): Publish => ({ type: 'publish', from, ...rest });
const producer = (name: string): Publish => publish({ kind: 'producer', name });
const exchange = (name: string, rest: Partial<Publish> = {}): Publish => publish({ kind: 'exchange', name }, rest);

describe('runtimeIssue', () => {
  it.each<RuntimeCommand>([
    { type: 'play' },
    { type: 'pause' },
    { type: 'step' },
    { type: 'speed', factor: 2 },
    { type: 'clear-messages' },
    { type: 'reset-counters' },
  ])('has nothing against %j, whatever is on the canvas', (command) => {
    expect(runtimeIssue(sample(), command)).toBeNull();
    expect(runtimeIssue(deepFreeze(documentOf()), command)).toBeNull();
  });

  describe('purge', () => {
    it('is for a queue that is there', () => {
      expect(runtimeIssue(sample(), { type: 'purge', queue: 'billing' })).toBeNull();
    });

    it('says that there is no such queue, with the names that were probably meant, and says when it is an exchange', () => {
      expect(runtimeIssue(sample(), { type: 'purge', queue: 'billng' })).toEqual({
        kind: 'missing-element',
        message: "There is no queue named 'billng'. Did you mean 'billing'?",
        suggestions: ['billing'],
      });
      expect(runtimeIssue(sample(), { type: 'purge', queue: 'orders' })?.message).toContain(
        "There is no queue named 'orders'",
      );
      expect(runtimeIssue(sample(), { type: 'purge', queue: 'orders' })?.message).toContain('exchange');
    });
  });

  describe('publish from a producer', () => {
    it('is for a producer that has somewhere to send to', () => {
      expect(runtimeIssue(sample(), producer('sender'))).toBeNull();
    });

    it('says that there is no such producer, with the names that were probably meant', () => {
      expect(runtimeIssue(sample(), producer('sendr'))).toMatchObject({
        kind: 'missing-element',
        suggestions: ['sender'],
      });
    });

    it('says that a producer with no target has nowhere to publish, and how to give it one', () => {
      const document = deepFreeze(
        documentOf({ producers: { P: producerRecord('lonely') }, queues: { Q: queueRecord('q') } }),
      );

      expect(runtimeIssue(document, producer('lonely'))).toEqual({
        kind: 'not-linked',
        message:
          "The producer 'lonely' is not linked to anything, so it has nowhere to publish. Link it with link lonely -> <an exchange or a queue>.",
      });
    });

    it('writes a name that has a space in it as the command would have it, quoted', () => {
      const document = deepFreeze(documentOf({ producers: { P: producerRecord('my producer') } }));

      expect(runtimeIssue(document, producer('my producer'))?.message).toContain('Link it with link "my producer" ->');
    });
  });

  describe('publish to an exchange', () => {
    it('is for an exchange that is there, with a message that a client could send', () => {
      expect(runtimeIssue(sample(), exchange('orders'))).toBeNull();
      expect(
        runtimeIssue(
          sample(),
          exchange('orders', {
            key: 'k'.repeat(255),
            payload: 'p'.repeat(LIMITS.textLength),
            headers: [{ key: 'n', value: { t: 'integer', v: 1 } }],
          }),
        ),
      ).toBeNull();
    });

    it('says that there is no such exchange, and that a queue is not one', () => {
      expect(runtimeIssue(sample(), exchange('ordrs'))).toMatchObject({
        kind: 'missing-element',
        suggestions: ['orders'],
      });
      expect(runtimeIssue(sample(), exchange('billing'))?.message).toContain("There is no exchange named 'billing'");
    });

    it('refuses an internal exchange with the 403 that the broker gives, and says what is wrong first', () => {
      const issue = runtimeIssue(sample(), exchange('hidden'));

      expect(issue).toMatchObject({ kind: 'internal-exchange', refusal: internalExchangeReply('hidden', '/') });
      expect(issue?.message).toContain('is internal, so a client cannot publish to it');
    });

    it('refuses a key of more than 255 bytes, headers that no message could have, and a payload that is too long', () => {
      expect(runtimeIssue(sample(), exchange('orders', { key: 'k'.repeat(256) }))?.kind).toBe('routing-key');
      expect(
        runtimeIssue(sample(), exchange('orders', { headers: [{ key: 'n', value: { t: 'integer', v: 2 ** 53 } }] }))
          ?.kind,
      ).toBe('header');
      expect(runtimeIssue(sample(), exchange('orders', { payload: 'p'.repeat(LIMITS.textLength + 1) }))?.kind).toBe(
        'invalid-value',
      );
    });

    it('looks for the exchange before it looks at the message, and an exchange that is internal before a key that is too long', () => {
      expect(runtimeIssue(sample(), exchange('nope', { key: 'k'.repeat(256) }))?.kind).toBe('missing-element');
      expect(runtimeIssue(sample(), exchange('hidden', { key: 'k'.repeat(256) }))?.kind).toBe('internal-exchange');
    });

    it('uses the exchange of that name and not a producer or a queue that has it too', () => {
      const document = deepFreeze(
        documentOf({
          exchanges: { E: exchangeRecord('same') },
          queues: { Q: queueRecord('same') },
          producers: { P: producerRecord('same') },
        }),
      );

      expect(runtimeIssue(document, exchange('same'))).toBeNull();
      expect(runtimeIssue(document, producer('same'))?.kind).toBe('not-linked');
    });
  });
});
