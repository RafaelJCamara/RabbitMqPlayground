import { headerValueIssue, RABBITMQ_BASELINE, type HeaderCondition } from '@rmq/engine';
import { z } from 'zod';

/**
 * The canvas document: everything that a canvas is, and nothing that a simulation is (queue contents and counters are
 * the engine's). It is plain data that survives JSON. It is immutable, and it is the unit of undo (ADR-0019): a command
 * returns a new document, and the branches that it did not touch are the same objects as before.
 *
 * Ids are stable and names are attributes, so a rename keeps every reference. A record is keyed by id, and ids are never
 * numbers in disguise, so a record lists its entries in the order they were made. Names are unique within a kind.
 *
 * The schema says what shape the data has. What the data means (names, references, the broker's rules) is the validation's
 * (`validateDocument`), because that is where the broker's refusals are reproduced and explained.
 */

/** The source of an id: a letter first, so that no id is an array index, which a JavaScript object would put first. */
export const ID_SOURCE = '[A-Za-z][A-Za-z0-9_.:-]{0,63}';
export const ID_PATTERN = new RegExp(`^${ID_SOURCE}$`);
/** The key of an edge's label: the id that it starts from, `>`, and the id that it ends at. */
export const EDGE_KEY_PATTERN = new RegExp(`^${ID_SOURCE}>${ID_SOURCE}$`);

/** The ranges of the numbers that a command can set. A document that a command made always loads again. */
export const LIMITS = {
  /** Messages that a producer publishes at once. */
  burst: { min: 1, max: 1000 },
  /** Virtual milliseconds between the publishes of a producer that repeats. */
  everyMs: { min: 1, max: 3_600_000 },
  /** AMQP writes the prefetch count as a short, and 0 means no limit (ADR-0008, rule 15). */
  prefetch: { min: 0, max: 65_535 },
  /** Virtual milliseconds that a consumer takes to process a message. */
  processingMs: { min: 0, max: 3_600_000 },
  /** Virtual milliseconds of each leg of a message's journey. */
  timingMs: { min: 0, max: 60_000 },
  /** The seed of the engine's PRNG: an unsigned 32-bit integer. */
  seed: { min: 0, max: 0xffff_ffff },
  /** How far from the origin a node may be put. */
  coordinate: 1_000_000,
} as const;

const idSchema = z.string().regex(ID_PATTERN);
const integerIn = ({ min, max }: { readonly min: number; readonly max: number }) => z.number().int().min(min).max(max);
const exchangeTypeSchema = z.enum(['direct', 'fanout', 'topic', 'headers']);
const xMatchSchema = z.enum(['all', 'any', 'all-with-x', 'any-with-x']);

/** A header value is always tagged with its type, because JSON cannot tell `1` from `1.0` (ADR-0009). */
const valueVariants = [
  z.strictObject({ t: z.literal('string'), v: z.string() }),
  z.strictObject({ t: z.literal('integer'), v: z.number() }),
  z.strictObject({ t: z.literal('float'), v: z.number() }),
  z.strictObject({ t: z.literal('boolean'), v: z.boolean() }),
] as const;
const existsVariant = z.strictObject({ t: z.literal('exists') });

/** The one rule about what a value may be lives in the engine (ADR-0023), and this is where a document learns it. */
const checkValue = (
  value: HeaderCondition,
  context: { addIssue(issue: { code: 'custom'; message: string }): void },
) => {
  const issue = headerValueIssue(value);
  if (issue !== null) {
    context.addIssue({ code: 'custom', message: issue });
  }
};

const headerValueSchema = z.discriminatedUnion('t', [...valueVariants]).superRefine(checkValue);
const headerConditionSchema = z.discriminatedUnion('t', [...valueVariants, existsVariant]).superRefine(checkValue);

const headerArgumentsSchema = z.strictObject({
  xMatch: xMatchSchema.nullable(),
  args: z.array(z.strictObject({ key: z.string(), value: headerConditionSchema })),
});

const exchangeSchema = z.strictObject({
  name: z.string(),
  type: exchangeTypeSchema,
  durable: z.boolean(),
  autoDelete: z.boolean(),
  internal: z.boolean(),
});

