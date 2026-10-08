import { arbTypedDamage, CANVAS_TIMING, configureFastCheck, newEngine, ZERO_TIMING, type Json } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EngineCommand } from './command';
import type { Engine } from './engine';
import type { EngineEvent } from './events';
import type { EngineSnapshot } from './snapshot';
import { snapshotIssue } from './snapshot-check';
import type { Timing } from './view';

/**
 * What must hold of every run of the engine, whatever the commands (ADR-0015, ADR-0052, ADR-0053): every published message is accounted for, no
 * copy of a message is held by two consumers, no consumer holds more than its prefetch, nothing is delivered to a consumer that was cancelled or whose
 * channel was closed, the same seed and the same commands give the same events, and an engine restored from a snapshot does what the first would
 * have done. A script is a list of intents, each a few numbers that are read against the engine as it is, so that most commands are about
 * something that is there, a few are not, and a failing script shrinks to small numbers.
 *
 * They run at 100 runs in the hook and in CI and at 5,000 in the Nightly job, with a seed that is chosen for the night.
 */

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

interface Intent {
  readonly verb: number;
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly flag: boolean;
}

const arbIntent: fc.Arbitrary<Intent> = fc.record({
  verb: fc.nat(10_000),
  a: fc.nat(10_000),
  b: fc.nat(10_000),
  c: fc.nat(10_000),
  flag: fc.boolean(),
});

const arbScript = fc.array(arbIntent, { minLength: 6, maxLength: 90 });

type Step =
  | { readonly kind: 'command'; readonly command: EngineCommand }
  | { readonly kind: 'advance'; readonly by: number }
  | { readonly kind: 'step' };

const at = <T>(list: readonly T[], index: number): T => list[index % list.length] as T;

const EXCHANGES = ['e0', 'e1', 'e2'];
const QUEUES = ['q0', 'q1', 'q2'];
const KEYS = ['', 'a', 'a.b', 'a.*', '#', 'b'];
const TYPES = ['direct', 'fanout', 'topic', 'headers'] as const;
const ADVANCES = [0, 1, 40, 300, 700, 2500];

const VERBS = [
  ...Array<string>(4).fill('declare-exchange'),
  ...Array<string>(4).fill('declare-queue'),
  ...Array<string>(9).fill('bind'),
  ...Array<string>(2).fill('unbind'),
  ...Array<string>(5).fill('open'),
  ...Array<string>(9).fill('consume'),
  'cancel',
  ...Array<string>(4).fill('ack'),
  ...Array<string>(2).fill('close'),
  ...Array<string>(2).fill('set-channel'),
  ...Array<string>(9).fill('publish'),
  ...Array<string>(4).fill('set-producer'),
  ...Array<string>(3).fill('producer-publish'),
  'remove-producer',
  'purge',
  'delete-queue',
  'delete-exchange',
  'clear',
  'reset',
  'configure',
  ...Array<string>(22).fill('advance'),
  ...Array<string>(6).fill('step'),
];

