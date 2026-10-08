import { edgeCount, elementCount } from '@rmq/domain';
import type { CanvasRecord } from '@rmq/persistence';
import { thumbnailOf, type Thumbnail } from './thumbnail';

/**
 * What the home knows of a canvas (ADR-0073): a summary made from the record once, so that the home does not hold a thousand documents in memory for a screen
 * that shows their names. What needs the document (a copy, a file, opening it) asks the repository for that one canvas.
 */
export interface CanvasSummary {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Exchanges, queues, producers and consumers together. */
  readonly elements: number;
  /** Bindings, producer links and consumer subscriptions together. */
  readonly edges: number;
  readonly thumbnail: Thumbnail;
}

export function summarise(record: CanvasRecord): CanvasSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    elements: elementCount(record.document),
    edges: edgeCount(record.document),
    thumbnail: thumbnailOf(record.document),
  };
}

export type SortKey = 'edited' | 'created' | 'name' | 'size';

export const SORTS: readonly { readonly key: SortKey; readonly label: string }[] = [
  { key: 'edited', label: 'Last edited' },
  { key: 'created', label: 'Created' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
];

/** The same on every machine: English rules, case and accents do not decide, and numbers are numbers (`Canvas 2` comes before `Canvas 10`). */
const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const byName = (a: CanvasSummary, b: CanvasSummary): number => COLLATOR.compare(a.name, b.name);
const byId = (a: CanvasSummary, b: CanvasSummary): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const ORDERS: Readonly<Record<SortKey, (a: CanvasSummary, b: CanvasSummary) => number>> = {
  edited: (a, b) => b.updatedAt - a.updatedAt,
  created: (a, b) => b.createdAt - a.createdAt,
  name: byName,
  size: (a, b) => b.elements - a.elements,
};

/**
 * The canvases in an order, which is a total one: a tie is broken by the name and then by the id, so that the order is the same every time and
 * a card does not jump when something else changes. The list that comes in is not changed.
 */
export function sortSummaries(canvases: readonly CanvasSummary[], key: SortKey): CanvasSummary[] {
  const first = ORDERS[key];
  return [...canvases].sort((a, b) => first(a, b) || byName(a, b) || byId(a, b));
}

/** Text made to be compared: no accents, no capitals. */
export const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** The canvases that have the text in their names, anywhere in them. An empty text, or one of white space, is all of them. */
export function searchSummaries(canvases: readonly CanvasSummary[], query: string): readonly CanvasSummary[] {
  const needle = fold(query.trim());
  return needle === '' ? canvases : canvases.filter(({ name }) => fold(name).includes(needle));
}

/** How many cards the home draws at first, and how many more each press of "Show more" adds. */
export const PAGE = 48;
