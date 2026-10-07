import type { ClearMessages, Pause, Play, Publish, Purge, ResetCounters, Speed, Step } from '../../commands/types';
import type { HeaderEntry, HeaderValue } from '@rmq/engine';
import type { OptionSpec } from '../cursor';
import { refText, type CommandSpec } from '../spec';
import { formatValue } from '../values';
import { KEY_OPTION, PAYLOAD_OPTION } from './set';
import { wordText } from '../words';

/**
 * The commands that run the simulation and not the canvas (ADR-0054): publish, purge, play, pause, step, speed, clear messages and reset counters. They
 * are typed, completed, written to the log and documented like every other command, and they are not applied to the document.
 */

/** The speeds that the buttons offer. A typed `speed` takes any number from the first to the last. */
export const SPEEDS: readonly number[] = [0.25, 0.5, 1, 2, 4];
export const SPEED_RANGE = { min: 0.25, max: 4 } as const;

/** The options of a message that is written in words: its key and its payload. The headers are `header:name=value`. */
export const MESSAGE_OPTIONS: readonly OptionSpec[] = [KEY_OPTION, PAYLOAD_OPTION];

const SOURCES = ['producer', 'exchange'] as const;

export const publish: CommandSpec<Publish> = {
  name: 'publish',
  type: 'publish',
  scope: 'runtime',
  syntax: 'publish <producer|exchange> [key=<text>] [payload=<text>] [header:<name>=<value>...]',
  summary:
    'Sends a message now. A producer sends the message that it has, as many times as its burst says, so it is told nothing more: change what it sends with `set`. An exchange is sent one message, with the key, the payload and the headers that are given, from no producer, which is a way to try a route. Nothing is sent when a producer has nowhere to send to, and an internal exchange is refused.',
  examples: ['publish sender', 'publish orders key=order.created payload=hello header:format=pdf'],
  parse(cursor) {
    const from = cursor.ref(SOURCES, 'the producer or the exchange to publish from');
    const { options, headers } = cursor.options({ options: MESSAGE_OPTIONS, messageHeaders: true });
    const source = { kind: from.kind as 'producer' | 'exchange', name: from.name };
    if (source.kind === 'producer') {
      if (Object.keys(options).length > 0 || headers.length > 0) {
        cursor.stop({
          kind: 'syntax',
          message: `A producer sends the message that it has. Change it with set ${wordText(source.name)} payload=… key=…, and publish it by its name alone.`,
        });
      }
      return { type: 'publish', from: source };
    }
    return {
      type: 'publish',
      from: source,
      ...(options['key'] === undefined ? {} : { key: options['key'] as string }),
      ...(options['payload'] === undefined ? {} : { payload: options['payload'] as string }),
      ...(headers.length === 0 ? {} : { headers }),
    };
  },
  format(command, document) {
    const headers: readonly HeaderEntry<HeaderValue>[] = command.headers ?? [];
    return [
      'publish',
      refText(document, command.from, SOURCES),
      ...(command.key === undefined || command.key === '' ? [] : [`key=${wordText(command.key)}`]),
      ...(command.payload === undefined || command.payload === '' ? [] : [`payload=${wordText(command.payload)}`]),
      ...headers.map(({ key, value }) => `header:${wordText(key)}=${formatValue(value)}`),
    ].join(' ');
  },
};

export const purge: CommandSpec<Purge> = {
  name: 'purge',
  type: 'purge',
  scope: 'runtime',
  syntax: 'purge <queue>',
  summary:
    'Takes the ready messages out of a queue, as a broker does. The messages that consumers hold and have not acknowledged stay with them, and the canvas is as it was.',
  examples: ['purge billing'],
  parse(cursor) {
    const queue = cursor.ref(['queue'], 'the queue to purge').name;
    cursor.finish();
    return { type: 'purge', queue };
  },
  format: (command) => `purge ${wordText(command.queue)}`,
};

export const play: CommandSpec<Play> = {
  name: 'play',
  type: 'play',
  scope: 'runtime',
  syntax: 'play',
  summary:
    'Lets the virtual clock run, so that messages move. It runs at the speed that was set, and starts running when the page opens.',
  examples: ['play'],
  parse(cursor) {
    cursor.finish();
    return { type: 'play' };
  },
  format: () => 'play',
};

export const pause: CommandSpec<Pause> = {
  name: 'pause',
  type: 'pause',
  scope: 'runtime',
  syntax: 'pause',
  summary:
    'Stops the virtual clock: nothing moves until it is played or stepped, and what is in flight stays where it is.',
  examples: ['pause'],
  parse(cursor) {
    cursor.finish();
    return { type: 'pause' };
  },
  format: () => 'pause',
};

export const step: CommandSpec<Step> = {
  name: 'step',
  type: 'step',
  scope: 'runtime',
  syntax: 'step',
  summary:
    'Runs the one event that is next, and moves the clock to it. A step is a whole event, such as the arrival of a message at an exchange, and not a hop: routing is decided at once.',
  examples: ['step'],
  parse(cursor) {
    cursor.finish();
    return { type: 'step' };
  },
  format: () => 'step',
};

export const speed: CommandSpec<Speed> = {
  name: 'speed',
  type: 'speed',
  scope: 'runtime',
  syntax: 'speed <0.25 to 4>',
  summary:
    'How fast the virtual clock runs, from a quarter to four times. At 1 a virtual millisecond passes for each real one, so the legs that a message takes (500 ms from a producer, 300 ms in the broker, 500 ms to a consumer, by default) take that long.',
  examples: ['speed 2', 'speed 0.25'],
  parse(cursor) {
    const factor = cursor.number('the speed', { ...SPEED_RANGE, suggestions: SPEEDS.map(String) });
    cursor.finish();
    return { type: 'speed', factor };
  },
  format: (command) => `speed ${command.factor}`,
};

export const clearMessages: CommandSpec<ClearMessages> = {
  name: 'clear messages',
  type: 'clear-messages',
  scope: 'runtime',
  syntax: 'clear messages',
  summary:
    'Takes every message out of the simulation: the ones on their way, in the queues and in the consumers. The canvas, the producers that repeat and the counters are as they were.',
  examples: ['clear messages'],
  parse(cursor) {
    cursor.finish();
    return { type: 'clear-messages' };
  },
  format: () => 'clear messages',
};

export const resetCounters: CommandSpec<ResetCounters> = {
  name: 'reset counters',
  type: 'reset-counters',
  scope: 'runtime',
  syntax: 'reset counters',
  summary:
    'Sets the counters on the nodes to zero: what was sent, routed, found unroutable, given and finished with. The messages are as they were.',
  examples: ['reset counters'],
  parse(cursor) {
    cursor.finish();
    return { type: 'reset-counters' };
  },
  format: () => 'reset counters',
};
