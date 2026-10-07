import { BrokerRefusal, type BrokerSession, type Delivery, type Refusal, type StepOf } from './session';
import type { LiveBroker } from './management';

/**
 * A scripted stand-in for a broker session, for the specs. It records the calls it receives, in order, and answers
 * from what the test sets up. It does not route or deliver anything: that is the broker's job, and the live run's.
 */
export class FakeSession implements BrokerSession {
  readonly vhost = 'fake-vhost';
  readonly calls: string[] = [];
  /**
   * Calls that the broker refuses, by the text `calls` records for them. They throw a `BrokerRefusal`. A call that is made more than
   * once can be refused the second time only, by writing `#2` after its text.
   */
  readonly refusals = new Map<string, Refusal>();
  private readonly made = new Map<string, number>();
  /** Bodies that `publish` should report as returned. */
  readonly returned = new Set<string>();
  /** What `drain` hands back, by queue. */
  readonly ready: Record<string, Delivery[]> = {};
  /** What `deliveries` reports, by consumer. */
  readonly received = new Map<string, Delivery[]>();
  failOn: string | undefined;
  closed = false;

  private record(call: string): Promise<void> {
    this.calls.push(call);
    const times = (this.made.get(call) ?? 0) + 1;
    this.made.set(call, times);
    const refusal = this.refusals.get(`${call}#${times}`) ?? this.refusals.get(call);
    if (refusal) {
      return Promise.reject(new BrokerRefusal(refusal));
    }
    return call.startsWith(this.failOn ?? '\0')
      ? Promise.reject(new Error(`scripted failure on ${call}`))
      : Promise.resolve();
  }

  declareExchange(step: StepOf<'exchange.declare'>) {
    return this.record(`exchange.declare ${step.name}`);
  }
  declareQueue(step: StepOf<'queue.declare'>) {
    return this.record(`queue.declare ${step.name}`);
  }
  bind(step: StepOf<'bind'>) {
    return this.record(`bind ${step.source} ${step.destination.name}`);
  }
  unbind(step: StepOf<'unbind'>) {
    return this.record(`unbind ${step.source} ${step.destination.name}`);
  }
  async publish(step: StepOf<'basic.publish'>) {
    await this.record(`publish ${step.body}`);
    return { returned: this.returned.has(step.body) };
  }
  openChannel(step: StepOf<'channel.open'>) {
    return this.record(`channel.open ${step.channel}`);
  }
  consume(step: StepOf<'basic.consume'>) {
    return this.record(`consume ${step.consumer}`);
  }
  cancel(step: StepOf<'basic.cancel'>) {
    return this.record(`cancel ${step.consumer}`);
  }
  ack(step: StepOf<'basic.ack'>) {
    return this.record(`ack ${step.consumer} ${step.body ?? '(oldest)'}`);
  }
  closeChannel(step: StepOf<'channel.close'>) {
    return this.record(`channel.close ${step.channel}`);
  }
  waitForDeliveries(count: number) {
    return this.record(`await ${count}`);
  }
  settle() {
    return this.record('settle');
  }
  deliveries() {
    return this.received;
  }
  async drain(queue: string) {
    await this.record(`drain ${queue}`);
    return this.ready[queue] ?? [];
  }
  close() {
    this.closed = true;
    return this.record('close');
  }
}

/** A broker that hands out fake sessions, and remembers which vhosts it was asked for. */
export class FakeBroker implements LiveBroker {
  readonly info = { image: 'fake:1', imageDigest: 'sha256:fake', serverVersion: '9.9.9', erlangVersion: '99' };
  readonly vhosts: string[] = [];
  readonly sessions: FakeSession[] = [];
  stopped = false;

  openSession(vhost: string): Promise<BrokerSession> {
    this.vhosts.push(vhost);
    const session = new FakeSession();
    this.sessions.push(session);
    return Promise.resolve(session);
  }

  stop(): Promise<void> {
    this.stopped = true;
    return Promise.resolve();
  }
}
