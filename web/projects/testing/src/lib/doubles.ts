/**
 * Stand-ins for the clock, for ids and for a timer, so that a spec of something that keeps time, or waits, is the same
 * every time (ADR-0015). The libraries take all three as inputs, and never read them from the environment (ADR-0018).
 */

export interface ManualClock {
  /** The time now, in milliseconds. */
  now(): number;
  /** Moves it forward. */
  advance(ms: number): void;
  /** Puts it somewhere. */
  set(ms: number): void;
}

/** A clock that only moves when a spec says so. */
export function manualClock(start = 1_000_000): ManualClock {
  let time = start;
  return {
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
    set: (ms) => {
      time = ms;
    },
  };
}

/** Ids that count up from 1 and start with `prefix`: `id1`, `id2`, `id3`. */
export function idSequence(prefix = 'id'): () => string {
  let count = 0;
  return () => `${prefix}${(count += 1)}`;
}

/** The part of a timer that something that waits needs: a way to start one, and a way to stop it. */
export interface ManualTimer {
  set(callback: () => void, delayMs: number): number;
  clear(handle: unknown): void;
  /**
   * Moves time forward, and runs every timer that falls due on the way, in the order of their times and then of the order that
   * they were set. A timer that one of them sets is run in the same move if it falls due in it.
   */
  advance(ms: number): void;
  /** How many timers are waiting. */
  readonly pending: number;
}

/** A timer that only runs when a spec moves time. */
export function manualTimer(): ManualTimer {
  let now = 0;
  let last = 0;
  const waiting = new Map<number, { readonly at: number; readonly callback: () => void }>();

  return {
    set(callback, delayMs) {
      last += 1;
      waiting.set(last, { at: now + delayMs, callback });
      return last;
    },
    clear(handle) {
      waiting.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        const due = [...waiting]
          .filter(([, timer]) => timer.at <= until)
          .sort(([idA, a], [idB, b]) => a.at - b.at || idA - idB)[0];
        if (due === undefined) {
          break;
        }
        waiting.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].callback();
      }
      now = until;
    },
    get pending() {
      return waiting.size;
    },
  };
}
