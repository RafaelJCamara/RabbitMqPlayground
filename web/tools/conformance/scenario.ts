/**
 * The vocabulary of conformance scenarios (M1 plan, section 5). A scenario is a list of steps that is played against a
 * real RabbitMQ to record what it does, and later against the engine to check that the engine does the same. It is
 * plain JSON, so the steps live inside the fixtures next to what the broker did.
 *
 * The steps follow the engine's command names (`exchange.declare`, `basic.publish`, …), so the engine can replay them.
 */

export type XMatch = 'all' | 'any' | 'all-with-x' | 'any-with-x';

/** A header value is always tagged, because JSON cannot tell `1` from `1.0` (ADR-0009). */
export type HeaderValue =
  | { readonly t: 'string'; readonly v: string }
  /** `width` is the AMQP integer size in bits. Left out, the client picks the smallest that fits. */
  | { readonly t: 'integer'; readonly v: number; readonly width?: 8 | 16 | 32 | 64 }
  | { readonly t: 'float'; readonly v: number }
  | { readonly t: 'boolean'; readonly v: boolean };

/** What a headers binding asks of a header: a value to equal, or only that the header is present. */
export type HeaderCondition = HeaderValue | { readonly t: 'exists' };

export interface HeaderEntry<V> {
  readonly key: string;
  readonly value: V;
}

export type ExchangeType = 'direct' | 'fanout' | 'topic' | 'headers';

export interface Destination {
  readonly kind: 'queue' | 'exchange';
  readonly name: string;
}

/**
 * A step that the broker may refuse. A refusal is an answer the broker gives, not a failure of the run: it closes the
 * channel the step was sent on (or, for the one refusal that is about a deprecated feature, the whole connection), and
 * the recording keeps the reply code and text. `refused: true` says that this is what the scenario is about. A step
 * without it is expected to be accepted, and a refusal there fails the run, so a scenario cannot hide a surprise.
 * The same holds the other way round: a step marked as refused that the broker accepts fails the run too.
 */
interface Refusable {
  readonly refused?: true;
}

export type Step =
  | ({
      readonly op: 'exchange.declare';
      readonly name: string;
      readonly type: ExchangeType;
      readonly durable?: boolean;
      readonly autoDelete?: boolean;
      /** An internal exchange cannot be published to by a client, but other exchanges can still route through it. */
      readonly internal?: boolean;
    } & Refusable)
  /**
   * RabbitMQ 4.3 refuses a queue that is neither durable nor exclusive, so a scenario either leaves `durable` out (a
   * durable queue) or says `durable: false` together with `exclusive: true`, or expects the refusal.
   */
  | ({
      readonly op: 'queue.declare';
      readonly name: string;
      readonly durable?: boolean;
      /** An exclusive queue belongs to the connection that declared it, and goes when that connection closes. */
      readonly exclusive?: boolean;
    } & Refusable)
  | ({
      readonly op: 'bind';
      readonly source: string;
      readonly destination: Destination;
      readonly key?: string;
      /** For a headers exchange. `xMatch: null` leaves `x-match` out, which the broker treats as `all`. */
      readonly headers?: { readonly xMatch: XMatch | null; readonly args: readonly HeaderEntry<HeaderCondition>[] };
    } & Refusable)
  | ({
      /** Always published as `mandatory`, so an unroutable message comes back instead of vanishing. */
      readonly op: 'basic.publish';
      readonly exchange: string;
      readonly key?: string;
      readonly headers?: readonly HeaderEntry<HeaderValue>[];
      /**
       * Also the message's identity: it is unique among the messages a scenario publishes and the broker accepts, and
       * the observations name messages by it. A refused publish is not observed as a message, so it may reuse a body.
       */
      readonly body: string;
    } & Refusable)
  | { readonly op: 'channel.open'; readonly channel: string; readonly prefetch?: number }
  | {
      readonly op: 'basic.consume';
      readonly channel: string;
      readonly queue: string;
      readonly consumer: string;
      readonly ack: 'auto' | 'manual';
    }
  | { readonly op: 'basic.cancel'; readonly consumer: string }
  /**
   * Acknowledges a message the consumer has received and not yet acknowledged: the one with this `body`, or, when it is
   * left out, the oldest. Leaving it out keeps a scenario from depending on which message the broker handed this consumer.
   */
  | { readonly op: 'basic.ack'; readonly consumer: string; readonly body?: string }
  | { readonly op: 'channel.close'; readonly channel: string }
  /** Waits until this many messages have been delivered to consumers in total. A count-based wait, never a sleep. */
  | { readonly op: 'await.deliveries'; readonly count: number };

export type ScenarioKind = 'routing' | 'delivery';

export interface Scenario {
  /** `routing/<name>` or `delivery/<name>`. It is also the path of the fixture below the baseline folder. */
  readonly id: string;
  readonly kind: ScenarioKind;
  readonly title: string;
  /** Where the case comes from, for example the original simulator's issue it is a regression test for. */
  readonly origin?: string;
  readonly steps: readonly Step[];
}

export class ScenarioError extends Error {
  constructor(scenarioId: string, message: string) {
    super(`Scenario ${scenarioId}: ${message}`);
    this.name = 'ScenarioError';
  }
}

const ID = /^(routing|delivery)\/[a-z0-9]+(-[a-z0-9]+)*$/;
const ROUTING_OPS = new Set<Step['op']>(['exchange.declare', 'queue.declare', 'bind', 'basic.publish']);

