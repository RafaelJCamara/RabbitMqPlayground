import { connect, type Channel, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { bindingArguments, messageHeaders } from './headers';
import { BrokerRefusal, type BrokerSession, type Delivery, type Refusal, type StepOf } from './session';

/**
 * The AMQP side of a conformance session, on amqplib. It is the one part of the runner that needs a real broker, so it
 * is kept thin: everything that decides what a scenario means is in executor.ts, which has specs.
 *
 * How it stays repeatable without sleeping:
 * - every publish waits for the publisher confirm, and a `mandatory` return arrives before its confirm;
 * - after every step `settle()` asks each queue a synchronous question, so the queue has handled everything sent to it
 *   before the answer comes back, and then asks each consumer channel one, so every delivery the broker already sent has
 *   reached the client;
 * - waiting for deliveries is by count (`waitForDeliveries`), never by time.
 *
 * When the broker refuses a step it closes the channel (or the connection) that the step used, and says why. The
 * session reports that as a `BrokerRefusal`, after it has opened a new channel or connected again, so the scenario can
 * carry on.
 */

export interface AmqpTarget {
  readonly hostname: string;
  readonly port: number;
  readonly vhost: string;
  readonly username: string;
  readonly password: string;
}

const DELIVERY_TIMEOUT_MS = 20_000;

/** amqplib puts the broker's reason for closing in the error's message, as `… with message "<reply text>"`. */
const REPLY_TEXT = /with message "([\s\S]*)"$/;

/**
 * The refusal that an error from amqplib stands for, or `undefined` when it is something else, such as a socket failure
 * or a mistake in how the client was used. When the broker closes a channel or the connection, amqplib sets `code` to the
 * AMQP reply code and puts the reply text in the message.
 */
export function refusalFrom(level: Refusal['level'], error: unknown): Refusal | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  const text = REPLY_TEXT.exec(error.message)?.[1];
  return typeof code === 'number' && text !== undefined ? { level, code, text } : undefined;
}

function openConnection(target: AmqpTarget): Promise<ChannelModel> {
  return connect({
    protocol: 'amqp',
    hostname: target.hostname,
    port: target.port,
    username: target.username,
    password: target.password,
    vhost: target.vhost,
  });
}

interface ConsumerState {
  readonly channelName: string;
  readonly channel: Channel;
  /** Received and not yet acknowledged, oldest first. Only for manual acknowledgement. */
  readonly unacked: ConsumeMessage[];
}

export class AmqpSession implements BrokerSession {
  readonly vhost: string;
  private readonly queues: string[] = [];
  /** Exclusive queues go when their connection does, which a refusal that closes the connection would do. */
  private readonly exclusive = new Set<string>();
  private readonly channels = new Map<string, Channel>();
  private readonly consumers = new Map<string, ConsumerState>();
  private readonly received = new Map<string, Delivery[]>();
  private readonly returned = new Set<string>();
  private readonly waiters = new Set<{ readonly count: number; readonly wake: () => void }>();
  private total = 0;
  private failure: Error | undefined;
  /** What the broker said when it last closed the connection or the control channel, until a step has taken it. */
  private closedWith: Refusal | undefined;

  private constructor(
    private readonly target: AmqpTarget,
    private connection: ChannelModel,
    private control: ConfirmChannel,
    private readonly onClose?: () => Promise<void>,
  ) {
    this.vhost = target.vhost;
    this.watchConnection(connection);
    this.watchControl(control);
  }

  /** `onClose` runs after the connection is closed, for example to delete the vhost that the session used. */
  static async connect(target: AmqpTarget, onClose?: () => Promise<void>): Promise<AmqpSession> {
    const connection = await openConnection(target);
    return new AmqpSession(target, connection, await connection.createConfirmChannel(), onClose);
  }

  /** A close that the broker explains is a refusal, which the step that caused it reports. Anything else ends the run. */
  private closedByBroker(level: Refusal['level']): (error: Error) => void {
    return (error) => {
      const refusal = refusalFrom(level, error);
      if (refusal) {
        this.closedWith ??= refusal;
      } else {
        this.fail(error);
      }
    };
  }

  private watchConnection(connection: ChannelModel): void {
    connection.on('error', this.closedByBroker('connection'));
    connection.on('close', (error) => {
      if (error) {
        this.closedByBroker('connection')(error);
      }
    });
  }

