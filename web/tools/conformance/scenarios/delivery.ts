import type { Scenario } from '../scenario';
import { publish } from './helpers';

/**
 * Seed delivery scenarios, including the two bugs of the original simulator that this project is a regression test
 * for (ADR-0002, ADR-0015). Messages are published through the default exchange, with the queue name as the key.
 */
export const DELIVERY_SCENARIOS: readonly Scenario[] = [
  {
    id: 'delivery/round-robin-between-consumers',
    kind: 'delivery',
    title: 'Messages are dealt out to the consumers of a queue in turn (ADR-0008, rule 14)',
    steps: [
      { op: 'queue.declare', name: 'work' },
      { op: 'channel.open', channel: 'ch1' },
      { op: 'channel.open', channel: 'ch2' },
      { op: 'basic.consume', channel: 'ch1', queue: 'work', consumer: 'c1', ack: 'auto' },
      { op: 'basic.consume', channel: 'ch2', queue: 'work', consumer: 'c2', ack: 'auto' },
      publish('', 'work', 'm1'),
      publish('', 'work', 'm2'),
      publish('', 'work', 'm3'),
      publish('', 'work', 'm4'),
      { op: 'await.deliveries', count: 4 },
    ],
  },
  {
    id: 'delivery/prefetch-holds-messages-back-until-an-ack',
    kind: 'delivery',
    title: 'A consumer with a full prefetch window gets nothing more until it acknowledges (ADR-0008, rules 14 and 15)',
    steps: [
      { op: 'queue.declare', name: 'work' },
      { op: 'channel.open', channel: 'ch1', prefetch: 2 },
      { op: 'channel.open', channel: 'ch2', prefetch: 1 },
      { op: 'basic.consume', channel: 'ch1', queue: 'work', consumer: 'c1', ack: 'manual' },
      { op: 'basic.consume', channel: 'ch2', queue: 'work', consumer: 'c2', ack: 'manual' },
      publish('', 'work', 'm1'),
      publish('', 'work', 'm2'),
      publish('', 'work', 'm3'),
      publish('', 'work', 'm4'),
      publish('', 'work', 'm5'),
      { op: 'await.deliveries', count: 3 },
      { op: 'basic.ack', consumer: 'c2' },
      { op: 'await.deliveries', count: 4 },
    ],
  },
  {
    id: 'delivery/issue-10-a-message-goes-to-one-consumer-only',
    kind: 'delivery',
    title: 'With two consumers on a queue, the first message goes to exactly one of them',
    origin: 'RabbitMQSimulator/RabbitMQSimulator#10',
    steps: [
      { op: 'queue.declare', name: 'jobs' },
      { op: 'channel.open', channel: 'ch1' },
      { op: 'channel.open', channel: 'ch2' },
      { op: 'basic.consume', channel: 'ch1', queue: 'jobs', consumer: 'c1', ack: 'auto' },
      { op: 'basic.consume', channel: 'ch2', queue: 'jobs', consumer: 'c2', ack: 'auto' },
      publish('', 'jobs', 'm1'),
      { op: 'await.deliveries', count: 1 },
      publish('', 'jobs', 'm2'),
      { op: 'await.deliveries', count: 2 },
    ],
  },
  {
    id: 'delivery/issue-18-a-removed-consumer-gets-nothing-more',
    kind: 'delivery',
    title:
      'Removing a consumer closes its channel: its unacked message is requeued as redelivered, and nothing else reaches it',
    origin: 'RabbitMQSimulator/RabbitMQSimulator#18',
    steps: [
      { op: 'queue.declare', name: 'jobs' },
      { op: 'channel.open', channel: 'ch1', prefetch: 1 },
      { op: 'channel.open', channel: 'ch2', prefetch: 1 },
      { op: 'basic.consume', channel: 'ch1', queue: 'jobs', consumer: 'c1', ack: 'manual' },
      { op: 'basic.consume', channel: 'ch2', queue: 'jobs', consumer: 'c2', ack: 'manual' },
      publish('', 'jobs', 'm1'),
      publish('', 'jobs', 'm2'),
      publish('', 'jobs', 'm3'),
      { op: 'await.deliveries', count: 2 },
      { op: 'channel.close', channel: 'ch1' },
      publish('', 'jobs', 'm4'),
      { op: 'basic.ack', consumer: 'c2' },
      { op: 'await.deliveries', count: 3 },
    ],
  },
  {
    id: 'delivery/cancel-keeps-unacked-messages',
    kind: 'delivery',
    title:
      'Cancelling a consumer does not requeue its unacked messages, and it can still acknowledge them (ADR-0008, rule 16)',
    steps: [
      { op: 'queue.declare', name: 'jobs' },
      { op: 'channel.open', channel: 'ch1', prefetch: 1 },
      { op: 'basic.consume', channel: 'ch1', queue: 'jobs', consumer: 'c1', ack: 'manual' },
      publish('', 'jobs', 'm1'),
      publish('', 'jobs', 'm2'),
      { op: 'await.deliveries', count: 1 },
      { op: 'basic.cancel', consumer: 'c1' },
      { op: 'basic.ack', consumer: 'c1' },
    ],
  },
];
