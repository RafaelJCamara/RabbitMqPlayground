import type { Link, Subscribe, Unlink, Unsubscribe } from '../../commands/types';
import { refText, type CommandSpec } from '../spec';
import { wordText } from '../words';

const TARGETS = ['exchange', 'queue'] as const;

export const link: CommandSpec<Link> = {
  name: 'link',
  type: 'link',
  scope: 'document',
  syntax: 'link <producer> -> <exchange|queue>',
  summary:
    'Points a producer at the exchange or the queue that it publishes to. A queue is reached through the default exchange. A producer has one target, so linking it again changes it, and an internal exchange is refused.',
  examples: ['link sender -> archive'],
  parse(cursor) {
    const producer = cursor.ref(['producer'], 'the producer').name;
    cursor.arrow();
    const target = cursor.ref(TARGETS, 'the exchange or queue it publishes to');
    cursor.finish();
    return { type: 'link', producer, target: { kind: target.kind as 'exchange' | 'queue', name: target.name } };
  },
  format: (command, document) => `link ${wordText(command.producer)} -> ${refText(document, command.target, TARGETS)}`,
};

export const unlink: CommandSpec<Unlink> = {
  name: 'unlink',
  type: 'unlink',
  scope: 'document',
  syntax: 'unlink <producer>',
  summary: 'Takes the target off a producer, so that it publishes to nothing.',
  examples: ['unlink sender'],
  parse(cursor) {
    const producer = cursor.ref(['producer'], 'the producer').name;
    cursor.finish();
    return { type: 'unlink', producer };
  },
  format: (command) => `unlink ${wordText(command.producer)}`,
};

export const subscribe: CommandSpec<Subscribe> = {
  name: 'subscribe',
  type: 'subscribe',
  scope: 'document',
  syntax: 'subscribe <consumer> <queue>',
  summary: 'Makes a consumer consume from a queue. A consumer may consume from several queues.',
  examples: ['subscribe worker archive'],
  parse(cursor) {
    const consumer = cursor.ref(['consumer'], 'the consumer').name;
    const queue = cursor.ref(['queue'], 'the queue to consume from').name;
    cursor.finish();
    return { type: 'subscribe', consumer, queue };
  },
  format: (command) => `subscribe ${wordText(command.consumer)} ${wordText(command.queue)}`,
};

export const unsubscribe: CommandSpec<Unsubscribe> = {
  name: 'unsubscribe',
  type: 'unsubscribe',
  scope: 'document',
  syntax: 'unsubscribe <consumer> <queue>',
  summary: 'Stops a consumer consuming from a queue.',
  examples: ['unsubscribe worker billing'],
  parse(cursor) {
    const consumer = cursor.ref(['consumer'], 'the consumer').name;
    const queue = cursor.ref(['queue'], 'the queue to stop consuming from').name;
    cursor.finish();
    return { type: 'unsubscribe', consumer, queue };
  },
  format: (command) => `unsubscribe ${wordText(command.consumer)} ${wordText(command.queue)}`,
};
