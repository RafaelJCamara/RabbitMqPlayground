import {
  configureFastCheck,
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
} from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Command, Publish } from '../commands/types';
import type { Issue } from '../document/issue';
import type { CanvasDocument } from '../document/schema';
import { completeCommand, type Completion } from './complete';
import { formatCommand } from './format';
import { parseCommand } from './parse';
import { SPEED_RANGE, SPEEDS } from './specs/runtime';

/**
 * The commands that run the simulation (ADR-0054): publish, purge, play, pause, step, speed, clear messages and reset counters. They are typed like every
 * other command, written to the log as the learner would type them, completed, and refused with the root cause first.
 */

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
/** A producer, an exchange and a queue with the same name, and one with a name that needs quotes. */
const twins = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: {
        E: exchangeRecord('same'),
        F: exchangeRecord('my exchange'),
        G: exchangeRecord('hidden', 'fanout', { internal: true }),
      },
      queues: { Q: queueRecord('same'), R: queueRecord('my queue') },
      producers: { P: producerRecord('same'), S: producerRecord('my producer') },
      consumers: { C: consumerRecord('same') },
    }),
  );

const read = (text: string, document: CanvasDocument = sample()): Command => {
  const result = parseCommand(text, document);
  if (!result.ok) {
    throw new Error(`"${text}" was not read: ${result.error.message}`);
  }
  return result.value;
};
const refused = (text: string, document: CanvasDocument = sample()): Issue => {
  const result = parseCommand(text, document);
  if (result.ok) {
    throw new Error(`"${text}" was read as ${JSON.stringify(result.value)}`);
  }
  return result.error;
};
const pointedAt = (text: string, issue: Issue): string => text.slice(issue.at?.start, issue.at?.end);
const at = (text: string, document: CanvasDocument = sample()): Completion =>
  completeCommand(text, text.length, document);
const inserts = (completion: Completion): string[] => completion.items.map(({ insert }) => insert);

describe('publish', () => {
  it('reads the name of a producer, and then asks for nothing more', () => {
    expect(read('publish sender')).toEqual({ type: 'publish', from: { kind: 'producer', name: 'sender' } });
  });

  it('reads an exchange, with the key, the payload and the headers of the message that it is sent, each typed as in a binding', () => {
    expect(read('publish orders')).toEqual({ type: 'publish', from: { kind: 'exchange', name: 'orders' } });
    expect(
      read(
        'publish orders key=order.created payload=hello header:format=pdf header:n=1 header:f=1.0 header:ok=true header:s="1"',
      ),
    ).toEqual({
      type: 'publish',
      from: { kind: 'exchange', name: 'orders' },
      key: 'order.created',
      payload: 'hello',
      headers: [
        { key: 'format', value: { t: 'string', v: 'pdf' } },
        { key: 'n', value: { t: 'integer', v: 1 } },
        { key: 'f', value: { t: 'float', v: 1 } },
        { key: 'ok', value: { t: 'boolean', v: true } },
        { key: 's', value: { t: 'string', v: '1' } },
      ],
    });
  });

  it('says which of a producer and an exchange that share a name is meant, and reads it when it is said', () => {
    const issue = refused('publish same', twins());

    expect(issue).toMatchObject({ kind: 'ambiguous-name', suggestions: ['exchange:same', 'producer:same'] });
    expect(read('publish producer:same', twins())).toMatchObject({ from: { kind: 'producer', name: 'same' } });
    expect(read('publish exchange:same key=k', twins())).toMatchObject({
      from: { kind: 'exchange', name: 'same' },
      key: 'k',
    });
  });

  it('refuses a producer that is given a message, and says how to change what it sends', () => {
    for (const text of ['publish sender key=a', 'publish sender payload=x', 'publish sender header:n=1']) {
      const issue = refused(text);

      expect(issue.kind).toBe('syntax');
      expect(issue.message).toBe(
        'A producer sends the message that it has. Change it with set sender payload=… key=…, and publish it by its name alone.',
      );
    }
  });

  it.each([
    ['publish', 'Expected the producer or the exchange to publish from.'],
    ['publish nope', "There is no producer or exchange named 'nope'."],
    ['publish billing', "There is no producer or exchange named 'billing'."],
  ])('refuses %j: %s', (text, message) => {
    expect(refused(text).message).toContain(message);
  });

  it('suggests the name that was probably meant', () => {
    const issue = refused('publish sendr');

    expect(issue.suggestions).toEqual(['sender']);
    expect(pointedAt('publish sendr', issue)).toBe('sendr');
  });

  it('refuses an option that it does not have, with the options that it has', () => {
    const issue = refused('publish orders color=red');

    expect(issue.kind).toBe('unknown-option');
    expect(issue.message).toContain('Its options are key and payload.');
  });
});