const queueSchema = z.strictObject({
  name: z.string(),
  /** The broker chose the name, so `amq.` is allowed in it. Nothing in M1 makes one, but a file or an import may. */
  serverNamed: z.boolean(),
  /** RabbitMQ 4.3 refuses a queue that is not durable, unless it is exclusive, which M1 does not model (ADR-0024). */
  durable: z.boolean(),
});

const bindingSchema = z.strictObject({
  source: idSchema,
  dest: z.strictObject({ kind: z.enum(['queue', 'exchange']), id: idSchema }),
  key: z.string(),
  headers: headerArgumentsSchema.optional(),
});

const producerSchema = z.strictObject({
  name: z.string(),
  /** Where it publishes. A queue means the default exchange, with the queue's name as the routing key. */
  target: z.strictObject({ kind: z.enum(['exchange', 'queue']), id: idSchema }).nullable(),
  message: z.strictObject({
    payload: z.string(),
    key: z.string(),
    headers: z.array(z.strictObject({ key: z.string(), value: headerValueSchema })),
  }),
  burst: integerIn(LIMITS.burst),
  interval: z.strictObject({ everyMs: integerIn(LIMITS.everyMs), on: z.boolean() }),
});

const consumerSchema = z.strictObject({
  name: z.string(),
  queues: z.array(idSchema),
  ack: z.enum(['auto', 'manual']),
  /** 0 means no limit. */
  prefetch: integerIn(LIMITS.prefetch),
  processingMs: integerIn(LIMITS.processingMs),
});

const coordinate = z.number().min(-LIMITS.coordinate).max(LIMITS.coordinate);
const timingMs = integerIn(LIMITS.timingMs);

export const canvasDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1),
  rabbitmqBaseline: z.literal(RABBITMQ_BASELINE),
  /** The vhost, which the broker names in some of its refusals. `/` unless the canvas says otherwise. */
  vhost: z.string(),
  exchanges: z.record(idSchema, exchangeSchema),
  queues: z.record(idSchema, queueSchema),
  bindings: z.record(idSchema, bindingSchema),
  producers: z.record(idSchema, producerSchema),
  consumers: z.record(idSchema, consumerSchema),
  layout: z.strictObject({
    /** A position for each exchange, queue, producer and consumer, by id. */
    nodes: z.record(idSchema, z.strictObject({ x: coordinate, y: coordinate })),
    /** Where along an edge its label sits, from 0 at the start to 1 at the end. */
    labels: z.record(z.string().regex(EDGE_KEY_PATTERN), z.strictObject({ at: z.number().min(0).max(1) })),
  }),
  settings: z.strictObject({
    showDefaultExchange: z.boolean(),
    seed: integerIn(LIMITS.seed),
    timing: z.strictObject({ publishMs: timingMs, brokerMs: timingMs, deliverMs: timingMs }),
  }),
});

type DeepReadonly<T> = T extends readonly (infer Item)[]
  ? readonly DeepReadonly<Item>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T;

export type CanvasDocument = DeepReadonly<z.infer<typeof canvasDocumentSchema>>;

export type Id = string;
export type ExchangeRecord = CanvasDocument['exchanges'][Id];
export type QueueRecord = CanvasDocument['queues'][Id];
export type BindingRecord = CanvasDocument['bindings'][Id];
export type ProducerRecord = CanvasDocument['producers'][Id];
export type ConsumerRecord = CanvasDocument['consumers'][Id];
export type Position = CanvasDocument['layout']['nodes'][Id];

/** The defaults of a new canvas. */
export const DEFAULT_SEED = 1;
export const DEFAULT_TIMING = { publishMs: 500, brokerMs: 300, deliverMs: 500 } as const;

export interface NewDocumentOptions {
  readonly vhost?: string;
  readonly seed?: number;
}

/** A canvas with nothing on it. */
export function emptyDocument(options: NewDocumentOptions = {}): CanvasDocument {
  return {
    schemaVersion: 1,
    rabbitmqBaseline: RABBITMQ_BASELINE,
    vhost: options.vhost ?? '/',
    exchanges: {},
    queues: {},
    bindings: {},
    producers: {},
    consumers: {},
    layout: { nodes: {}, labels: {} },
    settings: { showDefaultExchange: false, seed: options.seed ?? DEFAULT_SEED, timing: { ...DEFAULT_TIMING } },
  };
}
