import type { State } from './state';
import type { ChannelView, ExchangeView, Flight, ProducerView, QueueMessage, QueueView, RuntimeView } from './view';
import type { Topology } from './topology';

/** What the screen reads, worked out from the state (ADR-0052). Nothing here changes it. */

export function buildView(state: State, topology: Topology): RuntimeView {
  let travelling = 0;
  for (const { task } of state.heap.values()) {
    if (task.kind === 'arrive' || task.kind === 'receive') {
      travelling += 1;
    } else if (task.kind === 'enqueue') {
      travelling += task.paths.length;
    }
  }

  const unacked = new Map<string, number>();
  const subscribed = new Map<string, number>();
  for (const tag of state.tags.values()) {
    unacked.set(tag.queue, (unacked.get(tag.queue) ?? 0) + tag.unacked.length);
    if (!tag.cancelled) {
      subscribed.set(tag.queue, (subscribed.get(tag.queue) ?? 0) + 1);
    }
  }

  const queues: Record<string, QueueView> = {};
  for (const queue of state.queues.values()) {
    queues[queue.name] = {
      ready: queue.ready.length,
      unacked: unacked.get(queue.name) ?? 0,
      enqueued: queue.enqueued,
      delivered: queue.delivered,
      consumers: subscribed.get(queue.name) ?? 0,
    };
  }

  const exchanges: Record<string, ExchangeView> = {};
  for (const [name, counters] of state.exchangeCounters) {
    exchanges[name] = { ...counters };
  }

  const producers: Record<string, ProducerView> = {};
  for (const producer of state.producers.values()) {
    producers[producer.id] = {
      published: producer.published,
      repeating: producer.nextTickAt !== null,
      nextAt: producer.nextTickAt,
    };
  }

  const channels: Record<string, ChannelView> = {};
  for (const channel of state.channels.values()) {
    channels[channel.id] = {
      prefetch: channel.prefetch,
      processingMs: channel.processingMs,
      received: channel.received,
      consumed: channel.consumed,
      waiting: channel.waiting.length,
      working: channel.working !== null,
      consumers: channel.tags.map((name) => {
        const tag = state.tags.get(name)!;
        return {
          consumer: tag.tag,
          queue: tag.queue,
          ack: tag.ack,
          unacked: tag.unacked.length,
          cancelled: tag.cancelled,
        };
      }),
    };
  }

  return {
    now: state.now,
    seed: state.seed,
    timing: { ...state.timing },
    vhost: state.vhost,
    published: state.published,
    travelling,
    topology,
    queues,
    exchanges,
    producers,
    channels,
  };
}

/** The messages that are on the move, in the order that they will arrive, read off what is scheduled. */
export function buildFlights(state: State): Flight[] {
  const flights: Flight[] = [];
  for (const { at, task } of state.heap.sorted()) {
    if (task.kind === 'arrive') {
      const { message } = task;
      flights.push({
        leg: 'publish',
        message: message.id,
        key: message.key,
        producer: message.producer,
        exchange: message.exchange,
        from: task.sentAt,
        to: at,
      });
    } else if (task.kind === 'enqueue') {
      const { message } = task;
      flights.push({
        leg: 'broker',
        message: message.id,
        key: message.key,
        exchange: message.exchange,
        paths: task.paths,
        from: task.routedAt,
        to: at,
      });
    } else if (task.kind === 'receive') {
      const { held } = task;
      flights.push({
        leg: 'deliver',
        message: held.message.id,
        key: held.message.key,
        queue: held.queue,
        channel: task.channel,
        consumer: held.tag,
        redelivered: held.redelivered,
        from: task.sentAt,
        to: at,
      });
    }
  }
  return flights;
}

/** What a queue holds, ready first and then held by consumers, at most `limit` of them. */
export function listMessages(state: State, queueName: string, limit: number): QueueMessage[] {
  const queue = state.queues.get(queueName);
  if (queue === undefined) {
    return [];
  }
  const messages: QueueMessage[] = queue.ready.first(limit).map(({ message, redelivered }) => ({
    id: message.id,
    key: message.key,
    payload: message.payload,
    redelivered,
    heldBy: null,
  }));
  for (const tag of state.tags.values()) {
    if (tag.queue !== queueName) {
      continue;
    }
    for (const { message, redelivered } of tag.unacked) {
      if (messages.length >= limit) {
        return messages;
      }
      messages.push({
        id: message.id,
        key: message.key,
        payload: message.payload,
        redelivered,
        heldBy: { consumer: tag.tag, channel: tag.channel },
      });
    }
  }
  return messages;
}
