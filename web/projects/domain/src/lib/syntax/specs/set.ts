import type { HeaderEntry, HeaderValue } from '@rmq/engine';
import type {
  CanvasChanges,
  ConsumerChanges,
  ExchangeChanges,
  ProducerChanges,
  QueueChanges,
  SetCommand,
  Unset,
} from '../../commands/types';
import { ELEMENT_KINDS } from '../../document/issue';
import { LIMITS } from '../../document/schema';
import type { OptionSpec, Tail, TailSpec } from '../cursor';
import { refText, type CommandSpec } from '../spec';
import { formatValue } from '../values';
import { wordText } from '../words';

/**
 * `set` and `unset`: what an element is. Each kind of element has its own attributes, and the table that says which, in the
 * order that `format` writes them, is the one table that the parser, the formatter and the completer all read.
 */

const EXCHANGE_TYPES = ['direct', 'fanout', 'topic', 'headers'] as const;
const bool = { kind: 'bool' } as const;
const whole = ({ min, max }: { readonly min: number; readonly max: number }) => ({ kind: 'int', min, max }) as const;

/** The two options that a message has, for `set` of a producer and for `publish`. */
export const PAYLOAD_OPTION: OptionSpec = {
  name: 'payload',
  value: { kind: 'text' },
  summary: 'the body of the message',
};
export const KEY_OPTION: OptionSpec = {
  name: 'key',
  value: { kind: 'text' },
  summary: 'the routing key of the message',
};

const EXCHANGE: TailSpec = {
  options: [
    { name: 'type', value: { kind: 'enum', values: EXCHANGE_TYPES }, summary: 'how it routes' },
    { name: 'durable', value: bool, summary: 'survives a restart' },
    { name: 'auto-delete', value: bool, summary: 'goes when its last binding does' },
    { name: 'internal', value: bool, summary: 'no client can publish to it' },
  ],
};
const QUEUE: TailSpec = { options: [{ name: 'durable', value: bool, summary: 'has to be true' }] };
const PRODUCER: TailSpec = {
  options: [
    PAYLOAD_OPTION,
    KEY_OPTION,
    { name: 'burst', value: whole(LIMITS.burst), summary: 'messages in one publish' },
    { name: 'every', value: whole(LIMITS.everyMs), summary: 'milliseconds between publishes' },
    { name: 'repeat', value: bool, summary: 'publish again and again' },
  ],
  messageHeaders: true,
};
const CONSUMER: TailSpec = {
  options: [
    { name: 'ack', value: { kind: 'enum', values: ['auto', 'manual'] }, summary: 'when a message is taken as handled' },
    { name: 'prefetch', value: whole(LIMITS.prefetch), summary: 'messages in flight at once, 0 for no limit' },
    { name: 'processing', value: whole(LIMITS.processingMs), summary: 'milliseconds to handle a message' },
  ],
};
const CANVAS: TailSpec = {
  options: [
    { name: 'default-exchange', value: bool, summary: 'draw the default exchange' },
    { name: 'seed', value: whole(LIMITS.seed), summary: 'the seed of the simulation' },
    { name: 'publish-ms', value: whole(LIMITS.timingMs), summary: 'milliseconds to publish' },
    { name: 'broker-ms', value: whole(LIMITS.timingMs), summary: 'milliseconds in the broker' },
    { name: 'deliver-ms', value: whole(LIMITS.timingMs), summary: 'milliseconds to deliver' },
  ],
};

/** The name that each option has in the changes of a command. */
const EXCHANGE_FIELDS = { type: 'exchangeType', durable: 'durable', 'auto-delete': 'autoDelete', internal: 'internal' };
const QUEUE_FIELDS = { durable: 'durable' };
const PRODUCER_FIELDS = { payload: 'payload', key: 'key', burst: 'burst', every: 'everyMs', repeat: 'repeat' };
const CONSUMER_FIELDS = { ack: 'ack', prefetch: 'prefetch', processing: 'processingMs' };
const CANVAS_FIELDS = {
  'default-exchange': 'showDefaultExchange',
  seed: 'seed',
  'publish-ms': 'publishMs',
  'broker-ms': 'brokerMs',
  'deliver-ms': 'deliverMs',
};

/** The options that were given, as the changes that a command makes, under the names that it uses. */
function pick<Changes>(tail: Tail, fields: Readonly<Record<string, string>>): Changes {
  const changes: Record<string, unknown> = {};
  for (const [option, field] of Object.entries(fields)) {
    if (Object.hasOwn(tail.options, option)) {
      changes[field] = tail.options[option];
    }
  }
  return changes as Changes;
}

/** `name=value` for each attribute that is set, in the order of the table, with the value written as its option says. */
function attributes(spec: TailSpec, fields: Readonly<Record<string, string>>, changes: object): string[] {
  return spec.options.flatMap((option: OptionSpec) => {
    const value = (changes as Record<string, unknown>)[fields[option.name] as string];
    if (value === undefined) {
      return [];
    }
    // `+ 0` writes the integer that a `-0` is, so that what is written reads back the same.
    const text =
      typeof value === 'number'
        ? String(value + 0)
        : option.value.kind === 'text'
          ? wordText(value as string)
          : String(value);
    return [`${option.name}=${text}`];
  });
}

