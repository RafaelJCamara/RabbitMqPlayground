import type { Core } from './core';
import type { CloseReason } from './events';
import type { ChannelState, Held, QueueEntry, QueueState, TagState } from './state';

/**
 * How a queue gives its messages to its consumers, and what cancel, close and delete do to what they hold (ADR-0053). Each function
 * changes the state and says what it did.
 */

/**
 * Whether a consumer can be given one more message: its channel has no limit, or it holds fewer than the prefetch. One that acknowledges by itself holds nothing.
 * What an earlier consumer of the same tag held when the tag was taken again is left out of the count (ADR-0089).
 */
export function hasRoom(core: Core, tag: TagState): boolean {
  const { prefetch } = core.state.channels.get(tag.channel) as ChannelState;
  return prefetch === 0 || tag.unacked.length - tag.uncounted < prefetch;
}

/**
 * Gives the ready messages of a queue to its consumers for as long as there are messages and consumers with room. The consumer at the head of the
 * turn is tried: if it has room it is given the next message and goes to the back, and if it has none it leaves the turn and the next is tried.
 * A consumer is found to be full only here, when it is tried, and not when its window closes (the broker does the same, and the fixtures say so).
 */
export function dispatchQueue(core: Core, queue: QueueState): void {
  while (queue.ready.length > 0) {
    const name = queue.turn.shift();
    if (name === undefined) {
      return;
    }
    const tag = core.state.tags.get(name) as TagState;
    if (!hasRoom(core, tag)) {
      queue.blocked.push(name);
      continue;
    }
    give(core, queue, tag, queue.ready.shift() as QueueEntry);
    queue.turn.push(name);
  }
}

function give(core: Core, queue: QueueState, tag: TagState, entry: QueueEntry): void {
  const { state } = core;
  queue.delivered += 1;
  if (tag.ack === 'manual') {
    tag.unacked.push(entry);
  }
  const held: Held = {
    queue: queue.name,
    tag: tag.tag,
    ack: tag.ack,
    message: entry.message,
    order: entry.order,
    redelivered: entry.redelivered,
  };
  const arrivesAt = state.now + state.timing.deliverMs;
  core.emit({
    type: 'delivered',
    message: entry.message.id,
    queue: queue.name,
    consumer: tag.tag,
    channel: tag.channel,
    redelivered: entry.redelivered,
    autoAck: tag.ack === 'auto',
    arrivesAt,
  });
  core.schedule(arrivesAt, { kind: 'receive', channel: tag.channel, held, sentAt: state.now });
}

/** Puts a consumer that was blocked, and has room again, at the back of its queue's turn. The caller then dispatches the queue. */
export function unblock(core: Core, queue: QueueState, tag: TagState): void {
  const at = queue.blocked.indexOf(tag.tag);
  if (at >= 0 && hasRoom(core, tag)) {
    queue.blocked.splice(at, 1);
    queue.turn.push(tag.tag);
  }
}

/** Forgets a consumer altogether. */
export function removeTag(core: Core, tag: TagState): void {
  const { state } = core;
  state.tags.delete(tag.tag);
  const channel = state.channels.get(tag.channel) as ChannelState;
  channel.tags = channel.tags.filter((name) => name !== tag.tag);
}

/** Takes a consumer out of its queue's turn, so that it is given nothing more. */
function leaveTurn(core: Core, tag: TagState): void {
  const queue = core.state.queues.get(tag.queue) as QueueState;
  queue.turn = queue.turn.filter((name) => name !== tag.tag);
  queue.blocked = queue.blocked.filter((name) => name !== tag.tag);
}

/**
 * `basic.cancel`: the consumer is given nothing more, and what it holds stays with it and can still be acknowledged. It is gone when the last
 * of it is (ADR-0008, rule 16).
 */
export function cancelTag(core: Core, tag: TagState): void {
  leaveTurn(core, tag);
  tag.cancelled = true;
  core.emit({
    type: 'consumer.cancelled',
    consumer: tag.tag,
    channel: tag.channel,
    queue: tag.queue,
    reason: 'cancelled',
  });
  if (tag.unacked.length === 0) {
    removeTag(core, tag);
  }
}

/**
 * The consumer acknowledges a message that it holds: it is gone from the queue, and the consumer may be given another. A command can acknowledge a message
 * that the consumer has not finished with, or has not even received, and then the consumer has nothing to do for it: what refers to it is called back.
 */
export function ackEntry(core: Core, tag: TagState, entry: QueueEntry): void {
  const { state } = core;
  tag.unacked.splice(tag.unacked.indexOf(entry), 1);
  const channel = state.channels.get(tag.channel) as ChannelState;
  forget(core, channel, (held) => held.tag === tag.tag && held.order === entry.order);
  channel.consumed += 1;
  core.emit({ type: 'acked', message: entry.message.id, queue: tag.queue, consumer: tag.tag, channel: tag.channel });
  if (tag.cancelled) {
    if (tag.unacked.length === 0) {
      removeTag(core, tag);
    }
    return;
  }
  const queue = state.queues.get(tag.queue) as QueueState;
  unblock(core, queue, tag);
  dispatchQueue(core, queue);
}

