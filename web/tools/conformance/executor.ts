import { validateScenario, type Scenario } from './scenario';
import type { BrokerSession, Delivery, Observed } from './session';

/**
 * Plays a scenario's steps, one at a time, against a session, and returns what the broker did. After every step the
 * session is settled, so the next step starts from a broker that has finished reacting to the last one. That is what
 * makes a recording repeatable without sleeping.
 */
export async function runScenario(session: BrokerSession, scenario: Scenario): Promise<Observed> {
  validateScenario(scenario);

  const queues: string[] = [];
  const consumers: string[] = [];
  const publishes: { body: string; returned: boolean }[] = [];

  for (const step of scenario.steps) {
    switch (step.op) {
      case 'exchange.declare':
        await session.declareExchange(step);
        break;
      case 'queue.declare':
        await session.declareQueue(step);
        queues.push(step.name);
        break;
      case 'bind':
        await session.bind(step);
        break;
      case 'basic.publish': {
        const { returned } = await session.publish(step);
        publishes.push({ body: step.body, returned });
        break;
      }
      case 'channel.open':
        await session.openChannel(step);
        break;
      case 'basic.consume':
        await session.consume(step);
        consumers.push(step.consumer);
        break;
      case 'basic.cancel':
        await session.cancel(step);
        break;
      case 'basic.ack':
        await session.ack(step);
        break;
      case 'channel.close':
        await session.closeChannel(step);
        break;
      case 'await.deliveries':
        await session.waitForDeliveries(step.count);
        break;
    }
    await session.settle();
  }

  const ready: Record<string, readonly Delivery[]> = {};
  for (const queue of queues) {
    ready[queue] = await session.drain(queue);
  }

  if (scenario.kind === 'routing') {
    return {
      routes: publishes.map(({ body, returned }) => ({
        body,
        returned,
        // A queue that holds the message twice is listed twice, so a duplicate shows up in the fixture.
        queues: queues.flatMap((queue) =>
          (ready[queue] ?? []).filter((message) => message.body === body).map(() => queue),
        ),
      })),
    };
  }

  const received = session.deliveries();
  return {
    deliveries: Object.fromEntries(consumers.map((consumer) => [consumer, received.get(consumer) ?? []])),
    ready,
  };
}
