import type { Flight, QueueMessage } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import { placesOf, placeText, type Holds } from './where';

const copy = (id: number, heldBy: string | null = null): QueueMessage => ({
  id,
  exchange: 'orders',
  producer: 'p1',
  key: 'k',
  headers: [],
  payload: 'x',
  redelivered: false,
  heldBy: heldBy === null ? null : { consumer: `tag-${heldBy}`, channel: heldBy },
});

const publishing = (message: number): Flight => ({
  leg: 'publish',
  message,
  key: 'k',
  producer: 'p1',
  exchange: 'orders',
  from: 0,
  to: 500,
});
const broker = (message: number): Flight => ({
  leg: 'broker',
  message,
  key: 'k',
  producer: 'p1',
  exchange: 'orders',
  paths: [],
  from: 500,
  to: 800,
});
const delivering = (message: number, queue: string, channel: string): Flight => ({
  leg: 'deliver',
  message,
  key: 'k',
  queue,
  channel,
  consumer: `tag-${channel}`,
  redelivered: false,
  from: 800,
  to: 900,
});

const holding =
  (queues: Record<string, readonly QueueMessage[]>): Holds =>
  (queue) =>
    queues[queue] ?? [];

describe('placesOf (ADR-0063)', () => {
  it('says that a message is on its way to the broker, and does not look in the queues that it has not got to', () => {
    expect(placesOf(1, [], [publishing(1)], holding({}))).toEqual([{ kind: 'to-the-broker' }]);
  });

  it('says that a message is inside the broker, and that its copies are not finished with because they are not in the queues yet', () => {
    expect(placesOf(1, ['billing', 'archive'], [broker(1)], holding({}))).toEqual([{ kind: 'in-the-broker' }]);
  });

  it('says where a message is ready among the ones that are ready, ahead of the ones that a consumer holds', () => {
    const holds = holding({ billing: [copy(7), copy(8), copy(9), copy(1, 'c1')] });

    expect(placesOf(8, ['billing'], [], holds)).toEqual([{ kind: 'ready', queue: 'billing', place: 2, of: 3 }]);
    expect(placesOf(7, ['billing'], [], holds)).toEqual([{ kind: 'ready', queue: 'billing', place: 1, of: 3 }]);
  });

  it('says that a consumer holds a message that it has not acknowledged, and by which channel', () => {
    const holds = holding({ billing: [copy(7), copy(1, 'c1')] });

    expect(placesOf(1, ['billing'], [], holds)).toEqual([{ kind: 'held', queue: 'billing', channel: 'c1' }]);
  });

  it('says that a message is on its way from a queue to a consumer, and does not look in that queue, where it still is', () => {
    const holds = holding({ billing: [copy(1)] });

    expect(placesOf(1, ['billing'], [delivering(1, 'billing', 'c1')], holds)).toEqual([
      { kind: 'on-its-way', queue: 'billing', channel: 'c1' },
    ]);
  });

  it('says that a copy that is in no queue and is not on the move is finished with, for each queue that it went to', () => {
    expect(placesOf(1, ['billing', 'archive'], [], holding({ billing: [copy(2)] }))).toEqual([
      { kind: 'finished', queue: 'billing' },
      { kind: 'finished', queue: 'archive' },
    ]);
  });

  it('has a place for each copy of a message that went to several queues, in the order of the queues', () => {
    const holds = holding({ billing: [copy(1)], archive: [copy(1, 'c2')], audit: [] });

    expect(placesOf(1, ['billing', 'archive', 'audit'], [], holds)).toEqual([
      { kind: 'ready', queue: 'billing', place: 1, of: 1 },
      { kind: 'held', queue: 'archive', channel: 'c2' },
      { kind: 'finished', queue: 'audit' },
    ]);
  });

  it('says that a message that no queue got is in none, and ignores the flights of other messages', () => {
    expect(placesOf(1, [], [], holding({}))).toEqual([{ kind: 'nowhere' }]);
    expect(placesOf(1, [], [publishing(2), broker(3)], holding({}))).toEqual([{ kind: 'nowhere' }]);
  });
});

describe('placeText', () => {
  const name = (channel: string) => `the consumer of ${channel}`;

  it('says each place in a sentence, with the consumer by name', () => {
    expect(
      [
        { kind: 'to-the-broker' },
        { kind: 'in-the-broker' },
        { kind: 'ready', queue: 'billing', place: 2, of: 3 },
        { kind: 'on-its-way', queue: 'billing', channel: 'c1' },
        { kind: 'held', queue: 'billing', channel: 'c1' },
        { kind: 'finished', queue: 'billing' },
        { kind: 'nowhere' },
      ].map((place) => placeText(place as Parameters<typeof placeText>[0], name)),
    ).toEqual([
      'On its way from its producer to the exchange.',
      'Inside the broker, on its way to the queues that it was routed to.',
      'Ready in billing, number 2 of 3 that are waiting for a consumer.',
      'On its way from billing to the consumer of c1.',
      'Held by the consumer of c1, which has not acknowledged it: it stays in billing until it does.',
      'Finished with: it was acknowledged, or taken from billing.',
      'In no queue: no queue got it.',
    ]);
  });
});
