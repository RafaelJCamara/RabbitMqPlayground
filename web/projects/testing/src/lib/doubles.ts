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

/** The part of the page's frames that something that animates needs: a way to ask for the next one, and a way to take the request back. */
export interface ManualFramesSource {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export interface ManualFrames extends ManualFramesSource {
  /**
   * Runs the frames that were asked for, as the page would at this time (milliseconds). A frame that one of them asks for is for the next call. Answers how many ran,
   * which is 0 when none was asked for.
   */
  frame(time: number): number;
  /** How many frames are waiting to run. */
  readonly pending: number;
  /** How many frames were asked for in all, and not taken back. */
  readonly requested: number;
}

/** Frames that only run when a spec says so, at the time that it says. */
export function manualFrames(): ManualFrames {
  let last = 0;
  let requested = 0;
  let waiting = new Map<number, (time: number) => void>();

  return {
    request(callback) {
      last += 1;
      requested += 1;
      waiting.set(last, callback);
      return last;
    },
    cancel(handle) {
      if (waiting.delete(handle)) {
        requested -= 1;
      }
    },
    frame(time) {
      const due = waiting;
      waiting = new Map();
      for (const callback of due.values()) {
        callback(time);
      }
      return due.size;
    },
    get pending() {
      return waiting.size;
    },
    get requested() {
      return requested;
    },
  };
}
