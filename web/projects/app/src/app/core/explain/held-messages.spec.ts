import { emptyDocument } from '@rmq/domain';
import type { MessageInfo } from '@rmq/engine';
import { documentOf, entry, queueRecord, str } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { explainedUnder, HELD_LIMIT, HeldMessages, messageOf } from './held-messages';

const info = (id: number, changes: Partial<MessageInfo> = {}): MessageInfo => ({
  id,
  producer: 'P',
  exchange: 'orders',
  key: 'order.created',
  headers: [entry('format', str('pdf'))],
  payload: 'hi',
  ...changes,
});

describe('HeldMessages (ADR-0061)', () => {
  const published = emptyDocument();
  const routed = documentOf({ queues: { q: queueRecord('billing') } });

  it('holds a message that was published, with the canvas that it was published under, and says that it has not been routed', () => {
    const held = new HeldMessages();

    held.published(info(1), 500, published);

    expect(held.get(1)).toEqual({
      info: info(1),
      publishedAt: 500,
      under: published,
      outcome: null,
      routedUnder: null,
      queues: [],
    });
    expect(held.size).toBe(1);
    expect(held.get(2)).toBeUndefined();
  });

  it('holds, once the engine has routed it, what it did and the canvas that it did it with, and that canvas is the one that explains it', () => {
    const held = new HeldMessages();
    held.published(info(1), 500, published);
    expect(explainedUnder(held.get(1)!)).toBe(published);

    held.settled(1, 'routed', ['billing'], routed);

    expect(held.get(1)).toMatchObject({
      outcome: 'routed',
      queues: ['billing'],
      routedUnder: routed,
      under: published,
    });
    expect(explainedUnder(held.get(1)!)).toBe(routed);
  });

  it('says which message was routed, or refused, last, which is the one that Why? shows while the clock is stopped', () => {
    const held = new HeldMessages();
    held.published(info(1), 0, published);
    held.published(info(2), 0, published);
    expect(held.lastSettled).toBeNull();

    held.settled(2, 'unroutable', [], published);
    held.settled(1, 'refused', [], published);

    expect(held.lastSettled).toBe(1);
  });

  it('does not hold what it did not see published, and says nothing of it', () => {
    const held = new HeldMessages();

    held.settled(9, 'routed', ['billing'], routed);

    expect(held.get(9)).toBeUndefined();
    expect(held.lastSettled).toBeNull();
  });

  it('forgets the oldest message when it holds more than the limit, and the others stay', () => {
    const held = new HeldMessages();
    for (let id = 1; id <= HELD_LIMIT + 3; id += 1) {
      held.published(info(id), id, published);
    }

    expect(HELD_LIMIT).toBe(2000);
    expect(held.size).toBe(HELD_LIMIT);
    expect([1, 2, 3].map((id) => held.get(id))).toEqual([undefined, undefined, undefined]);
    expect(held.get(4)?.info.id).toBe(4);
    expect(held.get(HELD_LIMIT + 3)?.info.id).toBe(HELD_LIMIT + 3);
  });

  it('forgets everything when it is cleared, and which message was last', () => {
    const held = new HeldMessages();
    held.published(info(1), 0, published);
    held.settled(1, 'routed', [], published);

    held.clear();

    expect(held.size).toBe(0);
    expect(held.lastSettled).toBeNull();
  });

  it('gives a held message as the engine routes it: where it was published, the key and the headers', () => {
    const held = new HeldMessages();
    held.published(info(1), 0, published);

    expect(messageOf(held.get(1)!)).toEqual({
      exchange: 'orders',
      key: 'order.created',
      headers: [entry('format', str('pdf'))],
    });
  });
});
