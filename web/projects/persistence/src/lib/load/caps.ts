import { tooLarge, type LoadError } from '../errors';

/**
 * How much a document may hold (ADR-0027). The schema has ranges for its numbers and the validation has the 255 bytes of a
 * name, but nothing else bounded a document, and one with a million exchanges would be read to the end before anyone said so.
 * The caps are checked on the data before the schema runs, and they sit about ten times above the 200 nodes and 500 edges that
 * the plan runs, so that nothing a learner builds comes near them.
 */
export const SIZE_CAPS = {
  /** Exchanges, queues, producers and consumers together. */
  elements: 2_000,
  /** Bindings, producer links and consumer subscriptions together. */
  edges: 5_000,
  /** Entries in the headers of one message, or in the arguments of one binding. */
  headers: 100,
  /** Characters of one payload, and of one header value that is text. */
  text: 10_000,
  /** Characters in the text of a file or a backup. */
  file: 50_000_000,
  /** Canvases in a backup. */
  canvases: 1_000,
  /** Characters in the name of a canvas. */
  name: 200,
} as const;

type Raw = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): number => (isRecord(value) ? Object.keys(value).length : 0);
const valuesOf = (value: unknown): unknown[] => (isRecord(value) ? Object.values(value) : []);

const checkText = (value: unknown): LoadError | null =>
  typeof value === 'string' && value.length > SIZE_CAPS.text ? tooLarge('text', value.length, SIZE_CAPS.text) : null;

/** The entries of a table of headers or of arguments: how many there are, and how long the text of each value is. */
function checkEntries(entries: unknown): LoadError | null {
  if (!Array.isArray(entries)) {
    return null;
  }
  if (entries.length > SIZE_CAPS.headers) {
    return tooLarge('headers', entries.length, SIZE_CAPS.headers);
  }
  for (const entry of entries) {
    const value = isRecord(entry) ? entry['value'] : undefined;
    const error = isRecord(value) ? checkText(value['v']) : null;
    if (error !== null) {
      return error;
    }
  }
  return null;
}

/**
 * The first cap that the data is over, or `null`. It counts and does not read: what is not the shape of a document is left to
 * the schema, and the work stays small however much the data holds, because each count is made before anything is walked.
 * The order is the elements, the edges, the layout, then the producers and then the bindings.
 */
export function checkCaps(raw: unknown): LoadError | null {
  if (!isRecord(raw)) {
    return null;
  }

  const elements = count(raw['exchanges']) + count(raw['queues']) + count(raw['producers']) + count(raw['consumers']);
  if (elements > SIZE_CAPS.elements) {
    return tooLarge('elements', elements, SIZE_CAPS.elements);
  }

  const producers = valuesOf(raw['producers']);
  const links = producers.filter((producer) => isRecord(producer) && (producer['target'] ?? null) !== null).length;
  const subscriptions = valuesOf(raw['consumers']).reduce<number>(
    (sum, consumer) => sum + (isRecord(consumer) && Array.isArray(consumer['queues']) ? consumer['queues'].length : 0),
    0,
  );
  const edges = count(raw['bindings']) + links + subscriptions;
  if (edges > SIZE_CAPS.edges) {
    return tooLarge('edges', edges, SIZE_CAPS.edges);
  }

  const layout = raw['layout'];
  if (isRecord(layout)) {
    const positions = count(layout['nodes']);
    if (positions > SIZE_CAPS.elements) {
      return tooLarge('positions', positions, SIZE_CAPS.elements);
    }
    const labels = count(layout['labels']);
    if (labels > SIZE_CAPS.edges) {
      return tooLarge('labels', labels, SIZE_CAPS.edges);
    }
  }

  for (const producer of producers) {
    const message = isRecord(producer) ? producer['message'] : undefined;
    const error = isRecord(message) ? (checkText(message['payload']) ?? checkEntries(message['headers'])) : null;
    if (error !== null) {
      return error;
    }
  }
  for (const binding of valuesOf(raw['bindings'])) {
    const headers = isRecord(binding) ? binding['headers'] : undefined;
    const error = isRecord(headers) ? checkEntries(headers['args']) : null;
    if (error !== null) {
      return error;
    }
  }
  return null;
}

/** The name of a canvas is the one thing that someone types, so it has a cap of its own. */
export const checkName = (name: string): LoadError | null =>
  name.length > SIZE_CAPS.name ? tooLarge('name', name.length, SIZE_CAPS.name) : null;
