import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DocumentCommand, RuntimeCommand } from '@rmq/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingRecord, documentOf, exchangeRecord, producerRecord, queueRecord } from '@rmq/testing';
import { CommandBus, type RuntimeHost } from './command-bus';
import { CommandLog, LOG_LIMIT } from './command-log';
import { DocumentStore } from './document-store';
import { SelectionStore } from './selection-store';
import { StatusStore } from './status-store';

const declareQueue = (name: string): DocumentCommand => ({ type: 'declare-queue', name, durable: true });

describe('CommandLog (ADR-0046)', () => {
  let bus: CommandBus;
  let log: CommandLog;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, CommandLog] });
    bus = TestBed.inject(CommandBus);
    log = TestBed.inject(CommandLog);
  });

  const texts = () => log.entries().map(({ text }) => text);

  it('writes, for each command that changed the canvas, the line that a learner would type to do the same', () => {
    bus.apply(declareQueue('billing'), 'gesture');
    bus.apply({ type: 'add-producer', name: 'my sender' }, 'menu');
    bus.apply({ type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'a.*' }, 'typed');

    expect(texts()).toEqual(['declare queue billing', 'add producer "my sender"']);
  });

  describe('the commands of the simulation (ADR-0054)', () => {
    /** A simulation that changes what the spec says that it changes. */
    const host = (changes: (command: RuntimeCommand) => boolean): RuntimeHost => ({
      execute: (command) => ({ changed: changes(command), said: 'Done.' }),
      takeLost: () => 0,
    });

    beforeEach(() => {
      TestBed.inject(DocumentStore).load(
        documentOf({
          exchanges: { E: exchangeRecord('orders') },
          queues: { Q: queueRecord('billing') },
          bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
          producers: { P: producerRecord('my sender', { kind: 'exchange', id: 'E' }) },
        }),
      );
    });

    it('are lines of the same log, in the order with the commands of the canvas, written as the learner would type them', () => {
      bus.attach(host(() => true));

      bus.apply(declareQueue('archive'), 'gesture');
      bus.run({ type: 'pause' }, 'toolbar');
      bus.run({ type: 'publish', from: { kind: 'producer', name: 'my sender' } }, 'key');
      bus.run(
        { type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new', payload: 'hello' },
        'inspector',
      );
      bus.run({ type: 'step' }, 'key');
      bus.run({ type: 'speed', factor: 0.5 }, 'toolbar');
      bus.run({ type: 'purge', queue: 'billing' }, 'inspector');
      bus.run({ type: 'clear-messages' }, 'toolbar');
      bus.run({ type: 'reset-counters' }, 'toolbar');
      bus.run({ type: 'play' }, 'key');

      expect(texts()).toEqual([
        'declare queue archive',
        'pause',
        'publish "my sender"',
        'publish orders key=new payload=hello',
        'step',
        'speed 0.5',
        'purge billing',
        'clear messages',
        'reset counters',
        'play',
      ]);
      expect(log.entries().map(({ origin }) => origin)).toEqual([
        'gesture',
        'toolbar',
        'key',
        'inspector',
        'key',
        'toolbar',
        'inspector',
        'toolbar',
        'toolbar',
        'key',
      ]);
    });

    it('are not there when they changed nothing, or were refused', () => {
      bus.attach(host((command) => command.type !== 'pause'));

      bus.run({ type: 'pause' }, 'key');
      bus.run({ type: 'publish', from: { kind: 'producer', name: 'nobody' } }, 'typed');
      bus.run({ type: 'step' }, 'key');

      expect(texts()).toEqual(['step']);
    });

    it('are emptied with the rest when another canvas is opened', () => {
      bus.attach(host(() => true));
      bus.run({ type: 'step' }, 'key');

      bus.load(documentOf());

      expect(texts()).toEqual([]);
    });
  });

  it('says what the learner used, and numbers the lines from 1 without reusing a number', () => {
    bus.apply(declareQueue('a'), 'gesture');
    bus.apply(declareQueue('b'), 'key');
    bus.apply(declareQueue('c'), 'inspector');
    bus.apply(declareQueue('d'), 'toolbar');
    bus.apply(declareQueue('e'), 'menu');
    bus.apply(declareQueue('f'), 'typed');

    expect(log.entries().map(({ id, origin }) => [id, origin])).toEqual([
      [1, 'gesture'],
      [2, 'key'],
      [3, 'inspector'],
      [4, 'toolbar'],
      [5, 'menu'],
      [6, 'typed'],
    ]);
  });

  it('writes a name that two kinds share with its kind, because the canvas that the command meets is what says which', () => {
    bus.apply(
      {
        type: 'declare-exchange',
        name: 'same',
        exchangeType: 'direct',
        durable: true,
        autoDelete: false,
        internal: false,
      },
      'gesture',
    );
    bus.apply(declareQueue('same'), 'gesture');
    bus.apply({ type: 'rename', target: { kind: 'queue', name: 'same' }, name: 'other' }, 'inspector');

    expect(texts().at(-1)).toBe('rename queue:same other');
  });

  it('writes a batch as its commands joined with a semicolon, each as the canvas before it makes it, and counts it once', () => {
    bus.apply(
      {
        type: 'batch',
        commands: [
          declareQueue('billing'),
          { type: 'move', target: { kind: 'queue', name: 'billing' }, x: 412, y: 220 },
        ],
      },
      'gesture',
    );

    expect(texts()).toEqual(['declare queue billing; move billing x=412 y=220']);
    expect(log.entries()).toHaveLength(1);
  });

  it('leaves out a command that was refused and one that changed nothing', () => {
    bus.apply(declareQueue('billing'), 'gesture');
    bus.apply(declareQueue('billing'), 'key'); // refused: the name is taken
    bus.apply({ type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'billing' }, 'inspector'); // nothing

    expect(texts()).toEqual(['declare queue billing']);
  });

  it('has undo and redo in it, with what the learner used, and leaves out an undo that had nothing to undo', () => {
    bus.undo('key');
    bus.apply(declareQueue('billing'), 'gesture');
    bus.undo('toolbar');
    bus.redo('typed');
    bus.redo('typed');

    expect(log.entries().map(({ origin, text }) => [origin, text])).toEqual([
      ['gesture', 'declare queue billing'],
      ['toolbar', 'undo'],
      ['typed', 'redo'],
    ]);
  });

  it('is empty when a canvas is opened, because what was done to another is not what is done to this one', () => {
    bus.apply(declareQueue('billing'), 'gesture');

    bus.load(documentOf({ queues: { q9: queueRecord('other') } }));

    expect(log.entries()).toEqual([]);
    bus.apply(declareQueue('next'), 'gesture');
    expect(log.entries().map(({ id }) => id)).toEqual([1]);
  });

  it('says which line was written last, for the one line that the panel shows when it is closed', () => {
    expect(log.latest()).toBeUndefined();

    bus.apply(declareQueue('a'), 'gesture');
    bus.apply(declareQueue('b'), 'gesture');

    expect(log.latest()).toEqual({ id: 2, origin: 'gesture', text: 'declare queue b' });
  });

  it('keeps the last thousand lines, and goes on numbering', () => {
    // A change that does not make the canvas bigger, so that a thousand of them are quick even when the machine is busy. The seed starts above its default, which would change nothing.
    for (let index = 0; index < LOG_LIMIT + 5; index += 1) {
      bus.apply({ type: 'set', kind: 'canvas', changes: { seed: index + 2 } }, 'gesture');
    }

    expect(LOG_LIMIT, 'ADR-0046 says a thousand').toBe(1000);
    expect(log.entries()).toHaveLength(LOG_LIMIT);
    expect(log.entries()[0]?.id).toBe(6);
    expect(log.latest()?.id).toBe(LOG_LIMIT + 5);
  });

  it('stops listening when it is destroyed, so that a closed editor writes nothing', () => {
    const injector = createEnvironmentInjector(
      [DocumentStore, SelectionStore, StatusStore, CommandBus, CommandLog],
      TestBed.inject(EnvironmentInjector),
    );
    const second = injector.get(CommandBus);
    const secondLog = injector.get(CommandLog);
    injector.destroy();

    second.apply(declareQueue('late'), 'gesture');

    expect(secondLog.entries()).toEqual([]);
  });
});
