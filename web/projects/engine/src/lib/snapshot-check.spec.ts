import { busyEngine, newEngine } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from './snapshot';
import { snapshotIssue } from './snapshot-check';

/**
 * An engine trusts the state it holds, so a snapshot that comes from outside is held against what the engine trusts before it is restored (ADR-0052, ADR-0077). The busy engine has a consumer that
 * was cancelled while it held a message, one that is full, one that acknowledges by itself, copies in queues, on their way and being handled, and producers that repeat, so each rule has
 * something to be broken with. `properties.spec.ts` says the other half: that the snapshot of an engine at any step of any run passes, and that a snapshot which is damaged and passes does no harm.
 */

/** The type of a snapshot that can be changed all the way down: a pair is a pair, a list is a list that can be changed, and nothing is read-only. */
type Deep<T> = T extends readonly [infer First, infer Second]
  ? [Deep<First>, Deep<Second>]
  : T extends readonly (infer Item)[]
    ? Deep<Item>[]
    : T extends object
      ? { -readonly [Key in keyof T]: Deep<T[Key]> }
      : T;
type Mutable = Deep<EngineSnapshot>;

/**
 * A snapshot of the busy engine that a spec can break, as a link carries it: through JSON, so that a copy that the engine holds in two places is two objects here, as it is when it is read, and a spec that damages one is
 * not also damaging the other (a structured clone keeps the two as one, and the check of the second hid the check of the first).
 */
const busy = (): Mutable => JSON.parse(JSON.stringify(busyEngine().snapshot())) as Mutable;

const issueOf = (snapshot: Mutable): string | null => snapshotIssue(snapshot);