/** The step that an intent makes against the engine as it is. `counter` makes the names of consumers that no consumer has had before. */
function stepFor(engine: Engine, i: Intent, counter: { next: number }): Step {
  const view = engine.view();
  const exchanges = view.topology.exchanges.map(({ name }) => name);
  const queues = view.topology.queues;
  const channels = Object.keys(view.channels);
  const tags = Object.values(view.channels).flatMap((channel) =>
    channel.consumers.map(({ consumer, unacked, queue }) => ({ consumer, unacked, queue })),
  );
  const command = (c: EngineCommand): Step => ({ kind: 'command', command: c });
  const none: Step = { kind: 'advance', by: 0 };
  const key = at(KEYS, i.b);

  switch (at(VERBS, i.verb)) {
    case 'declare-exchange':
      return command({
        op: 'exchange.declare',
        name: at(EXCHANGES, i.a),
        type: at(TYPES, i.b),
        durable: true,
        autoDelete: i.flag,
        internal: i.c % 7 === 0,
      });
    case 'declare-queue':
      return command({ op: 'queue.declare', name: at(QUEUES, i.a), durable: true });
    case 'bind': {
      const source = exchanges.length === 0 ? at(EXCHANGES, i.a) : at(exchanges, i.a);
      const toExchange = i.c % 4 === 0 && exchanges.length > 0;
      const destination = toExchange
        ? ({ kind: 'exchange', name: at(exchanges, i.c) } as const)
        : ({ kind: 'queue', name: queues.length === 0 ? at(QUEUES, i.c) : at(queues, i.c) } as const);
      const headers =
        i.b % 5 === 0
          ? {
              headers: {
                xMatch: at([null, 'all', 'any'] as const, i.c),
                args: [{ key: 'n', value: { t: 'integer', v: 1 } as const }],
              },
            }
          : {};
      return command({ op: 'bind', source, destination, key, ...headers });
    }
    case 'unbind': {
      const bindings = view.topology.bindings;
      if (bindings.length > 0 && i.flag) {
        const { source, destination, key: bound, headers } = at(bindings, i.a);
        return command({
          op: 'unbind',
          source,
          destination,
          key: bound,
          ...(headers === undefined ? {} : { headers }),
        });
      }
      return command({
        op: 'unbind',
        source: at(EXCHANGES, i.a),
        destination: { kind: 'queue', name: at(QUEUES, i.c) },
        key,
      });
    }
    case 'open': {
      const name = `ch${i.a % 4}`;
      return channels.includes(name)
        ? none
        : command({
            op: 'channel.open',
            channel: name,
            prefetch: at([0, 1, 2, 3], i.b),
            processingMs: at([null, 0, 120, 400], i.c),
          });
    }
    case 'consume': {
      if (channels.length === 0) {
        return none;
      }
      counter.next += 1;
      const queue = queues.length > 0 && i.c % 12 !== 0 ? at(queues, i.c) : 'missing';
      return command({
        op: 'basic.consume',
        channel: at(channels, i.a),
        queue,
        consumer: `t${counter.next}`,
        ack: i.flag ? 'manual' : 'auto',
      });
    }
    case 'cancel':
      return tags.length === 0 ? none : command({ op: 'basic.cancel', consumer: at(tags, i.a).consumer });
    case 'ack': {
      const held = tags.filter(({ unacked }) => unacked > 0);
      const pool = held.length > 0 && i.c % 6 !== 0 ? held : tags;
      if (pool.length === 0) {
        return none;
      }
      const tag = at(pool, i.a);
      const heldBy = engine.messages(tag.queue).filter(({ heldBy: by }) => by?.consumer === tag.consumer);
      return command({
        op: 'basic.ack',
        consumer: tag.consumer,
        ...(i.flag && heldBy.length > 0 ? { message: at(heldBy, i.b).id } : {}),
      });
    }
    case 'close':
      return channels.length === 0 ? none : command({ op: 'channel.close', channel: at(channels, i.a) });
    case 'set-channel':
      return channels.length === 0
        ? none
        : command({
            op: 'channel.set',
            channel: at(channels, i.a),
            prefetch: at([0, 1, 2, 5], i.b),
            processingMs: at([null, 0, 90, 300], i.c),
          });
    case 'publish':
      return command({
        op: 'basic.publish',
        exchange: i.c % 9 === 0 ? '' : exchanges.length === 0 ? at(EXCHANGES, i.a) : at(exchanges, i.a),
        key: i.c % 9 === 0 && queues.length > 0 ? at(queues, i.a) : key,
        headers: i.flag ? [{ key: 'n', value: { t: 'integer', v: 1 } }] : [],
        body: `m${counter.next}`,
      });
    case 'set-producer': {
      const target =
        i.c % 3 === 0 && queues.length > 0
          ? ({ kind: 'queue', name: at(queues, i.a) } as const)
          : exchanges.length > 0
            ? ({ kind: 'exchange', name: at(exchanges, i.a) } as const)
            : null;
      return command({
        op: 'producer.set',
        producer: `p${i.a % 3}`,
        target,
        key,
        payload: 'x',
        headers: [],
        burst: 1 + (i.b % 4),
        everyMs: at([50, 200, 500], i.c),
        repeat: i.flag,
      });
    }
    case 'producer-publish': {
      const producers = Object.keys(view.producers);
      return producers.length === 0 ? none : command({ op: 'producer.publish', producer: at(producers, i.a) });
    }
    case 'remove-producer':
      return command({ op: 'producer.remove', producer: `p${i.a % 3}` });
    case 'purge':
      return command({ op: 'queue.purge', name: queues.length === 0 ? 'missing' : at(queues, i.a) });
    case 'delete-queue':
      return command({ op: 'queue.delete', name: at(QUEUES, i.a) });
    case 'delete-exchange':
      return command({ op: 'exchange.delete', name: at(EXCHANGES, i.a) });
    case 'clear':
      return command({ op: 'sim.clearMessages' });
    case 'reset':
      return command({ op: 'sim.resetCounters' });
    case 'configure':
      return command({
        op: 'sim.configure',
        seed: i.a,
        timing: {
          publishMs: at([0, 100, 500], i.b),
          brokerMs: at([0, 50, 300], i.c),
          deliverMs: at([0, 80, 500], i.a),
        },
      });
    case 'advance':
      return { kind: 'advance', by: at(ADVANCES, i.a) };
    default:
      return { kind: 'step' };
  }
}

