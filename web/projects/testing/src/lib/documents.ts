import {
  emptyDocument,
  type BindingRecord,
  type CanvasDocument,
  type ConsumerRecord,
  type ExchangeRecord,
  type Id,
  type ProducerRecord,
  type QueueRecord,
} from '@rmq/domain';
import type { HeaderArguments } from '@rmq/engine';

/**
 * Small constructors for canvas documents, so that a spec can say what it means in a few lines. They build records and
 * documents directly, without commands, so that a spec of the commands does not depend on the commands to set up.
 */

export const exchangeRecord = (
  name: string,
  type: ExchangeRecord['type'] = 'direct',
  flags: Partial<Omit<ExchangeRecord, 'name' | 'type'>> = {},
): ExchangeRecord => ({ name, type, durable: true, autoDelete: false, internal: false, ...flags });

export const queueRecord = (name: string, flags: Partial<Omit<QueueRecord, 'name'>> = {}): QueueRecord => ({
  name,
  serverNamed: false,
  durable: true,
  ...flags,
});

export const bindingRecord = (
  source: Id,
  dest: { readonly kind: 'queue' | 'exchange'; readonly id: Id },
  key = '',
  headers?: HeaderArguments,
): BindingRecord => ({ source, dest, key, ...(headers ? { headers } : {}) });

export const producerRecord = (
  name: string,
  target: ProducerRecord['target'] = null,
  overrides: Partial<Omit<ProducerRecord, 'name' | 'target'>> = {},
): ProducerRecord => ({
  name,
  target,
  message: { payload: '', key: '', headers: [] },
  burst: 1,
  interval: { everyMs: 1000, on: false },
  ...overrides,
});

export const consumerRecord = (
  name: string,
  queues: readonly Id[] = [],
  overrides: Partial<Omit<ConsumerRecord, 'name' | 'queues'>> = {},
): ConsumerRecord => ({ name, queues, ack: 'auto', prefetch: 0, processingMs: 500, ...overrides });

export interface DocumentParts {
  readonly vhost?: string;
  readonly exchanges?: Readonly<Record<Id, ExchangeRecord>>;
  readonly queues?: Readonly<Record<Id, QueueRecord>>;
  readonly bindings?: Readonly<Record<Id, BindingRecord>>;
  readonly producers?: Readonly<Record<Id, ProducerRecord>>;
  readonly consumers?: Readonly<Record<Id, ConsumerRecord>>;
  /** Left out, every element gets a position, in a row. Given, it is exactly the positions that the document has. */
  readonly nodes?: CanvasDocument['layout']['nodes'];
  readonly labels?: CanvasDocument['layout']['labels'];
}

/** A document with these records. Unless the spec says where things are, every element has a position. */
export function documentOf(parts: DocumentParts = {}): CanvasDocument {
  const exchanges = parts.exchanges ?? {};
  const queues = parts.queues ?? {};
  const producers = parts.producers ?? {};
  const consumers = parts.consumers ?? {};
  const ids = [...Object.keys(exchanges), ...Object.keys(queues), ...Object.keys(producers), ...Object.keys(consumers)];
  return {
    ...emptyDocument(parts.vhost === undefined ? {} : { vhost: parts.vhost }),
    exchanges,
    queues,
    bindings: parts.bindings ?? {},
    producers,
    consumers,
    layout: {
      nodes: parts.nodes ?? Object.fromEntries(ids.map((id, index) => [id, { x: index * 100, y: 0 }])),
      labels: parts.labels ?? {},
    },
  };
}

/**
 * A canvas with a little of everything and nothing wrong with it. Its ids are in capitals (`E1`, `Q2`, `B3`, `P1`, `C1`),
 * so that they never meet the ones that `sequentialIds` makes for what a spec adds to it.
 *
 *     P1 sender ──▶ E1 orders (topic) ──'order.*'──▶ Q1 billing ──▶ C1 worker
 *                        └──'#'──▶ E3 hidden (fanout, internal)
 *                   E2 docs (headers) ──any pdf──▶ Q2 archive
 */
export const SAMPLE: DocumentParts = {
  exchanges: {
    E1: exchangeRecord('orders', 'topic'),
    E2: exchangeRecord('docs', 'headers'),
    E3: exchangeRecord('hidden', 'fanout', { internal: true }),
  },
  queues: { Q1: queueRecord('billing'), Q2: queueRecord('archive') },
  bindings: {
    B1: bindingRecord('E1', { kind: 'queue', id: 'Q1' }, 'order.*'),
    B2: bindingRecord('E2', { kind: 'queue', id: 'Q2' }, '', {
      xMatch: 'any',
      args: [{ key: 'format', value: { t: 'string', v: 'pdf' } }],
    }),
    B3: bindingRecord('E1', { kind: 'exchange', id: 'E3' }, '#'),
  },
  producers: {
    P1: producerRecord(
      'sender',
      { kind: 'exchange', id: 'E1' },
      {
        message: { payload: 'hello', key: 'order.new', headers: [{ key: 'n', value: { t: 'integer', v: 1 } }] },
        burst: 2,
        interval: { everyMs: 500, on: true },
      },
    ),
  },
  consumers: { C1: consumerRecord('worker', ['Q1'], { ack: 'manual', prefetch: 3, processingMs: 200 }) },
  labels: { 'E1>Q1': { at: 0.5 } },
};

/** A new copy of `SAMPLE`, as a document. */
export const sampleDocument = (): CanvasDocument => documentOf(SAMPLE);
