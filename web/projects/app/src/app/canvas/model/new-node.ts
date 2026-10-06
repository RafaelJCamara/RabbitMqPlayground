import type { ElementKind } from '@rmq/domain';
import type { ExchangeType } from '@rmq/engine';

/**
 * What the toolbox can add (ADR-0031, ADR-0032). It is a kind of node, and for an exchange its type, because a learner chooses a
 * type when they pick the exchange up, and changing it later is a `set` in the inspector.
 */
export type NewNode =
  | { readonly kind: 'producer' | 'queue' | 'consumer' }
  | { readonly kind: 'exchange'; readonly exchangeType: ExchangeType };

export const EXCHANGE_TYPES: readonly ExchangeType[] = ['direct', 'fanout', 'topic', 'headers'];

/** A key for a toolbox item, which is also the identity of what is dragged from it. */
export function newNodeKey(node: NewNode): string {
  return node.kind === 'exchange' ? `exchange:${node.exchangeType}` : node.kind;
}

export const kindOfNew = (node: NewNode): ElementKind => node.kind;
