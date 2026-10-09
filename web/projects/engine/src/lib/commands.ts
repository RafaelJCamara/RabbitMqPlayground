import { bindingSignature, canonicalHeaders } from './bindings';
import type { EngineCommand, ProducerSet } from './command';
import type { Core } from './core';
import { exchangeDifference, queueDifference } from './declaration';
import { createPrng } from './prng';
import { hashWordCount, TOPIC_MAX_HASH_WORDS } from './topic';
import {
  defaultExchangeReply,
  inequivalentReply,
  noExchangeReply,
  noQueueReply,
  RESERVED_NAME_PREFIX,
  reservedNameReply,
  topicWildcardsReply,
  transientQueueReply,
  unknownDeliveryTagReply,
  type BrokerReply,
} from './refusal';
import { routingKeyIssue } from './keys';
import { ackEntry, cancelTag, closeChannel, deleteQueue, dispatchQueue, unblock } from './queues';
import { checkMessage, publishBurst, publishMessage, removeProducer, setProducer } from './publishing';
import { ReadyList } from './ready';
import type { ChannelState, QueueState, TagState } from './state';
import type { Timing } from './view';

/**
 * What each command does to the state (ADR-0052). A command that the broker refuses answers its reply, which the engine turns into a
 * result, and changes nothing but what a closing channel changes (ADR-0050). A command that no client could send, or that names what is not
 * there and a broker would not have been asked about, is a mistake of the caller and throws a `RangeError`.
 */

