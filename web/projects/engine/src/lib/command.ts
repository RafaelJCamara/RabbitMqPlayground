import type { HeaderArguments } from './headers';
import type { Destination, ExchangeType } from './topology';

/**
 * The commands that change the topology that the engine holds (ADR-0007, ADR-0019). Their names and fields follow the
 * conformance steps (`exchange.declare`, `queue.declare`, `bind`), so that a recorded scenario and a document change are
 * the same kind of thing. Everything is plain data. A flag that a step may leave out is always written out here, so that
 * no reader has to know a default.
 *
 * These are the commands that the domain's `reconcile` makes to keep the engine in step with a canvas document, and they
 * are only the types: the dispatcher that applies them arrives with the simulation (slice S6), together with the rest of
 * the plan's vocabulary, which is about running a topology and not about building one: channels, consumers, publishing,
 * producers, purging and the simulation's own commands.
 *
 * A broker cannot change an exchange or a queue that it has, and redeclaring one with other arguments is refused with
 * `406` (ADR-0008, rule 27). So a change of any flag is a delete and a declare, never a second declaration.
 */

export interface ExchangeDeclare {
  readonly op: 'exchange.declare';
  readonly name: string;
  readonly type: ExchangeType;
  readonly durable: boolean;
  readonly autoDelete: boolean;
  /** A client cannot publish to an internal exchange, but other exchanges can still route through it. */
  readonly internal: boolean;
}

/** Deleting an exchange deletes the bindings that start from it and the ones that end at it. */
export interface ExchangeDelete {
  readonly op: 'exchange.delete';
  readonly name: string;
}

export interface QueueDeclare {
  readonly op: 'queue.declare';
  readonly name: string;
  /** RabbitMQ 4.3 refuses a queue that is not durable, unless it is exclusive (ADR-0021, ADR-0024). */
  readonly durable: boolean;
}

/** Deleting a queue deletes the bindings that end at it. */
export interface QueueDelete {
  readonly op: 'queue.delete';
  readonly name: string;
}

/** Binding the same thing twice is the same binding: a broker keeps it once. */
export interface Bind {
  readonly op: 'bind';
  readonly source: string;
  readonly destination: Destination;
  readonly key: string;
  /** The arguments of a binding. Left out, the binding has none. */
  readonly headers?: HeaderArguments;
}

export interface Unbind {
  readonly op: 'unbind';
  readonly source: string;
  readonly destination: Destination;
  readonly key: string;
  readonly headers?: HeaderArguments;
}

export type TopologyCommand = ExchangeDeclare | ExchangeDelete | QueueDeclare | QueueDelete | Bind | Unbind;

export type EngineCommand = TopologyCommand;
