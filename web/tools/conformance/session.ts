import type { Step } from './scenario';

/** One message as a consumer received it, or as it was left in a queue. Messages are named by their body. */
export interface Delivery {
  readonly body: string;
  readonly redelivered: boolean;
}

/**
 * What the broker answered when it refused a step. It is an answer, not a failure: the broker closes the channel the
 * step was sent on and says why, and the run carries on with a new channel.
 */
export interface Refusal {
  /**
   * What the broker closed. Almost every refusal closes the channel. RabbitMQ 4.3 closes the whole connection when a
   * queue is declared that is neither durable nor exclusive.
   */
  readonly level: 'channel' | 'connection';
  /** The AMQP reply code: 403 ACCESS_REFUSED, 404 NOT_FOUND, 406 PRECONDITION_FAILED, 541 INTERNAL_ERROR, … */
  readonly code: number;
  /** The reply text, as the broker sent it. */
  readonly text: string;
}

/** A refusal that has been seen at a step, and which step it was. */
export interface RecordedRefusal extends Refusal {
  /** Counted from 1, the way a validation message says "step 3". */
  readonly step: number;
}

/**
 * What a session throws when the broker refuses a step. The session is ready for the next step when it does: it has
 * opened a new channel, or connected again, if the broker closed the one it was using.
 */
export class BrokerRefusal extends Error {
  constructor(readonly refusal: Refusal) {
    super(`${refusal.code} ${refusal.text}`);
    this.name = 'BrokerRefusal';
  }
}

/** What a routing scenario shows: for each publish, whether it came back unroutable and which queues got a copy. */
export interface RoutingObserved {
  /** One entry for every publish that the broker accepted, in the order they were sent. */
  readonly routes: readonly { readonly body: string; readonly returned: boolean; readonly queues: readonly string[] }[];
  /** Every step that the broker refused, in order. Left out when there is none. */
  readonly refusals?: readonly RecordedRefusal[];
}

/**
 * What a delivery scenario shows: what each consumer received, in the order it received it, and what was left ready
 * in each queue. Interleaving across consumers is deliberately not recorded, because a real broker does not make it
 * observable (M1 plan, section 5).
 */
export interface DeliveryObserved {
  readonly deliveries: Readonly<Record<string, readonly Delivery[]>>;
  readonly ready: Readonly<Record<string, readonly Delivery[]>>;
}

export type Observed = RoutingObserved | DeliveryObserved;

export type StepOf<Op extends Step['op']> = Extract<Step, { readonly op: Op }>;

/**
 * One scenario's connection to a broker, in its own vhost. The executor speaks only this interface, so everything
 * except the AMQP adapter can be tested without a broker.
 *
 * When the broker refuses what a step asks for, the method throws a `BrokerRefusal`. The executor decides whether
 * the step was expected to be refused.
 */
export interface BrokerSession {
  /** The vhost this session works in. The broker names it in some of its answers. */
  readonly vhost: string;
  declareExchange(step: StepOf<'exchange.declare'>): Promise<void>;
  declareQueue(step: StepOf<'queue.declare'>): Promise<void>;
  bind(step: StepOf<'bind'>): Promise<void>;
  /** Publishes as `mandatory`, waits for the publisher confirm, and says whether the message came back. */
  publish(step: StepOf<'basic.publish'>): Promise<{ readonly returned: boolean }>;
  openChannel(step: StepOf<'channel.open'>): Promise<void>;
  consume(step: StepOf<'basic.consume'>): Promise<void>;
  cancel(step: StepOf<'basic.cancel'>): Promise<void>;
  ack(step: StepOf<'basic.ack'>): Promise<void>;
  closeChannel(step: StepOf<'channel.close'>): Promise<void>;
  /** Resolves when this many messages have been delivered to consumers in total, or rejects when that does not happen. */
  waitForDeliveries(count: number): Promise<void>;
  /** Resolves once the broker has finished what the last step set going and the client has seen the results. */
  settle(): Promise<void>;
  /** What each consumer has received so far, in order. */
  deliveries(): ReadonlyMap<string, readonly Delivery[]>;
  /** Takes every ready message out of a queue, oldest first. */
  drain(queue: string): Promise<readonly Delivery[]>;
  close(): Promise<void>;
}
