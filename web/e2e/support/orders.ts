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