/** What happened, as a model that has nothing in common with the engine but the events, which it checks the engine's own counts against. */
class Model {
  private readonly copies = new Map<string, 'pending' | 'ready' | 'held'>();
  private readonly heldBy = new Map<string, string>();
  private readonly tags = new Map<
    string,
    { channel: string; queue: string; ack: 'auto' | 'manual'; cancelled: boolean }
  >();
  private readonly prefetch = new Map<string, number>();
  private readonly closed = new Set<string>();
  /** Published, and not yet routed, refused or called back. */
  private readonly unrouted = new Set<number>();
  private lastSeq = 0;
  private lastAt = 0;
  published = 0;
  settled = 0;
  autoDelivered = 0;
  problems: string[] = [];

  private fail(message: string): void {
    this.problems.push(message);
  }

  private copy = (message: number, queue: string): string => `${message}|${queue}`;

  channelOpened(channel: string, prefetch: number): void {
    this.prefetch.set(channel, prefetch);
    this.closed.delete(channel);
  }

  channelSet(channel: string, prefetch: number | undefined): void {
    if (prefetch !== undefined) {
      this.prefetch.set(channel, prefetch);
    }
  }

  consuming(command: Extract<EngineCommand, { op: 'basic.consume' }>): void {
    this.tags.set(command.consumer, {
      channel: command.channel,
      queue: command.queue,
      ack: command.ack,
      cancelled: false,
    });
  }

  private heldCount(tag: string): number {
    let count = 0;
    for (const holder of this.heldBy.values()) {
      count += holder === tag ? 1 : 0;
    }
    return count;
  }

  private count(queue: string, state: 'ready' | 'held'): number {
    let count = 0;
    for (const [key, value] of this.copies) {
      count += key.endsWith(`|${queue}`) && value === state ? 1 : 0;
    }
    return count;
  }