/** Where the damage is done, by what the busy engine has: its first queue is `jobs` and its second `logs`; its consumers are `c-slow` (cancelled, holds one), `c-fast` (acknowledges by itself) and `c-held`. */
const CASES: readonly (readonly [string, (s: Mutable) => void, string | RegExp])[] = [
  ['an exchange twice', (s) => s.exchanges.push(s.exchanges[0]!), 'The exchange “e” is there twice'],
  ['a queue twice', (s) => s.queues.push(s.queues[0]!), 'The queue “jobs” is there twice'],
  ['a channel twice', (s) => s.channels.push(s.channels[0]!), 'The channel “slow” is there twice'],
  ['a consumer twice', (s) => s.tags.push(s.tags[0]!), 'The consumer “c-slow” is there twice'],
  ['a producer twice', (s) => s.producers.push(s.producers[0]!), 'The producer “p1” is there twice'],
  [
    'a producer with an interval of nothing, which would tick again with no time gone',
    (s) => (s.producers[0]!.everyMs = 0),
    'The producer “p1” has an interval (everyMs) of 0, and an interval is a whole number of at least 1',
  ],
  [
    'a producer with an interval that is less than nothing, which the Nightly of 2026-10-09 ran the engine out of memory with',
    (s) => (s.producers[0]!.everyMs = -200),
    'The producer “p1” has an interval (everyMs) of -200, and an interval is a whole number of at least 1',
  ],
  [
    'a producer with an interval that is not a whole number',
    (s) => (s.producers[0]!.everyMs = 1.5),
    'The producer “p1” has an interval (everyMs) of 1.5, and an interval is a whole number of at least 1',
  ],
  [
    'a producer with a burst of nothing',
    (s) => (s.producers[0]!.burst = 0),
    'The producer “p1” has a burst of 0, and a burst is a whole number of at least 1',
  ],
  [
    'a producer with a burst that is not a whole number',
    (s) => (s.producers[0]!.burst = 2.5),
    'The producer “p1” has a burst of 2.5, and a burst is a whole number of at least 1',
  ],
  [
    'the counters of an exchange twice',
    (s) => s.exchangeCounters.push(s.exchangeCounters[1]!),
    'The exchange “e” has its counters twice',
  ],
  [
    'a binding to a queue that is not there',
    (s) => (s.bindings[0]!.destination.name = 'ghost'),
    'A binding from “e” to “ghost” refers to something that is not in the snapshot',
  ],
  [
    'a binding from an exchange that is not there',
    (s) => (s.bindings[0]!.source = 'ghost'),
    'A binding from “ghost” to “jobs” refers to something that is not in the snapshot',
  ],
  [
    'a consumer on a queue that is not there',
    (s) => (s.tags[1]!.queue = 'ghost'),
    'The consumer “c-fast” refers to a queue or a channel that is not in the snapshot',
  ],
  [
    'a consumer on a channel that is not there',
    (s) => (s.tags[1]!.channel = 'ghost'),
    'The consumer “c-fast” refers to a queue or a channel that is not in the snapshot',
  ],
  [
    'a consumer that its channel does not list',
    (s) => (s.channels[1]!.tags = []),
    'The consumer “c-fast” is on the channel “fast”, which does not list it',
  ],
  [
    'a consumer that acknowledges by itself and holds messages',
    (s) => s.tags[1]!.unacked.push(s.tags[2]!.unacked[0]!),
    'The consumer “c-fast” acknowledges by itself, and yet it holds messages that it has not acknowledged',
  ],
  [
    'a consumer that is cancelled and holds nothing',
    (s) => (s.tags[0]!.unacked = []),
    'The consumer “c-slow” is cancelled and holds nothing, so it would be gone',
  ],
  [
    'a clock that is ahead of what is scheduled, which would run it in the past',
    (s) => (s.now = s.heap[0]!.at + 1),
    'What is scheduled is before the time that it is now',
  ],
  [
    'a consumer that does not count more messages than its queue has given out',
    (s) => (s.tags[0]!.uncounted = 1000),
    /^The consumer “c-slow” does not count 1000 messages that an earlier consumer of its tag held, and the queue “jobs” has given out \d+$/,
  ],
  [
    'a consumer that does not count less than nothing',
    (s) => (s.tags[0]!.uncounted = -1),
    /^The consumer “c-slow” does not count -1 messages that an earlier consumer of its tag held, and the queue “jobs” has given out \d+$/,
  ],
  [
    'a consumer that does not count a part of a message',
    (s) => (s.tags[0]!.uncounted = 0.5),
    /^The consumer “c-slow” does not count 0.5 messages that an earlier consumer of its tag held, and the queue “jobs” has given out \d+$/,
  ],
  [
    'a channel that lists a consumer that is not there',
    (s) => s.channels[0]!.tags.push('ghost'),
    'The channel “slow” refers to the consumer “ghost”, which is not in the snapshot',
  ],
  [
    'a channel that lists the consumer of another channel',
    (s) => s.channels[0]!.tags.push('c-fast'),
    'The channel “slow” lists the consumer “c-fast”, which is on the channel “fast”',
  ],
  [
    'a queue that serves a consumer that is not there',
    (s) => s.queues[0]!.turn.push('ghost'),
    'The queue “jobs” refers to the consumer “ghost”, which is not in the snapshot',
  ],
  [
    'a queue that serves the consumer of another queue',
    (s) => s.queues[0]!.turn.push('c-fast'),
    'The queue “jobs” serves the consumer “c-fast”, which is on the queue “logs”',
  ],
  [
    'a queue that serves a consumer that is cancelled',
    (s) => s.queues[0]!.turn.push('c-slow'),
    'The queue “jobs” serves the consumer “c-slow”, which is cancelled',
  ],
  [
    'a queue that serves a consumer twice',
    (s) => s.queues[0]!.turn.push('c-held'),
    'The queue “jobs” serves the consumer “c-held” twice',
  ],
  [
    'a consumer that its queue does not serve',
    (s) => (s.queues[0]!.blocked = []),
    'The consumer “c-held” is not served by its queue “jobs”',
  ],
  [
    'no counters for the default exchange',
    (s) => (s.exchangeCounters = s.exchangeCounters.filter(([name]) => name !== '')),
    'The default exchange has no counters',
  ],
  [
    'no counters for an exchange',
    (s) => (s.exchangeCounters = s.exchangeCounters.filter(([name]) => name !== 'e')),
    'The exchange “e” has no counters',
  ],
  [
    'counters for an exchange that is not there',
    (s) => s.exchangeCounters.push(['ghost', { routed: 0, unroutable: 0, refused: 0 }]),
    'There are counters for the exchange “ghost”, which is not in the snapshot',
  ],
  [
    'a copy to acknowledge that belongs to a consumer that is not there',
    (s) => (s.channels[0]!.working!.tag = 'ghost'),
    'A message that “ghost” has to acknowledge is not among the messages that it has not acknowledged',
  ],
  [
    'a copy to acknowledge that its consumer does not hold',
    (s) => (s.channels[0]!.working!.order = 99),
    'A message that “c-slow” has to acknowledge is not among the messages that it has not acknowledged',
  ],
  [
    'a copy to acknowledge that is from another queue than the consumer’s',
    (s) => (s.channels[0]!.working!.queue = 'logs'),
    'A message that “c-slow” has to acknowledge is not among the messages that it has not acknowledged',
  ],
  [
    'a copy on its way to acknowledge that its consumer does not hold',
    (s) => {
      const delivery = s.heap.find(({ task }) => task.kind === 'finish' && task.held.ack === 'manual');
      (delivery!.task as { held: { order: number } }).held.order = 99;
      s.channels[0]!.working = null;
    },
    'A message that “c-slow” has to acknowledge is not among the messages that it has not acknowledged',
  ],
  [
    'messages that a queue holds out of order',
    (s) => s.queues[0]!.ready.reverse(),
    'The queue “jobs” holds its messages out of order',
  ],
  [
    'two messages with the same number in a queue',
    (s) => (s.queues[0]!.ready[1]!.order = s.queues[0]!.ready[0]!.order),
    'The queue “jobs” holds two messages with the same number',
  ],
  [
    'a message that a consumer holds with the number of one that is in the queue',
    (s) => (s.tags[2]!.unacked[0]!.order = s.queues[0]!.ready[0]!.order),
    'The queue “jobs” holds two messages with the same number',
  ],
  [
    'a message numbered at or above the number of the next',
    (s) => (s.queues[0]!.nextOrder = 3),
    'The queue “jobs” holds a message that is numbered above the number of the next one',
  ],
  [
    'a message that is numbered 0',
    (s) => (s.queues[0]!.ready[0]!.order = 0),
    'The queue “jobs” holds a message that is numbered above the number of the next one',
  ],
  [
    'what is scheduled out of order',
    (s) => s.heap.reverse(),
    'What is scheduled is not in the order that it will happen',
  ],
  [
    'what is scheduled at the same time with the same number',
    (s) => (s.heap[1]!.seq = s.heap[0]!.seq),
    'What is scheduled is not in the order that it will happen',
  ],
  [
    'a tick for a producer that is not there',
    (s) => ((s.heap.find(({ task }) => task.kind === 'tick')!.task as { producer: string }).producer = 'ghost'),
    'A tick is scheduled for the producer “ghost”, which is not in the snapshot',
  ],
  [
    'a delivery to a channel that is not there',
    (s) => ((s.heap.find(({ task }) => task.kind === 'receive')!.task as { channel: string }).channel = 'ghost'),
    'A delivery is scheduled to the channel “ghost”, which is not in the snapshot',
  ],
  [
    'a producer that repeats and has nothing scheduled',
    (s) => (s.heap = s.heap.filter(({ task }) => !(task.kind === 'tick' && task.producer === 'p1'))),
    'The producer “p1” does not repeat as what is scheduled says',
  ],
  [
    'a producer that does not repeat and has a time for the next',
    (s) => (s.producers[2]!.nextTickAt = 5_000),
    'The producer “p3” does not repeat as what is scheduled says',
  ],
  [
    'a producer that repeats at another time than the one that is scheduled',
    (s) => (s.producers[0]!.nextTickAt = 2_900),
    'The producer “p1” does not repeat as what is scheduled says',
  ],
  [
    'a producer that repeats with nowhere to send to',
    (s) => (s.producers[0]!.target = null),
    'The producer “p1” does not repeat as what is scheduled says',
  ],
  [
    'a producer with two ticks',
    (s) => {
      const tick = s.heap.find(({ task }) => task.kind === 'tick' && task.producer === 'p1')!;
      s.heap.push({ ...structuredClone(tick), seq: s.nextSeq });
      s.nextSeq += 1;
    },
    'The producer “p1” does not repeat as what is scheduled says',
  ],
  [
    'a number for the next message that is already a message’s',
    (s) => (s.nextMessageId = 5),
    /^The number of the next message is 5, and a message is numbered \d+$/,
  ],
  [
    'a number for the next thing scheduled that is already something’s',
    (s) => (s.nextSeq = 5),
    /^The number of the next thing to be scheduled is 5, and something is scheduled as \d+$/,
  ],
  [
    'a copy that waits in a channel to acknowledge that its consumer does not hold',
    (s) => s.channels[0]!.waiting.push({ ...structuredClone(s.channels[0]!.working!), order: 99 }),
    'A message that “c-slow” has to acknowledge is not among the messages that it has not acknowledged',
  ],
  [
    'a copy that is on its way to a consumer to acknowledge that the consumer does not hold',
    (s) => {
      const delivery = s.heap.find(({ task }) => task.kind === 'receive')!;
      Object.assign((delivery.task as { held: object }).held, {
        tag: 'c-slow',
        queue: 'jobs',
        ack: 'manual',
        order: 99,
      });
    },
    'A message that “c-slow” has to acknowledge is not among the messages that it has not acknowledged',
  ],
  [
    'a handling that is scheduled for a channel that is not there',
    (s) => ((s.heap.find(({ task }) => task.kind === 'finish')!.task as { channel: string }).channel = 'ghost'),
    'A delivery is scheduled to the channel “ghost”, which is not in the snapshot',
  ],
  [
    'a message numbered the number of the next one',
    (s) => (s.queues[0]!.nextOrder = s.queues[0]!.ready[s.queues[0]!.ready.length - 1]!.order),
    'The queue “jobs” holds a message that is numbered above the number of the next one',
  ],
  [
    'a producer that repeats and has no time for the next and nothing scheduled',
    (s) => {
      s.producers[0]!.nextTickAt = null;
      s.heap = s.heap.filter(({ task }) => !(task.kind === 'tick' && task.producer === 'p1'));
    },
    'The producer “p1” does not repeat as what is scheduled says',
  ],
  [
    'a producer that does not repeat and has something scheduled',
    (s) => {
      const last = s.heap[s.heap.length - 1]!;
      s.heap.push({ at: last.at + 1, seq: s.nextSeq, task: { kind: 'tick', producer: 'p3' } });
      s.nextSeq += 1;
    },
    'The producer “p3” does not repeat as what is scheduled says',
  ],
  [
    'a message in a queue that is numbered above the number of the next message',
    (s) => (s.queues[0]!.ready[0]!.message.id = 1_000),
    'The number of the next message is 22, and a message is numbered 1000',
  ],
  [
    'a message that a consumer holds that is numbered above the number of the next message',
    (s) => (s.tags[0]!.unacked[0]!.message.id = 1_000),
    'The number of the next message is 22, and a message is numbered 1000',
  ],
  [
    'a message that a channel is handling that is numbered above the number of the next message',
    (s) => (s.channels[1]!.working!.message.id = 1_000),
    'The number of the next message is 22, and a message is numbered 1000',
  ],
  [
    'a message on its way to a consumer that is numbered above the number of the next message',
    (s) =>
      ((
        s.heap.find(({ task }) => task.kind === 'receive')!.task as { held: { message: { id: number } } }
      ).held.message.id = 1_000),
    'The number of the next message is 22, and a message is numbered 1000',
  ],
  [
    'a message that is arriving that is numbered above the number of the next message',
    (s) =>
      ((s.heap.find(({ task }) => task.kind === 'arrive')!.task as { message: { id: number } }).message.id = 1_000),
    'The number of the next message is 22, and a message is numbered 1000',
  ],
  [
    'a message that is being put in queues that is numbered above the number of the next message',
    (s) =>
      ((s.heap.find(({ task }) => task.kind === 'enqueue')!.task as { message: { id: number } }).message.id = 1_000),
    'The number of the next message is 22, and a message is numbered 1000',
  ],
  [
    'a number for the next message that is the number of the last',
    (s) => (s.nextMessageId = 21),
    'The number of the next message is 21, and a message is numbered 21',
  ],
  [
    'a number for the next thing scheduled that is the number of the last',
    (s) => (s.nextSeq = Math.max(...s.heap.map(({ seq }) => seq))),
    /^The number of the next thing to be scheduled is \d+, and something is scheduled as \d+$/,
  ],
];

