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
import { WhatIf } from './what-if';

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
    WhatIf,
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
    whatIf: TestBed.inject(WhatIf),
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

  it('asks a queue that is selected about the message that is open, even when the row that was chosen last is a line of a command, which is about no message', () => {
    const { state, log, selection, stoppedAfterOneRouted } = setup();
    stoppedAfterOneRouted();
    state.openMessage(2);
    state.chooseRow(log.shown().find(({ kind }) => kind === 'command')?.seq as number);

    selection.select(['A']);

    expect(state.shown()).toMatchObject({ source: 'queue', message: 2, title: 'Why? Message 2 and archive' });
  });

  it('asks a queue that is selected about the message of the row that was chosen when the message was closed, and not about the one that was routed last', () => {
    const { state, log, selection, stoppedAfterOneRouted, run } = setup();
    stoppedAfterOneRouted();
    run({ type: 'step' });
    expect(log.lastSettled()).toBe(2);
    state.chooseRow(log.shown().find(({ kind }) => kind === 'routed')?.seq as number);
    state.closeMessage();
    expect(state.message()).toBeNull();

    selection.select(['A']);

    expect(state.shown()).toMatchObject({ source: 'queue', message: 1 });
  });

  it('asks a queue that is selected about the message whose Why? is lit, when none is open, and not about the one that was routed last', () => {
    const { state, selection, stoppedAfterOneRouted, run } = setup();
    stoppedAfterOneRouted();
    run({ type: 'step' });
    state.showWhy(1);
    expect(state.message()).toBeNull();

    selection.select(['A']);

    expect(state.shown()).toMatchObject({ source: 'queue', message: 1 });
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
    expect(state.shown()).toMatchObject({ source: 'why', message: 2, title: 'Why? Message 2 (where it would go now)' });
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

    expect(state.shown()).toMatchObject({ source: 'why', message: 1, title: 'Why? Message 1' });
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
    expect(lit?.edges.find(({ key }) => key === 'E>Q')).toStrictEqual({ key: 'E>Q', mark: 'path' });
    const missed = lit?.edges.find(({ key }) => key === 'E>A');
    expect(missed?.mark).toBe('missed');
    expect(missed?.reason).toEqual(expect.any(String));
  });

  describe('the message that is open (ADR-0063)', () => {
    it('is nothing until a message is opened, and nothing again when it is closed', () => {
      const { state, stoppedAfterOneRouted } = setup();
      expect(state.openedMessage()).toBeNull();
      stoppedAfterOneRouted();

      state.openMessage(1);
      expect(state.openedMessage()?.number).toBe(1);
      state.closeMessage();

      expect(state.openedMessage()).toBeNull();
    });

    it('is what the log held of the message, explained with the canvas that routed it', () => {
      const { state, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();

      state.openMessage(1);
      const opened = state.openedMessage();

      expect(opened).toMatchObject({ number: 1, basis: 'routed' });
      expect(opened?.info).toMatchObject({ id: 1, exchange: 'orders', key: 'new', payload: 'hi' });
      expect(opened?.held?.outcome).toBe('routed');
      expect(opened?.explanation).toMatchObject({ outcome: 'routed', queues: ['billing'], unreached: ['archive'] });
    });

    it('keeps the route that the broker made when the canvas changes, because the route was decided then', () => {
      const { state, stoppedAfterOneRouted, bus } = setup();
      stoppedAfterOneRouted();
      state.openMessage(1);

      bus.apply(
        { type: 'unbind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'new' },
        'gesture',
      );

      expect(state.openedMessage()).toMatchObject({
        basis: 'routed',
        explanation: { outcome: 'routed', queues: ['billing'] },
      });
    });

    it('says what would happen now to a message that has not got to the broker, and the route of it when it does', () => {
      const { state, run } = setup();
      run({ type: 'pause' });
      run(PUBLISH);

      state.openMessage(1);
      expect(state.openedMessage()).toMatchObject({ basis: 'would', explanation: { outcome: 'routed' } });
      expect(state.openedMessage()?.held?.outcome).toBeNull();

      run({ type: 'step' });
      expect(state.openedMessage()).toMatchObject({ basis: 'routed' });
    });

    it('explains a message that the log does not hold from what the list that it was opened from says, with the canvas as it is, and says that it is again', () => {
      const { state, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();
      const known = { id: 4242, producer: null, exchange: 'orders', key: 'old', headers: [], payload: 'from a list' };

      state.openMessage(4242, { info: known, queue: 'archive' });
      const opened = state.openedMessage();

      expect(opened).toMatchObject({ number: 4242, basis: 'again', held: undefined, queues: ['archive'] });
      expect(opened?.info).toBe(known);
      expect(opened?.explanation).toMatchObject({ outcome: 'routed', queues: ['archive'] });
    });

    it('is nothing for a message that is not held and that no list said anything of, and for a list that said it of another', () => {
      const { state, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();

      state.openMessage(4242);
      expect(state.openedMessage()).toBeNull();

      const other = { id: 4242, producer: null, exchange: 'orders', key: 'old', headers: [], payload: 'x' };
      state.openMessage(4243, { info: other, queue: 'archive' });
      expect(state.openedMessage()).toBeNull();
    });

    it('is nothing without both flags', () => {
      TestBed.resetTestingModule();
      const { state } = setup('simulation');

      state.openMessage(1);

      expect(state.openedMessage()).toBeNull();
    });

    it('lights nothing of a message with the explanation alone, though a list that has the message says what it is: that needs the simulation too', () => {
      TestBed.resetTestingModule();
      const { state } = setup('explain');
      const info = { id: 4242, producer: 'P', exchange: 'orders', key: 'new', headers: [], payload: 'x' };

      state.openMessage(4242, { info, queue: 'billing' });

      expect(state.openedMessage()).toBeNull();
      expect(state.shown()).toBeNull();
      expect(state.debugState()).toBeNull();
    });

    it('says which queues a message went to: the ones that routed it, and the one that a list opened it from when the log does not hold it', () => {
      const { state, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();

      state.openMessage(1);
      expect(state.openedMessage()?.queues).toEqual(['billing']);

      const info = { id: 4242, producer: null, exchange: 'orders', key: 'new', headers: [], payload: 'x' };
      state.openMessage(4242, { info, queue: 'billing' });
      expect(state.openedMessage()?.queues).toEqual(['billing']);
    });

    it('lights where a message that is not held would go now, with a title that says so, when its Why? is shown', () => {
      const { state, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();
      const info = { id: 4242, producer: 'P', exchange: 'orders', key: 'new', headers: [], payload: 'x' };

      state.openMessage(4242, { info, queue: 'billing' });

      expect(state.shown()).toMatchObject({
        source: 'why',
        message: 4242,
        title: 'Why? Message 4242 (where it would go now)',
      });
      expect(state.shown()?.emphasis.nodes.get('Q')).toBe('reached');
    });

    it('says that it shows the Why? of the message, aloud, when the button for it is pressed', () => {
      const { state, stoppedAfterOneRouted, announcer } = setup();
      stoppedAfterOneRouted();

      state.showWhy(1);

      expect(announcer.last()).toBe('Showing why message 1 went where it went on the canvas.');
    });
  });

  describe('the queue that is asked about (ADR-0062, ADR-0063)', () => {
    it('is why the selected queue did not get the message chosen, or how it did, with the name that the canvas had', () => {
      const { state, selection, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();
      state.openMessage(1);

      selection.select(['A']);
      const missed = state.asked();
      selection.select(['Q']);
      const got = state.asked();

      expect(missed).toMatchObject({ message: 1, name: 'archive', explanation: { reached: false } });
      expect(got).toMatchObject({ message: 1, name: 'billing', explanation: { reached: true } });
    });

    it('is nothing when what is selected is not a queue, when nothing is selected, and without both flags', () => {
      const { state, selection, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();
      expect(state.asked()).toBeNull();

      selection.select(['E']);
      expect(state.asked()).toBeNull();
      selection.select(['A', 'Q']);
      expect(state.asked()).toBeNull();

      TestBed.resetTestingModule();
      const off = setup('explain');
      off.selection.select(['A']);
      expect(off.state.asked()).toBeNull();
    });
  });

  describe('the what-if tester (ADR-0064)', () => {
    it('is what is lit while it is open and its message can be read, before anything else, with the card that says so', () => {
      const { state, whatIf, stoppedAfterOneRouted, selection } = setup();
      stoppedAfterOneRouted();
      selection.select(['A']);
      expect(state.shown()?.source).toBe('queue');

      whatIf.open();
      whatIf.type('key=new');

      expect(state.shown()).toMatchObject({
        source: 'what-if',
        message: null,
        title: 'What if? To orders with the key "new"',
        text: 'Would reach billing.',
      });
      expect(state.shown()?.emphasis.nodes.get('Q')).toBe('reached');
    });

    it('gives way to what else is lit when it is shut, or when what is typed cannot be read', () => {
      const { state, whatIf, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();
      whatIf.open();
      expect(state.shown()?.source).toBe('what-if');

      whatIf.type('keyy=new');
      expect(state.shown()?.source).toBe('auto');

      whatIf.type('key=new');
      whatIf.close();
      expect(state.shown()?.source).toBe('auto');
    });

    it('is lit with the flag of the explanation alone, which the rest of what is lit is not, because it needs the simulation', () => {
      TestBed.resetTestingModule();
      const { state, whatIf } = setup('explain');
      expect(state.enabled).toBe(false);
      expect(state.shown()).toBeNull();

      whatIf.open();
      whatIf.type('key=new');

      expect(state.shown()?.source).toBe('what-if');
      expect(state.debugState()).toMatchObject({ source: 'what-if', text: 'Would reach billing.' });
    });

    it('is let go of by shutting it, which the button of its card does, and what was lit before comes back', () => {
      const { state, whatIf, stoppedAfterOneRouted } = setup();
      stoppedAfterOneRouted();
      whatIf.open();
      whatIf.type('key=new');

      state.letGoOfWhat();

      expect(whatIf.isOpen()).toBe(false);
      expect(state.shown()).toMatchObject({ source: 'auto', message: 1 });
    });
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

  it('lights nothing without the simulation', () => {
    const { state } = setup(null);

    expect(state.enabled).toBe(false);
    expect(state.shown()).toBeNull();
  });
});
