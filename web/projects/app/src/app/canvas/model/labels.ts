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

/** `Queue billing`, `Exchange orders, topic`, and for a node that has lints `Exchange orders, topic, 1 warning` (ADR-0044). */
export function nodeLabel(kind: ElementKind, name: string, exchangeType?: ExchangeType, warnings = 0): string {
  const type = kind === 'exchange' && exchangeType !== undefined ? `, ${exchangeType}` : '';
  const lints = warnings === 0 ? '' : `, ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`;
  return `${KIND[kind]} ${name}${type}${lints}`;
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

export const linkLabel = (producer: string, kind: 'exchange' | 'queue', target: string, viaDefault = false): string =>
  `Producer ${producer} publishes to ${kind} ${target}${viaDefault ? ', through the default exchange' : ''}`;

/** The edge from the default exchange to a queue, which RabbitMQ makes for every queue, with the name of the queue as its key (ADR-0043). */
export const implicitLabel = (queue: string): string =>
  `Implicit binding from the default exchange to queue ${queue}, key ${queue}`;

export const subscriptionLabel = (consumer: string, queue: string): string =>
  `Consumer ${consumer} consumes from queue ${queue}`;

/** How many chips an edge shows before it says how many more there are (ADR-0044). */
export const MAX_CHIPS = 3;

/** What one binding says about itself on an edge. */
export interface BindingFacts {
  readonly key: string;
  readonly hasArguments: boolean;
}

/**
 * What an edge between an exchange and what it is bound to says, as chips (ADR-0044): the key of each binding, in the order that they were made, and
 * the same text once. An empty key is said where it matters, which is for a direct or a topic exchange, and is nothing for one that ignores the key. A
 * binding that has header arguments is a chip `headers`, once, after the keys.
 */
export function chipsOf(type: ExchangeType | undefined, bindings: readonly BindingFacts[]): string[] {
  const texts: string[] = [];
  for (const { key } of bindings) {
    if (key !== '') {
      texts.push(key);
    } else if (type === 'direct' || type === 'topic') {
      texts.push('(empty key)');
    }
  }
  if (bindings.some(({ hasArguments }) => hasArguments)) {
    texts.push('headers');
  }
  return [...new Set(texts)];
}

/** The chips that are shown, and the ones that "+N more" stands for. */
export function splitChips(all: readonly string[]): { readonly chips: string[]; readonly more: string[] } {
  return { chips: all.slice(0, MAX_CHIPS), more: all.slice(MAX_CHIPS) };
}