  private watchControl(control: ConfirmChannel): void {
    control.on('error', this.closedByBroker('channel'));
    control.on('return', (message) => this.returned.add(message.content.toString()));
  }

  /** Gets the session ready for the next step after the broker closed what the last one used. */
  private async recover(refusal: Refusal): Promise<void> {
    if (refusal.level === 'connection') {
      if (this.exclusive.size > 0 || this.channels.size > 0) {
        throw new Error(
          `The broker closed the connection (${refusal.code} ${refusal.text}), which ended the channels and the exclusive queues that this scenario had opened. Put a refusal like that before them`,
        );
      }
      this.connection = await openConnection(this.target);
      this.watchConnection(this.connection);
    }
    this.control = await this.connection.createConfirmChannel();
    this.watchControl(this.control);
  }

  private fail(error: Error): void {
    this.failure ??= error;
    for (const waiter of [...this.waiters]) {
      waiter.wake();
    }
  }

  private check(): void {
    if (this.failure) {
      throw new Error(`The broker closed the connection or a channel: ${this.failure.message}`);
    }
  }

  /**
   * Runs one broker call. When the broker closes a channel or the connection, the call fails with something that says
   * nothing: "channel closed", or amqplib's "Channel ended, no reply will be forthcoming". The broker's reason, such as
   * "404 NOT_FOUND - no exchange 'x'", arrives on the `error` event of what it closed, so wait for it. A reason like that
   * is a refusal: the session opens a new channel, or connects again, and throws it for the executor to judge. Any other
   * failure is reported together with what the runner was trying to do.
   */
  private async call<T>(what: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      await new Promise((resolve) => setImmediate(resolve));
      const refusal = this.closedWith;
      if (refusal) {
        this.closedWith = undefined;
        await this.recover(refusal);
        throw new BrokerRefusal(refusal);
      }
      const reason = this.failure ?? (error instanceof Error ? error : new Error(String(error)));
      throw new Error(`${what}: ${reason.message}`, { cause: error });
    }
  }

  private channel(name: string): Channel {
    const channel = this.channels.get(name);
    if (!channel) {
      throw new Error(`Channel "${name}" is not open`);
    }
    return channel;
  }

  async declareExchange(step: StepOf<'exchange.declare'>): Promise<void> {
    await this.call(`declare exchange "${step.name}"`, () =>
      this.control.assertExchange(step.name, step.type, {
        durable: step.durable ?? false,
        autoDelete: step.autoDelete ?? false,
        internal: step.internal ?? false,
      }),
    );
  }

  async declareQueue(step: StepOf<'queue.declare'>): Promise<void> {
    // The fallback for `durable` is `true`, because RabbitMQ 4.3 refuses a queue that is neither durable nor exclusive.
    await this.call(`declare queue "${step.name}"`, () =>
      this.control.assertQueue(step.name, {
        durable: step.durable ?? true,
        ...(step.exclusive === true ? { exclusive: true } : {}),
      }),
    );
    this.queues.push(step.name);
    if (step.exclusive === true) {
      this.exclusive.add(step.name);
    }
  }

  async bind(step: StepOf<'bind'>): Promise<void> {
    const args = step.headers ? bindingArguments(step.headers) : undefined;
    const key = step.key ?? '';
    const { kind, name } = step.destination;
    await this.call(`bind ${kind} "${name}" to "${step.source}"`, () =>
      kind === 'queue'
        ? this.control.bindQueue(name, step.source, key, args)
        : this.control.bindExchange(name, step.source, key, args),
    );
  }

  async publish(step: StepOf<'basic.publish'>): Promise<{ returned: boolean }> {
    this.returned.delete(step.body);
    await this.call(
      `publish "${step.body}" to "${step.exchange}"`,
      () =>
        new Promise<void>((resolve, reject) => {
          this.control.publish(
            step.exchange,
            step.key ?? '',
            Buffer.from(step.body),
            { mandatory: true, ...(step.headers ? { headers: messageHeaders(step.headers) } : {}) },
            (error) =>
              error
                ? reject(error instanceof Error ? error : new Error(`Publish was not confirmed: ${String(error)}`))
                : resolve(),
          );
        }),
    );
    return { returned: this.returned.has(step.body) };
  }

  async openChannel(step: StepOf<'channel.open'>): Promise<void> {
    const channel = await this.call(`open channel "${step.channel}"`, () => this.connection.createChannel());
    channel.on('error', (error) => this.fail(error));
    if (step.prefetch !== undefined) {
      const { prefetch } = step;
      await this.call(`set the prefetch of channel "${step.channel}"`, () => channel.prefetch(prefetch));
    }
    this.channels.set(step.channel, channel);
  }

  async consume(step: StepOf<'basic.consume'>): Promise<void> {
    const channel = this.channel(step.channel);
    const state: ConsumerState = { channelName: step.channel, channel, unacked: [] };
    this.consumers.set(step.consumer, state);
    this.received.set(step.consumer, []);

    const onMessage = (message: ConsumeMessage | null): void => {
      if (message === null) {
        return; // the broker cancelled the consumer
      }
      this.received
        .get(step.consumer)
        ?.push({ body: message.content.toString(), redelivered: message.fields.redelivered });
      if (step.ack === 'manual') {
        state.unacked.push(message);
      }
      this.total += 1;
      for (const waiter of [...this.waiters].filter((candidate) => this.total >= candidate.count)) {
        waiter.wake();
      }
    };

    await this.call(`consume "${step.queue}" as "${step.consumer}"`, () =>
      channel.consume(step.queue, onMessage, { noAck: step.ack === 'auto', consumerTag: step.consumer }),
    );
  }

  async cancel(step: StepOf<'basic.cancel'>): Promise<void> {
    const { channel } = this.consumer(step.consumer);
    await this.call(`cancel consumer "${step.consumer}"`, () => channel.cancel(step.consumer));
  }

  async ack(step: StepOf<'basic.ack'>): Promise<void> {
    const state = this.consumer(step.consumer);
    const index =
      step.body === undefined ? 0 : state.unacked.findIndex((message) => message.content.toString() === step.body);
    const message = state.unacked[index];
    if (!message) {
      throw new Error(
        `Consumer "${step.consumer}" has no unacknowledged message${step.body === undefined ? '' : ` "${step.body}"`}`,
      );
    }
    state.unacked.splice(index, 1);
    state.channel.ack(message);
  }

  async closeChannel(step: StepOf<'channel.close'>): Promise<void> {
    const channel = this.channel(step.channel);
    await this.call(`close channel "${step.channel}"`, () => channel.close());
    this.channels.delete(step.channel);
  }

  private consumer(name: string): ConsumerState {
    const state = this.consumers.get(name);
    if (!state) {
      throw new Error(`Consumer "${name}" does not exist`);
    }
    return state;
  }

  async waitForDeliveries(count: number): Promise<void> {
    if (this.total < count && !this.failure) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters.delete(waiter);
          reject(
            new Error(
              `Timed out after ${DELIVERY_TIMEOUT_MS} ms waiting for ${count} deliveries; ${this.total} arrived`,
            ),
          );
        }, DELIVERY_TIMEOUT_MS);
        const waiter = {
          count,
          wake: () => {
            clearTimeout(timer);
            this.waiters.delete(waiter);
            resolve();
          },
        };
        this.waiters.add(waiter);
      });
    }
    this.check();
  }

  async settle(): Promise<void> {
    for (const queue of this.queues) {
      await this.call(`ask queue "${queue}" to catch up`, () => this.control.checkQueue(queue));
    }
    for (const [name, channel] of this.channels) {
      await this.call(`ask channel "${name}" to catch up`, () => channel.checkExchange('amq.direct'));
    }
    this.check();
  }

  deliveries(): ReadonlyMap<string, readonly Delivery[]> {
    return this.received;
  }

  async drain(queue: string): Promise<readonly Delivery[]> {
    const messages: Delivery[] = [];
    for (;;) {
      const message = await this.call(`take a message from queue "${queue}"`, () =>
        this.control.get(queue, { noAck: true }),
      );
      if (message === false) {
        return messages;
      }
      messages.push({ body: message.content.toString(), redelivered: message.fields.redelivered });
    }
  }

  async close(): Promise<void> {
    await this.connection.close().catch(() => undefined);
    await this.onClose?.();
  }
}
