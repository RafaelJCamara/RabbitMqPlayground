import type {
  BindingOutcome,
  Destination,
  ExchangeType,
  Message,
  RoutePath,
  TopicMiss,
  TopicSegment,
  XMatch,
} from '@rmq/engine';
import type { ConditionLine } from './headers-words';

/**
 * What a learner is told about a message and a topology (ADR-0060): plain data that survives JSON, made by one function and drawn by a template and printed for a golden file. The sentences are written
 * once, with the parts that they were made of beside them, so that a template can mark a word and a test can read both.
 */

/** What a binding compared, as data. */
export type BindingDetail =
  | { readonly kind: 'direct'; readonly bindingKey: string; readonly routingKey: string }
  | { readonly kind: 'fanout' }
  | {
      readonly kind: 'topic';
      readonly pattern: readonly string[];
      readonly key: readonly string[];
      /** Every word of the pattern, with the key words that it took (ADR-0059). */
      readonly segments: readonly TopicSegment[];
      readonly miss?: TopicMiss;
    }
  | {
      readonly kind: 'headers';
      readonly xMatch: XMatch;
      /** The binding left `x-match` out, which means `all`. */
      readonly omitted: boolean;
      readonly conditions: readonly ConditionLine[];
      /** How many conditions took part, and how many of those held. */
      readonly counted: number;
      readonly passed: number;
    }
  /** The implicit binding of the default exchange: the queue that has the routing key as its name. */
  | { readonly kind: 'default'; readonly queue: string; readonly routingKey: string };

/** One binding that a message met, matched or not. */
export interface BindingNode {
  /** Where the binding is in `topology.bindings`, or `null` for an implicit binding of the default exchange. */
  readonly index: number | null;
  /** The exchange that it starts from. The default exchange is `""`. */
  readonly from: string;
  readonly to: Destination;
  /** The binding as a person says it: its key, or its `x-match` and conditions. */
  readonly label: string;
  readonly verdict: 'matched' | 'missed';
  /** It matched, and what became of the message was new: it gave a queue its first copy, or took the message to an exchange that had not been reached. */
  readonly followed: boolean;
  /** What came of a binding that matched. */
  readonly outcome?: BindingOutcome;
  /** The reason in few words (at most 48 characters), for the label of an edge. */
  readonly short: string;
  /** The reason as a sentence, cause first. */
  readonly text: string;
  readonly detail: BindingDetail;
  /** The exchange that this binding took the message to, when it was the first to reach it. */
  readonly next: ExchangeNode | null;
}

/** An exchange that the message reached, with every binding that starts from it. */
export interface ExchangeNode {
  /** The default exchange is `""`. */
  readonly name: string;
  readonly type: ExchangeType | 'default';
  readonly text: string;
  readonly bindings: readonly BindingNode[];
}

interface Explained {
  readonly message: Message;
}

/** The message could not be sent at all: a key over 255 bytes, a header that is not exact. A client refuses before the broker sees it. */
export interface InvalidExplanation extends Explained {
  readonly outcome: 'invalid';
  readonly text: string;
}

/** The broker refuses the publish: an exchange that is not there, or is internal. The cause comes first and the broker's reply after it. */
export interface RefusedExplanation extends Explained {
  readonly outcome: 'refused';
  readonly code: 403 | 404;
  readonly reply: string;
  readonly text: string;
}

/** The message was routed, to some queues or to none. */
export interface RoutedExplanation extends Explained {
  readonly outcome: 'routed' | 'unroutable';
  /** The queues that got a copy, in the order that they were reached. */
  readonly queues: readonly string[];
  /** The queues that did not, in the order of the topology. */
  readonly unreached: readonly string[];
  readonly paths: readonly RoutePath[];
  /** The exchange that the message was published to, with the whole tree under it. */
  readonly root: ExchangeNode;
  readonly summary: string;
}

export type RouteExplanation = InvalidExplanation | RefusedExplanation | RoutedExplanation;

/** One reason that a queue did not get a message, with what it was made of. */
export type ReasonNode =
  | { readonly kind: 'invalid'; readonly text: string }
  | { readonly kind: 'refused'; readonly text: string; readonly code: 403 | 404; readonly reply: string }
  | { readonly kind: 'no-such-queue'; readonly text: string }
  | { readonly kind: 'default-exchange'; readonly text: string; readonly routingKey: string }
  | { readonly kind: 'no-bindings'; readonly text: string; readonly destination: Destination }
  | { readonly kind: 'binding-did-not-match'; readonly text: string; readonly binding: BindingNode }
  | {
      readonly kind: 'exchange-not-reached';
      readonly text: string;
      readonly binding: number;
      readonly exchange: string;
      readonly because: readonly ReasonNode[];
    }
  | { readonly kind: 'cycle' | 'already-explained'; readonly text: string; readonly exchange: string };

/** What came of one queue: how it got a copy, or why it did not. */
export interface QueueExplanation {
  readonly queue: string;
  readonly reached: boolean;
  /** One sentence: that it did, or did not, get the message. */
  readonly text: string;
  /** For a queue that got a copy: the bindings that took the message to it, in order. */
  readonly path: readonly BindingNode[];
  /** For a queue that did not: every way that it could have been reached, and what stopped each. */
  readonly because: readonly ReasonNode[];
}