/**
 * Checks that a scenario is well formed: the id fits the kind, every name a step uses was declared before, names are
 * not declared twice, bodies are unique, and a routing scenario uses only routing steps. A scenario that is wrong
 * should fail here, with a message, not as a confusing broker error in CI.
 *
 * The checks about names and what the broker accepts apply to a step that is expected to be accepted. A step marked
 * `refused` is expected to fail in one of those ways, so they are left out for it, and what it names is not counted as
 * declared, because the broker did not create it. Only a routing scenario may expect a refusal, because that is where
 * the broker's refusals are (a delivery scenario that gets one has gone wrong).
 */
export function validateScenario(scenario: Scenario): void {
  const fail = (message: string): never => {
    throw new ScenarioError(scenario.id, message);
  };

  const match = ID.exec(scenario.id);
  if (!match || match[1] !== scenario.kind) {
    fail(`the id must be "${scenario.kind}/<kebab-case name>"`);
  }
  if (scenario.title.trim() === '') {
    fail('it needs a title');
  }
  if (scenario.steps.length === 0) {
    fail('it has no steps');
  }

  const exchanges = new Set<string>(['']); // the default exchange always exists
  const internalExchanges = new Set<string>();
  const queues = new Set<string>();
  const channels = new Set<string>();
  const closedChannels = new Set<string>();
  const consumers = new Map<string, string>(); // consumer -> channel
  const bodies = new Set<string>();

  scenario.steps.forEach((step, index) => {
    const at = `step ${index + 1} (${step.op})`;
    if (scenario.kind === 'routing' && !ROUTING_OPS.has(step.op)) {
      fail(`${at}: a routing scenario cannot use ${step.op}`);
    }

    // The step may come from a fixture file, so what is there is checked and not trusted to be `true` or absent.
    const flag = (step as { readonly refused?: unknown }).refused;
    if (flag !== undefined && flag !== true) {
      fail(`${at}: "refused" can only be true. Leave it out for a step that the broker accepts`);
    }
    if (flag === true && !ROUTING_OPS.has(step.op)) {
      fail(`${at}: ${step.op} cannot be marked as refused`);
    }
    if (flag === true && scenario.kind !== 'routing') {
      fail(`${at}: a delivery scenario cannot expect a refusal`);
    }
    const refused = flag === true;

    switch (step.op) {
      case 'exchange.declare':
        if (!refused) {
          if (step.name === '' || step.name.startsWith('amq.')) {
            fail(`${at}: "${step.name}" is not a name a client may declare`);
          }
          if (exchanges.has(step.name)) {
            fail(`${at}: exchange "${step.name}" is declared twice`);
          }
          exchanges.add(step.name);
          if (step.internal === true) {
            internalExchanges.add(step.name);
          }
        }
        break;
      case 'queue.declare':
        if (!refused) {
          if (step.name === '' || queues.has(step.name)) {
            fail(`${at}: queue "${step.name}" is empty or declared twice`);
          }
          if (step.name.startsWith('amq.')) {
            fail(`${at}: "${step.name}" is not a name a client may declare`);
          }
          if (step.durable === false && step.exclusive !== true) {
            fail(
              `${at}: RabbitMQ 4.3 refuses queue "${step.name}", which is neither durable nor exclusive. Make it durable, or expect the refusal`,
            );
          }
          queues.add(step.name);
        }
        break;
      case 'bind':
        if (!refused) {
          if (step.source === '' || !exchanges.has(step.source)) {
            fail(`${at}: the source exchange "${step.source}" is not declared`);
          }
          if (step.destination.kind === 'exchange' && step.destination.name === '') {
            fail(`${at}: the default exchange cannot be the destination of a binding`);
          }
          if (
            step.destination.kind === 'queue'
              ? !queues.has(step.destination.name)
              : !exchanges.has(step.destination.name)
          ) {
            fail(`${at}: the destination ${step.destination.kind} "${step.destination.name}" is not declared`);
          }
        }
        break;
      case 'basic.publish':
        if (!refused) {
          if (!exchanges.has(step.exchange)) {
            fail(`${at}: exchange "${step.exchange}" is not declared`);
          }
          if (internalExchanges.has(step.exchange)) {
            fail(
              `${at}: exchange "${step.exchange}" is internal, so the broker refuses a publish to it. Expect the refusal`,
            );
          }
          if (bodies.has(step.body)) {
            fail(`${at}: the body "${step.body}" is used twice, so the observations could not tell the messages apart`);
          }
          bodies.add(step.body);
        }
        break;
      case 'channel.open':
        if (channels.has(step.channel)) {
          fail(`${at}: channel "${step.channel}" is opened twice`);
        }
        channels.add(step.channel);
        break;
      case 'basic.consume':
        if (!channels.has(step.channel) || closedChannels.has(step.channel)) {
          fail(`${at}: channel "${step.channel}" is not open`);
        }
        if (!queues.has(step.queue)) {
          fail(`${at}: queue "${step.queue}" is not declared`);
        }
        if (consumers.has(step.consumer)) {
          fail(`${at}: consumer "${step.consumer}" is used twice`);
        }
        consumers.set(step.consumer, step.channel);
        break;
      case 'basic.cancel':
        if (!consumers.has(step.consumer)) {
          fail(`${at}: consumer "${step.consumer}" does not exist`);
        }
        break;
      case 'basic.ack':
        if (!consumers.has(step.consumer)) {
          fail(`${at}: consumer "${step.consumer}" does not exist`);
        }
        break;
      case 'channel.close':
        if (!channels.has(step.channel) || closedChannels.has(step.channel)) {
          fail(`${at}: channel "${step.channel}" is not open`);
        }
        closedChannels.add(step.channel);
        break;
      case 'await.deliveries':
        if (!Number.isInteger(step.count) || step.count < 1) {
          fail(`${at}: the count must be a positive whole number`);
        }
        break;
    }
  });
}
