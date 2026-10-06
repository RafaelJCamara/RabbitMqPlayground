import type { ElementKind } from '@rmq/domain';
import type { ExchangeType } from '@rmq/engine';

/**
 * Our own names for what is on the canvas (ADR-0017, section 5). Foblex's are poor ("order-eventsqueue"), and it keeps a label
 * that the app has set. A label says what a thing is, and never a live count, so that a running simulation does not make a screen
 * reader talk.
 */

const KIND: Readonly<Record<ElementKind, string>> = {
  producer: 'Producer',
  exchange: 'Exchange',
  queue: 'Queue',
  consumer: 'Consumer',
};

/** `Queue billing`, `Exchange orders, topic`. */
export function nodeLabel(kind: ElementKind, name: string, exchangeType?: ExchangeType): string {
  return `${KIND[kind]} ${name}${kind === 'exchange' && exchangeType !== undefined ? `, ${exchangeType}` : ''}`;
}

/** The label with its first letter in lower case, for a sentence that goes on after it: `Linking from exchange orders`. */
export const lowerFirst = (text: string): string => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

export interface BindingEnds {
  readonly from: string;
  readonly to: string;
  readonly toKind: 'queue' | 'exchange';
  /** The keys of the bindings between the two ends, in the order they were made. An empty key is a binding with no key. */
  readonly keys: readonly string[];
  /** Whether a binding between them has header arguments. */
  readonly hasArguments: boolean;
}

/** `Binding from exchange orders to queue billing, keys order.*, invoice.#`. */
export function bindingLabel({ from, to, toKind, keys, hasArguments }: BindingEnds): string {
  const named = [...new Set(keys.filter((key) => key !== ''))];
  const parts = [`Binding from exchange ${from} to ${toKind} ${to}`];
  if (named.length > 0) {
    parts.push(`${named.length === 1 ? 'key' : 'keys'} ${named.join(', ')}`);
  }
  if (hasArguments) {
    parts.push('with header arguments');
  }
  return parts.join(', ');
}

export const linkLabel = (producer: string, kind: 'exchange' | 'queue', target: string): string =>
  `Producer ${producer} publishes to ${kind} ${target}`;

export const subscriptionLabel = (consumer: string, queue: string): string =>
  `Consumer ${consumer} consumes from queue ${queue}`;
