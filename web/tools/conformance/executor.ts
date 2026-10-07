import { validateScenario, type Scenario, type Step } from './scenario';
import { BrokerRefusal, type BrokerSession, type Delivery, type Observed, type RecordedRefusal } from './session';

/**
 * Plays a scenario's steps, one at a time, against a session, and returns what the broker did. After every step the
 * session is settled, so the next step starts from a broker that has finished reacting to the last one. That is what
 * makes a recording repeatable without sleeping.
 *
 * A step the broker refuses is recorded and the run carries on, but only if the scenario expected the refusal. A
 * refusal that was not expected, or an expected one that does not come, fails the run: the recording is the broker's
 * answer, and a scenario must say what it is asking about.
 */
export async function runScenario(session: BrokerSession, scenario: Scenario): Promise<Observed> {
  validateScenario(scenario);

  const queues: string[] = [];
  const consumers: string[] = [];
  const publishes: { body: string; returned: boolean }[] = [];
  const refusals: RecordedRefusal[] = [];

  for (const [index, step] of scenario.steps.entries()) {
    const at = `step ${index + 1} (${step.op})`;
    let refusal: BrokerRefusal | undefined;
    try {
      await play(step);
    } catch (error) {
      if (!(error instanceof BrokerRefusal)) {
        throw error;
      }
      refusal = error;
    }

    const expected = 'refused' in step && step.refused === true;
    if (refusal && !expected) {
      const { code, text } = refusal.refusal;
      throw new Error(
        `${at}: the broker refused it with ${code} ${text}. If that is what the scenario is about, mark the step as refused`,
      );
    }
    if (!refusal && expected) {
      throw new Error(`${at}: marked as refused, but the broker accepted it`);
    }
    if (refusal) {
      refusals.push({ step: index + 1, ...refusal.refusal, text: withoutVhost(refusal.refusal.text, session.vhost) });
    }
    await session.settle();
  }

  async function play(step: Step): Promise<void> {
    switch (step.op) {
      case 'exchange.declare':
        await session.declareExchange(step);
        break;
      case 'queue.declare':
        await session.declareQueue(step);
        // A queue that is declared again is the same queue, and is drained once.
        if (!queues.includes(step.name)) {
          queues.push(step.name);
        }
        break;
      case 'bind':
        await session.bind(step);
        break;
      case 'unbind':
        await session.unbind(step);
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
      // Left out, not empty, so that the fixtures of scenarios that nothing refuses read as they always did.
      ...(refusals.length > 0 ? { refusals } : {}),
    };
  }

  const received = session.deliveries();
  return {
    deliveries: Object.fromEntries(consumers.map((consumer) => [consumer, received.get(consumer) ?? []])),
    ready,
  };
}

/**
 * The broker names the vhost in some of its answers (`no exchange 'x' in vhost 'v'`). Every scenario runs in a vhost of
 * its own, named after the scenario, so the name says nothing about the broker and would only tie the recording to
 * the runner. It is written as `/`, the vhost a canvas has unless it says otherwise.
 */
function withoutVhost(text: string, vhost: string): string {
  return text.replaceAll(`'${vhost}'`, "'/'");
}
