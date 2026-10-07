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
import { describe, expect, it } from 'vitest';
import { Announcer } from '../announcer';
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
import { EventLog } from './event-log';
import { ExplainState } from './explain-state';

/** A producer `sender` that sends two messages at a time to `orders`, which sends what has the key `new` to `billing`, and nothing else anywhere: `archive` is bound with a key that never matches. */
const traffic = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing'), A: queueRecord('archive') },
    bindings: {
      B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new'),
      B2: bindingRecord('E', { kind: 'queue', id: 'A' }, 'old'),
    },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 2, interval: { everyMs: 1_000, on: false } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const PUBLISH: RuntimeCommand = { type: 'publish', from: { kind: 'producer', name: 'sender' } };

function setup(flags: string | null = 'simulation,explain') {
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
    ExplainState,
    FeatureFlags,
    { provide: FRAME_SOURCE, useValue: frames },
    { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
    {
      provide: MOTION_QUERY,
      useValue: { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
    },
  ];
  TestBed.configureTestingModule({ providers });
  const bus = TestBed.inject(CommandBus);
  const log = TestBed.inject(EventLog);
  TestBed.inject(CommandLog);
  const state = TestBed.inject(ExplainState);
  TestBed.inject(Simulation);
  TestBed.inject(DocumentStore).load(traffic());
  frames.frame(0);
  const run = (command: RuntimeCommand): void => {
    const result = bus.run(command, 'toolbar');
    if (!result.ok) {
      throw new Error(`refused: ${result.error.message}`);
    }
    log.flush();
  };
  return {
    frames,
    bus,
    log,
    state,
    selection: TestBed.inject(SelectionStore),
    announcer: TestBed.inject(Announcer),
    run,
    /** A canvas that has stopped the clock and published, and has had the first message routed. */
    stoppedAfterOneRouted(): void {
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
    },
  };
}

describe('ExplainState (ADR-0061, ADR-0062)', () => {
  it('lights nothing at first, and nothing while the clock runs, however many messages are routed', () => {
    const { state, run, frames } = setup();

    expect(state.shown()).toBeNull();
    run(PUBLISH);
    for (let time = 10; time <= 300; time += 10) {
      frames.frame(time);
    }

    expect(state.shown()).toBeNull();
  });

  it('lights the Why? of the message that was routed last, while the clock is stopped, and follows each message that is routed', () => {
    const { state, stoppedAfterOneRouted, run } = setup();

    stoppedAfterOneRouted();
    const first = state.shown();
    run({ type: 'step' });
    const second = state.shown();

    expect(first).toMatchObject({
      source: 'auto',
      message: 1,
      title: 'Why? Message 1 (the last one routed)',
      text: 'Reached billing.',
    });
    expect(first?.emphasis.nodes.get('Q')).toBe('reached');
    expect(first?.emphasis.nodes.get('A')).toBe('missed');
    expect(first?.emphasis.edges.get('E>A')?.mark).toBe('missed');
    expect(second).toMatchObject({ source: 'auto', message: 2 });
  });

  it('lets go of the Why? of the last message when it is told to, and shows the next message again', () => {
    const { state, stoppedAfterOneRouted, run } = setup();
    stoppedAfterOneRouted();

    state.letGoOfWhat();
    expect(state.shown()).toBeNull();
    run({ type: 'step' });

    expect(state.shown()).toMatchObject({ source: 'auto', message: 2 });
  });

  it('stops showing the last message when the clock plays, and shows it again when it is stopped', () => {
    const { state, stoppedAfterOneRouted, run } = setup();
    stoppedAfterOneRouted();

    run({ type: 'play' });
    expect(state.shown()).toBeNull();
    run({ type: 'pause' });

    expect(state.shown()).toMatchObject({ source: 'auto', message: 1 });
  });

  it('chooses a row of the log: lights what the row is about, opens the message, and says what it did once', () => {
    const { state, log, stoppedAfterOneRouted, announcer } = setup();
    stoppedAfterOneRouted();
    const routed = log.shown().find(({ kind }) => kind === 'routed');

    state.chooseRow(routed?.seq as number);

    expect(state.focus()).toEqual({ kind: 'row', seq: routed?.seq });
    expect(state.message()).toBe(1);
    expect(state.shown()).toMatchObject({
      source: 'row',
      title: `Event ${routed?.seq}`,
      text: 'Orders routed message 1 to billing.',
    });
    expect(state.shown()?.emphasis.nodes.get('Q')).toBe('reached');
    expect(announcer.last()).toBe('Orders routed message 1 to billing. Showing it on the canvas.');
  });

  it('chooses a line of a command, which has nothing to show, and says so, and leaves the message that was open', () => {
    const { state, log, stoppedAfterOneRouted, announcer } = setup();
    stoppedAfterOneRouted();
    state.openMessage(2);
    const line = log.shown().find(({ kind }) => kind === 'command');

    state.chooseRow(line?.seq as number);

    expect(state.message()).toBe(2);
    expect(state.shown()).toMatchObject({
      source: 'row',
      message: null,
      text: 'pause. There is nothing of it to show on the canvas.',
    });
    expect(state.shown()?.emphasis.nodes.size).toBe(0);
    expect(announcer.last()).toBe('pause. There is nothing of it to show on the canvas.');
  });

  it('does nothing for a row that is not kept', () => {
    const { state, stoppedAfterOneRouted } = setup();
    stoppedAfterOneRouted();

    state.chooseRow(9999);

    expect(state.focus()).toBeNull();
  });

  it('opens a message, and lights its Why?, and closes it with what it lit', () => {
    const { state, stoppedAfterOneRouted, announcer } = setup();
    stoppedAfterOneRouted();

    state.openMessage(2);
    expect(state.message()).toBe(2);
    expect(state.focus()).toEqual({ kind: 'why', message: 2 });
    expect(state.shown()).toMatchObject({ source: 'why', message: 2, title: 'Why? Message 2' });
    expect(announcer.last()).toBe('Message 2 is open in the inspector.');

    state.closeMessage();
    expect(state.message()).toBeNull();
    expect(state.focus()).toBeNull();
    expect(state.shown()).toMatchObject({ source: 'auto', message: 1 });
  });

  it('keeps what a row lit when the message is closed, which is what the row chose', () => {
    const { state, log, stoppedAfterOneRouted } = setup();
    stoppedAfterOneRouted();
    const routed = log.shown().find(({ kind }) => kind === 'routed');
    state.chooseRow(routed?.seq as number);

    state.closeMessage();

    expect(state.message()).toBeNull();
    expect(state.focus()).toEqual({ kind: 'row', seq: routed?.seq });
  });

  it('lights the Why? of the message that is open, when its button says so, and lets go of it', () => {
    const { state, log, stoppedAfterOneRouted } = setup();
    stoppedAfterOneRouted();
    const published = log.shown().find(({ kind }) => kind === 'published');
    state.chooseRow(published?.seq as number);
    expect(state.shown()?.emphasis.edges.has('E>A')).toBe(false);

    state.showWhy(1);

    expect(state.shown()).toMatchObject({ source: 'why', message: 1 });
    expect(state.shown()?.emphasis.edges.get('E>A')?.mark).toBe('missed');
    state.letGoOfWhat();
    expect(state.focus()).toBeNull();
  });

  it('says what a queue made of the message when it is selected, instead of what the row lit, and goes back when it is not', () => {
    const { state, selection, stoppedAfterOneRouted } = setup();
    stoppedAfterOneRouted();
    state.openMessage(1);

    selection.select(['A']);
    const asked = state.shown();
    selection.select(['Q']);
    const got = state.shown();
    selection.select(['E']);
    const exchange = state.shown();
    selection.clear();

    expect(asked).toMatchObject({
      source: 'queue',
      message: 1,
      title: 'Why? Message 1 and archive',
      text: 'The queue archive did not get the message.',
    });
    expect(asked?.emphasis.nodes.get('A')).toBe('asked');
    expect(asked?.emphasis.edges.get('E>A')).toMatchObject({ mark: 'missed' });
    expect(got).toMatchObject({ source: 'queue', text: 'The queue billing got a copy of the message.' });
    expect(got?.emphasis.edges.get('E>Q')?.mark).toBe('path');
    expect(exchange?.source).toBe('why');
    expect(state.shown()?.source).toBe('why');
  });

  it('lets go of a queue that is asked about by taking the selection away, and lights nothing until the next message', () => {
    const { state, selection, stoppedAfterOneRouted, run } = setup();
    stoppedAfterOneRouted();
    selection.select(['A']);
    expect(state.shown()?.source).toBe('queue');

    state.letGoOfWhat();

    expect(selection.count()).toBe(0);
    expect(state.shown()).toBeNull();
    run({ type: 'step' });
    expect(state.shown()).toMatchObject({ source: 'auto', message: 2 });
  });

  it('keeps the selection when what is let go of is not a queue that is asked about', () => {
    const { state, selection, stoppedAfterOneRouted } = setup();
    stoppedAfterOneRouted();
    selection.select(['E']);
    expect(state.shown()?.source).toBe('auto');

    state.letGoOfWhat();

    expect(selection.count()).toBe(1);
    expect(state.shown()).toBeNull();
  });

  it('asks about the message that was routed last when none was chosen, for a queue that is selected while the clock is stopped', () => {
    const { state, selection, stoppedAfterOneRouted } = setup();
    stoppedAfterOneRouted();

    selection.select(['A']);

    expect(state.shown()).toMatchObject({ source: 'queue', message: 1 });
  });

  it('asks nothing when there is no message to ask about, or the queue is not one that the canvas had when it was routed', () => {
    const { state, selection, run } = setup();
    selection.select(['A']);
    expect(state.shown()).toBeNull();

    run({ type: 'pause' });
    run(PUBLISH);
    run({ type: 'step' });
    state.openMessage(1);
    run({ type: 'step' });
    selection.select(['C']);
    expect(state.shown()?.source).toBe('why');
  });

  it('says what is lit as plain data for a test of the whole app, and nothing when nothing is lit', () => {
    const { state, stoppedAfterOneRouted } = setup();
    expect(state.debugState()).toBeNull();

    stoppedAfterOneRouted();
    const lit = state.debugState();

    expect(lit).toMatchObject({
      source: 'auto',
      message: 1,
      title: 'Why? Message 1 (the last one routed)',
      text: 'Reached billing.',
      gone: 0,
    });
    expect(lit?.nodes).toContainEqual({ id: 'Q', mark: 'reached' });
    expect(lit?.nodes).toContainEqual({ id: 'A', mark: 'missed' });
    expect(lit?.edges).toContainEqual({ key: 'E>Q', mark: 'path' });
    const missed = lit?.edges.find(({ key }) => key === 'E>A');
    expect(missed?.mark).toBe('missed');
    expect(missed?.reason).toEqual(expect.any(String));
  });

  it('opens and closes the log, and says which', () => {
    const { state } = setup();

    expect(state.logOpen()).toBe(false);
    expect(state.toggleLog()).toBe(true);
    expect(state.logOpen()).toBe(true);
    state.closeLog();
    expect(state.logOpen()).toBe(false);
    state.openLog();
    state.openLog();
    expect(state.logOpen()).toBe(true);
    expect(state.toggleLog()).toBe(false);
  });

  it('lights nothing without both flags', () => {
    for (const flags of ['simulation', 'explain', null]) {
      TestBed.resetTestingModule();
      const { state } = setup(flags);

      expect(state.enabled, String(flags)).toBe(false);
      expect(state.shown(), String(flags)).toBeNull();
    }
  });
});
