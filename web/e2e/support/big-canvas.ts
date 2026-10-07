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
/** The exchanges of the canvas of the headers exchange (S8): every fourth one reads headers. */
const HEADERS_TYPES = [...TYPES, 'headers'] as const;

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

/** The conditions of a binding from a headers exchange: three, of three types, in a mode that changes from one binding to the next, so that the chips are of every length. */
function conditionsOf(index: number) {
  const modes = ['all', 'any', 'all-with-x', 'any-with-x'] as const;
  return {
    xMatch: modes[index % modes.length]!,
    args: [
      { key: 'format', value: { t: 'string', v: index % 2 === 0 ? 'pdf' : 'tiff' } },
      { key: 'size', value: { t: 'integer', v: index } },
      { key: 'x-region', value: { t: 'string', v: 'eu' } },
    ],
  } as const;
}

export function bigCommands(readsHeaders = false): DocumentCommand[] {
  const types = readsHeaders ? HEADERS_TYPES : TYPES;
  const commands: DocumentCommand[] = [];
  for (let index = 0; index < PRODUCERS; index += 1) {
    commands.push({ type: 'add-producer', name: `p${index}` });
  }
  for (let index = 0; index < EXCHANGES; index += 1) {
    commands.push({
      type: 'declare-exchange',
      name: exchange(index),
      exchangeType: types[index % types.length]!,
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
        key:
          types[source % types.length] === 'fanout' || types[source % types.length] === 'headers' ? '' : `key.${index}`,
        ...(types[source % types.length] === 'headers' ? { headers: conditionsOf(index) } : {}),
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
      key: types[index % types.length] === 'fanout' || types[index % types.length] === 'headers' ? '' : 'next',
      ...(types[index % types.length] === 'headers' ? { headers: conditionsOf(index) } : {}),
    });
  }
  if (readsHeaders) {
    commands.push(
      ...gridOf(
        ['producer', PRODUCERS, 'p'],
        ['exchange', EXCHANGES, 'x'],
        ['queue', QUEUES, 'q'],
        ['consumer', CONSUMERS, 'c'],
      ),
    );
  }
  return commands;
}

/**
 * Where the nodes of the canvas of the headers exchange are: twenty to a row, in the order that they were made, a node of 160 and a gap of 160 across and 84 of room down. The nodes that a canvas
 * makes for itself are in a long line, which the canvas fits at three percent, where a node is a speck that a press does not find.
 */
function gridOf(
  ...groups: readonly (readonly ['producer' | 'exchange' | 'queue' | 'consumer', number, string])[]
): DocumentCommand[] {
  const moves: DocumentCommand[] = [];
  let at = 0;
  for (const [kind, count, prefix] of groups) {
    for (let index = 0; index < count; index += 1, at += 1) {
      moves.push({
        type: 'move',
        target: { kind, name: `${prefix}${index}` },
        x: (at % 20) * 320,
        y: Math.floor(at / 20) * 140,
      });
    }
  }
  return moves;
}

export const BIG_CANVAS = buildDocument(bigCommands());

/**
 * The same canvas, with every fourth exchange a headers exchange, whose bindings have conditions: the labels of a hundred edges are chips of a mode and three conditions, and the editor of a binding has
 * a table of recent messages to draw. The producer `p3` publishes to the headers exchange `x3`.
 */
export const BIG_HEADERS_CANVAS = buildDocument(bigCommands(true));

/** How many edges that is: producer links, bindings, subscriptions. */
export const BIG_EDGES = 500;
