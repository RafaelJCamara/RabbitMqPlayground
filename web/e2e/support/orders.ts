import type { DocumentCommand } from '@rmq/domain';
import { buildDocument } from './seed';

/**
 * Canvases for the tests of the simulation, made with the commands of the domain. A producer that repeats starts to send as soon as the canvas is opened, so none of them has one: a
 * test sends what it wants, with a key or a command, and the clock is stopped until it steps it.
 */

const orders: DocumentCommand[] = [
  { type: 'add-producer', name: 'sender' },
  {
    type: 'declare-exchange',
    name: 'orders',
    exchangeType: 'direct',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'add-consumer', name: 'worker' },
  { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'order.new' },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
  { type: 'subscribe', consumer: 'worker', queue: 'billing' },
  { type: 'set', kind: 'producer', name: 'sender', changes: { key: 'order.new', payload: 'hello' } },
  { type: 'set', kind: 'consumer', name: 'worker', changes: { ack: 'manual', prefetch: 1, processingMs: 1_000 } },
];

/**
 * `sender` sends `order.new` to the direct exchange `orders`, which sends it to the queue `billing`, which `worker` takes from, one at a time, a second for each. A message takes
 * 500 ms to get to the broker, 300 ms in it, and 500 ms to get from the queue to the consumer. The ids are `p1`, `x1`, `q1`, `c1` and `b1`, and the edges `p1>x1`, `x1>q1`
 * and `q1>c1`.
 */
export const ORDERS = buildDocument(orders);

/** The same, with a link that takes a minute, so that something is scheduled for as long as a test looks at the clock. The first message gets to the broker at 60,000 ms. */
export const LONG_LEG = buildDocument([...orders, { type: 'set', kind: 'canvas', changes: { publishMs: 60_000 } }]);

/** The same, and a second consumer, `helper`, which takes from the same queue in the same way: the two take turns. Its id is `c2`, and its edge `q1>c2`. */
export const TWO_WORKERS = buildDocument([
  ...orders,
  { type: 'add-consumer', name: 'helper' },
  { type: 'subscribe', consumer: 'helper', queue: 'billing' },
  { type: 'set', kind: 'consumer', name: 'helper', changes: { ack: 'manual', prefetch: 1, processingMs: 1_000 } },
]);

/** `sender` sends straight to the queue `billing`, through the default exchange, and `worker` takes from it. The edges are `p1>q1` and `q1>c1`. */
export const DIRECT_TO_QUEUE = buildDocument([
  { type: 'add-producer', name: 'sender' },
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'add-consumer', name: 'worker' },
  { type: 'link', producer: 'sender', target: { kind: 'queue', name: 'billing' } },
  { type: 'subscribe', consumer: 'worker', queue: 'billing' },
  { type: 'set', kind: 'producer', name: 'sender', changes: { payload: 'hello' } },
  { type: 'set', kind: 'consumer', name: 'worker', changes: { ack: 'manual', prefetch: 1, processingMs: 1_000 } },
]);

/**
 * `ORDERS`, and a second queue, `archive`, bound to `orders` with the key `order.cancelled`, which `order.new` does not match: a message that `sender` sends goes to `billing` and
 * not to `archive`, so that there is a binding that misses. The ids are `q2` and `b2`, and the edge `x1>q2`.
 */
export const WITH_ARCHIVE = buildDocument([
  ...orders,
  { type: 'declare-queue', name: 'archive', durable: true },
  { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'archive' }, key: 'order.cancelled' },
]);

/**
 * `sender` sends `app.error` to the topic exchange `logs`, which has three queues: `errors`, bound with `*.error`, which the key matches; `warnings`, bound with `*.warn`, which it does not, in its second word; and
 * `everything`, bound with `#`. The ids are `p1`, `x1`, `q1`, `q2` and `q3`, and the edges `p1>x1`, `x1>q1`, `x1>q2` and `x1>q3`.
 */
export const TOPICS = buildDocument([
  { type: 'add-producer', name: 'sender' },
  {
    type: 'declare-exchange',
    name: 'logs',
    exchangeType: 'topic',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  { type: 'declare-queue', name: 'errors', durable: true },
  { type: 'declare-queue', name: 'warnings', durable: true },
  { type: 'declare-queue', name: 'everything', durable: true },
  { type: 'bind', source: 'logs', destination: { kind: 'queue', name: 'errors' }, key: '*.error' },
  { type: 'bind', source: 'logs', destination: { kind: 'queue', name: 'warnings' }, key: '*.warn' },
  { type: 'bind', source: 'logs', destination: { kind: 'queue', name: 'everything' }, key: '#' },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'logs' } },
  { type: 'set', kind: 'producer', name: 'sender', changes: { key: 'app.error', payload: 'disk full' } },
]);

/**
 * `sender` sends a message with the headers `format` = "pdf" and `big` = false to the headers exchange `files`, which has two queues: `pdfs`, bound with `x-match` all, `format` = "pdf" and `big` = true, which a
 * message that is not big does not match, and `documents`, bound with `x-match` any and the same two, which it does. The ids are `p1`, `x1`, `q1` and `q2`.
 */
export const HEADERS = buildDocument([
  { type: 'add-producer', name: 'sender' },
  {
    type: 'declare-exchange',
    name: 'files',
    exchangeType: 'headers',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  { type: 'declare-queue', name: 'pdfs', durable: true },
  { type: 'declare-queue', name: 'documents', durable: true },
  {
    type: 'bind',
    source: 'files',
    destination: { kind: 'queue', name: 'pdfs' },
    key: '',
    headers: {
      xMatch: 'all',
      args: [
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'big', value: { t: 'boolean', v: true } },
      ],
    },
  },
  {
    type: 'bind',
    source: 'files',
    destination: { kind: 'queue', name: 'documents' },
    key: '',
    headers: {
      xMatch: 'any',
      args: [
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'big', value: { t: 'boolean', v: true } },
      ],
    },
  },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'files' } },
  {
    type: 'set',
    kind: 'producer',
    name: 'sender',
    changes: {
      payload: 'report.pdf',
      headers: [
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'big', value: { t: 'boolean', v: false } },
      ],
    },
  },
]);
