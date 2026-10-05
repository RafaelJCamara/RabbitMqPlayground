import type { Step } from './scenario';

/** One message as a consumer received it, or as it was left in a queue. Messages are named by their body. */
export interface Delivery {
  readonly body: string;
  readonly redelivered: boolean;
}

/** What a routing scenario shows: for each publish, whether it came back unroutable and which queues got a copy. */
export interface RoutingObserved {
  readonly routes: readonly { readonly body: string; readonly returned: boolean; readonly queues: readonly string[] }[];
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
 */
export interface BrokerSession {
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