describe('purge', () => {
  it('reads a queue and nothing else, and leaves it to the simulation to say that there is no such queue, as subscribe does', () => {
    expect(read('purge billing')).toEqual({ type: 'purge', queue: 'billing' });
    expect(read('purge orders')).toEqual({ type: 'purge', queue: 'orders' });
    expect(refused('purge').message).toBe('Expected the queue to purge.');
    expect(refused('purge billing archive').message).toContain("Unexpected 'archive'");
  });
});

describe('play, pause, step, clear messages and reset counters', () => {
  it.each([
    ['play', { type: 'play' }],
    ['pause', { type: 'pause' }],
    ['step', { type: 'step' }],
    ['clear messages', { type: 'clear-messages' }],
    ['reset counters', { type: 'reset-counters' }],
  ])('read %j, which says nothing more', (text, command) => {
    expect(read(text)).toEqual(command);
    expect(refused(`${text} now`).message).toContain("Unexpected 'now': there is nothing more to say here.");
  });

  it('keeps clear to the canvas and messages to the simulation: both are commands, and one word makes the first', () => {
    expect(read('clear')).toEqual({ type: 'clear' });
    expect(read('clear messages')).toEqual({ type: 'clear-messages' });
    expect(refused('clear message').message).toContain("Unexpected 'message'");
  });
});

describe('speed', () => {
  it.each(['0.25', '0.5', '1', '2', '4', '3', '1.5', '0.3'])('reads %s', (text) => {
    expect(read(`speed ${text}`)).toEqual({ type: 'speed', factor: Number(text) });
  });

  it.each(['0', '0.2', '5', '-1', 'fast', '1x', '', '1e3'])('refuses %j, and says what is allowed', (text) => {
    const issue = refused(`speed ${text}`.trimEnd());

    expect(issue.message).toMatch(
      /^(the speed must be a number from 0\.25 to 4, and '.*' is not\.|Expected the speed\.)$/,
    );
  });

  it('says where the number is that it refuses, and refuses a second number', () => {
    const issue = refused('speed 9');

    expect(issue.kind).toBe('invalid-value');
    expect(pointedAt('speed 9', issue)).toBe('9');
    expect(refused('speed 2 3').message).toContain("Unexpected '3'");
  });

  it('has the speeds that the buttons offer, from a quarter to four times', () => {
    expect(SPEEDS).toEqual([0.25, 0.5, 1, 2, 4]);
    expect(SPEED_RANGE).toEqual({ min: 0.25, max: 4 });
  });
});