export const set: CommandSpec<SetCommand> = {
  name: 'set',
  type: 'set',
  scope: 'document',
  syntax:
    'set <element|canvas> <attribute>=<value>...   (exchange: type, durable, auto-delete, internal · queue: durable · producer: payload, key, burst, every, repeat, header:<name> · consumer: ack, prefetch, processing · canvas: default-exchange, seed, publish-ms, broker-ms, deliver-ms)',
  summary:
    "Sets attributes of an element, or of the canvas. A queue that is not durable is refused, as it is when it is declared. An exchange cannot become internal while a producer publishes to it, and cannot become a topic exchange while a binding of it has a key that a topic exchange refuses. A producer's message headers are set one at a time, as `header:name=value`, with the value typed as in `bind`.",
  examples: [
    'set orders type=direct',
    'set billing durable=true',
    'set sender payload="Hello, world" key=order.created burst=3 every=500 repeat=true header:format=pdf',
    'set worker ack=manual prefetch=5 processing=250',
    'set canvas default-exchange=true',
  ],
  parse(cursor) {
    const target = cursor.setTarget();
    const needSomething = (tail: Tail): void => {
      if (Object.keys(tail.options).length === 0 && tail.headers.length === 0) {
        cursor.stop({ kind: 'nothing-to-change', message: 'Say what to set, for example durable=true.' });
      }
    };
    switch (target.kind) {
      case 'exchange': {
        const tail = cursor.options(EXCHANGE);
        needSomething(tail);
        return {
          type: 'set',
          kind: 'exchange',
          name: target.name,
          changes: pick<ExchangeChanges>(tail, EXCHANGE_FIELDS),
        };
      }
      case 'queue': {
        const tail = cursor.options(QUEUE);
        needSomething(tail);
        return { type: 'set', kind: 'queue', name: target.name, changes: pick<QueueChanges>(tail, QUEUE_FIELDS) };
      }
      case 'producer': {
        const tail = cursor.options(PRODUCER);
        needSomething(tail);
        return {
          type: 'set',
          kind: 'producer',
          name: target.name,
          changes: {
            ...pick<ProducerChanges>(tail, PRODUCER_FIELDS),
            ...(tail.headers.length === 0 ? {} : { headers: tail.headers }),
          },
        };
      }
      case 'consumer': {
        const tail = cursor.options(CONSUMER);
        needSomething(tail);
        return {
          type: 'set',
          kind: 'consumer',
          name: target.name,
          changes: pick<ConsumerChanges>(tail, CONSUMER_FIELDS),
        };
      }
      case 'canvas': {
        const tail = cursor.options(CANVAS);
        needSomething(tail);
        return { type: 'set', kind: 'canvas', changes: pick<CanvasChanges>(tail, CANVAS_FIELDS) };
      }
    }
  },
  format(command, document) {
    if (command.kind === 'canvas') {
      return ['set canvas', ...attributes(CANVAS, CANVAS_FIELDS, command.changes)].join(' ');
    }
    // An element called `canvas` is not the canvas, and has to say what it is.
    const target =
      command.name === 'canvas'
        ? `${command.kind}:${wordText('canvas')}`
        : refText(document, { kind: command.kind, name: command.name }, ELEMENT_KINDS);
    const headers: readonly HeaderEntry<HeaderValue>[] =
      command.kind === 'producer' ? (command.changes.headers ?? []) : [];
    const [spec, fields] =
      command.kind === 'exchange'
        ? [EXCHANGE, EXCHANGE_FIELDS]
        : command.kind === 'queue'
          ? [QUEUE, QUEUE_FIELDS]
          : command.kind === 'producer'
            ? [PRODUCER, PRODUCER_FIELDS]
            : [CONSUMER, CONSUMER_FIELDS];
    return [
      'set',
      target,
      ...attributes(spec, fields, command.changes),
      ...headers.map(({ key, value }) => `header:${wordText(key)}=${formatValue(value)}`),
    ].join(' ');
  },
};

export const unset: CommandSpec<Unset> = {
  name: 'unset',
  type: 'unset',
  scope: 'document',
  syntax: 'unset <producer> header:<name>...',
  summary: 'Takes headers off the message of a producer.',
  examples: ['unset sender header:n'],
  parse(cursor) {
    const producer = cursor.ref(['producer'], 'the producer').name;
    const { headerNames } = cursor.options({ options: [], headerNames: true });
    if (headerNames.length === 0) {
      cursor.stop({ kind: 'nothing-to-change', message: 'Say which headers to take off, for example header:format.' });
    }
    return { type: 'unset', kind: 'producer', name: producer, headers: headerNames };
  },
  format: (command) =>
    ['unset', wordText(command.name), ...command.headers.map((key) => `header:${wordText(key)}`)].join(' '),
};
