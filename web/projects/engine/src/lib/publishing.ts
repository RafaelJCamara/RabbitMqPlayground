import type { ProducerSet } from './command';
import type { Core } from './core';
import type { MessageInfo } from './events';
import { headerValueIssue, type HeaderEntry, type HeaderValue } from './headers';
import { routingKeyIssue } from './keys';
import { dispatchQueue } from './queues';
import { route } from './route';
import type { ExchangeCounters, ProducerState, QueueState, State } from './state';
import type { Topology } from './topology';

/**
 * Publishing: a message leaves a producer or a command, takes `publishMs` to reach the broker, is routed when it gets there, and its copies take
 * `brokerMs` to reach their queues (ADR-0052). A producer that repeats is a task on the heap that publishes and puts the next one back.
 */

/** What `route()` reads, made from the state and kept until a command changes the topology. */
export function topologyOf(state: State): Topology {
  state.topology ??= {
    vhost: state.vhost,
    exchanges: [...state.exchanges.values()].map(({ name, type, internal }) => ({ name, type, internal })),
    queues: [...state.queues.keys()],
    bindings: [...state.bindings.values()],
  };
  return state.topology;
}

/** A message that no client could send is a mistake of the caller, as it is for `route()` (ADR-0050). */
export function checkMessage(key: string, headers: readonly HeaderEntry<HeaderValue>[]): void {
  const keyIssue = routingKeyIssue(key);
  if (keyIssue !== null) {
    throw new RangeError(keyIssue);
  }
  for (const entry of headers) {
    const issue = headerValueIssue(entry.value);
    if (issue !== null) {
      throw new RangeError(`Header "${entry.key}": ${issue}`);
    }
  }
}

export function exchangeCountersOf(state: State, exchange: string): ExchangeCounters | undefined {
  return state.exchangeCounters.get(exchange);
}

export interface Publication {
  readonly producer: string | null;
  readonly exchange: string;
  readonly key: string;
  readonly headers: readonly HeaderEntry<HeaderValue>[];
  readonly payload: string;
}

/** Sends a message. A message that no producer sent is already at the broker. */
export function publishMessage(core: Core, publication: Publication): void {
  const { state } = core;
  const message: MessageInfo = { id: state.nextMessageId, ...publication };
  state.nextMessageId += 1;
  state.published += 1;
  if (publication.producer !== null) {
    (state.producers.get(publication.producer) as ProducerState).published += 1;
  }
  const arrivesAt = state.now + (publication.producer === null ? 0 : state.timing.publishMs);
  core.emit({ type: 'published', message, arrivesAt });
  core.schedule(arrivesAt, { kind: 'arrive', message, sentAt: state.now });
}

/** The message reaches the broker, which routes it as the topology is now. */
export function onArrive(core: Core, message: MessageInfo): void {
  const { state } = core;
  const result = route(topologyOf(state), { exchange: message.exchange, key: message.key, headers: message.headers });
  const counters = exchangeCountersOf(state, message.exchange);
  if (!result.ok) {
    core.emit({
      type: 'refused',
      message: message.id,
      exchange: message.exchange,
      code: result.code,
      text: result.text,
    });
    if (counters !== undefined) {
      counters.refused += 1;
    }
    return;
  }
  const counted = counters as ExchangeCounters;
  if (result.queues.length === 0) {
    counted.unroutable += 1;
    core.emit({ type: 'unroutable', message: message.id, exchange: message.exchange, trace: result.trace });
    return;
  }
  counted.routed += 1;
  const enqueueAt = state.now + state.timing.brokerMs;
  core.emit({
    type: 'routed',
    message: message.id,
    exchange: message.exchange,
    queues: result.queues,
    paths: result.paths,
    trace: result.trace,
    enqueueAt,
  });
  core.schedule(enqueueAt, { kind: 'enqueue', message, paths: result.paths, routedAt: state.now });
}

/** The copies of a message reach their queues, in the order that they were routed, and each queue serves its consumers. */
export function onEnqueue(core: Core, message: MessageInfo, queues: readonly string[]): void {
  const { state } = core;
  for (const name of queues) {
    const queue = state.queues.get(name) as QueueState | undefined;
    if (queue === undefined) {
      core.emit({ type: 'dropped', message: message.id, queue: name });
      continue;
    }
    queue.ready.push({ message, order: queue.nextOrder, redelivered: false });
    queue.nextOrder += 1;
    queue.enqueued += 1;
    core.emit({ type: 'enqueued', message: message.id, queue: name, depth: queue.ready.length });
    dispatchQueue(core, queue);
  }
}

/** A producer sends its message `burst` times, now. It sends nothing when it has nowhere to send it. */
export function publishBurst(core: Core, producer: ProducerState): void {
  const { target } = producer;
  if (target === null) {
    return;
  }
  // A queue is reached through the default exchange, with its name as the routing key.
  const exchange = target.kind === 'queue' ? '' : target.name;
  const key = target.kind === 'queue' ? target.name : producer.key;
  for (let sent = 0; sent < producer.burst; sent += 1) {
    publishMessage(core, {
      producer: producer.id,
      exchange,
      key,
      headers: producer.headers,
      payload: producer.payload,
    });
  }
}

function putTick(core: Core, producer: ProducerState, at: number): void {
  producer.nextTickAt = at;
  core.schedule(at, { kind: 'tick', producer: producer.id });
}

function removeTick(core: Core, producer: ProducerState): void {
  producer.nextTickAt = null;
  core.state.heap.removeWhere(({ task }) => task.kind === 'tick' && task.producer === producer.id);
}

/** A producer that repeats sends again, and puts the next time on the heap. */
export function onTick(core: Core, producerId: string): void {
  const { state } = core;
  const producer = state.producers.get(producerId) as ProducerState;
  producer.lastTickAt = state.now;
  publishBurst(core, producer);
  putTick(core, producer, state.now + producer.everyMs);
}

/**
 * Makes a producer, or changes it. It repeats when it is told to and has somewhere to send to, and the first time is now. A change of how often it
 * repeats moves the time of the next to one interval after the last, and a change of anything else leaves the next where it was.
 */
export function setProducer(core: Core, command: ProducerSet): void {
  const { state } = core;
  const before = state.producers.get(command.producer);
  // What it has counted and when it sends next is kept, and the rest is what the command says.
  const producer: ProducerState = {
    published: 0,
    lastTickAt: 0,
    nextTickAt: null,
    ...before,
    id: command.producer,
    target: command.target,
    key: command.key,
    payload: command.payload,
    headers: command.headers,
    burst: command.burst,
    everyMs: command.everyMs,
    repeat: command.repeat,
  };
  const everyChanged = before !== undefined && before.everyMs !== command.everyMs;
  state.producers.set(command.producer, producer);

  if (!(producer.repeat && producer.target !== null)) {
    removeTick(core, producer);
  } else if (producer.nextTickAt === null) {
    producer.lastTickAt = state.now - producer.everyMs;
    putTick(core, producer, state.now);
  } else if (everyChanged) {
    removeTick(core, producer);
    putTick(core, producer, Math.max(state.now, producer.lastTickAt + producer.everyMs));
  }
}

export function removeProducer(core: Core, producerId: string): void {
  const producer = core.state.producers.get(producerId);
  if (producer !== undefined) {
    removeTick(core, producer);
    core.state.producers.delete(producerId);
  }
}
