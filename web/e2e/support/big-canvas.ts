import type { DocumentCommand } from '@rmq/domain';
import { buildDocument } from './seed';

/**
 * The canvas that the plan sizes the editor for (section 6, ADR-0036): 200 nodes and 500 edges, made with the commands of the domain, so that it
 * is one that the app could hold. 20 producers, 30 exchanges, 100 queues and 50 consumers; each producer is linked to an exchange, each queue
 * is bound from three exchanges, each consumer subscribes to three queues, and each exchange is bound to the next one. Everything is
 * computed from the numbers, so that the canvas is the same every time.
 */

const PRODUCERS = 20;
const EXCHANGES = 30;
const QUEUES = 100;
const CONSUMERS = 50;
const TYPES = ['direct', 'fanout', 'topic'] as const;

export const BIG_NODES = PRODUCERS + EXCHANGES + QUEUES + CONSUMERS;

/** Three different exchanges for a queue, which is what makes three edges into it. */
function exchangesOf(queue: number): number[] {
  const chosen: number[] = [];
  for (const start of [queue % EXCHANGES, (queue * 7 + 3) % EXCHANGES, (queue * 11 + 5) % EXCHANGES]) {
    let exchange = start;
    while (chosen.includes(exchange)) {
      exchange = (exchange + 1) % EXCHANGES;
    }
    chosen.push(exchange);
  }
  return chosen;
}

/** Three different queues for a consumer. */
function queuesOf(consumer: number): number[] {
  const chosen: number[] = [];
  for (const start of [consumer * 2, consumer * 2 + 1, consumer * 3 + 50]) {
    let queue = start % QUEUES;
    while (chosen.includes(queue)) {
      queue = (queue + 1) % QUEUES;
    }
    chosen.push(queue);
  }
  return chosen;
}

const exchange = (index: number): string => `x${index}`;
const queue = (index: number): string => `q${index}`;

export function bigCommands(): DocumentCommand[] {
  const commands: DocumentCommand[] = [];
  for (let index = 0; index < PRODUCERS; index += 1) {
    commands.push({ type: 'add-producer', name: `p${index}` });
  }
  for (let index = 0; index < EXCHANGES; index += 1) {
    commands.push({
      type: 'declare-exchange',
      name: exchange(index),
      exchangeType: TYPES[index % TYPES.length]!,
      durable: true,
      autoDelete: false,
      internal: false,
    });
  }
  for (let index = 0; index < QUEUES; index += 1) {
    commands.push({ type: 'declare-queue', name: queue(index), durable: true });
  }
  for (let index = 0; index < CONSUMERS; index += 1) {
    commands.push({ type: 'add-consumer', name: `c${index}` });
  }
  for (let index = 0; index < PRODUCERS; index += 1) {
    commands.push({ type: 'link', producer: `p${index}`, target: { kind: 'exchange', name: exchange(index) } });
  }
  for (let index = 0; index < QUEUES; index += 1) {
    for (const source of exchangesOf(index)) {
      commands.push({
        type: 'bind',
        source: exchange(source),
        destination: { kind: 'queue', name: queue(index) },
        key: TYPES[source % TYPES.length] === 'fanout' ? '' : `key.${index}`,
      });
    }
  }
  for (let index = 0; index < CONSUMERS; index += 1) {
    for (const subscribed of queuesOf(index)) {
      commands.push({ type: 'subscribe', consumer: `c${index}`, queue: queue(subscribed) });
    }
  }
  for (let index = 0; index < EXCHANGES; index += 1) {
    commands.push({
      type: 'bind',
      source: exchange(index),
      destination: { kind: 'exchange', name: exchange((index + 1) % EXCHANGES) },
      key: TYPES[index % TYPES.length] === 'fanout' ? '' : 'next',
    });
  }
  return commands;
}

export const BIG_CANVAS = buildDocument(bigCommands());

/** How many edges that is: producer links, bindings, subscriptions. */
export const BIG_EDGES = 500;
