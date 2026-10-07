import type { ExchangeType } from './topology';

/**
 * What a declaration that repeats is made of (ADR-0051). A broker treats a declaration as "make sure that this is there":
 * one that says the same as what is there changes nothing, and one that does not is refused with 406, and names the first
 * attribute that differs, in the order that the broker checks them. The engine's dispatcher and the commands of the domain
 * ask the same question, so it is asked here, once.
 */

export interface ExchangeAttributes {
  readonly type: ExchangeType;
  readonly durable: boolean;
  readonly autoDelete: boolean;
  readonly internal: boolean;
}

/** An attribute that a declaration that repeats says differently, as the broker names it, and the two values as it writes them. */
export interface Difference {
  readonly attribute: 'type' | 'durable' | 'auto_delete' | 'internal';
  /** What the declaration says. */
  readonly received: string;
  /** What the exchange or the queue has. */
  readonly current: string;
}

/** The first attribute of an exchange, in the broker's order (type, durable, auto_delete, internal), that `wanted` says differently, or `null`. */
export function exchangeDifference(current: ExchangeAttributes, wanted: ExchangeAttributes): Difference | null {
  if (wanted.type !== current.type) {
    return { attribute: 'type', received: wanted.type, current: current.type };
  }
  if (wanted.durable !== current.durable) {
    return { attribute: 'durable', received: String(wanted.durable), current: String(current.durable) };
  }
  if (wanted.autoDelete !== current.autoDelete) {
    return { attribute: 'auto_delete', received: String(wanted.autoDelete), current: String(current.autoDelete) };
  }
  if (wanted.internal !== current.internal) {
    return { attribute: 'internal', received: String(wanted.internal), current: String(current.internal) };
  }
  return null;
}

/** The first attribute of a queue that `wanted` says differently, or `null`. A queue here has one, `durable`, and no auto-delete. */
export function queueDifference(
  current: { readonly durable: boolean },
  wanted: { readonly durable: boolean },
): Difference | null {
  return wanted.durable === current.durable
    ? null
    : { attribute: 'durable', received: String(wanted.durable), current: String(current.durable) };
}
