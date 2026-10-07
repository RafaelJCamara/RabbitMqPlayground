import type { AddConsumer, AddProducer, DeclareExchange, DeclareQueue } from '../../commands/types';
import type { OptionSpec } from '../cursor';
import type { CommandSpec } from '../spec';
import { wordText } from '../words';

const EXCHANGE_TYPES = ['direct', 'fanout', 'topic', 'headers'] as const;

const EXCHANGE_OPTIONS: readonly OptionSpec[] = [
  { name: 'type', value: { kind: 'enum', values: EXCHANGE_TYPES }, summary: 'how it routes', required: true },
  { name: 'durable', value: { kind: 'bool' }, summary: 'survives a restart (default true)' },
  { name: 'auto-delete', value: { kind: 'bool' }, summary: 'goes when its last binding does (default false)' },
  { name: 'internal', value: { kind: 'bool' }, summary: 'no client can publish to it (default false)' },
];

export const declareExchange: CommandSpec<DeclareExchange> = {
  name: 'declare exchange',
  type: 'declare-exchange',
  scope: 'document',
  syntax:
    'declare exchange <name> type=direct|fanout|topic|headers [durable=true|false] [auto-delete=true|false] [internal=true|false]',
  summary:
    'Puts an exchange on the canvas. A name may not be empty or start with `amq.`. If an exchange of that name is there, a declaration that says the same changes nothing, as on a broker, and one that says another type or flag is refused, because a broker does not change an exchange that it has: use `set` for that.',
  examples: ['declare exchange events type=topic', 'declare exchange audit type=fanout durable=false auto-delete=true'],
  parse(cursor) {
    const name = cursor.name('the name of the exchange');
    const { options } = cursor.options({ options: EXCHANGE_OPTIONS });
    return {
      type: 'declare-exchange',
      name,
      exchangeType: options['type'] as DeclareExchange['exchangeType'],
      durable: (options['durable'] as boolean | undefined) ?? true,
      autoDelete: (options['auto-delete'] as boolean | undefined) ?? false,
      internal: (options['internal'] as boolean | undefined) ?? false,
    };
  },
  format: (command) =>
    [
      'declare exchange',
      wordText(command.name),
      `type=${command.exchangeType}`,
      ...(command.durable ? [] : ['durable=false']),
      ...(command.autoDelete ? ['auto-delete=true'] : []),
      ...(command.internal ? ['internal=true'] : []),
    ].join(' '),
};

export const declareQueue: CommandSpec<DeclareQueue> = {
  name: 'declare queue',
  type: 'declare-queue',
  scope: 'document',
  syntax: 'declare queue <name> [durable=true|false] [type=classic]',
  summary:
    'Puts a queue on the canvas. A queue that is not durable is refused, as RabbitMQ 4.3 refuses it, because every queue here has to be durable. Declaring a queue that is there changes nothing, as on a broker. Quorum queues and streams arrive in M4.',
  examples: ['declare queue jobs'],
  parse(cursor) {
    const name = cursor.name('the name of the queue');
    const { options } = cursor.options({
      options: [
        {
          name: 'type',
          value: {
            kind: 'enum',
            values: ['classic'],
            refused: {
              quorum: 'Quorum queues arrive in M4. Only classic queues are available now.',
              stream: 'Streams arrive in M4. Only classic queues are available now.',
            },
          },
          summary: 'only classic for now',
        },
        { name: 'durable', value: { kind: 'bool' }, summary: 'has to be true (default true)' },
      ],
    });
    return { type: 'declare-queue', name, durable: (options['durable'] as boolean | undefined) ?? true };
  },
  format: (command) => `declare queue ${wordText(command.name)}${command.durable ? '' : ' durable=false'}`,
};

export const addProducer: CommandSpec<AddProducer> = {
  name: 'add producer',
  type: 'add-producer',
  scope: 'document',
  syntax: 'add producer <name>',
  summary: 'Puts a producer on the canvas. It publishes nothing and to nothing until it is set up and linked.',
  examples: ['add producer clock'],
  parse(cursor) {
    const name = cursor.name('the name of the producer');
    cursor.finish();
    return { type: 'add-producer', name };
  },
  format: (command) => `add producer ${wordText(command.name)}`,
};

export const addConsumer: CommandSpec<AddConsumer> = {
  name: 'add consumer',
  type: 'add-consumer',
  scope: 'document',
  syntax: 'add consumer <name>',
  summary: 'Puts a consumer on the canvas. It consumes from nothing until it is subscribed to a queue.',
  examples: ['add consumer logger'],
  parse(cursor) {
    const name = cursor.name('the name of the consumer');
    cursor.finish();
    return { type: 'add-consumer', name };
  },
  format: (command) => `add consumer ${wordText(command.name)}`,
};