const wholeNumber = (value: number, name: string, minimum = 0): void => {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a whole number of at least ${minimum}, and ${value} is not`);
  }
};

const checkTiming = (timing: Timing): void => {
  wholeNumber(timing.publishMs, 'publishMs');
  wholeNumber(timing.brokerMs, 'brokerMs');
  wholeNumber(timing.deliverMs, 'deliverMs');
};

function declareExchange(core: Core, command: Extract<EngineCommand, { op: 'exchange.declare' }>): BrokerReply | null {
  const { state } = core;
  if (command.name === '') {
    return defaultExchangeReply();
  }
  if (command.name.startsWith(RESERVED_NAME_PREFIX)) {
    return reservedNameReply('exchange', command.name);
  }
  const there = state.exchanges.get(command.name);
  if (there !== undefined) {
    const difference = exchangeDifference(there, command);
    return difference === null
      ? null
      : inequivalentReply(
          'exchange',
          difference.attribute,
          command.name,
          state.vhost,
          difference.received,
          difference.current,
        );
  }
  state.exchanges.set(command.name, command);
  state.exchangeCounters.set(command.name, { routed: 0, unroutable: 0, refused: 0 });
  state.topology = null;
  return null;
}

function declareQueue(core: Core, command: Extract<EngineCommand, { op: 'queue.declare' }>): BrokerReply | null {
  const { state } = core;
  if (command.name === '') {
    throw new RangeError('A queue needs a name: the simulator does not name queues for a client');
  }
  if (command.name.startsWith(RESERVED_NAME_PREFIX) && command.serverNamed !== true) {
    return reservedNameReply('queue', command.name);
  }
  const there = state.queues.get(command.name);
  if (there !== undefined) {
    const difference = queueDifference(there, command);
    return difference === null
      ? null
      : inequivalentReply(
          'queue',
          difference.attribute,
          command.name,
          state.vhost,
          difference.received,
          difference.current,
        );
  }
  if (!command.durable) {
    return transientQueueReply();
  }
  state.queues.set(command.name, {
    name: command.name,
    durable: command.durable,
    ready: new ReadyList(),
    turn: [],
    blocked: [],
    nextOrder: 1,
    enqueued: 0,
    delivered: 0,
  });
  state.topology = null;
  return null;
}

function deleteExchange(core: Core, name: string): null {
  const { state } = core;
  if (state.exchanges.delete(name)) {
    state.exchangeCounters.delete(name);
    for (const [signature, binding] of state.bindings) {
      if (binding.source === name || (binding.destination.kind === 'exchange' && binding.destination.name === name)) {
        state.bindings.delete(signature);
      }
    }
    state.topology = null;
  }
  return null;
}

type Binding = Extract<EngineCommand, { op: 'bind' | 'unbind' }>;

/** What a client library refuses before it sends anything, and the default exchange, which a broker refuses for a bind and for an unbind. */
function checkBinding(command: Binding): BrokerReply | null {
  const keyIssue = routingKeyIssue(command.key);
  if (keyIssue !== null) {
    throw new RangeError(keyIssue);
  }
  return command.source === '' || (command.destination.kind === 'exchange' && command.destination.name === '')
    ? defaultExchangeReply()
    : null;
}

function bind(core: Core, command: Extract<EngineCommand, { op: 'bind' }>): BrokerReply | null {
  const { state } = core;
  const refusal = checkBinding(command);
  if (refusal !== null) {
    return refusal;
  }
  const source = state.exchanges.get(command.source);
  if (source === undefined) {
    return noExchangeReply(command.source, state.vhost);
  }
  const { destination } = command;
  if (destination.kind === 'queue' ? !state.queues.has(destination.name) : !state.exchanges.has(destination.name)) {
    return destination.kind === 'queue'
      ? noQueueReply(destination.name, state.vhost)
      : noExchangeReply(destination.name, state.vhost);
  }
  if (source.type === 'topic' && hashWordCount(command.key) > TOPIC_MAX_HASH_WORDS) {
    return topicWildcardsReply(command.key, hashWordCount(command.key));
  }
  // A binding that is there already is written again as it is, and keeps its place.
  const headers = canonicalHeaders(command.headers);
  state.bindings.set(
    bindingSignature(command.source, destination.kind, destination.name, command.key, command.headers),
    {
      source: command.source,
      destination,
      key: command.key,
      ...(headers === undefined ? {} : { headers }),
    },
  );
  state.topology = null;
  return null;
}

function unbind(core: Core, command: Extract<EngineCommand, { op: 'unbind' }>): BrokerReply | null {
  const refusal = checkBinding(command);
  if (refusal !== null) {
    return refusal;
  }
  const { destination } = command;
  if (
    core.state.bindings.delete(
      bindingSignature(command.source, destination.kind, destination.name, command.key, command.headers),
    )
  ) {
    core.state.topology = null;
  }
  return null;
}

function purge(core: Core, name: string): BrokerReply | null {
  const queue = core.state.queues.get(name);
  if (queue === undefined) {
    return noQueueReply(name, core.state.vhost);
  }
  const count = queue.ready.clear();
  if (count > 0) {
    core.emit({ type: 'queue.purged', queue: name, count });
  }
  return null;
}

function channelOf(core: Core, id: string): ChannelState {
  const channel = core.state.channels.get(id);
  if (channel === undefined) {
    throw new RangeError(`There is no open channel "${id}"`);
  }
  return channel;
}

function checkChannel(prefetch: number | undefined, processingMs: number | null | undefined): void {
  if (prefetch !== undefined) {
    wholeNumber(prefetch, 'prefetch');
  }
  if (processingMs !== undefined && processingMs !== null) {
    wholeNumber(processingMs, 'processingMs');
  }
}

function openChannel(core: Core, command: Extract<EngineCommand, { op: 'channel.open' }>): null {
  const { state } = core;
  if (state.channels.has(command.channel)) {
    throw new RangeError(`The channel "${command.channel}" is open already`);
  }
  checkChannel(command.prefetch, command.processingMs);
  state.channels.set(command.channel, {
    id: command.channel,
    prefetch: command.prefetch ?? 0,
    processingMs: command.processingMs ?? null,
    tags: [],
    waiting: [],
    working: null,
    received: 0,
    consumed: 0,
  });
  return null;
}

/** A change of prefetch applies to every consumer of the channel at once, and a consumer that has room again is served (ADR-0053). */
function setChannel(core: Core, command: Extract<EngineCommand, { op: 'channel.set' }>): null {
  const { state } = core;
  const channel = channelOf(core, command.channel);
  checkChannel(command.prefetch, command.processingMs);
  if (command.processingMs !== undefined) {
    channel.processingMs = command.processingMs;
  }
  if (command.prefetch !== undefined) {
    channel.prefetch = command.prefetch;
    const queues = new Set<QueueState>();
    for (const name of channel.tags) {
      const tag = state.tags.get(name) as TagState;
      const queue = state.queues.get(tag.queue) as QueueState;
      unblock(core, queue, tag);
      queues.add(queue);
    }
    for (const queue of queues) {
      dispatchQueue(core, queue);
    }
  }
  return null;
}

function consume(core: Core, command: Extract<EngineCommand, { op: 'basic.consume' }>): BrokerReply | null {
  const { state } = core;
  const channel = channelOf(core, command.channel);
  if (state.tags.has(command.consumer)) {
    throw new RangeError(`The consumer "${command.consumer}" is consuming already`);
  }
  const queue = state.queues.get(command.queue);
  if (queue === undefined) {
    const reply = noQueueReply(command.queue, state.vhost);
    closeChannel(core, channel, { kind: 'refused', code: reply.code, text: reply.text });
    return reply;
  }
  state.tags.set(command.consumer, {
    tag: command.consumer,
    channel: command.channel,
    queue: command.queue,
    ack: command.ack,
    unacked: [],
    cancelled: false,
  });
  channel.tags.push(command.consumer);
  queue.turn.push(command.consumer);
  dispatchQueue(core, queue);
  return null;
}

function cancel(core: Core, consumer: string): null {
  const tag = core.state.tags.get(consumer);
  if (tag !== undefined && !tag.cancelled) {
    cancelTag(core, tag);
  }
  return null;
}

function ack(core: Core, command: Extract<EngineCommand, { op: 'basic.ack' }>): BrokerReply | null {
  const tag = core.state.tags.get(command.consumer);
  const entry =
    command.message === undefined
      ? tag?.unacked[0]
      : tag?.unacked.find((candidate) => candidate.message.id === command.message);
  if (tag === undefined || entry === undefined) {
    const reply = unknownDeliveryTagReply(command.message ?? 0);
    if (tag !== undefined) {
      closeChannel(core, channelOf(core, tag.channel), { kind: 'refused', code: reply.code, text: reply.text });
    }
    return reply;
  }
  ackEntry(core, tag, entry);
  return null;
}

function setConfiguration(core: Core, command: Extract<EngineCommand, { op: 'sim.configure' }>): null {
  const { state } = core;
  checkTiming(command.timing);
  if (command.seed !== state.seed) {
    state.prng = createPrng(command.seed);
    state.seed = command.seed;
  }
  state.timing = command.timing;
  return null;
}

function checkProducer(command: ProducerSet): void {
  checkMessage(command.key, command.headers);
  wholeNumber(command.burst, 'burst', 1);
  wholeNumber(command.everyMs, 'everyMs', 1);
}

/** Takes every message out, wherever it is, and lets every consumer that was waiting for room be served again. */
function clearMessages(core: Core): null {
  const { state } = core;
  let travelling = 0;
  for (const { task } of state.heap.values()) {
    // A copy that a consumer holds without acknowledging is counted where it is held, and one that a consumer that acknowledges by itself is
    // being given is counted here, because the broker has let go of it.
    if (task.kind === 'arrive' || (task.kind === 'receive' && task.held.ack === 'auto')) {
      travelling += 1;
    } else if (task.kind === 'enqueue') {
      travelling += task.paths.length;
    }
  }
  state.heap.removeWhere(
    ({ task }) =>
      task.kind === 'arrive' || task.kind === 'enqueue' || task.kind === 'receive' || task.kind === 'finish',
  );
  let ready = 0;
  for (const queue of state.queues.values()) {
    ready += queue.ready.clear();
    queue.turn.push(...queue.blocked);
    queue.blocked = [];
  }
  let unacked = 0;
  for (const tag of state.tags.values()) {
    unacked += tag.unacked.length;
    tag.unacked = [];
  }
  let buffered = 0;
  for (const channel of state.channels.values()) {
    buffered += [...channel.waiting, ...(channel.working === null ? [] : [channel.working])].filter(
      (held) => held.ack === 'auto',
    ).length;
    channel.waiting = [];
    channel.working = null;
  }
  // A cancelled consumer has nothing left to hold, so it is gone too.
  for (const tag of [...state.tags.values()]) {
    if (tag.cancelled) {
      state.tags.delete(tag.tag);
      const channel = state.channels.get(tag.channel) as ChannelState;
      channel.tags = channel.tags.filter((name) => name !== tag.tag);
    }
  }
  if (travelling + ready + unacked + buffered > 0) {
    core.emit({ type: 'cleared', travelling, ready, unacked, buffered });
  }
  return null;
}

function resetCounters(core: Core): null {
  const { state } = core;
  let counted = state.published;
  state.published = 0;
  for (const producer of state.producers.values()) {
    counted += producer.published;
    producer.published = 0;
  }
  for (const counters of state.exchangeCounters.values()) {
    counted += counters.routed + counters.unroutable + counters.refused;
    counters.routed = 0;
    counters.unroutable = 0;
    counters.refused = 0;
  }
  for (const queue of state.queues.values()) {
    counted += queue.enqueued + queue.delivered;
    queue.enqueued = 0;
    queue.delivered = 0;
  }
  for (const channel of state.channels.values()) {
    counted += channel.received + channel.consumed;
    channel.received = 0;
    channel.consumed = 0;
  }
  if (counted > 0) {
    core.emit({ type: 'counters.reset' });
  }
  return null;
}

/** Applies one command. Answers the broker's reply when it refuses it. */
export function runCommand(core: Core, command: EngineCommand): BrokerReply | null {
  const { state } = core;
  switch (command.op) {
    case 'exchange.declare':
      return declareExchange(core, command);
    case 'exchange.delete':
      return deleteExchange(core, command.name);
    case 'queue.declare':
      return declareQueue(core, command);
    case 'queue.delete': {
      const queue = state.queues.get(command.name);
      if (queue !== undefined) {
        deleteQueue(core, queue);
      }
      return null;
    }
    case 'bind':
      return bind(core, command);
    case 'unbind':
      return unbind(core, command);
    case 'queue.purge':
      return purge(core, command.name);
    case 'channel.open':
      return openChannel(core, command);
    case 'channel.set':
      return setChannel(core, command);
    case 'channel.close':
      closeChannel(core, channelOf(core, command.channel), { kind: 'closed' });
      return null;
    case 'basic.consume':
      return consume(core, command);
    case 'basic.cancel':
      return cancel(core, command.consumer);
    case 'basic.ack':
      return ack(core, command);
    case 'basic.publish': {
      const key = command.key ?? '';
      const headers = command.headers ?? [];
      checkMessage(key, headers);
      publishMessage(core, { producer: null, exchange: command.exchange, key, headers, payload: command.body ?? '' });
      return null;
    }
    case 'producer.set':
      checkProducer(command);
      setProducer(core, command);
      return null;
    case 'producer.remove':
      removeProducer(core, command.producer);
      return null;
    case 'producer.publish': {
      const producer = state.producers.get(command.producer);
      if (producer === undefined) {
        throw new RangeError(`There is no producer "${command.producer}"`);
      }
      publishBurst(core, producer);
      return null;
    }
    case 'sim.configure':
      return setConfiguration(core, command);
    case 'sim.clearMessages':
      return clearMessages(core);
    case 'sim.resetCounters':
      return resetCounters(core);
  }
}
