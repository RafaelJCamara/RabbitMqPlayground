import { BINDING_OPTION_NAMES, formatCondition, type ElementKind } from '@rmq/domain';
import type { ExchangeType, HeaderArguments } from '@rmq/engine';

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
  /** What each headers binding between them asks, in words (`x-match all: format=pdf`) (ADR-0070). A binding of an exchange that does not read headers has none, and its label says only that there are arguments. */
  readonly conditions?: readonly string[];
}

/** `Binding from exchange orders to queue billing, keys order.*, invoice.#`. */
export function bindingLabel({ from, to, toKind, keys, hasArguments, conditions = [] }: BindingEnds): string {
  const named = [...new Set(keys.filter((key) => key !== ''))];
  const parts = [`Binding from exchange ${from} to ${toKind} ${to}`];
  if (named.length > 0) {
    parts.push(`${named.length === 1 ? 'key' : 'keys'} ${named.join(', ')}`);
  }
  if (conditions.length > 0) {
    parts.push(conditions.join('; '));
  } else if (hasArguments) {
    parts.push('with header arguments');
  }
  return parts.join(', ');
}

/** What joins the mode and the conditions in the chip of a headers binding (ADR-0070). */
export const CHIP_SEPARATOR = ' · ';

/** How many conditions the chip of a binding names before it says how many more there are. */
export const MAX_CONDITIONS = 3;

/** The text of a chip as it is drawn, and as the card shows it whole. */
export interface ChipText {
  readonly short: string;
  readonly full: string;
}

/** Whether a chip is the conditions of a headers binding: it begins with its mode and a separator, which is not how a key begins, and it goes on to more lines where a key is cut (ADR-0071). */
export const isConditionsChip = (chip: string): boolean =>
  ['all', 'any', 'all-with-x', 'any-with-x'].some((mode) => chip.startsWith(`${mode}${CHIP_SEPARATOR}`));

/** A space that does not let a line end after it: what goes before a dot in a chip, so that the dot stays with the word that it follows. */
const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

/**
 * What a chip says as it is drawn: the text of a headers binding goes on to the next line after a separator and not before it, so that no line begins with a dot, and the count of what is left out
 * is not broken in two (ADR-0071).
 */
export const chipDisplay = (chip: string): string =>
  isConditionsChip(chip)
    ? chip.replaceAll(CHIP_SEPARATOR, `${NO_BREAK_SPACE}· `).replace(/ more$/, `${NO_BREAK_SPACE}more`)
    : chip;

/** The conditions of a binding as a chip writes them: as the grammar writes them (`n=1`, `s="1"`, `exists(f)`), and `(ignored)` after one that the mode does not count. */
function conditionTexts(headers: HeaderArguments | undefined): string[] {
  const counts = headers?.xMatch === 'all-with-x' || headers?.xMatch === 'any-with-x';
  return (headers?.args ?? []).map(
    ({ key, value }) =>
      `${formatCondition(key, value, BINDING_OPTION_NAMES)}${!counts && key.startsWith('x-') ? ' (ignored)' : ''}`,
  );
}

/**
 * The chip of a headers binding (ADR-0070): the mode first, written out also when the binding left it out, and then its conditions, three at most and then `+N more`, so that the count of what is not
 * shown is in the text and not in what a cut takes away. The full text has them all.
 */
export function headersChip(headers: HeaderArguments | undefined): ChipText {
  const mode = headers?.xMatch ?? 'all';
  const conditions = conditionTexts(headers);
  if (conditions.length === 0) {
    const text = [mode, 'no conditions'].join(CHIP_SEPARATOR);
    return { short: text, full: text };
  }
  const shown = conditions.slice(0, MAX_CONDITIONS);
  const hidden = conditions.length - shown.length;
  return {
    short: [mode, ...shown, ...(hidden > 0 ? [`+${hidden} more`] : [])].join(CHIP_SEPARATOR),
    full: [mode, ...conditions].join(CHIP_SEPARATOR),
  };
}

/** What a headers binding asks, as the label of an edge says it (ADR-0070): `x-match all: format=pdf, n=1`. */
export function headersSentence(headers: HeaderArguments | undefined): string {
  const mode = `x-match ${headers?.xMatch ?? 'all'}`;
  const conditions = conditionTexts(headers);
  return conditions.length === 0 ? `${mode}, no conditions` : `${mode}: ${conditions.join(', ')}`;
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
  /** Its arguments, for the chip that names its conditions. */
  readonly headers?: HeaderArguments;
}

/**
 * What an edge between an exchange and what it is bound to says, as chips (ADR-0044): the key of each binding, in the order that they were made, and
 * the same text once. An empty key is said where it matters, which is for a direct or a topic exchange, and is nothing for one that ignores the key. A
 * binding of another exchange that has header arguments is a chip `headers`, once, after the keys. A binding of a headers exchange is a chip of its own that
 * says its mode and its first conditions, after its key (ADR-0070).
 */
export function chipsOf(type: ExchangeType | undefined, bindings: readonly BindingFacts[]): ChipText[] {
  const detailed = type === 'headers';
  const texts: ChipText[] = [];
  for (const { key, headers } of bindings) {
    if (key !== '') {
      texts.push({ short: key, full: key });
    } else if (type === 'direct' || type === 'topic') {
      texts.push({ short: '(empty key)', full: '(empty key)' });
    }
    if (detailed) {
      texts.push(headersChip(headers));
    }
  }
  if (!detailed && bindings.some(({ hasArguments }) => hasArguments)) {
    texts.push({ short: 'headers', full: 'headers' });
  }
  const seen = new Set<string>();
  return texts.filter(({ short, full }) => !seen.has(`${short}\n${full}`) && seen.add(`${short}\n${full}`));
}

/** The chips that are shown, the ones that "+N more" stands for, and the whole text of all of them for the card, which says whether a chip was cut. */
export function splitChips(all: readonly ChipText[]): {
  readonly chips: string[];
  readonly more: string[];
  readonly cards: string[];
  readonly cut: boolean;
} {
  const shorts = all.map(({ short }) => short);
  return {
    chips: shorts.slice(0, MAX_CHIPS),
    more: shorts.slice(MAX_CHIPS),
    cards: all.map(({ full }) => full),
    cut: all.some(({ short, full }) => short !== full),
  };
}
