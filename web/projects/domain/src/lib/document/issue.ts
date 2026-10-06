import type { BrokerReply } from '@rmq/engine';

/**
 * What is wrong, in a form that a person can read and a program can act on. Every refusal that a command makes, every
 * problem that the validation finds in a document and every parse error is an `Issue`.
 */

/**
 * Why something was refused. A program branches on this and not on the text.
 *
 * - The ones that name a rule of the broker (`reserved-name`, `default-exchange`, `missing-exchange`, `missing-queue`,
 *   `topic-wildcards`, `transient-queue`, `internal-exchange`) usually carry the broker's own reply too.
 * - The others are rules of the simulator or of the client library, which a broker never gets to answer.
 */
export type IssueKind =
  | 'schema'
  | 'empty-name'
  | 'name-too-long'
  | 'reserved-name'
  | 'default-exchange'
  | 'duplicate-name'
  | 'duplicate-id'
  | 'duplicate-edge'
  | 'missing-exchange'
  | 'missing-queue'
  | 'missing-element'
  | 'ambiguous-name'
  | 'built-in-exchange'
  | 'topic-wildcards'
  | 'transient-queue'
  | 'internal-exchange'
  | 'routing-key'
  | 'header'
  | 'invalid-link'
  | 'not-bound'
  | 'not-linked'
  | 'not-subscribed'
  | 'no-header'
  | 'invalid-value'
  | 'nothing-to-change'
  | 'layout'
  | 'syntax'
  | 'unknown-command'
  | 'unknown-option'
  | 'missing-argument'
  | 'unsupported'
  | 'batch';

export interface Issue {
  readonly kind: IssueKind;
  /**
   * What to tell the person: the root cause, in plain words, and what to do about it where that is not obvious. It is
   * written for someone who is learning RabbitMQ, so it does not assume that they know the broker's wording.
   */
  readonly message: string;
  /**
   * What the broker answers to the same operation, word for word (ADR-0021, ADR-0022). Only for the refusals that were
   * recorded against a real broker. It is shown next to the message, and not instead of it, because the broker's words
   * say what it did, and not always why.
   */
  readonly refusal?: BrokerReply;
  /** Names that were probably meant, closest first. */
  readonly suggestions?: readonly string[];
  /** Where in the document the problem is, for example `['queues', 'q1', 'durable']`. */
  readonly path?: readonly string[];
  /** Where in the typed command the problem is: character offsets into the text. */
  readonly at?: { readonly start: number; readonly end: number };
  /** For a command inside a batch: which one, counting from 0. */
  readonly batchIndex?: number;
}

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Issue };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = (error: Issue): Result<never> => ({ ok: false, error });

/** The four kinds of element that a canvas holds, and that a command can name. */
export type ElementKind = 'exchange' | 'queue' | 'producer' | 'consumer';

export const ELEMENT_KINDS: readonly ElementKind[] = ['exchange', 'queue', 'producer', 'consumer'];

/** An element, as a command names it: by kind and name. Ids stay inside the document (ADR-0026). */
export interface ElementRef {
  readonly kind: ElementKind;
  readonly name: string;
}