describe('written to the log', () => {
  it.each([
    [{ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'publish sender'],
    [
      {
        type: 'publish',
        from: { kind: 'exchange', name: 'orders' },
        key: 'order.created',
        payload: 'hello world',
        headers: [{ key: 'n', value: { t: 'integer', v: 1 } }],
      },
      'publish orders key=order.created payload="hello world" header:n=1',
    ],
    [{ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: '', payload: '' }, 'publish orders'],
    [{ type: 'purge', queue: 'billing' }, 'purge billing'],
    [{ type: 'play' }, 'play'],
    [{ type: 'pause' }, 'pause'],
    [{ type: 'step' }, 'step'],
    [{ type: 'speed', factor: 0.25 }, 'speed 0.25'],
    [{ type: 'speed', factor: 2 }, 'speed 2'],
    [{ type: 'clear-messages' }, 'clear messages'],
    [{ type: 'reset-counters' }, 'reset counters'],
  ] as [Command, string][])('%j as %j', (command, text) => {
    expect(formatCommand(command, sample())).toBe(text);
  });

  it('says the kind of an element only where its name would not say which, and quotes a name that has a space in it', () => {
    expect(formatCommand({ type: 'publish', from: { kind: 'producer', name: 'same' } }, twins())).toBe(
      'publish producer:same',
    );
    expect(formatCommand({ type: 'publish', from: { kind: 'exchange', name: 'my exchange' } }, twins())).toBe(
      'publish "my exchange"',
    );
    expect(formatCommand({ type: 'publish', from: { kind: 'producer', name: 'my producer' } }, twins())).toBe(
      'publish "my producer"',
    );
    expect(formatCommand({ type: 'purge', queue: 'my queue' }, twins())).toBe('purge "my queue"');
  });

  it('is read back as the command that it was written from, for any message', () => {
    const arbText = fc.oneof(
      fc.string({ maxLength: 12 }),
      fc.constantFrom('', 'a b', 'k=v', '"q"', 'x->y', 'é', '日本', 'a;b', 'header:h', '1', 'true'),
    );
    const arbHeaders = fc.array(
      fc.record({
        key: fc.constantFrom('a', 'my header', 'key', 'x-c'),
        value: fc.oneof(
          fc.record({ t: fc.constant('string' as const), v: arbText }),
          fc.record({ t: fc.constant('integer' as const), v: fc.integer({ min: -1000, max: 1000 }) }),
          fc.record({ t: fc.constant('boolean' as const), v: fc.boolean() }),
        ),
      }),
      { maxLength: 3 },
    );
    const keys = (headers: readonly { readonly key: string }[]) =>
      new Set(headers.map(({ key }) => key)).size === headers.length;

    fc.assert(
      fc.property(
        fc.constantFrom('orders', 'my exchange'),
        arbText,
        arbText,
        arbHeaders,
        (name, key, payload, headers) => {
          fc.pre(keys(headers));
          const document = twins();
          const command: Publish = {
            type: 'publish',
            from: { kind: 'exchange', name: name === 'my exchange' ? 'my exchange' : 'same' },
            ...(key === '' ? {} : { key }),
            ...(payload === '' ? {} : { payload }),
            ...(headers.length === 0 ? {} : { headers }),
          };
          const text = formatCommand(command, document);
          const parsed = parseCommand(text, document);

          expect(text).not.toMatch(/[\n\r]/);
          expect(parsed.ok && parsed.value).toEqual(command);
          expect(parsed.ok && formatCommand(parsed.value, document)).toBe(text);
        },
      ),
    );
  });
});

describe('one of several commands', () => {
  it.each([
    ['publish sender', 'publish'],
    ['purge billing', 'purge'],
    ['play', 'play'],
    ['pause', 'pause'],
    ['step', 'step'],
    ['speed 2', 'speed'],
    ['clear messages', 'clear messages'],
    ['reset counters', 'reset counters'],
  ])('%j cannot be, because it runs the simulation and a batch is one change of the canvas', (text, name) => {
    const line = `declare queue fresh; ${text}`;
    const issue = refused(line);

    expect(issue).toMatchObject({ kind: 'batch', batchIndex: 1 });
    expect(issue.message).toBe(
      `${name} runs the simulation and does not change the canvas, so it cannot be one of several commands. Type it by itself.`,
    );
    expect(pointedAt(line, issue)).toBe(text);
  });
});

describe('completion', () => {
  it('offers the names of the commands that start with what is typed, and the two words of those that have two', () => {
    expect(inserts(at('pu'))).toEqual(['publish', 'purge']);
    expect(inserts(at('p'))).toEqual(['publish', 'purge', 'play', 'pause']);
    expect(inserts(at('s'))).toEqual(['subscribe', 'set', 'step', 'speed']);
    expect(inserts(at('clear '))).toEqual(['messages']);
    expect(inserts(at('reset '))).toEqual(['counters']);
    expect(inserts(at('re'))).toEqual(['rename', 'reset', 'redo']);
  });

  it('offers the producers and the exchanges after publish, and the queues after purge, and nothing for an exchange that is not there', () => {
    expect(inserts(at('publish '))).toEqual(['orders', 'docs', 'hidden', 'sender']);
    expect(inserts(at('publish s'))).toEqual(['sender']);
    expect(inserts(at('purge '))).toEqual(['billing', 'archive']);
    expect(inserts(at('purge or'))).toEqual([]);
  });

  it('offers the options of the message for an exchange, and the headers, once the exchange is named', () => {
    expect(inserts(at('publish orders '))).toEqual(['key=', 'payload=', 'header:']);
    expect(inserts(at('publish orders key=a '))).toEqual(['payload=', 'header:']);
  });

  it('offers the speeds, the ones that start like what is typed, and each is a value of the speed', () => {
    const completion = at('speed ');

    expect(inserts(completion)).toEqual(['0.25', '0.5', '1', '2', '4']);
    expect(completion.items.every(({ kind, detail }) => kind === 'value' && detail === 'the speed')).toBe(true);
    expect(inserts(at('speed 0'))).toEqual(['0.25', '0.5']);
    expect(inserts(at('speed 3'))).toEqual([]);
    expect(at('speed 0')).toMatchObject({ from: 6, to: 7 });
  });
});
