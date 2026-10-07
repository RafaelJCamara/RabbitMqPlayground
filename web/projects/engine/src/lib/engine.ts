import type { EngineCommand } from './command';
import { runCommand } from './commands';
import { createCore, type Core } from './core';
import type { EngineEvent } from './events';
import { onEnqueue, onArrive, onTick, topologyOf } from './publishing';
import { onFinish, onReceive } from './queues';
import type { RefusalCode } from './refusal';
import { loadSnapshot, snapshotIssue, takeSnapshot, type EngineSnapshot } from './snapshot';
import { createState, type State, type Task } from './state';
import type { Timing } from './view';
import { buildFlights, buildView, listMessages } from './views';
import type { Flight, QueueMessage, RuntimeView } from './view';

/**
 * The engine (ADR-0007, ADR-0052): commands in, events out, one virtual clock. It reads no clock and no timer of the machine, and nothing in what
 * it takes or gives is a function, so it can run on the main thread or in a worker, and the same seed and the same commands give the same events.
 */

export interface EngineOptions {
  readonly seed: number;
  readonly timing: Timing;
  /** The virtual host, which the broker names in some of its refusals. `/` unless the canvas says otherwise. */
  readonly vhost?: string;
}

export type DispatchResult =
  | { readonly ok: true; readonly events: EngineEvent[] }
  /** A command that the broker refuses (ADR-0050). `events` are what the refusal did, which is nothing, unless it closed a channel. */
  | { readonly ok: false; readonly code: RefusalCode; readonly text: string; readonly events: EngineEvent[] };

export interface Engine {
  /** Does what the command asks, at the time that it is now. What takes time is scheduled, and what the broker does at once is done and said. */
  dispatch(command: EngineCommand): DispatchResult;
  /** Runs everything that is scheduled for this time or before it, in order, and leaves the clock at this time. A time before now changes nothing. */
  advanceTo(time: number): EngineEvent[];
  /** Runs the one thing that is scheduled next, and moves the clock to its time. Nothing is run when nothing is scheduled. */
  step(): EngineEvent[];
  now(): number;
  /** When the next thing happens, or `null` when nothing is scheduled. */
  nextAt(): number | null;
  view(): RuntimeView;
  /** The messages that are on the move, in the order that they will arrive. */
  flights(): readonly Flight[];
  /** What a queue holds, ready first and then held, at most `limit`. A queue that is not there holds nothing. */
  messages(queue: string, limit?: number): QueueMessage[];
  snapshot(): EngineSnapshot;
  /** Replaces everything with what the snapshot holds. It throws a `RangeError` for a version that it cannot read. */
  restore(snapshot: EngineSnapshot): void;
}

function runTask(core: Core, task: Task): void {
  switch (task.kind) {
    case 'tick':
      return onTick(core, task.producer);
    case 'arrive':
      return onArrive(core, task.message);
    case 'enqueue':
      return onEnqueue(
        core,
        task.message,
        task.paths.map(({ queue }) => queue),
      );
    case 'receive':
      return onReceive(core, task.channel, task.held);
    case 'finish':
      return onFinish(core, task.channel, task.held);
  }
}

export function createEngine(options: EngineOptions): Engine {
  const state: State = createState({ seed: options.seed, timing: options.timing, vhost: options.vhost ?? '/' });
  const core = createCore(state);
  let flightsOf: { readonly version: number; readonly flights: readonly Flight[] } | null = null;

  const take = (): EngineEvent[] => {
    state.version += 1;
    return core.said.splice(0);
  };

  const runNext = (): void => {
    const next = state.heap.pop();
    if (next !== undefined) {
      state.now = Math.max(state.now, next.at);
      runTask(core, next.task);
    }
  };

  return {
    dispatch(command) {
      const refusal = runCommand(core, command);
      const events = take();
      return refusal === null ? { ok: true, events } : { ok: false, code: refusal.code, text: refusal.text, events };
    },
    advanceTo(time) {
      const until = Math.floor(time);
      for (let next = state.heap.peek(); next !== undefined && next.at <= until; next = state.heap.peek()) {
        runNext();
      }
      state.now = Math.max(state.now, until);
      return take();
    },
    step() {
      runNext();
      return take();
    },
    now: () => state.now,
    nextAt: () => state.heap.peek()?.at ?? null,
    view: () => buildView(state, topologyOf(state)),
    flights() {
      if (flightsOf?.version !== state.version) {
        flightsOf = { version: state.version, flights: buildFlights(state) };
      }
      return flightsOf.flights;
    },
    messages: (queue, limit = Number.POSITIVE_INFINITY) => listMessages(state, queue, limit),
    snapshot: () => takeSnapshot(state),
    restore(snapshot) {
      const issue = snapshotIssue(snapshot);
      if (issue !== null) {
        throw new RangeError(issue);
      }
      Object.assign(state, loadSnapshot(snapshot));
      core.said.length = 0;
      state.version += 1;
    },
  };
}
