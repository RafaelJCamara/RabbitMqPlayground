import { createEnvironmentInjector, EnvironmentInjector, type Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { emptyDocument, findId, nameOf, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import type { EngineEvent, EngineSnapshot } from '@rmq/engine';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  engineFor,
  exchangeRecord,
  manualFrames,
  producerRecord,
  queueRecord,
  snapshotAfter,
} from '@rmq/testing';
import { describe, expect, it, vi } from 'vitest';
import { SHARED_MESSAGES, type SharedMessages } from '../share/shared-messages';
import { CommandBus } from '../state/command-bus';
import { DocumentStore } from '../state/document-store';
import { SelectionStore } from '../state/selection-store';
import { StatusStore } from '../state/status-store';
import { FRAME_SOURCE, FrameLoop } from './frame-loop';
import { MOTION_QUERY } from './motion';
import { SimStats } from './sim-stats';
import { Simulation, STEP_TWEEN_MS } from './simulation';

/**
 * The simulation of the canvas (ADR-0052, ADR-0054, ADR-0055): the engine that follows the document, the commands of the runtime, and the clock that the frames
 * of the page move. The frames are the spec's, so the clock is too.
 */

/**
 * A producer `sender` that sends two messages at a time to the direct exchange `orders`, which sends what has the key `new` to the queue `billing`, which is
 * consumed by `worker`, one message at a time and a hundred milliseconds for each, and acknowledged when it is done. A message takes 100 ms to get to the broker,
 * 50 ms in it, and 100 ms from the queue to the consumer.
 */
const traffic = (repeat = false): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 2, interval: { everyMs: 1_000, on: repeat } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const PUBLISH: RuntimeCommand = { type: 'publish', from: { kind: 'producer', name: 'sender' } };

/** What the simulation is made of, with frames that the spec runs. */
const services = (
  frames: ReturnType<typeof manualFrames>,
  options: { readonly reduced?: boolean; readonly shared?: SharedMessages } = {},
): Provider[] => [
  DocumentStore,
  SelectionStore,
  StatusStore,
  CommandBus,
  FrameLoop,
  SimStats,
  Simulation,
  { provide: FRAME_SOURCE, useValue: frames },
  ...(options.shared === undefined ? [] : [{ provide: SHARED_MESSAGES, useValue: options.shared }]),
  {
    provide: MOTION_QUERY,
    useValue: {
      matches: options.reduced === true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  },
];

function setup(
  options: {
    readonly reduced?: boolean;
    readonly document?: CanvasDocument;
    readonly shared?: SharedMessages;
  } = {},
) {
  const frames = manualFrames();
  TestBed.configureTestingModule({ providers: services(frames, options) });
  const store = TestBed.inject(DocumentStore);
  const simulation = TestBed.inject(Simulation);
  const bus = TestBed.inject(CommandBus);
  store.load(options.document ?? traffic());
  const said: EngineEvent[] = [];
  simulation.onEvents((events) => said.push(...events));
  /** The frame that the load asked for, and the sleep that follows it: what the canvas does when it has nothing to do. */
  frames.frame(0);
  return {
    frames,
    store,
    simulation,
    bus,
    said,
    stats: TestBed.inject(SimStats),
    status: TestBed.inject(StatusStore),
    /** Runs a command of the runtime and answers what it said, which is a failure if it was refused. */
    run(command: RuntimeCommand) {
      const result = bus.run(command, 'toolbar');
      if (!result.ok) {
        throw new Error(`refused: ${result.error.message}`);
      }
      return result.value;
    },
    /** Moves the frames on by this much, in frames of 10 ms, the first of which lasts no time. */
    elapse(ms: number, from = 0) {
      for (let time = from; time <= from + ms; time += 10) {
        frames.frame(time);
      }
    },
  };
}

const types = (events: readonly EngineEvent[]): string[] => events.map(({ type }) => type);

describe('Simulation', () => {
  describe('a canvas that the engine will not take', () => {
    it('is not followed in silence: what reconcile gave the engine and it refused is a bug, and is thrown', () => {
      const { store } = setup();

      // A queue that is not durable is what a broker refuses, and what no command makes: a file could say it.
      expect(() => store.load(documentOf({ queues: { Q: queueRecord('q', { durable: false }) } }))).toThrow(
        /The simulation could not follow the canvas: queue.declare was refused with 541/,
      );
    });

    it('follows a canvas that has a queue that a broker named, which a file or a link can hold and whose name starts with amq.', () => {
      const { store, simulation } = setup();

      store.load(documentOf({ queues: { Q: queueRecord('amq.gen-JzTY20BRgKO', { serverNamed: true }) } }));

      expect(Object.keys(simulation.view().queues)).toEqual(['amq.gen-JzTY20BRgKO']);
    });
  });

  describe('at rest', () => {
    it('starts running, at 1×, and goes to sleep when there is nothing scheduled, so that a canvas that has nothing to do costs no frames', () => {
      const { simulation, frames } = setup();

      expect(simulation.running()).toBe(true);
      expect(simulation.speed()).toBe(1);
      expect(simulation.canStep()).toBe(false);
      expect(frames.pending).toBe(0);
    });

    it('wakes up for a producer that repeats, which has something scheduled from the moment that the canvas is open', () => {
      const { simulation, frames } = setup({ document: traffic(true) });
      // The load asked for a frame, which was run, and which asks for another because there is something to do.
      expect(simulation.canStep()).toBe(true);
      expect(frames.pending).toBe(1);
    });

    it('holds the numbers of the nodes from the moment that the canvas is open', () => {
      const { stats } = setup();

      expect(stats.of('Q')()).toEqual({ kind: 'queue', ready: 0, unacked: 0, consumers: 1 });
      expect(stats.of('P')()).toEqual({ kind: 'producer', sent: 0, repeating: false });
      expect(stats.of('C')()).toMatchObject({ kind: 'consumer', holds: 0, limit: 1 });
    });
  });

  describe('play, pause and speed', () => {
    it('says what they did, and that they did nothing when it is as they say', () => {
      const { run, simulation } = setup();

      expect(run({ type: 'play' })).toEqual({ changed: false, said: 'It is playing already.' });
      expect(run({ type: 'pause' })).toEqual({ changed: true, said: 'Paused.' });
      expect(run({ type: 'pause' })).toEqual({ changed: false, said: 'It is paused already.' });
      expect(simulation.running()).toBe(false);
      expect(run({ type: 'play' })).toEqual({ changed: true, said: 'Playing at 1×.' });
      expect(run({ type: 'speed', factor: 0.25 })).toEqual({ changed: true, said: 'Speed 0.25×.' });
      expect(run({ type: 'speed', factor: 0.25 })).toEqual({ changed: false, said: 'The speed is 0.25× already.' });
      expect(run({ type: 'play' }).said).toBe('It is playing already.');
      expect(simulation.speed()).toBe(0.25);
    });

    it('says the speed that it plays at, when it is told to play', () => {
      const { run } = setup();
      run({ type: 'pause' });
      run({ type: 'speed', factor: 4 });

      expect(run({ type: 'play' }).said).toBe('Playing at 4×.');
    });

    it('moves the clock by the time that a frame lasted, times the speed', () => {
      const { run, frames, simulation } = setup();
      run(PUBLISH);

      frames.frame(1_000);
      frames.frame(1_060);
      expect(simulation.view().now).toBe(60);

      run({ type: 'speed', factor: 2 });
      frames.frame(1_120);
      expect(simulation.view().now).toBe(180);

      run({ type: 'speed', factor: 0.25 });
      frames.frame(1_140);
      expect(simulation.view().now).toBe(185);
    });

    it('keeps the fraction of a millisecond that the engine does not, so that a slow speed is not a standstill', () => {
      const { run, frames, simulation } = setup();
      run({ type: 'speed', factor: 0.25 });
      run(PUBLISH);

      frames.frame(0);
      for (let frame = 1; frame <= 8; frame += 1) {
        frames.frame(frame * 2);
      }

      // Sixteen real milliseconds at a quarter of the speed are 4, though no frame lasted as long as a virtual millisecond.
      expect(simulation.view().now).toBe(4);
    });

    it('runs what is scheduled for a millisecond when that millisecond has come, and not when a part of it has', () => {
      const { run, frames, said } = setup();
      run({ type: 'speed', factor: 0.25 });
      run(PUBLISH);
      said.length = 0;

      // Two milliseconds of frames at a quarter of the speed are half a millisecond of the simulation: 199 of them are 99.5, and the messages arrive at 100.
      for (let frame = 0; frame < 200; frame += 1) {
        frames.frame(frame * 2);
      }
      expect(types(said)).not.toContain('routed');

      frames.frame(400);
      expect(types(said)).toContain('routed');
    });

    it('does not move the clock while it is paused, and goes to sleep', () => {
      const { run, frames, simulation } = setup();
      run(PUBLISH);
      run({ type: 'pause' });

      frames.frame(0);
      frames.frame(50);

      expect(simulation.view().now).toBe(0);
      expect(frames.pending).toBe(0);
    });

    it('moves the clock again when it plays, from where it was, and not by the time that it was paused', () => {
      const { run, frames, simulation } = setup();
      run(PUBLISH);
      frames.frame(0);
      frames.frame(40);
      run({ type: 'pause' });
      frames.frame(60);

      run({ type: 'play' });
      frames.frame(5_000);
      frames.frame(5_030);

      expect(simulation.view().now).toBe(70);
    });

    it('goes to sleep when nothing is scheduled any more, with the clock where the last frame left it', () => {
      const { run, frames, simulation } = setup();
      run(PUBLISH);

      frames.frame(0);
      for (let time = 10; time <= 2_000; time += 10) {
        frames.frame(time);
      }

      expect(frames.pending).toBe(0);
      expect(simulation.canStep()).toBe(false);
      expect(simulation.view()).toMatchObject({ published: 2, travelling: 0 });
      expect(simulation.view().queues['billing']).toMatchObject({ ready: 0, unacked: 0, enqueued: 2, delivered: 2 });
    });

    it('asks for frames for as long as something is scheduled and the clock runs', () => {
      const { run, frames, simulation } = setup();
      run(PUBLISH);

      frames.frame(0);

      expect(simulation.animating()).toBe(true);
      expect(frames.pending).toBe(1);
    });
  });

  describe('publish', () => {
    it('sends what the producer has, as many as its burst, and says how many', () => {
      const { run, said } = setup();

      expect(run(PUBLISH)).toEqual({ changed: true, said: 'Published 2 messages from sender.' });
      expect(types(said)).toEqual(['published', 'published']);
      expect(said[0]).toMatchObject({
        message: { id: 1, producer: 'P', key: 'new', payload: 'hi' },
        at: 0,
        arrivesAt: 100,
      });
    });

    it('says a message when it is one', () => {
      const { run } = setup({
        document: {
          ...traffic(),
          producers: { P: { ...traffic().producers['P']!, burst: 1 } },
        },
      });

      expect(run(PUBLISH).said).toBe('Published 1 message from sender.');
    });

    it('sends one message to an exchange, with the key, the payload and the headers that it is given, and none of a producer', () => {
      const { run, said } = setup();

      const outcome = run({
        type: 'publish',
        from: { kind: 'exchange', name: 'orders' },
        key: 'new',
        payload: 'hello',
        headers: [{ key: 'n', value: { t: 'integer', v: 1 } }],
      });

      expect(outcome).toEqual({ changed: true, said: 'Published a message to orders.' });
      expect(said).toMatchObject([
        {
          type: 'published',
          message: {
            id: 1,
            producer: null,
            exchange: 'orders',
            key: 'new',
            payload: 'hello',
            headers: [{ key: 'n', value: { t: 'integer', v: 1 } }],
          },
        },
      ]);
    });

    it('sends a message with no key, no payload and no headers when it is told none', () => {
      const { run, said } = setup();

      run({ type: 'publish', from: { kind: 'exchange', name: 'orders' } });

      expect(said).toMatchObject([{ message: { key: '', payload: '', headers: [] } }]);
    });

    it('asks for a frame, so that what was sent is seen to go', () => {
      const { run, frames } = setup();

      run(PUBLISH);

      expect(frames.pending).toBe(1);
    });

    it('is refused by the bus for what the canvas cannot do, before the simulation hears of it', () => {
      const { bus, said, status } = setup();

      const result = bus.run({ type: 'publish', from: { kind: 'producer', name: 'nobody' } }, 'typed');

      expect(!result.ok && result.error.kind).toBe('missing-element');
      expect(status.refusal()).toMatchObject({ origin: 'typed' });
      expect(said).toEqual([]);
    });

    it('throws for a producer that the canvas does not have, which only a caller that did not ask the bus could do', () => {
      const { simulation } = setup();

      expect(() => simulation.execute({ type: 'publish', from: { kind: 'producer', name: 'nobody' } })).toThrow(
        new RangeError('There is no producer named "nobody" on the canvas'),
      );
    });
  });

  describe('step', () => {
    it('runs the one thing that is next, moves the clock to it, and says what it was', () => {
      const { run, simulation, said } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      said.length = 0;

      const outcome = run({ type: 'step' });

      expect(outcome).toEqual({ changed: true, said: 'Stepped: message 1 was routed to billing.' });
      expect(simulation.view().now).toBe(100);
      expect(types(said)).toEqual(['routed']);
    });

    it('runs the next thing, and not all that is scheduled for that time, so that a learner can see each', () => {
      const { run, said } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      said.length = 0;

      run({ type: 'step' });
      run({ type: 'step' });

      expect(said).toMatchObject([
        { type: 'routed', message: 1, at: 100 },
        { type: 'routed', message: 2, at: 100 },
      ]);
    });

    it('says what several things were, when a step did several', () => {
      const { run } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
      run({ type: 'step' });

      expect(run({ type: 'step' }).said).toBe('Stepped: message 1 is in billing; billing gave message 1 to worker.');
    });

    it('does nothing when nothing is scheduled, and says so', () => {
      const { run, simulation } = setup();

      expect(run({ type: 'step' })).toEqual({
        changed: false,
        said: 'Nothing is scheduled, so there is nothing to step.',
      });
      expect(simulation.view().now).toBe(0);
    });

    it('keeps the real clock at the clock of the engine, so that playing goes on from there', () => {
      const { run, frames, simulation } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
      run({ type: 'play' });

      frames.frame(10);
      frames.frame(30);

      expect(simulation.view().now).toBe(120);
    });

    it('moves the picture to where the clock is over a quarter of a second, and the clock at once', () => {
      const { run, frames, simulation } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      frames.frame(0);

      run({ type: 'step' });

      expect(simulation.view().now).toBe(100);
      expect(simulation.visualTime()).toBe(0);
      expect(simulation.animating()).toBe(true);

      frames.frame(1_000);
      frames.frame(1_100);
      frames.frame(1_125);
      expect(simulation.visualTime()).toBe(50);

      frames.frame(1_225);
      frames.frame(1_000 + STEP_TWEEN_MS);
      expect(simulation.visualTime()).toBe(100);
      expect(simulation.animating()).toBe(false);
      frames.frame(2_000);
      expect(frames.pending).toBe(0);
    });

    it('moves the picture from where the last step left it to where this one puts it', () => {
      const { run, frames, simulation } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      // Both messages arrive at 100, and a step takes one of them.
      run({ type: 'step' });
      run({ type: 'step' });
      for (const time of [1_000, 1_100, 1_200, 1_250]) {
        frames.frame(time);
      }
      expect(simulation.visualTime()).toBe(100);

      run({ type: 'step' });
      expect(simulation.view().now).toBe(150);
      for (const time of [2_000, 2_100, 2_125]) {
        frames.frame(time);
      }

      expect(simulation.visualTime()).toBe(125);
    });

    it('moves the picture from where it is when a step is taken before the last has finished', () => {
      const { run, frames, simulation } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      run({ type: 'step' });
      frames.frame(1_000);
      frames.frame(1_100);
      frames.frame(1_125);
      expect(simulation.visualTime()).toBe(50);

      run({ type: 'step' });

      expect(simulation.visualTime()).toBe(50);
    });

    it('moves the picture at once when the learner asked for less motion, which changes nothing else', () => {
      const { run, simulation } = setup({ reduced: true });
      run({ type: 'pause' });
      run(PUBLISH);

      run({ type: 'step' });

      expect(simulation.visualTime()).toBe(100);
      expect(simulation.animating()).toBe(false);
      expect(simulation.view().now).toBe(100);
    });

    it('is where the clock is when nothing was stepped', () => {
      const { run, frames, simulation } = setup();
      run(PUBLISH);
      frames.frame(0);
      frames.frame(30);

      expect(simulation.visualTime()).toBe(30);
    });
  });

  describe('purge, clear and reset', () => {
    /** The canvas with three messages in the queue, and nobody to take them. */
    const filled = () => {
      const harness = setup({ document: { ...traffic(), consumers: {} } });
      harness.run({ type: 'pause' });
      for (let sent = 0; sent < 3; sent += 1) {
        harness.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' });
      }
      for (let steps = 0; steps < 6; steps += 1) {
        harness.run({ type: 'step' });
      }
      return harness;
    };

    it('takes the ready messages out of a queue, and says how many', () => {
      const { run, stats } = filled();
      expect(stats.of('Q')()).toMatchObject({ ready: 3 });

      expect(run({ type: 'purge', queue: 'billing' })).toEqual({
        changed: true,
        said: 'Purged 3 messages from billing.',
      });
      expect(stats.of('Q')()).toMatchObject({ ready: 0 });
    });

    it('says one message when it was one', () => {
      const { run } = setup({ document: { ...traffic(), consumers: {} } });
      run({ type: 'pause' });
      run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' });
      run({ type: 'step' });
      run({ type: 'step' });

      expect(run({ type: 'purge', queue: 'billing' }).said).toBe('Purged 1 message from billing.');
    });

    it('changes nothing for a queue that has nothing ready, and says why', () => {
      const { run } = setup();

      expect(run({ type: 'purge', queue: 'billing' })).toEqual({
        changed: false,
        said: 'Nothing to purge: billing has no ready messages.',
      });
    });

    it('takes every message out of the simulation, and says so', () => {
      const { run, stats, simulation } = filled();
      run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' });

      expect(run({ type: 'clear-messages' })).toEqual({ changed: true, said: 'Cleared the messages.' });
      expect(stats.of('Q')()).toMatchObject({ ready: 0 });
      expect(simulation.travelling()).toBe(0);
      expect(simulation.canStep()).toBe(false);
    });

    it('changes nothing when there are no messages, and says so', () => {
      const { run } = setup();

      expect(run({ type: 'clear-messages' })).toEqual({ changed: false, said: 'There are no messages to clear.' });
    });

    it('zeroes the counters, and leaves the messages', () => {
      const { run, stats } = filled();
      expect(stats.of('E')()).toMatchObject({ routed: 3 });

      expect(run({ type: 'reset-counters' })).toEqual({ changed: true, said: 'Counters reset.' });
      expect(stats.of('E')()).toMatchObject({ routed: 0 });
      expect(stats.of('Q')()).toMatchObject({ ready: 3 });
    });

    it('changes nothing when they are 0 already, and says so', () => {
      const { run } = setup();

      expect(run({ type: 'reset-counters' })).toEqual({ changed: false, said: 'The counters are 0 already.' });
    });
  });

  describe('what the numbers of the nodes follow', () => {
    it('is what the engine says, after what it said', () => {
      const { run, stats } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      for (let steps = 0; steps < 5; steps += 1) {
        run({ type: 'step' });
      }

      expect(stats.of('P')()).toEqual({ kind: 'producer', sent: 2, repeating: false });
      expect(stats.of('E')()).toMatchObject({ routed: 2 });
      expect(stats.of('Q')()).toMatchObject({ ready: 1, unacked: 1 });
      expect(stats.of('C')()).toMatchObject({ holds: 1, finished: 0 });
    });

    it('does not set a signal for a frame in which nothing was said', () => {
      const { run, frames, stats } = setup();
      run(PUBLISH);
      frames.frame(0);
      const sets: number[] = [];
      const apply = stats.apply.bind(stats);
      stats.apply = (next) => {
        const count = apply(next);
        sets.push(count);
        return count;
      };

      // 10 ms in, the messages are still on their way to the broker, and the engine has nothing to say.
      frames.frame(10);

      expect(sets).toEqual([]);
    });

    it('counts the changes that were said, so that a list that depends on them is read again', () => {
      const { run, simulation, frames } = setup();
      const before = simulation.revision();
      run(PUBLISH);
      const after = simulation.revision();
      frames.frame(0);
      frames.frame(10);

      expect(after).toBeGreaterThan(before);
      expect(simulation.revision()).toBe(after);
    });

    it('is the time, to a tenth of a second, and how many messages are on their way', () => {
      const { run, frames, simulation } = setup();
      run(PUBLISH);
      expect(simulation.travelling()).toBe(2);

      frames.frame(0);
      frames.frame(60);
      expect(simulation.time()).toBe(0);
      frames.frame(100);
      expect(simulation.time()).toBe(100);
      frames.frame(160);
      expect(simulation.time()).toBe(100);
    });
  });

  describe('following the canvas', () => {
    it('has what the canvas gets, and what it loses', () => {
      const { bus, simulation, store, stats } = setup();

      bus.apply({ type: 'declare-queue', name: 'archive', durable: true }, 'gesture');
      const archive = findId(store.document(), 'queue', 'archive') as string;

      expect(simulation.view().queues['archive']).toMatchObject({ ready: 0 });
      expect(stats.of(archive)()).toEqual({ kind: 'queue', ready: 0, unacked: 0, consumers: 0 });

      bus.undo('toolbar');

      expect(simulation.view().queues['archive']).toBeUndefined();
      expect(stats.of(archive)()).toBeNull();
      bus.redo('toolbar');
      expect(simulation.view().queues['archive']).toBeDefined();
    });

    it('wakes up for a change of the canvas, since a producer that was set to repeat has something to do', () => {
      const { bus, frames } = setup();
      expect(frames.pending).toBe(0);

      bus.apply({ type: 'set', kind: 'producer', name: 'sender', changes: { repeat: true } }, 'inspector');

      expect(frames.pending).toBe(1);
    });

    it('gives the simulation the seed and the latencies of the canvas', () => {
      const { bus, simulation } = setup();

      bus.apply(
        { type: 'set', kind: 'canvas', changes: { seed: 9, publishMs: 7, brokerMs: 8, deliverMs: 9 } },
        'inspector',
      );

      expect(simulation.view()).toMatchObject({ seed: 9, timing: { publishMs: 7, brokerMs: 8, deliverMs: 9 } });
    });

    it('begins again for a canvas that is opened, with a clock at 0, and nothing that was in it', () => {
      const { run, frames, simulation, store, stats } = setup();
      run(PUBLISH);
      frames.frame(0);
      frames.frame(50);
      expect(simulation.view().now).toBe(50);

      store.load(documentOf({ queues: { Q: queueRecord('other') } }));

      expect(simulation.view().now).toBe(0);
      expect(simulation.view().published).toBe(0);
      expect(Object.keys(simulation.view().queues)).toEqual(['other']);
      expect(stats.of('E')()).toBeNull();
      expect(stats.of('Q')()).toMatchObject({ kind: 'queue' });
    });

    it('counts the messages that a queue held and the ones that its consumers held, as lost, when the queue is deleted', () => {
      const { run, bus, status } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      for (let steps = 0; steps < 4; steps += 1) {
        run({ type: 'step' });
      }

      bus.apply({ type: 'delete', target: { kind: 'queue', name: 'billing' } }, 'key');

      expect(status.notice()).toEqual({ kind: 'message', text: 'Deleted queue billing. 2 messages were lost.' });
    });

    it('tells how many messages a change took with it, after what it did, and once', () => {
      const { run, bus, status } = setup({ document: { ...traffic(), consumers: {} } });
      run({ type: 'pause' });
      for (let sent = 0; sent < 3; sent += 1) {
        run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' });
      }
      for (let steps = 0; steps < 6; steps += 1) {
        run({ type: 'step' });
      }

      bus.apply({ type: 'delete', target: { kind: 'queue', name: 'billing' } }, 'key');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Deleted queue billing. 3 messages were lost.' });

      bus.undo('toolbar');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Undid: deleted queue billing.' });
      bus.redo('toolbar');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Redid: deleted queue billing.' });
    });

    it('tells it for an undo, a redo and a change that the canvas said already', () => {
      const { run, bus, status } = setup({ document: { ...traffic(), consumers: {} } });
      bus.apply({ type: 'declare-queue', name: 'extra', durable: true }, 'gesture');
      bus.apply(
        { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'extra' }, key: 'new' },
        'gesture',
      );
      run({ type: 'pause' });
      run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' });
      run({ type: 'step' });
      run({ type: 'step' });
      run({ type: 'step' });

      bus.undo('toolbar');
      bus.undo('toolbar');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Undid: added queue extra. 1 message was lost.' });
      bus.redo('toolbar');
      bus.redo('toolbar');
      run({ type: 'publish', from: { kind: 'exchange', name: 'orders' }, key: 'new' });
      for (let steps = 0; steps < 3; steps += 1) {
        run({ type: 'step' });
      }
      bus.apply({ type: 'delete', target: { kind: 'queue', name: 'extra' } }, 'key', { say: false });

      expect(status.notice()).toEqual({ kind: 'message', text: '1 message was lost.' });
    });

    it('says nothing of what was lost when nothing was', () => {
      const { bus, status } = setup();

      bus.apply({ type: 'declare-queue', name: 'extra', durable: true }, 'gesture');

      expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue extra.' });
      bus.apply({ type: 'declare-queue', name: 'more', durable: true }, 'gesture', { say: false });
      expect(status.notice()).toBeNull();
    });

    it('does not tell what was lost twice', () => {
      const { simulation, bus } = setup();
      bus.apply({ type: 'declare-queue', name: 'extra', durable: true }, 'gesture');

      expect(simulation.takeLost()).toBe(0);
      expect(simulation.takeLost()).toBe(0);
    });
  });

  describe('what it says', () => {
    it('tells whoever listens what the engine said, in order, after each command and each advance, and stops when it is told to', () => {
      const { run, frames, simulation } = setup();
      const heard: string[][] = [];
      const stop = simulation.onEvents((events) => heard.push(types(events)));

      run(PUBLISH);
      frames.frame(0);
      frames.frame(100);
      stop();
      frames.frame(200);

      expect(heard).toEqual([
        ['published', 'published'],
        ['routed', 'routed'],
      ]);
    });

    it('tells the canvas that the events are about with them: the one that the engine routes with, for what a command and the clock make (ADR-0061)', () => {
      const { run, frames, simulation, store } = setup();
      const about: CanvasDocument[] = [];
      simulation.onEvents((_events, document) => about.push(document));

      run(PUBLISH);
      frames.frame(0);
      frames.frame(100);

      expect(about).toHaveLength(2);
      expect(about[0]).toBe(store.document());
      expect(about[1]).toBe(store.document());
    });

    it('says whether the clock made the events or a command did, since the line of a command comes after what it made (ADR-0061)', () => {
      const { run, frames, simulation, bus } = setup();
      const causes: string[] = [];
      simulation.onEvents((events, _about, cause) => causes.push(`${cause}:${events[0]?.type}`));

      run(PUBLISH);
      frames.frame(0);
      frames.frame(100);
      run({ type: 'pause' });
      run({ type: 'step' });
      bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'gesture');

      expect(causes).toEqual(['command:published', 'clock:routed', 'command:enqueued', 'command:channel.closed']);
    });

    it('tells, for what a change of the canvas did, the canvas as it was before the change, which still has the names of what went', () => {
      const { simulation, bus } = setup();
      const heard: { types: string[]; consumers: (string | undefined)[] }[] = [];
      simulation.onEvents((events, document) =>
        heard.push({
          types: types(events),
          consumers: events.flatMap((event) =>
            event.type === 'channel.closed' ? [nameOf(document, 'consumer', event.channel)] : [],
          ),
        }),
      );

      bus.apply({ type: 'delete', target: { kind: 'consumer', name: 'worker' } }, 'gesture');

      expect(heard).toEqual([{ types: ['channel.closed'], consumers: ['worker'] }]);
    });

    it('says the time of the engine in milliseconds, which is what the log puts on a line of a command', () => {
      const { run, simulation } = setup();
      run({ type: 'pause' });
      run(PUBLISH);

      expect(simulation.now()).toBe(0);
      run({ type: 'step' });
      expect(simulation.now()).toBe(100);
    });

    it('says the same for the same commands and the same advances, which is what makes a lesson of it', () => {
      const play = () => {
        const { run, frames, said } = setup();
        run(PUBLISH);
        frames.frame(0);
        for (let time = 10; time <= 1_000; time += 10) {
          frames.frame(time);
        }
        return JSON.stringify(said);
      };
      const first = play();
      TestBed.resetTestingModule();

      expect(play()).toBe(first);
    });

    it('gives what a spec outside the page reads: the clock, whether it runs, how fast, when the next thing is, and the view', () => {
      const { run, simulation } = setup();
      run(PUBLISH);

      expect(simulation.debugState()).toMatchObject({ now: 0, running: true, speed: 1, nextAt: 100 });
      expect(simulation.debugState().view.published).toBe(2);
    });

    it('lists the messages of a queue, ready first and then held, at most as many as it is asked for', () => {
      const { run, simulation } = setup();
      run({ type: 'pause' });
      run(PUBLISH);
      for (let steps = 0; steps < 5; steps += 1) {
        run({ type: 'step' });
      }

      expect(simulation.messages('billing', 10).map(({ id, heldBy }) => [id, heldBy?.consumer ?? null])).toEqual([
        [2, null],
        [1, 'C/billing'],
      ]);
      expect(simulation.messages('billing', 1)).toHaveLength(1);
      expect(simulation.flights()).toEqual([]);
    });

    it('lists the flights of the messages that are on their way', () => {
      const { run, simulation } = setup();
      run(PUBLISH);

      expect(simulation.flights()).toMatchObject([
        { leg: 'publish', message: 1, producer: 'P', exchange: 'orders', from: 0, to: 100 },
        { leg: 'publish', message: 2, from: 0, to: 100 },
      ]);
    });
  });

  describe('the messages of a shared canvas (ADR-0078)', () => {
    const shared = (snapshot: EngineSnapshot) => {
      const failed = vi.fn<(reason: string) => void>();
      return { failed, messages: { snapshot, failed } as SharedMessages };
    };

    it('are given to the engine when the canvas first loads: paused, with the clock where the sender left it, and the messages where they were', () => {
      const snapshot = snapshotAfter(traffic(), 180);
      const { messages, failed } = shared(snapshot);
      expect(snapshot.now).toBe(180);

      const { simulation, frames, stats } = setup({ shared: messages });
      frames.frame(10_000);

      expect(failed).not.toHaveBeenCalled();
      expect(simulation.running()).toBe(false);
      expect(simulation.now()).toBe(180);
      expect(simulation.time()).toBe(100);
      expect(simulation.snapshot()).toEqual(snapshot);
      expect(simulation.messageCount()).toBeGreaterThan(0);
      // Paused, the clock does not move, whatever the frames say.
      expect(simulation.now()).toBe(180);
      // The screen is told at once, without waiting for the clock: the numbers on the nodes and the messages on their way are those of the messages that came.
      expect(stats.of('Q')()).toEqual({ kind: 'queue', ready: 1, unacked: 1, consumers: 1 });
      expect(stats.of('P')()).toEqual({ kind: 'producer', sent: 2, repeating: false });
      expect(simulation.travelling()).toBe(1);
    });

    it('go on from there when the learner plays, as the engine that the snapshot was taken from would have', () => {
      const snapshot = snapshotAfter(traffic(), 180);
      const original = engineFor(traffic());
      original.restore(snapshot);
      const { messages } = shared(snapshot);
      const { simulation, run, elapse } = setup({ shared: messages });

      run({ type: 'play' });
      elapse(220);
      original.advanceTo(400);

      expect(simulation.running()).toBe(true);
      expect(simulation.now()).toBe(400);
      expect(simulation.snapshot()).toEqual(original.snapshot());
    });

    it('are given only to the first canvas that loads, and the next canvas starts as every canvas does', () => {
      const snapshot = snapshotAfter(traffic(), 180);
      const { messages } = shared(snapshot);
      const { simulation, store } = setup({ shared: messages });
      expect(simulation.messageCount()).toBeGreaterThan(0);

      store.load(traffic());

      expect(simulation.messageCount()).toBe(0);
      expect(simulation.now()).toBe(0);
    });

    it('are left out, and the view is told why, when the engine does not take them: the canvas is as it would be without them and runs', () => {
      const { messages, failed } = shared({
        ...snapshotAfter(traffic(), 180),
        version: 2,
      } as unknown as EngineSnapshot);

      const { simulation } = setup({ shared: messages });

      expect(failed).toHaveBeenCalledTimes(1);
      expect(failed.mock.calls[0]?.[0]).toBe('This engine reads snapshots of version 1, and this one is version 2');
      expect(simulation.running()).toBe(true);
      expect(simulation.now()).toBe(0);
      expect(simulation.messageCount()).toBe(0);
    });
  });

  describe('what a link carries (ADR-0077)', () => {
    it('is the engine as it is: its snapshot is the same as the engine of the document makes, and it changes as the run goes on', () => {
      const { simulation, run, elapse } = setup();
      const before = simulation.snapshot();
      expect(before.now).toBe(0);
      expect(before.published).toBe(0);

      run(PUBLISH);
      elapse(120);

      expect(simulation.snapshot().published).toBe(2);
      expect(simulation.snapshot().now).toBeGreaterThan(0);
      expect(before.published).toBe(0);
    });

    it('is counted in messages: those on their way, those waiting in queues, and those a consumer holds, and none when there are none', () => {
      const { simulation, run, elapse } = setup();
      expect(simulation.messageCount()).toBe(0);

      run(PUBLISH);
      expect(simulation.messageCount()).toBe(2);

      elapse(160);
      // One is at the consumer, which holds it until it has finished and acknowledged it, and one waits in the queue.
      expect(simulation.messageCount()).toBe(2);

      elapse(1_000, 170);
      expect(simulation.messageCount()).toBe(0);
    });
  });

  describe('when it is destroyed', () => {
    it('is not what the bus runs the commands with, and asks for no more frames', () => {
      const frames = manualFrames();
      const injector = createEnvironmentInjector(services(frames), TestBed.inject(EnvironmentInjector));
      const bus = injector.get(CommandBus);
      injector.get(DocumentStore).load(traffic());
      injector.get(Simulation);
      expect(bus.run(PUBLISH, 'key').ok).toBe(true);
      expect(frames.pending).toBe(1);

      injector.destroy();

      expect(frames.pending).toBe(0);
      const result = bus.run({ type: 'play' }, 'key');
      expect(!result.ok && result.error.kind).toBe('unsupported');
    });
  });
});