  hear(event: EngineEvent): void {
    if (event.seq !== this.lastSeq + 1) {
      this.fail(`the events are not numbered one after the other: ${this.lastSeq} and then ${event.seq}`);
    }
    this.lastSeq = event.seq;
    if (event.at < this.lastAt) {
      this.fail(`time went back: ${this.lastAt} and then ${event.at}`);
    }
    this.lastAt = event.at;

    switch (event.type) {
      case 'published':
        this.published += 1;
        this.unrouted.add(event.message.id);
        break;
      case 'routed':
        this.unrouted.delete(event.message);
        for (const queue of event.queues) {
          this.copies.set(this.copy(event.message, queue), 'pending');
        }
        break;
      case 'unroutable':
      case 'refused':
        this.unrouted.delete(event.message);
        break;
      case 'enqueued': {
        const key = this.copy(event.message, event.queue);
        if (this.copies.get(key) !== 'pending') {
          this.fail(`${key} was enqueued and was not on its way`);
        }
        this.copies.set(key, 'ready');
        break;
      }
      case 'dropped':
        this.copies.delete(this.copy(event.message, event.queue));
        break;
      case 'delivered': {
        const key = this.copy(event.message, event.queue);
        if (this.copies.get(key) !== 'ready') {
          this.fail(
            `${key} was given to ${event.consumer} and was not ready: a message goes to one consumer at a time`,
          );
        }
        const tag = this.tags.get(event.consumer);
        if (tag === undefined || tag.cancelled) {
          this.fail(`${key} was given to ${event.consumer}, which was cancelled or never consumed`);
        }
        if (this.closed.has(event.channel)) {
          this.fail(`${key} was given to the closed channel ${event.channel}`);
        }
        if (event.autoAck) {
          this.copies.delete(key);
          this.autoDelivered += 1;
        } else {
          this.copies.set(key, 'held');
          this.heldBy.set(key, event.consumer);
          const prefetch = this.prefetch.get(event.channel) ?? 0;
          if (prefetch > 0 && this.heldCount(event.consumer) > prefetch) {
            this.fail(`${event.consumer} holds ${this.heldCount(event.consumer)} and its prefetch is ${prefetch}`);
          }
        }
        break;
      }
      case 'acked': {
        const key = this.copy(event.message, event.queue);
        if (this.heldBy.get(key) !== event.consumer) {
          this.fail(`${key} was acknowledged by ${event.consumer}, which did not hold it`);
        }
        this.copies.delete(key);
        this.heldBy.delete(key);
        this.settled += 1;
        break;
      }
      case 'requeued': {
        const key = this.copy(event.message, event.queue);
        if (this.heldBy.get(key) !== event.consumer) {
          this.fail(`${key} was requeued from ${event.consumer}, which did not hold it`);
        }
        this.copies.set(key, 'ready');
        this.heldBy.delete(key);
        break;
      }
      case 'consumer.cancelled': {
        const tag = this.tags.get(event.consumer);
        if (tag !== undefined) {
          tag.cancelled = true;
        }
        break;
      }
      case 'channel.closed':
        this.closed.add(event.channel);
        for (const tag of this.tags.values()) {
          if (tag.channel === event.channel) {
            tag.cancelled = true;
          }
        }
        break;
      case 'queue.purged': {
        let purged = 0;
        for (const [key, value] of [...this.copies]) {
          if (key.endsWith(`|${event.queue}`) && value === 'ready') {
            this.copies.delete(key);
            purged += 1;
          }
        }
        if (purged !== event.count) {
          this.fail(`${event.queue} was purged of ${event.count} and the model had ${purged} ready`);
        }
        break;
      }
      case 'queue.deleted': {
        if (this.count(event.queue, 'ready') !== event.ready || this.count(event.queue, 'held') !== event.unacked) {
          this.fail(
            `${event.queue} was deleted with ${event.ready} ready and ${event.unacked} held, and the model had ${this.count(event.queue, 'ready')} and ${this.count(event.queue, 'held')}`,
          );
        }
        // What was on its way to the queue is not in it, and comes to whatever queue has the name when it gets there.
        for (const [key, value] of [...this.copies]) {
          if (key.endsWith(`|${event.queue}`) && value !== 'pending') {
            this.copies.delete(key);
            this.heldBy.delete(key);
          }
        }
        break;
      }
      case 'cleared': {
        const ready = [...this.copies.values()].filter((value) => value === 'ready').length;
        const held = [...this.copies.values()].filter((value) => value === 'held').length;
        if (ready !== event.ready || held !== event.unacked) {
          this.fail(
            `clear took ${event.ready} ready and ${event.unacked} held, and the model had ${ready} and ${held}`,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  /** What a command that is not an event does to the model: clearing takes out what was on its way too. */
  cleared(): void {
    this.copies.clear();
    this.heldBy.clear();
    this.unrouted.clear();
  }

  /** What the engine counts, against what the events add up to. */
  check(engine: Engine): void {
    const view = engine.view();
    for (const [name, queue] of Object.entries(view.queues)) {
      if (queue.ready !== this.count(name, 'ready') || queue.unacked !== this.count(name, 'held')) {
        this.fail(
          `${name} has ${queue.ready} ready and ${queue.unacked} held, and the events add up to ${this.count(name, 'ready')} and ${this.count(name, 'held')}`,
        );
      }
    }
    // A message that was published is, at each moment, in one of the places that it can be: on its way to the broker, or settled by it.
    const flights = engine.flights();
    const toBroker = flights.filter((flight) => flight.leg === 'publish').length;
    if (toBroker !== this.unrouted.size) {
      this.fail(`${this.unrouted.size} messages have not been routed, and ${toBroker} are on their way to the broker`);
    }
    let copies = 0;
    for (const flight of flights) {
      copies += flight.leg === 'broker' ? flight.paths.length : 1;
    }
    if (copies !== view.travelling) {
      this.fail(`the view says that ${view.travelling} are travelling, and the flights add up to ${copies}`);
    }
    const next = engine.nextAt();
    if (next !== null && next < engine.now()) {
      this.fail(`the next thing is at ${next}, and it is ${engine.now()}`);
    }
  }
}

interface Run {
  readonly events: EngineEvent[];
  readonly problems: string[];
  readonly view: string;
}

/** Plays a script against an engine, checking the model after every step. `from` starts at a step, for the engine that was restored. */
function play(
  engine: Engine,
  script: readonly Intent[],
  options: { from?: number; model?: Model; counter?: { next: number } } = {},
): Run & { model: Model } {
  const model = options.model ?? new Model();
  const counter = options.counter ?? { next: 0 };
  const events: EngineEvent[] = [];
  const hear = (heard: readonly EngineEvent[]): void => {
    for (const event of heard) {
      model.hear(event);
      events.push(event);
    }
  };

  for (const intent of script.slice(options.from ?? 0)) {
    const step = stepFor(engine, intent, counter);
    if (step.kind === 'advance') {
      hear(engine.advanceTo(engine.now() + step.by));
    } else if (step.kind === 'step') {
      hear(engine.step());
    } else {
      const { command } = step;
      const result = engine.dispatch(command);
      if (result.ok) {
        // The consumer is known before what the command did for it is heard: a consumer is given what is waiting inside the command that starts it.
        if (command.op === 'channel.open') {
          model.channelOpened(command.channel, command.prefetch ?? 0);
        } else if (command.op === 'channel.set') {
          model.channelSet(command.channel, command.prefetch);
        } else if (command.op === 'basic.consume') {
          model.consuming(command);
        }
      }
      hear(result.events);
      if (result.ok && command.op === 'sim.clearMessages') {
        model.cleared();
      }
    }
    model.check(engine);
  }
  return { events, problems: model.problems, view: JSON.stringify(engine.view()), model };
}

const arbTiming: fc.Arbitrary<Timing> = fc.constantFrom(ZERO_TIMING, CANVAS_TIMING, {
  publishMs: 30,
  brokerMs: 7,
  deliverMs: 120,
});

describe('what holds of every run of the engine', () => {
  it('accounts for every message, gives each copy to one consumer at a time, never gives a consumer more than its prefetch, and nothing after a cancel or a close', () => {
    fc.assert(
      fc.property(arbScript, arbTiming, fc.nat(1_000), (script, timing, seed) => {
        const { problems } = play(newEngine(timing, seed), script);

        expect(problems.join('\n')).toBe('');
      }),
    );
  });

  it('gives the same events, the same view and the same snapshot for the same seed and the same commands', () => {
    fc.assert(
      fc.property(arbScript, arbTiming, fc.nat(1_000), (script, timing, seed) => {
        const first = newEngine(timing, seed);
        const second = newEngine(timing, seed);

        const a = play(first, script);
        const b = play(second, script);

        expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
        expect(a.view).toBe(b.view);
        expect(JSON.stringify(first.snapshot())).toBe(JSON.stringify(second.snapshot()));
      }),
    );
  });

  it('is an engine that does what the first would have done, when it is restored from a snapshot taken at any step, through JSON', () => {
    fc.assert(
      fc.property(arbScript, arbTiming, fc.nat(1_000), fc.nat(1_000), (script, timing, seed, where) => {
        const split = where % (script.length + 1);
        const first = newEngine(timing, seed);
        const head = play(first, script.slice(0, split));
        const taken = JSON.stringify(first.snapshot());
        const restored = newEngine(ZERO_TIMING, 0);
        restored.restore(JSON.parse(taken));

        const original = play(first, script, { from: split, model: head.model, counter: { next: split } });
        const copy = play(restored, script, { from: split, counter: { next: split } });

        expect(JSON.stringify(copy.events)).toBe(JSON.stringify(original.events));
        expect(copy.view).toBe(original.view);
        expect(JSON.stringify(restored.snapshot())).toBe(JSON.stringify(first.snapshot()));
      }),
    );
  });

  it('is told about by a model that notices when the engine is wrong: a delivery to a consumer that was cancelled', () => {
    const model = new Model();
    model.consuming({ op: 'basic.consume', channel: 'ch', queue: 'q', consumer: 't', ack: 'manual' });
    model.hear({
      type: 'routed',
      seq: 1,
      at: 0,
      message: 1,
      exchange: '',
      queues: ['q'],
      paths: [],
      trace: { exchange: '', visits: [] },
      enqueueAt: 0,
    });
    model.hear({ type: 'enqueued', seq: 2, at: 0, message: 1, queue: 'q', depth: 1 });
    model.hear({
      type: 'consumer.cancelled',
      seq: 3,
      at: 0,
      consumer: 't',
      channel: 'ch',
      queue: 'q',
      reason: 'cancelled',
    });
    model.hear({
      type: 'delivered',
      seq: 4,
      at: 0,
      message: 1,
      queue: 'q',
      consumer: 't',
      channel: 'ch',
      redelivered: false,
      autoAck: false,
      arrivesAt: 0,
    });

    expect(model.problems.join('\n')).toMatch(/was cancelled or never consumed/);
  });

  it('is told about by a model that notices a message that is delivered twice, and a window that is exceeded', () => {
    const model = new Model();
    model.channelOpened('ch', 1);
    model.consuming({ op: 'basic.consume', channel: 'ch', queue: 'q', consumer: 't', ack: 'manual' });
    for (const message of [1, 2]) {
      model.hear({
        type: 'routed',
        seq: 2 * message - 1,
        at: 0,
        message,
        exchange: '',
        queues: ['q'],
        paths: [],
        trace: { exchange: '', visits: [] },
        enqueueAt: 0,
      });
      model.hear({ type: 'enqueued', seq: 2 * message, at: 0, message, queue: 'q', depth: 1 });
    }
    const delivered = (seq: number, message: number) =>
      ({
        type: 'delivered',
        seq,
        at: 0,
        message,
        queue: 'q',
        consumer: 't',
        channel: 'ch',
        redelivered: false,
        autoAck: false,
        arrivesAt: 0,
      }) as const;
    model.hear(delivered(5, 1));
    model.hear(delivered(6, 1));
    model.hear(delivered(7, 2));

    expect(model.problems.join('\n')).toMatch(/not ready: a message goes to one consumer at a time/);
    expect(model.problems.join('\n')).toMatch(/holds 2 and its prefetch is 1/);
  });

  it('is told about by a model that notices events that are out of order or out of time', () => {
    const model = new Model();
    model.hear({ type: 'counters.reset', seq: 2, at: 5 });
    model.hear({ type: 'counters.reset', seq: 3, at: 4 });

    expect(model.problems.join('\n')).toMatch(/not numbered one after the other/);
    expect(model.problems.join('\n')).toMatch(/time went back/);
  });
});

/** Does what a script says, as `play` does, without a model: for an engine whose state came from outside, which no model has heard the history of. */
function carryOn(engine: Engine, script: readonly Intent[], check: () => void = () => undefined): void {
  const counter = { next: 1_000 };
  for (const intent of script) {
    const step = stepFor(engine, intent, counter);
    if (step.kind === 'advance') {
      engine.advanceTo(engine.now() + step.by);
    } else if (step.kind === 'step') {
      engine.step();
    } else {
      engine.dispatch(step.command);
    }
    // What the screen reads after every change.
    engine.view();
    engine.flights();
    check();
  }
}

describe('what is restored (ADR-0052, ADR-0077)', () => {
  it('is a snapshot that passes the check that a snapshot from outside has to, whatever the engine has done and whenever it was taken', () => {
    fc.assert(
      fc.property(arbScript, arbTiming, fc.nat(1_000), (script, timing, seed) => {
        const engine = newEngine(timing, seed);

        expect(snapshotIssue(engine.snapshot())).toBeNull();
        carryOn(engine, script, () => {
          const issue = snapshotIssue(engine.snapshot());
          if (issue !== null) {
            throw new Error(issue);
          }
        });
      }),
    );
  });

  it('is refused, with the reason, or does no harm to an engine that goes on, when the snapshot is damaged: a name that is another, a number that is one off, a list with an element gone or twice', () => {
    fc.assert(
      fc.property(
        arbScript,
        arbTiming,
        fc.nat(1_000),
        fc.nat(1_000),
        arbTypedDamage(),
        arbScript,
        (script, timing, seed, where, damage, after) => {
          const first = newEngine(timing, seed);
          play(first, script.slice(0, where % (script.length + 1)));
          const damaged = damage(JSON.parse(JSON.stringify(first.snapshot())) as Json) as unknown as EngineSnapshot;
          const issue = snapshotIssue(damaged);
          const engine = newEngine(ZERO_TIMING, 0);

          if (issue !== null) {
            expect(() => engine.restore(damaged)).toThrow(issue);
            return;
          }
          engine.restore(damaged);
          expect(() => {
            engine.advanceTo(engine.now() + 3_000);
            carryOn(engine, after);
            engine.advanceTo(engine.now() + 6_000);
          }).not.toThrow();
        },
      ),
    );
  });
});
