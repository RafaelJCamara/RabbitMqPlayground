import {
  createEngine,
  type Bind,
  type EngineCommand,
  type EngineEvent,
  type Engine,
  type ExchangeDeclare,
  type ExchangeType,
  type HeaderArguments,
  type ProducerSet,
  type Timing,
} from '@rmq/engine';

/**
 * Helpers for specs of the engine and of whatever runs one: a few timings, small makers of commands, and ways to drive an engine and read what
 * it said. They are test code, so a refusal that a spec did not expect throws, with the reply.
 */

/** Every leg takes no time, so that a command and what follows it from the clock are one instant. */
export const ZERO_TIMING: Timing = { publishMs: 0, brokerMs: 0, deliverMs: 0 };

/** The latencies of a new canvas (ADR-0007). */
export const CANVAS_TIMING: Timing = { publishMs: 500, brokerMs: 300, deliverMs: 500 };

/** How far `settle` goes: more than any run of a spec takes. */
const A_LONG_TIME = 10_000_000;

export const newEngine = (timing: Timing = ZERO_TIMING, seed = 1): Engine => createEngine({ seed, timing });

/** Lets everything that is scheduled happen, and answers what it said. A producer that repeats is never done, so a spec that has one does not settle. */
export const settle = (engine: Engine): EngineEvent[] => engine.advanceTo(engine.now() + A_LONG_TIME);

/** Dispatches a command that is expected to be accepted, and answers what it said. */
export function run(engine: Engine, command: EngineCommand): EngineEvent[] {
  const result = engine.dispatch(command);
  if (!result.ok) {
    throw new Error(`${command.op} was refused: ${result.code} ${result.text}`);
  }
  return result.events;
}

/** Dispatches the commands in order, and answers everything that they said. */
export function runAll(engine: Engine, ...commands: EngineCommand[]): EngineEvent[] {
  return commands.flatMap((command) => run(engine, command));
}

export const declareExchange = (
  name: string,
  type: ExchangeType = 'direct',
  flags: Partial<Pick<ExchangeDeclare, 'durable' | 'autoDelete' | 'internal'>> = {},
): ExchangeDeclare => ({
  op: 'exchange.declare',
  name,
  type,
  durable: true,
  autoDelete: false,
  internal: false,
  ...flags,
});

export const declareQueue = (name: string): EngineCommand => ({ op: 'queue.declare', name, durable: true });

export const bindQueue = (source: string, queue: string, key = '', headers?: HeaderArguments): Bind => ({
  op: 'bind',
  source,
  destination: { kind: 'queue', name: queue },
  key,
  ...(headers === undefined ? {} : { headers }),
});

export const publish = (exchange: string, key = '', body = ''): EngineCommand => ({
  op: 'basic.publish',
  exchange,
  key,
  body,
});

/** A channel that handles nothing by itself, as the conformance scenarios have. */
export const openChannel = (channel: string, prefetch?: number, processingMs: number | null = null): EngineCommand => ({
  op: 'channel.open',
  channel,
  ...(prefetch === undefined ? {} : { prefetch }),
  processingMs,
});

export const consume = (
  channel: string,
  queue: string,
  consumer: string,
  ack: 'auto' | 'manual' = 'auto',
): EngineCommand => ({ op: 'basic.consume', channel, queue, consumer, ack });

export const producer = (id: string, changes: Partial<Omit<ProducerSet, 'op' | 'producer'>> = {}): ProducerSet => ({
  op: 'producer.set',
  producer: id,
  target: null,
  key: '',
  payload: '',
  headers: [],
  burst: 1,
  everyMs: 1000,
  repeat: false,
  ...changes,
});

/** The events of one type, in order. */
export function only<Type extends EngineEvent['type']>(
  events: readonly EngineEvent[],
  type: Type,
): Extract<EngineEvent, { readonly type: Type }>[] {
  return events.filter((event): event is Extract<EngineEvent, { readonly type: Type }> => event.type === type);
}

/** The types of the events, in order, for a spec that reads what happened as a sentence. */
export const types = (events: readonly EngineEvent[]): string[] => events.map(({ type }) => type);

/**
 * An engine that is busy everywhere, for the specs of what keeps its state: messages on their way, in queues, held, waiting and handled, consumers that acknowledge and consumers that do not, one
 * that was cancelled while it held messages, producers that repeat, and a channel that was closed. It is stopped at 2,300 ms of its clock.
 */
export function busyEngine(): Engine {
  const engine = newEngine(CANVAS_TIMING, 7);
  runAll(
    engine,
    declareExchange('e', 'topic'),
    declareExchange('f', 'fanout', { durable: false }),
    declareQueue('jobs'),
    declareQueue('logs'),
    bindQueue('e', 'jobs', 'job.#'),
    { op: 'bind', source: 'e', destination: { kind: 'exchange', name: 'f' }, key: '#' },
    bindQueue('f', 'logs'),
    bindQueue('f', 'jobs', '', undefined),
    openChannel('slow', 1, 400),
    consume('slow', 'jobs', 'c-slow', 'manual'),
    openChannel('fast', 0, 100),
    consume('fast', 'logs', 'c-fast', 'auto'),
    openChannel('scripted', 2, null),
    consume('scripted', 'jobs', 'c-held', 'manual'),
    openChannel('gone', 1, null),
    consume('gone', 'logs', 'c-gone', 'manual'),
    producer('p1', {
      target: { kind: 'exchange', name: 'e' },
      key: 'job.new',
      payload: 'work',
      burst: 3,
      everyMs: 700,
      repeat: true,
    }),
    producer('p2', { target: { kind: 'queue', name: 'logs' }, payload: 'line', everyMs: 300, repeat: true }),
    producer('p3', { target: { kind: 'exchange', name: 'f' }, headers: [{ key: 'n', value: { t: 'integer', v: 1 } }] }),
  );
  engine.advanceTo(1900);
  run(engine, { op: 'producer.publish', producer: 'p3' });
  run(engine, { op: 'channel.close', channel: 'gone' });
  engine.advanceTo(2300);
  run(engine, { op: 'basic.cancel', consumer: 'c-slow' });
  return engine;
}