describe('snapshotIssue (ADR-0077)', () => {
  it('finds nothing wrong with a snapshot that the engine took, at any moment of a busy run', () => {
    const engine = newEngine();
    expect(snapshotIssue(engine.snapshot())).toBeNull();

    const busy = busyEngine();
    for (let at = 0; at <= 8_000; at += 37) {
      busy.advanceTo(at);
      expect(snapshotIssue(busy.snapshot()), `at ${at}`).toBeNull();
    }
  });

  it('reads the version first, and does not look inside a snapshot of another version', () => {
    expect(snapshotIssue({ version: 2 } as unknown as EngineSnapshot)).toBe(
      'This engine reads snapshots of version 1, and this one is version 2',
    );
    expect(snapshotIssue({} as unknown as EngineSnapshot)).toBe(
      'This engine reads snapshots of version 1, and this one is version undefined',
    );
  });

  it.each(CASES)('refuses %s, and says what it is', (_what, damage, expected) => {
    const snapshot = busy();
    damage(snapshot);

    const issue = issueOf(snapshot);

    if (typeof expected === 'string') {
      expect(issue).toBe(expected);
    } else {
      expect(issue).toMatch(expected);
    }
  });

  it.each(CASES)('is the reason that restore gives for %s, as a RangeError', (_what, damage) => {
    const snapshot = busy();
    damage(snapshot);
    const issue = issueOf(snapshot);

    expect(() => newEngine().restore(snapshot)).toThrow(RangeError);
    expect(() => newEngine().restore(snapshot)).toThrow(issue ?? 'no issue');
  });

  it('says one sentence for each, which starts with a capital letter and does not end it twice', () => {
    for (const [what, damage] of CASES) {
      const snapshot = busy();
      damage(snapshot);
      const issue = issueOf(snapshot);

      expect(issue, what).toMatch(/^[A-Z]/);
      expect(issue, what).not.toMatch(/[.]$/);
    }
  });

  it('leaves a snapshot that is not damaged alone, and does not change what it was given', () => {
    const snapshot = busy();
    const before = JSON.stringify(snapshot);

    expect(issueOf(snapshot)).toBeNull();
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  describe('what an earlier consumer of a tag held, and is not counted (ADR-0089)', () => {
    it('is accepted when the queue has given out that many, and a snapshot without it is accepted as it always was', () => {
      const snapshot = busy();
      expect(snapshot.tags[0]!.uncounted).toBeUndefined();

      const given = snapshot.queues.find(({ name }) => name === snapshot.tags[0]!.queue)!.nextOrder - 1;

      snapshot.tags[0]!.uncounted = given;
      expect(issueOf(snapshot)).toBeNull();

      snapshot.tags[0]!.uncounted = given + 1;
      expect(issueOf(snapshot)).toContain(`has given out ${given}`);

      snapshot.tags[0]!.uncounted = 0;
      expect(issueOf(snapshot)).toBeNull();
    });
  });

  describe('what a consumer that acknowledges by itself has', () => {
    it('is its own, even when the consumer is gone, because the broker has forgotten it and the channel finishes it', () => {
      const snapshot = busy();
      const fast = snapshot.channels[1]!;
      expect(fast.working!.ack).toBe('auto');

      fast.working!.tag = 'ghost';
      snapshot.heap.forEach(({ task }) => {
        if ((task.kind === 'receive' || task.kind === 'finish') && task.held.ack === 'auto') {
          (task.held as { tag: string }).tag = 'ghost';
        }
      });

      expect(issueOf(snapshot)).toBeNull();
    });
  });

  describe('a snapshot that is made of a run that is not busy', () => {
    it('has the default exchange and nothing else for the counters, and passes', () => {
      const snapshot = newEngine().snapshot();

      expect(snapshot.exchangeCounters).toEqual([['', { routed: 0, unroutable: 0, refused: 0 }]]);
      expect(snapshotIssue(snapshot)).toBeNull();
    });
  });
});
