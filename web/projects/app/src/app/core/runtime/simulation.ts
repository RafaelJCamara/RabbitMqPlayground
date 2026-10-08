import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { findId, reconcile, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import {
  createEngine,
  type Engine,
  type EngineCommand,
  type EngineEvent,
  type EngineSnapshot,
  type Flight,
  type QueueMessage,
  type RuntimeView,
} from '@rmq/engine';
import { FeatureFlags } from '../flags/feature-flags';
import { SHARED_MESSAGES, type SharedMessages } from '../share/shared-messages';
import { CommandBus, type RuntimeHost, type RuntimeOutcome } from '../state/command-bus';
import { DocumentStore, type ChangeCause } from '../state/document-store';
import { copiesIn } from './copies';
import { FrameLoop } from './frame-loop';
import { MotionPreference } from './motion';
import { describeStep, namesOf } from './sentences';
import { SimStats } from './sim-stats';
import { statsOf } from './stats';

/** How long the picture takes to go from where it was to where a step put it, in real milliseconds (ADR-0055). The engine's clock does not take it: it jumps. */
export const STEP_TWEEN_MS = 250;

/** How much of the clock the readout of the strip shows: a tenth of a second, so that it changes ten times a second at most. */
const READOUT_MS = 100;

/** Is told what the engine said, and the canvas that it is about: the one that the engine holds, and for what a change of the canvas made, the one before the change, which still has the names of what went (ADR-0061). */
export type SimulationListener = (events: readonly EngineEvent[], about: CanvasDocument, cause: EventsCause) => void;

/** What made the events: the clock, which has no command of its own, or a command, whose line comes after them (ADR-0061). */
export type EventsCause = 'clock' | 'command';

/** What the simulation says of itself to whoever reads it from outside the page: the end-to-end suite (ADR-0056). */
export interface SimulationState {
  readonly now: number;
  readonly running: boolean;
  readonly speed: number;
  readonly nextAt: number | null;
  readonly view: RuntimeView;
}

const engineFor = ({ settings, vhost }: CanvasDocument): Engine =>
  createEngine({ seed: settings.seed, timing: settings.timing, vhost });

const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`;

/**
 * The simulation of the canvas that is open (ADR-0007, ADR-0052, ADR-0054): the engine, its clock and what the screen reads of it. It follows the document by
 * `reconcile`, which is the one path for a command, an undo, a redo and a load alike, so that it is always what the canvas says. It runs the commands of the
 * runtime that the bus hands it, and advances the engine in the frames of the page by the time that passed times the speed (ADR-0055). The engine is never
 * called by anything else, and what it says goes to the screen as signals that are set only when they change.
 *
 * Without the flag `simulation` it does nothing and takes nothing: the bus refuses what it is not given a host for.
 */
@Injectable()
export class Simulation implements RuntimeHost {
  private readonly store = inject(DocumentStore);
  private readonly bus = inject(CommandBus);
  private readonly frames = inject(FrameLoop);
  private readonly stats = inject(SimStats);
  private readonly motion = inject(MotionPreference);
  /** The messages of a shared canvas, until the document of the canvas has loaded and they have been given to the engine (ADR-0078). */
  private shared: SharedMessages | null = inject(SHARED_MESSAGES);

  readonly enabled = inject(FeatureFlags).isEnabled('simulation');

  private engine: Engine = engineFor(this.store.document());
  /** The document that the engine holds, which is what `reconcile` goes on from. */
  private held: CanvasDocument = this.store.document();
  /** The clock, with the fraction of a millisecond that the engine does not keep. */
  private real = 0;
  /** Where the picture was when a step moved the clock, and how long it has taken to get to where the clock is. `null` when it is where the clock is. */
  private tween: { readonly from: number; elapsed: number } | null = null;
  private lost = 0;
  private readonly listeners = new Set<SimulationListener>();

  private readonly playing = signal(true);
  private readonly rate = signal(1);
  private readonly readout = signal(0);
  private readonly onTheWay = signal(0);
  private readonly scheduled = signal(false);
  private readonly changes = signal(0);

  /** Whether the clock runs. It starts running, as the plan says, and stands still while nothing is scheduled (ADR-0054). */
  readonly running = this.playing.asReadonly();
  /** How fast it runs: 1 is a virtual millisecond for each real one. */
  readonly speed = this.rate.asReadonly();
  /** The virtual time, in milliseconds, to a tenth of a second. */
  readonly time = this.readout.asReadonly();
  /** How many messages are on their way: to the broker, to a queue or to a consumer. */
  readonly travelling = this.onTheWay.asReadonly();
  /** Whether there is something to step to. */
  readonly canStep = this.scheduled.asReadonly();
  /** Counts the changes that the engine made to what the screen reads of it, so that a list can be read again when the messages in it changed and their number did not. */
  readonly revision = this.changes.asReadonly();

  constructor() {
    if (!this.enabled) {
      return;
    }
    this.rebuild(this.store.document());
    const stopBus = this.bus.attach(this);
    const stopStore = this.store.subscribe((document, cause) => this.follow(document, cause));
    const stopFrames = this.frames.add((elapsed) => this.tick(elapsed));
    inject(DestroyRef).onDestroy(() => {
      stopBus();
      stopStore();
      stopFrames();
    });
  }

  // What the screen reads.

  view(): RuntimeView {
    return this.engine.view();
  }

  /** The messages on the move, which the overlay draws. */
  flights(): readonly Flight[] {
    return this.engine.flights();
  }

  /** What a queue holds, ready first and then held, at most `limit`. */
  messages(queue: string, limit: number): QueueMessage[] {
    return this.engine.messages(queue, limit);
  }

  /** The engine as it is, with what it holds and the clock, for a link that carries the messages (ADR-0077). */
  snapshot(): EngineSnapshot {
    return this.engine.snapshot();
  }

  /** How many copies of messages the canvas holds, each once: what a link with its messages carries (ADR-0078). */
  messageCount(): number {
    return copiesIn(this.engine.snapshot());
  }

  /** The engine's clock in whole virtual milliseconds, which is what a line of the log says when it was (ADR-0061). */
  now(): number {
    return this.engine.now();
  }

  /** Where the picture is: the clock, or where it is on its way to the clock after a step. */
  visualTime(): number {
    if (this.tween === null) {
      return this.real;
    }
    return this.tween.from + (this.real - this.tween.from) * (this.tween.elapsed / STEP_TWEEN_MS);
  }

  /** Whether something moves, which is when the frames go on: the clock runs with something scheduled, or the picture is on its way after a step. */
  animating(): boolean {
    return (this.playing() && this.engine.nextAt() !== null) || this.tween !== null;
  }

  /** Is told of what the engine says, after each command and each advance of the clock, in order. */
  onEvents(listener: SimulationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  debugState(): SimulationState {
    return {
      now: this.engine.now(),
      running: this.playing(),
      speed: this.rate(),
      nextAt: this.engine.nextAt(),
      view: this.engine.view(),
    };
  }

  // What the bus asks.

  execute(command: RuntimeCommand): RuntimeOutcome {
    switch (command.type) {
      case 'play':
        return this.setPlaying(true);
      case 'pause':
        return this.setPlaying(false);
      case 'speed':
        return this.setSpeed(command.factor);
      case 'step':
        return this.step();
      case 'publish':
        return this.publish(command);
      case 'purge':
        return this.purge(command.queue);
      case 'clear-messages':
        return this.clearMessages();
      case 'reset-counters':
        return this.resetCounters();
    }
  }

  takeLost(): number {
    const lost = this.lost;
    this.lost = 0;
    return lost;
  }

  private setPlaying(on: boolean): RuntimeOutcome {
    if (on === this.playing()) {
      return { changed: false, said: on ? 'It is playing already.' : 'It is paused already.' };
    }
    this.playing.set(on);
    this.frames.wake();
    return { changed: true, said: on ? `Playing at ${this.rate()}×.` : 'Paused.' };
  }

  private setSpeed(factor: number): RuntimeOutcome {
    if (factor === this.rate()) {
      return { changed: false, said: `The speed is ${factor}× already.` };
    }
    this.rate.set(factor);
    return { changed: true, said: `Speed ${factor}×.` };
  }

  private step(): RuntimeOutcome {
    const from = this.visualTime();
    const events = this.engine.step();
    if (events.length === 0) {
      return { changed: false, said: 'Nothing is scheduled, so there is nothing to step.' };
    }
    this.real = Math.max(this.real, this.engine.now());
    // The picture takes a moment to get to where the clock is, unless the learner asked for less motion.
    this.tween = this.motion.reduced() ? null : { from, elapsed: 0 };
    this.refresh(events);
    this.frames.wake();
    return { changed: true, said: describeStep(events, namesOf(this.held)) };
  }

  private publish(command: Extract<RuntimeCommand, { type: 'publish' }>): RuntimeOutcome {
    const { from } = command;
    if (from.kind === 'producer') {
      const producer = this.required('producer', from.name);
      const sent = this.send({ op: 'producer.publish', producer }).filter(({ type }) => type === 'published').length;
      return { changed: true, said: `Published ${plural(sent, 'message')} from ${from.name}.` };
    }
    this.send({
      op: 'basic.publish',
      exchange: from.name,
      key: command.key ?? '',
      headers: command.headers ?? [],
      body: command.payload ?? '',
    });
    return { changed: true, said: `Published a message to ${from.name}.` };
  }

  private purge(queue: string): RuntimeOutcome {
    const purged = this.send({ op: 'queue.purge', name: queue }).find((event) => event.type === 'queue.purged');
    const count = purged?.type === 'queue.purged' ? purged.count : 0;
    return count > 0
      ? { changed: true, said: `Purged ${plural(count, 'message')} from ${queue}.` }
      : { changed: false, said: `Nothing to purge: ${queue} has no ready messages.` };
  }

  private clearMessages(): RuntimeOutcome {
    const cleared = this.send({ op: 'sim.clearMessages' }).length > 0;
    return cleared
      ? { changed: true, said: 'Cleared the messages.' }
      : { changed: false, said: 'There are no messages to clear.' };
  }

  private resetCounters(): RuntimeOutcome {
    const reset = this.send({ op: 'sim.resetCounters' }).length > 0;
    return reset ? { changed: true, said: 'Counters reset.' } : { changed: false, said: 'The counters are 0 already.' };
  }

  /** The id that the engine knows an element of the canvas by. A command that names one that is not there was not checked against the canvas, which is the bus's to do. */
  private required(kind: 'producer', name: string): string {
    const id = findId(this.held, kind, name);
    if (id === undefined) {
      throw new RangeError(`There is no ${kind} named "${name}" on the canvas`);
    }
    return id;
  }

  // Following the canvas.

  private follow(document: CanvasDocument, cause: ChangeCause): void {
    if (cause === 'load') {
      this.rebuild(document);
      this.restoreShared();
      return;
    }
    const before = this.held;
    const events = this.feed(reconcile(before, document));
    this.held = document;
    for (const event of events) {
      if (event.type === 'queue.deleted') {
        this.lost += event.ready + event.unacked;
      }
    }
    // A node that is new, or has another name, has numbers of its own though nothing was said.
    this.refresh(events, true, before);
    this.frames.wake();
  }

  /**
   * The first canvas to load in a shared view is the shared one, and the engine is given its messages: they are put back as they were, and the clock stands still where the sender left it (ADR-0078). If the engine does not
   * take them, which the reader of the link makes sure that it does, the canvas is without its messages and the view is told, so that it can say so.
   */
  private restoreShared(): void {
    const shared = this.shared;
    this.shared = null;
    if (shared === null) {
      return;
    }
    try {
      this.engine.restore(shared.snapshot);
    } catch (error) {
      // `restore` throws a RangeError, with the reason in its message, and nothing else (ADR-0077).
      shared.failed((error as RangeError).message);
      return;
    }
    this.real = this.engine.now();
    this.playing.set(false);
    this.refresh([], true);
    this.frames.wake();
  }

  /** A new engine, for a canvas that was opened: nothing that was running is kept, because nothing that it was running on is there. */
  private rebuild(document: CanvasDocument): void {
    this.engine = engineFor(document);
    this.held = document;
    this.real = 0;
    this.tween = null;
    this.lost = 0;
    this.refresh(this.feed(reconcile(null, document)), true);
    this.frames.wake();
  }

  /** Gives the engine the commands, which it takes: `reconcile` makes only commands that are valid for what the engine holds, and a refusal is a bug. */
  private feed(commands: readonly EngineCommand[]): EngineEvent[] {
    const events: EngineEvent[] = [];
    for (const command of commands) {
      const result = this.engine.dispatch(command);
      events.push(...result.events);
      if (!result.ok) {
        throw new Error(
          `The simulation could not follow the canvas: ${command.op} was refused with ${result.code} ${result.text}.`,
        );
      }
    }
    return events;
  }

  /** One command of the runtime, and what it said. */
  private send(command: EngineCommand): EngineEvent[] {
    const events = this.feed([command]);
    this.refresh(events);
    this.frames.wake();
    return events;
  }

  // Running.

  private tick(elapsed: number): boolean {
    if (this.playing()) {
      this.real += elapsed * this.rate();
      this.refresh(this.engine.advanceTo(Math.floor(this.real)), undefined, undefined, 'clock');
    }
    if (this.tween !== null) {
      this.tween.elapsed += elapsed;
      if (this.tween.elapsed >= STEP_TWEEN_MS) {
        this.tween = null;
      }
    }
    return this.animating();
  }

  /**
   * Tells the listeners what the engine said, and sets the signals that what it said changed. The numbers of the nodes are worked out when something was said,
   * and when the canvas changed, which is `redraw`.
   */
  private refresh(
    events: readonly EngineEvent[],
    redraw = events.length > 0,
    about = this.held,
    cause: EventsCause = 'command',
  ): void {
    if (events.length > 0) {
      this.changes.update((count) => count + 1);
      for (const listener of [...this.listeners]) {
        listener(events, about, cause);
      }
    }
    if (redraw) {
      this.publishView();
    }
    this.readout.set(Math.floor(this.engine.now() / READOUT_MS) * READOUT_MS);
    this.scheduled.set(this.engine.nextAt() !== null);
  }

  private publishView(): void {
    const view = this.engine.view();
    this.onTheWay.set(view.travelling);
    this.stats.apply(statsOf(this.held, view));
  }
}