/** Starts the next message that a channel has waiting, if it handles messages by itself and is not busy. */
export function pump(core: Core, channel: ChannelState): void {
  const { state } = core;
  const next = channel.waiting[0];
  if (channel.working !== null || next === undefined || channel.processingMs === null) {
    return;
  }
  channel.waiting.shift();
  channel.working = next;
  core.schedule(state.now + channel.processingMs, { kind: 'finish', channel: channel.id, held: next });
}

/** A message reaches a consumer's channel. */
export function onReceive(core: Core, channelId: string, held: Held): void {
  const channel = core.state.channels.get(channelId) as ChannelState;
  channel.received += 1;
  core.emit({ type: 'received', message: held.message.id, queue: held.queue, consumer: held.tag, channel: channelId });
  if (channel.processingMs === null) {
    // A channel that handles nothing by itself holds what it is given until it is told to ack, and has finished with what it need not ack.
    if (held.ack === 'auto') {
      channel.consumed += 1;
    }
    return;
  }
  channel.waiting.push(held);
  pump(core, channel);
}

/** A channel has finished a message: it acknowledges it, if it has to, and starts the next. */
export function onFinish(core: Core, channelId: string, held: Held): void {
  const { state } = core;
  const channel = state.channels.get(channelId) as ChannelState;
  channel.working = null;
  core.emit({ type: 'processed', message: held.message.id, queue: held.queue, consumer: held.tag, channel: channelId });
  if (held.ack === 'manual') {
    const tag = state.tags.get(held.tag) as TagState;
    ackEntry(core, tag, tag.unacked.find((entry) => entry.order === held.order) as QueueEntry);
  } else {
    channel.consumed += 1;
  }
  pump(core, channel);
}

/**
 * Closes a channel: everything that its consumers hold goes back to its queue, redelivered, in the place that it had, and the broker serves the
 * other consumers at once. What was on its way to the channel is called back, and what a consumer that acknowledges by itself had not finished with
 * is lost, because the broker had forgotten it (ADR-0053).
 */
export function closeChannel(core: Core, channel: ChannelState, reason: CloseReason): void {
  const { state } = core;
  const held = channel.tags.flatMap((name) =>
    (state.tags.get(name) as TagState).unacked.map((entry) => ({ name, entry })),
  );
  core.emit({ type: 'channel.closed', channel: channel.id, reason, requeued: held.length });
  state.heap.removeWhere(
    ({ task }) => (task.kind === 'receive' || task.kind === 'finish') && task.channel === channel.id,
  );

  const touched = new Set<QueueState>();
  for (const name of channel.tags) {
    leaveTurn(core, state.tags.get(name) as TagState);
  }
  for (const { name, entry } of held) {
    const tag = state.tags.get(name) as TagState;
    const queue = state.queues.get(tag.queue) as QueueState;
    entry.redelivered = true;
    queue.ready.insert(entry);
    core.emit({ type: 'requeued', message: entry.message.id, queue: queue.name, consumer: name, channel: channel.id });
    touched.add(queue);
  }
  for (const name of channel.tags) {
    state.tags.delete(name);
  }
  state.channels.delete(channel.id);
  for (const queue of touched) {
    dispatchQueue(core, queue);
  }
}

/**
 * Deletes a queue with what it holds. Its consumers are cancelled, and what they held goes with the queue, wherever it is: on its way to them,
 * waiting in their channels, or being handled. What a consumer that acknowledges by itself already has is its own, and it finishes it.
 */
export function deleteQueue(core: Core, queue: QueueState): void {
  const { state } = core;
  const tags = [...state.tags.values()].filter((tag) => tag.queue === queue.name);
  let unacked = 0;
  for (const tag of tags) {
    unacked += tag.unacked.length;
    core.emit({
      type: 'consumer.cancelled',
      consumer: tag.tag,
      channel: tag.channel,
      queue: queue.name,
      reason: 'queue-deleted',
    });
    state.tags.delete(tag.tag);
    const channel = state.channels.get(tag.channel) as ChannelState;
    channel.tags = channel.tags.filter((name) => name !== tag.tag);
    if (tag.ack === 'manual') {
      forget(core, channel, (held) => held.tag === tag.tag);
    }
  }
  const ready = queue.ready.length;
  state.queues.delete(queue.name);
  for (const [signature, binding] of state.bindings) {
    if (binding.destination.kind === 'queue' && binding.destination.name === queue.name) {
      state.bindings.delete(signature);
    }
  }
  state.topology = null;
  core.emit({ type: 'queue.deleted', queue: queue.name, ready, unacked });
}

/** Takes away what a channel has from this tag: what is on its way, what waits, and what is being handled, which lets it start the next. */
function forget(core: Core, channel: ChannelState, gone: (held: Held) => boolean): void {
  core.state.heap.removeWhere(
    ({ task }) => (task.kind === 'receive' || task.kind === 'finish') && task.channel === channel.id && gone(task.held),
  );
  channel.waiting = channel.waiting.filter((held) => !gone(held));
  if (channel.working !== null && gone(channel.working)) {
    channel.working = null;
    pump(core, channel);
  }
}
