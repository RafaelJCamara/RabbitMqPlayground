import { SNAPSHOT_VERSION, type EngineSnapshot } from './snapshot';
import type { Held } from './state';

/**
 * Whether a snapshot can be restored (ADR-0052, ADR-0077). An engine trusts the state that it holds: it looks up the consumer that a queue serves, the channel that a consumer is on and the
 * counters of an exchange, and it does not ask whether they are there. That is right for the snapshot that an engine took itself, and wrong for one that came from outside, such as the messages of a
 * share link, which went through a compressor, an address and someone's hands. So a snapshot is held against what the engine trusts before it is restored: the version it reads, the names that are
 * there once, what refers to what, the counters of the exchanges, the copies that a consumer holds, the order of the copies in a queue, what a producer that repeats has scheduled, and the numbers
 * that say what comes next.
 *
 * The snapshot that an engine takes always passes, and a property says so for any run, at any step. The sentences are for a person who was sent a link: they name what is wrong, and where.
 */

const twice = (what: string, names: readonly string[], saying = 'is there twice'): string | null => {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      return `${what} “${name}” ${saying}`;
    }
    seen.add(name);
  }
  return null;
};

/** The first thing that is there twice, among the things that are found by their names. */
function duplicateIssue(snapshot: EngineSnapshot): string | null {
  return (
    twice(
      'The exchange',
      snapshot.exchanges.map((exchange) => exchange.name),
    ) ??
    twice(
      'The queue',
      snapshot.queues.map((queue) => queue.name),
    ) ??
    twice(
      'The channel',
      snapshot.channels.map((channel) => channel.id),
    ) ??
    twice(
      'The consumer',
      snapshot.tags.map((tag) => tag.tag),
    ) ??
    twice(
      'The producer',
      snapshot.producers.map((producer) => producer.id),
    ) ??
    twice(
      'The exchange',
      snapshot.exchangeCounters.map(([name]) => name),
      'has its counters twice',
    )
  );
}

/**
 * What a producer may be set to, as `producer.set` asks it: a burst and an interval that are whole numbers of at least 1. An interval of nothing, or less, ticks again with no time gone, so
 * the engine that was given it would never get to the end of a second (the Nightly of 2026-10-09 ran one out of memory with an interval of -200). A snapshot that came from outside is
 * refused by `readSnapshot` of the domain before it gets here; this is what the engine holds itself to.
 */
function producerIssue(snapshot: EngineSnapshot): string | null {
  for (const producer of snapshot.producers) {
    if (!Number.isInteger(producer.burst) || producer.burst < 1) {
      return `The producer “${producer.id}” has a burst of ${String(producer.burst)}, and a burst is a whole number of at least 1`;
    }
    if (!Number.isInteger(producer.everyMs) || producer.everyMs < 1) {
      return `The producer “${producer.id}” has an interval (everyMs) of ${String(producer.everyMs)}, and an interval is a whole number of at least 1`;
    }
  }
  return null;
}

