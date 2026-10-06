import { buildDocument } from './seed';

/**
 * A canvas for the tests that need one with something on it, made with the commands of the domain: one of each kind of node, an
 * internal exchange, and an edge of each kind. Its ids are `p1`, `x1`, `x2`, `q1` and `c1`.
 */
export const TOPOLOGY = buildDocument([
  { type: 'add-producer', name: 'sender' },
  {
    type: 'declare-exchange',
    name: 'orders',
    exchangeType: 'topic',
    durable: true,
    autoDelete: false,
    internal: false,
  },
  {
    type: 'declare-exchange',
    name: 'hidden',
    exchangeType: 'fanout',
    durable: true,
    autoDelete: false,
    internal: true,
  },
  { type: 'declare-queue', name: 'billing', durable: true },
  { type: 'add-consumer', name: 'worker' },
  { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'order.*' },
  { type: 'bind', source: 'orders', destination: { kind: 'exchange', name: 'hidden' }, key: '#' },
  { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
  { type: 'subscribe', consumer: 'worker', queue: 'billing' },
]);
export const EDGES = ['p1>x1', 'x1>q1', 'x1>x2', 'q1>c1'];
export const NODES = ['p1', 'x1', 'x2', 'q1', 'c1'];
