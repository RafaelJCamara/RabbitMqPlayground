import type { EngineEvent } from './events';
import type { State, Task } from './state';

/**
 * What the functions of the engine are given to work with: the state, a way to say an event and a way to schedule something. The engine
 * collects what was said and hands it to whoever asked (ADR-0052).
 */

/** An event as a function says it, without the number and the time, which the core gives it. */
export type Said = EngineEvent extends infer Event
  ? Event extends EngineEvent
    ? Omit<Event, 'seq' | 'at'>
    : never
  : never;

export interface Core {
  readonly state: State;
  /** What has been said since it was last taken, in the order that it was said. */
  readonly said: EngineEvent[];
  emit(event: Said): void;
  /** Schedules a task for a time that is now or later. Ties are settled by the order in which things were scheduled. */
  schedule(at: number, task: Task): void;
}

export function createCore(state: State): Core {
  const said: EngineEvent[] = [];
  return {
    state,
    said,
    emit(event) {
      said.push({ ...event, seq: state.nextEventSeq, at: state.now } as EngineEvent);
      state.nextEventSeq += 1;
    },
    schedule(at, task) {
      state.heap.push({ at, seq: state.nextSeq, task });
      state.nextSeq += 1;
    },
  };
}