/** What refers to what: the bindings, the consumers, the channels and the queues that serve them. */
function referenceIssue(snapshot: EngineSnapshot): string | null {
  const queues = new Map(snapshot.queues.map((queue) => [queue.name, queue]));
  const exchanges = new Set(snapshot.exchanges.map((exchange) => exchange.name));
  const channels = new Map(snapshot.channels.map((channel) => [channel.id, channel]));
  const tags = new Map(snapshot.tags.map((tag) => [tag.tag, tag]));

  for (const binding of snapshot.bindings) {
    const found =
      binding.destination.kind === 'queue'
        ? queues.has(binding.destination.name)
        : exchanges.has(binding.destination.name);
    if (!exchanges.has(binding.source) || !found) {
      return `A binding from “${binding.source}” to “${binding.destination.name}” refers to something that is not in the snapshot`;
    }
  }
  for (const tag of snapshot.tags) {
    const channel = channels.get(tag.channel);
    const queue = queues.get(tag.queue);
    if (queue === undefined || channel === undefined) {
      return `The consumer “${tag.tag}” refers to a queue or a channel that is not in the snapshot`;
    }
    if (!channel.tags.includes(tag.tag)) {
      return `The consumer “${tag.tag}” is on the channel “${tag.channel}”, which does not list it`;
    }
    if (tag.ack === 'auto' && tag.unacked.length > 0) {
      return `The consumer “${tag.tag}” acknowledges by itself, and yet it holds messages that it has not acknowledged`;
    }
    if (tag.cancelled && tag.unacked.length === 0) {
      return `The consumer “${tag.tag}” is cancelled and holds nothing, so it would be gone`;
    }
    const uncounted = tag.uncounted ?? 0;
    const given = queue.nextOrder - 1;
    if (!Number.isInteger(uncounted) || uncounted < 0 || uncounted > given) {
      return `The consumer “${tag.tag}” does not count ${String(uncounted)} messages that an earlier consumer of its tag held, and the queue “${tag.queue}” has given out ${String(given)}`;
    }
  }
  for (const channel of snapshot.channels) {
    for (const name of channel.tags) {
      const tag = tags.get(name);
      if (tag === undefined) {
        return `The channel “${channel.id}” refers to the consumer “${name}”, which is not in the snapshot`;
      }
      if (tag.channel !== channel.id) {
        return `The channel “${channel.id}” lists the consumer “${name}”, which is on the channel “${tag.channel}”`;
      }
    }
  }
  const served = new Set<string>();
  for (const queue of snapshot.queues) {
    for (const name of [...queue.turn, ...queue.blocked]) {
      const tag = tags.get(name);
      if (tag === undefined) {
        return `The queue “${queue.name}” refers to the consumer “${name}”, which is not in the snapshot`;
      }
      if (tag.queue !== queue.name) {
        return `The queue “${queue.name}” serves the consumer “${name}”, which is on the queue “${tag.queue}”`;
      }
      if (tag.cancelled) {
        return `The queue “${queue.name}” serves the consumer “${name}”, which is cancelled`;
      }
      if (served.has(name)) {
        return `The queue “${queue.name}” serves the consumer “${name}” twice`;
      }
      served.add(name);
    }
  }
  const unserved = snapshot.tags.find((tag) => !tag.cancelled && !served.has(tag.tag));
  return unserved === undefined
    ? null
    : `The consumer “${unserved.tag}” is not served by its queue “${unserved.queue}”`;
}

/** The counters of the exchanges: one for each exchange, and one for the default exchange, which is the name `""`, and no other. */
function counterIssue(snapshot: EngineSnapshot): string | null {
  const counted = new Set(snapshot.exchangeCounters.map(([name]) => name));
  const exchanges = new Set(['', ...snapshot.exchanges.map((exchange) => exchange.name)]);
  for (const name of exchanges) {
    if (!counted.has(name)) {
      return name === '' ? 'The default exchange has no counters' : `The exchange “${name}” has no counters`;
    }
  }
  for (const name of counted) {
    if (!exchanges.has(name)) {
      return `There are counters for the exchange “${name}”, which is not in the snapshot`;
    }
  }
  return null;
}

/** The copies that are held, wherever they are: in the channel that waits for them, in the one that handles them, and on their way. */
function heldOf(snapshot: EngineSnapshot): Held[] {
  const held: Held[] = [];
  for (const channel of snapshot.channels) {
    for (const waiting of channel.waiting) {
      held.push(waiting);
    }
    if (channel.working !== null) {
      held.push(channel.working);
    }
  }
  for (const { task } of snapshot.heap) {
    if (task.kind === 'receive' || task.kind === 'finish') {
      held.push(task.held);
    }
  }
  return held;
}

/** A copy that a consumer holds to acknowledge is among the copies that it has not acknowledged, because that is what the engine acknowledges when the channel has finished with it. */
function heldIssue(snapshot: EngineSnapshot): string | null {
  const tags = new Map(snapshot.tags.map((tag) => [tag.tag, tag]));
  for (const held of heldOf(snapshot)) {
    if (held.ack === 'manual') {
      const tag = tags.get(held.tag);
      if (tag === undefined || tag.queue !== held.queue || !tag.unacked.some((entry) => entry.order === held.order)) {
        return `A message that “${held.tag}” has to acknowledge is not among the messages that it has not acknowledged`;
      }
    }
  }
  return null;
}

/** The copies of a queue are in the order that they came in, and what a queue gives out next is above all of them. */
function orderIssue(snapshot: EngineSnapshot): string | null {
  const unacked = new Map<string, number[]>();
  for (const tag of snapshot.tags) {
    const orders = unacked.get(tag.queue) ?? [];
    for (const entry of tag.unacked) {
      orders.push(entry.order);
    }
    unacked.set(tag.queue, orders);
  }
  for (const queue of snapshot.queues) {
    const orders = [...queue.ready.map((entry) => entry.order), ...(unacked.get(queue.name) ?? [])];
    if (orders.some((order) => order < 1 || order >= queue.nextOrder)) {
      return `The queue “${queue.name}” holds a message that is numbered above the number of the next one`;
    }
    if (new Set(orders).size !== orders.length) {
      return `The queue “${queue.name}” holds two messages with the same number`;
    }
    let before = 0;
    for (const entry of queue.ready) {
      if (entry.order < before) {
        return `The queue “${queue.name}” holds its messages out of order`;
      }
      before = entry.order;
    }
  }
  return null;
}

