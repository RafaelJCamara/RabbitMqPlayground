import type { HeaderArguments, HeaderEntry, HeaderValue } from './headers';

/**
 * What the router needs to know about a broker's topology and about a message (ADR-0007). Everything here is plain data,
 * so it can be saved, sent to a Web Worker and compared. Names are the broker's own names, which are unique among
 * exchanges and unique among queues, and may be the same across the two.
 */

export type ExchangeType = 'direct' | 'fanout' | 'topic' | 'headers';

export interface Exchange {
  readonly name: string;
  readonly type: ExchangeType;
  /** A client cannot publish to an internal exchange (ADR-0008, rule 8), but another exchange can route through it. */
  readonly internal: boolean;
}

export interface Destination {
  readonly kind: 'queue' | 'exchange';
  readonly name: string;
}

export interface Binding {
  /** The exchange that the binding starts from. Never the default exchange, which cannot have one (ADR-0008, rule 6). */
  readonly source: string;
  readonly destination: Destination;
  /** The routing or binding key. `""` when the source is a fanout or a headers exchange, which do not look at it. */
  readonly key: string;
  /** For a binding on a headers exchange. Left out, the binding has no arguments. */
  readonly headers?: HeaderArguments;
}

export interface Topology {
  /** The vhost, which the broker names in some of its refusals. A canvas has `/` unless it says otherwise. */
  readonly vhost: string;
  readonly exchanges: readonly Exchange[];
  readonly queues: readonly string[];
  /** In the order they were made. An exchange looks at its own bindings in that order. */
  readonly bindings: readonly Binding[];
}

/** A message as a client publishes it. */
export interface Message {
  /** `""` is the default exchange. */
  readonly exchange: string;
  /** At most 255 bytes of UTF-8, which is as long as AMQP can write one. */
  readonly key: string;
  /** Typed headers. A key may appear once, and if it appears twice the first one is read. */
  readonly headers: readonly HeaderEntry<HeaderValue>[];
}
