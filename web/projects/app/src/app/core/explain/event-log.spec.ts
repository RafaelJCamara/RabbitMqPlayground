import type { Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  manualFrames,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import { describe, expect, it, vi } from 'vitest';
import { FeatureFlags, FLAG_SOURCES } from '../flags/feature-flags';
import { FRAME_SOURCE, FrameLoop } from '../runtime/frame-loop';
import { MOTION_QUERY } from '../runtime/motion';
import { SimStats } from '../runtime/sim-stats';
import { Simulation } from '../runtime/simulation';
import { CommandBus } from '../state/command-bus';
import { CommandLog } from '../state/command-log';
import { DocumentStore } from '../state/document-store';
import { SelectionStore } from '../state/selection-store';
import { StatusStore } from '../state/status-store';
import { EventLog, LOG_CAP } from './event-log';
import { nodeKey } from './log-row';

/** The same canvas as the spec of the simulation: a producer `sender` that sends two messages at a time to `orders`, which sends what has the key `new` to `billing`, which `worker` consumes. */
const traffic = (burst = 2): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst, interval: { everyMs: 1_000, on: false } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const PUBLISH: RuntimeCommand = { type: 'publish', from: { kind: 'producer', name: 'sender' } };

function setup(
  options: { readonly flags?: string | null; readonly burst?: number; readonly before?: () => void } = {},
) {
  const frames = manualFrames();
  const providers: Provider[] = [
    DocumentStore,
    SelectionStore,
    StatusStore,
    CommandBus,
    CommandLog,
    FrameLoop,
    SimStats,
    Simulation,
    EventLog,
    FeatureFlags,
    { provide: FRAME_SOURCE, useValue: frames },
    {
      provide: FLAG_SOURCES,
      useValue: { stored: null, query: options.flags === undefined ? 'simulation,explain' : options.flags },
    },
    {
      provide: MOTION_QUERY,
      useValue: { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
    },
  ];
  TestBed.configureTestingModule({ providers });
  options.before?.();
  const store = TestBed.inject(DocumentStore);
  const bus = TestBed.inject(CommandBus);
  TestBed.inject(CommandLog);
  const log = TestBed.inject(EventLog);
  const simulation = TestBed.inject(Simulation);
  store.load(traffic(options.burst));
  frames.frame(0);
  return {
    frames,
    store,
    bus,
    log,
    simulation,
    run(command: RuntimeCommand) {
      const result = bus.run(command, 'toolbar');
      if (!result.ok) {
        throw new Error(`refused: ${result.error.message}`);
      }
      log.flush();
      return result.value;
    },
    texts: () => log.shown().map(({ text }) => text),
  };
}

describe('EventLog (ADR-0061)', () => {
  it('puts the line of a command before the events that it made, and the clock’s events after it, with one number for all of them', () => {
    const { run, frames, log } = setup();
    run({ type: 'pause' });

    run(PUBLISH);
    frames.frame(100);
    run({ type: 'step' });

    const rows = log.shown();
    expect(rows.map(({ seq, kind }) => [seq, kind])).toEqual([
      [1, 'command'],
      [2, 'command'],
      [3, 'published'],
      [4, 'published'],
      [5, 'command'],
      [6, 'routed'],
    ]);
    expect(rows.map(({ text }) => text)).toEqual([
      'pause',
      'publish sender',
      'Sender published message 1 to orders with key "new"',
      'Sender published message 2 to orders with key "new"',
      'step',
      'Orders routed message 1 to billing',
    ]);
  });

  it('puts the events of the clock in the order that they were said, when no command was run', () => {
    const { run, frames, log } = setup();
    run(PUBLISH);
    log.flush();

    for (let time = 10; time <= 1000; time += 10) {
      frames.frame(time);
    }
    log.flush();

    expect(log.shown().map(({ kind }) => kind)).toEqual([
      'command',
      'published',
      'published',
      'routed',
      'routed',
      'enqueued',
      'delivered',
      'enqueued',
      'received',
      'processed',
      'acked',
      'delivered',
      'received',
      'processed',
      'acked',
    ]);
  });

  it('has the time of the engine on every row: the event’s, and the clock’s for a line of a command', () => {
    const { run, log } = setup();
    run({ type: 'pause' });
    run(PUBLISH);
    run({ type: 'step' });
    run({ type: 'step' });

    expect(log.shown().map(({ at, kind }) => [at, kind])).toEqual([
      [0, 'command'],
      [0, 'command'],
      [0, 'published'],
      [0, 'published'],
      [100, 'command'],
      [100, 'routed'],
      [100, 'command'],
      [100, 'routed'],
    ]);
  });

  it('words each row with the names that the canvas had when it happened, and keeps them when the canvas changes', () => {
    const { run, log, bus } = setup();
    run({ type: 'pause' });
    run(PUBLISH);
    run({ type: 'step' });
    bus.apply({ type: 'rename', target: { kind: 'producer', name: 'sender' }, name: 'dispatcher' }, 'inspector');
    bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'gesture');
    log.flush();

    const texts = log.shown().map(({ text }) => text);
    expect(texts).toContain('Sender published message 1 to orders with key "new"');
    expect(texts).toContain('rename sender dispatcher');
    expect(texts.at(-2)).toBe('delete worker');
    // What the delete did is worded with the canvas before it, which still has the name of the consumer.
    expect(texts.at(-1)).toBe('Worker was closed, and 0 messages went back to their queues');
  });

  it('keeps the last five thousand rows, counts what it dropped, and keeps counting the numbers after it drops the oldest', () => {
    const { run, log } = setup({ burst: 1000 });
    run({ type: 'pause' });

    // A burst of a thousand is a thousand events, and the line of the command.
    for (let times = 0; times < 6; times += 1) {
      run(PUBLISH);
    }

    expect(LOG_CAP).toBe(5000);
    expect(log.count()).toBe(LOG_CAP);
    expect(log.dropped()).toBe(1 + 6 * 1001 - LOG_CAP);
    expect(log.shown()).toHaveLength(LOG_CAP);
    expect(log.shown()[0]?.seq).toBe(log.dropped() + 1);
    expect(log.shown().at(-1)?.seq).toBe(1 + 6 * 1001);
  });

  it('takes the oldest rows off in one go and not one at a time, and never shows more than the cap', () => {
    const { run, log } = setup({ burst: 1000 });
    run({ type: 'pause' });
    for (let times = 0; times < 5; times += 1) {
      run(PUBLISH);
    }
    const dropped = log.dropped();
    expect(log.count()).toBe(LOG_CAP);
    run(PUBLISH);

    expect(log.count()).toBe(LOG_CAP);
    expect(log.dropped()).toBe(dropped + 1001);
    const first = log.shown()[0]?.seq as number;
    expect(first).toBe(log.dropped() + 1);
    expect(log.rowBySeq(first - 1)).toBeUndefined();
    expect(log.rowBySeq(first)?.seq).toBe(first);
    expect(log.rowBySeq(first + LOG_CAP - 1)?.seq).toBe(first + LOG_CAP - 1);
    expect(log.rowBySeq(first + LOG_CAP)).toBeUndefined();
  });

  it('never shows or counts more than the cap, as soon as the turn that went over it is over, and counts what that turn dropped', () => {
    const { run, log } = setup({ burst: 1000 });
    run({ type: 'pause' });
    // The line of the pause, and five bursts of a thousand and the line of each: 5,006 rows, six more than the cap.
    for (let times = 0; times < 5; times += 1) {
      run(PUBLISH);
    }

    expect(log.count()).toBe(LOG_CAP);
    expect(log.dropped()).toBe(6);
    expect(log.shown()).toHaveLength(LOG_CAP);
    expect(log.shown()[0]?.seq).toBe(7);
    expect(log.debugState().rows).toHaveLength(LOG_CAP);
    expect(log.rowBySeq(6)).toBeUndefined();
    expect(log.rowBySeq(7)?.seq).toBe(7);
  });

  it('has dropped nothing when it has not been full, and the first row is the first', () => {
    const { run, log } = setup();
    run({ type: 'pause' });

    expect(log.dropped()).toBe(0);
    expect(log.shown().map(({ seq }) => seq)).toEqual([1]);
  });

  it('puts the line of a command that made no events after the events of the clock that were said in the same turn', () => {
    const { bus, frames, log } = setup();
    bus.run(PUBLISH, 'toolbar');
    log.flush();
    for (let time = 10; time <= 300; time += 10) {
      frames.frame(time);
    }

    bus.run({ type: 'speed', factor: 2 }, 'toolbar');
    log.flush();

    const kinds = log.shown().map(({ kind }) => kind);
    expect(kinds.at(-1)).toBe('command');
    expect(kinds.slice(1, -1).every((kind) => kind !== 'command')).toBe(true);
    expect(kinds).toContain('routed');
    expect(log.shown().at(-1)?.text).toBe('speed 2');
  });

  it('schedules one flush for a turn, however many things were said in it, and one more for the next turn', async () => {
    const { bus, log } = setup();
    const flush = vi.spyOn(log, 'flush');

    bus.run({ type: 'pause' }, 'toolbar');
    bus.run({ type: 'play' }, 'toolbar');
    bus.run({ type: 'pause' }, 'toolbar');
    await Promise.resolve();

    expect(flush).toHaveBeenCalledOnce();
    expect(log.count()).toBe(3);

    bus.run({ type: 'play' }, 'toolbar');
    await Promise.resolve();

    expect(flush).toHaveBeenCalledTimes(2);
    expect(log.count()).toBe(4);
  });

  it('says what it keeps as plain data for a test of the whole app, which is every row that is kept and how many went', () => {
    const { run, log } = setup();
    run({ type: 'pause' });
    run(PUBLISH);

    expect(log.debugState()).toStrictEqual({
      count: 4,
      dropped: 0,
      rows: [
        { seq: 1, at: 0, family: 'commands', kind: 'command', text: 'pause', message: null },
        { seq: 2, at: 0, family: 'commands', kind: 'command', text: 'publish sender', message: null },
        {
          seq: 3,
          at: 0,
          family: 'publishing',
          kind: 'published',
          text: 'Sender published message 1 to orders with key "new"',
          message: 1,
        },
        {
          seq: 4,
          at: 0,
          family: 'publishing',
          kind: 'published',
          text: 'Sender published message 2 to orders with key "new"',
          message: 2,
        },
      ],
    });
  });

  it('says what it keeps for a test of the whole app when the log is full: the last rows, and how many went', () => {
    const { run, log } = setup({ burst: 1000 });
    run({ type: 'pause' });
    for (let times = 0; times < 6; times += 1) {
      run(PUBLISH);
    }

    const state = log.debugState();

    expect(state.count).toBe(LOG_CAP);
    expect(state.dropped).toBe(log.dropped());
    expect(state.rows).toHaveLength(LOG_CAP);
    expect(state.rows[0]?.seq).toBe(log.dropped() + 1);
  });

  it('finds a row by its number, and answers nothing for a number that is not there', () => {
    const { run, log } = setup();
    run({ type: 'pause' });
    run(PUBLISH);

    expect(log.rowBySeq(1)?.text).toBe('pause');
    expect(log.rowBySeq(3)?.kind).toBe('published');
    expect(log.rowBySeq(0)).toBeUndefined();
    expect(log.rowBySeq(99)).toBeUndefined();
  });

  it('sets its signal once for the turn in which something was said, however many events it was', () => {
    const { bus, log } = setup({ burst: 1000 });
    bus.run({ type: 'pause' }, 'toolbar');
    log.flush();
    const before = log.changed();

    bus.run(PUBLISH, 'toolbar');
    log.flush();
    log.flush();

    expect(log.count()).toBe(1 + 1000 + 1);
    expect(log.changed()).toBe(before + 1);
  });

  it('flushes by itself when the turn is over, so that a reader who is not told finds the rows', async () => {
    const { bus, log } = setup();

    bus.run({ type: 'pause' }, 'key');
    expect(log.count()).toBe(0);
    await Promise.resolve();

    expect(log.count()).toBe(1);
  });

  it('filters by family, node, message and text, all at once, and says what it leaves out', () => {
    const { run, log } = setup();
    run({ type: 'pause' });
    run(PUBLISH);
    run({ type: 'step' });
    run({ type: 'step' });
    run({ type: 'step' });
    const all = log.shown().length;

    log.setFilter({ families: new Set(['commands' as const]) });
    expect(log.shown().map(({ text }) => text)).toEqual(['pause', 'publish sender', 'step', 'step', 'step']);
    log.setFilter({ families: new Set(['routing' as const, 'publishing' as const]), message: 1 });
    expect(log.shown().map(({ kind }) => kind)).toEqual(['published', 'routed']);
    log.setFilter({ message: null, node: nodeKey('queue', 'billing') });
    expect(log.shown().map(({ kind }) => kind)).toEqual(['routed', 'routed']);
    log.setFilter({ node: null, text: 'MESSAGE 2' });
    expect(log.shown().map(({ text }) => text)).toEqual([
      'Sender published message 2 to orders with key "new"',
      'Orders routed message 2 to billing',
    ]);
    expect(log.filter().text).toBe('MESSAGE 2');

    log.clearFilter();
    expect(log.shown()).toHaveLength(all);
    expect(log.filter().families.size).toBe(8);
  });

  it('holds the messages that it saw published with the canvas that routed them, and which was routed last', () => {
    const { run, log, store } = setup();
    run({ type: 'pause' });
    run(PUBLISH);

    expect(log.held.get(1)).toMatchObject({ outcome: null, routedUnder: null });
    run({ type: 'step' });
    expect(log.held.get(1)).toMatchObject({ outcome: 'routed', queues: ['billing'], routedUnder: store.document() });
    expect(log.held.lastSettled).toBe(1);
    expect(log.lastSettled()).toBe(1);
    run({ type: 'step' });
    expect(log.held.lastSettled).toBe(2);
    expect(log.lastSettled()).toBe(2);
  });

  it('holds a message that nothing took, and a message that was refused, as such', () => {
    const { run, log } = setup();
    run({ type: 'pause' });
    run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'nothing' });
    run({ type: 'step' });

    expect(log.held.get(1)).toMatchObject({ outcome: 'unroutable', queues: [] });
    expect(log.shown().at(-1)?.text).toBe('Message 1 reached orders and found no queue to go to');
    expect(log.shown().at(-1)?.family).toBe('problems');
  });

  it('starts again for a canvas that is opened: no rows, the numbers from 1, no held messages, and no filter', () => {
    const { run, log, store } = setup();
    run({ type: 'pause' });
    run(PUBLISH);
    log.setFilter({ text: 'x' });

    store.load(traffic());
    run({ type: 'play' });

    expect(log.shown().map(({ seq, text }) => [seq, text])).toEqual([[1, 'play']]);
    expect(log.held.size).toBe(0);
    expect(log.lastSettled()).toBeNull();
    expect(log.filter().text).toBe('');
    expect(log.dropped()).toBe(0);
  });

  it('forgets what was said in a turn that ended with a canvas that was opened', () => {
    const { bus, log, store } = setup();
    bus.run({ type: 'pause' }, 'key');

    store.load(traffic());
    log.flush();

    expect(log.count()).toBe(0);
  });

  it('listens to nothing without both flags: a log that says what it cannot know would be a log of nothing', () => {
    for (const flags of ['simulation', 'explain', null]) {
      TestBed.resetTestingModule();
      const { run, log } = setup({ flags });
      if (flags === 'simulation') {
        run({ type: 'pause' });
        run(PUBLISH);
      }

      expect(log.enabled, String(flags)).toBe(false);
      expect(log.count(), String(flags)).toBe(0);
      expect(log.held.size, String(flags)).toBe(0);
    }
  });

  it('stops listening to the events and to the lines of commands when it is destroyed, so that a closed editor says nothing', () => {
    const stops = { events: vi.fn(), lines: vi.fn() };
    setup({
      before: () => {
        vi.spyOn(TestBed.inject(Simulation), 'onEvents').mockReturnValue(stops.events);
        vi.spyOn(TestBed.inject(CommandLog), 'onLine').mockReturnValue(stops.lines);
      },
    });
    expect(stops.events).not.toHaveBeenCalled();
    expect(stops.lines).not.toHaveBeenCalled();

    TestBed.resetTestingModule();

    expect(stops.events).toHaveBeenCalledOnce();
    expect(stops.lines).toHaveBeenCalledOnce();
  });
});