/** The highest number that has been given out, which the number of the next one has to be above. */
function highest(numbers: Iterable<number>): number {
  let most = 0;
  for (const number of numbers) {
    most = Math.max(most, number);
  }
  return most;
}

/** The numbers of every message that the snapshot holds, wherever. */
function* messageIds(snapshot: EngineSnapshot): Generator<number> {
  for (const queue of snapshot.queues) {
    for (const entry of queue.ready) {
      yield entry.message.id;
    }
  }
  for (const tag of snapshot.tags) {
    for (const entry of tag.unacked) {
      yield entry.message.id;
    }
  }
  for (const held of heldOf(snapshot)) {
    yield held.message.id;
  }
  for (const { task } of snapshot.heap) {
    if (task.kind === 'arrive' || task.kind === 'enqueue') {
      yield task.message.id;
    }
  }
}

/** What is scheduled: in the order that it will happen, for things that are there, and for a producer that repeats exactly one tick, when it says. */
function scheduleIssue(snapshot: EngineSnapshot): string | null {
  const channels = new Set(snapshot.channels.map((channel) => channel.id));
  const producers = new Map(snapshot.producers.map((producer) => [producer.id, producer]));
  const ticks = new Map<string, number[]>();
  let previous: { readonly at: number; readonly seq: number } | undefined;
  for (const scheduled of snapshot.heap) {
    if (scheduled.at < snapshot.now) {
      return 'What is scheduled is before the time that it is now';
    }
    if (
      previous !== undefined &&
      (scheduled.at < previous.at || (scheduled.at === previous.at && scheduled.seq <= previous.seq))
    ) {
      return 'What is scheduled is not in the order that it will happen';
    }
    previous = scheduled;
    const task = scheduled.task;
    if (task.kind === 'tick') {
      if (!producers.has(task.producer)) {
        return `A tick is scheduled for the producer “${task.producer}”, which is not in the snapshot`;
      }
      ticks.set(task.producer, [...(ticks.get(task.producer) ?? []), scheduled.at]);
    }
    if ((task.kind === 'receive' || task.kind === 'finish') && !channels.has(task.channel)) {
      return `A delivery is scheduled to the channel “${task.channel}”, which is not in the snapshot`;
    }
  }
  for (const producer of snapshot.producers) {
    const times = ticks.get(producer.id) ?? [];
    const repeats = producer.repeat && producer.target !== null;
    const agrees =
      producer.nextTickAt === null
        ? !repeats && times.length === 0
        : repeats && times.length === 1 && times[0] === producer.nextTickAt;
    if (!agrees) {
      return `The producer “${producer.id}” does not repeat as what is scheduled says`;
    }
  }
  return null;
}

/** The numbers that say what comes next are above what has been given out. */
function counterOfNextIssue(snapshot: EngineSnapshot): string | null {
  const messages = highest(messageIds(snapshot));
  if (snapshot.nextMessageId <= messages) {
    return `The number of the next message is ${snapshot.nextMessageId}, and a message is numbered ${messages}`;
  }
  const scheduled = highest(snapshot.heap.map(({ seq }) => seq));
  if (snapshot.nextSeq <= scheduled) {
    return `The number of the next thing to be scheduled is ${snapshot.nextSeq}, and something is scheduled as ${scheduled}`;
  }
  return null;
}

/**
 * Why a snapshot cannot be restored, or `null` when it can. It looks at the version first, and does not look inside a snapshot of another version, because it does not know what is there. The
 * rest is for a snapshot that is of the right shape, which `readSnapshot` of the domain makes sure of for one that came from outside.
 */
export function snapshotIssue(snapshot: EngineSnapshot): string | null {
  if (snapshot.version !== SNAPSHOT_VERSION) {
    return `This engine reads snapshots of version ${SNAPSHOT_VERSION}, and this one is version ${String(snapshot.version)}`;
  }
  return (
    duplicateIssue(snapshot) ??
    referenceIssue(snapshot) ??
    producerIssue(snapshot) ??
    counterIssue(snapshot) ??
    heldIssue(snapshot) ??
    orderIssue(snapshot) ??
    scheduleIssue(snapshot) ??
    counterOfNextIssue(snapshot)
  );
}
