import type { Destination, ExchangeType, HeaderArguments, HeaderEntry, HeaderValue } from '@rmq/engine';
import type { ElementRef } from '../document/issue';

/**
 * The commands (ADR-0011, ADR-0019, ADR-0025, ADR-0026). A command is a plain object that names the elements it is about
 * by kind and name, as the typed command does, and it is checked against the document it is applied to. Every change to a
 * canvas is one of these, whether it came from a gesture, a shortcut, the command bar, a template or a test.
 */

export interface DeclareExchange {
  readonly type: 'declare-exchange';
  readonly name: string;
  readonly exchangeType: ExchangeType;
  readonly durable: boolean;
  readonly autoDelete: boolean;
  readonly internal: boolean;
}

export interface DeclareQueue {
  readonly type: 'declare-queue';
  readonly name: string;
  /** RabbitMQ 4.3 refuses a queue that is not durable, and so does the command (ADR-0024). */
  readonly durable: boolean;
}

export interface AddProducer {
  readonly type: 'add-producer';
  readonly name: string;
}

export interface AddConsumer {
  readonly type: 'add-consumer';
  readonly name: string;
}

/** An exchange is bound to a queue or to another exchange. Binding what is already bound changes nothing. */
export interface BindCommand {
  readonly type: 'bind';
  /** The name of an exchange. The default exchange, whose name is empty, cannot be bound from. */
  readonly source: string;
  readonly destination: Destination;
  readonly key: string;
  /** The arguments of a binding. Left out, the binding has none. */
  readonly headers?: HeaderArguments;
}

export interface UnbindCommand {
  readonly type: 'unbind';
  readonly source: string;
  readonly destination: Destination;
  readonly key: string;
  readonly headers?: HeaderArguments;
}

/** A producer publishes to an exchange, or to a queue through the default exchange. It has one target. */
export interface Link {
  readonly type: 'link';
  readonly producer: string;
  readonly target: { readonly kind: 'exchange' | 'queue'; readonly name: string };
}

export interface Unlink {
  readonly type: 'unlink';
  readonly producer: string;
}

/** A consumer consumes from queues, as many as it likes. */
export interface Subscribe {
  readonly type: 'subscribe';
  readonly consumer: string;
  readonly queue: string;
}

export interface Unsubscribe {
  readonly type: 'unsubscribe';
  readonly consumer: string;
  readonly queue: string;
}

export interface ExchangeChanges {
  readonly exchangeType?: ExchangeType;
  readonly durable?: boolean;
  readonly autoDelete?: boolean;
  readonly internal?: boolean;
}

export interface QueueChanges {
  readonly durable?: boolean;
}

export interface ProducerChanges {
  readonly payload?: string;
  /** The routing key of the message. */
  readonly key?: string;
  /** How many messages one publish sends. */
  readonly burst?: number;
  readonly everyMs?: number;
  /** Whether it publishes again and again, `everyMs` apart. */
  readonly repeat?: boolean;
  /** Headers to set on the message. A header that it has already gets the new value. */
  readonly headers?: readonly HeaderEntry<HeaderValue>[];
}

export interface ConsumerChanges {
  readonly ack?: 'auto' | 'manual';
  /** 0 means no limit. */
  readonly prefetch?: number;
  readonly processingMs?: number;
}

export interface CanvasChanges {
  readonly showDefaultExchange?: boolean;
  readonly seed?: number;
  readonly publishMs?: number;
  readonly brokerMs?: number;
  readonly deliverMs?: number;
}

/** Sets attributes of one element, or of the canvas. */
export type SetCommand =
  | { readonly type: 'set'; readonly kind: 'exchange'; readonly name: string; readonly changes: ExchangeChanges }
  | { readonly type: 'set'; readonly kind: 'queue'; readonly name: string; readonly changes: QueueChanges }
  | { readonly type: 'set'; readonly kind: 'producer'; readonly name: string; readonly changes: ProducerChanges }
  | { readonly type: 'set'; readonly kind: 'consumer'; readonly name: string; readonly changes: ConsumerChanges }
  | { readonly type: 'set'; readonly kind: 'canvas'; readonly changes: CanvasChanges };

/** Takes headers off the message of a producer. */
export interface Unset {
  readonly type: 'unset';
  readonly kind: 'producer';
  readonly name: string;
  /** The names of the headers to take off. */
  readonly headers: readonly string[];
}

/** Puts a node somewhere. A coordinate that is left out stays where it was. */
export interface Move {
  readonly type: 'move';
  readonly target: ElementRef;
  readonly x?: number;
  readonly y?: number;
}

/** Puts the label of an edge somewhere along it: 0 is at its start and 1 at its end. */
export interface MoveLabel {
  readonly type: 'move-label';
  readonly from: ElementRef;
  readonly to: ElementRef;
  readonly at: number;
}

export interface Rename {
  readonly type: 'rename';
  readonly target: ElementRef;
  readonly name: string;
}

/** Deletes an element and the edges that it has: its bindings, its link, its subscriptions. */
export interface Delete {
  readonly type: 'delete';
  readonly target: ElementRef;
}

/** Takes everything off the canvas. Its vhost and its settings stay. */
export interface Clear {
  readonly type: 'clear';
}

/** Puts every node in its place, left to right: producers, exchanges, queues, consumers. */
export interface Layout {
  readonly type: 'layout';
}

/** Several commands that are one change: they all apply, or none does, and undo takes them back together. */
export interface Batch {
  readonly type: 'batch';
  readonly commands: readonly DocumentCommand[];
}

/** A command that changes the document. */
export type DocumentCommand =
  | DeclareExchange
  | DeclareQueue
  | AddProducer
  | AddConsumer
  | BindCommand
  | UnbindCommand
  | Link
  | Unlink
  | Subscribe
  | Unsubscribe
  | SetCommand
  | Unset
  | Move
  | MoveLabel
  | Rename
  | Delete
  | Clear
  | Layout
  | Batch;

export interface Undo {
  readonly type: 'undo';
}

export interface Redo {
  readonly type: 'redo';
}

/** A command about the history of the document and not about the document: the app answers it from its `History`. */
export type AppCommand = Undo | Redo;

export type Command = DocumentCommand | AppCommand;
