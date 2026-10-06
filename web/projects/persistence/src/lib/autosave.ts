import { classifyStorageError } from './errors';
import { failure, succeed, type Outcome } from './outcome';

/**
 * Autosave (ADR-0028): a debounced writer for one value that changes, the document of the open canvas. Every command changes
 * it, and it is written once the changes stop. A failure is a result, and not an exception, because a disk that is full is
 * something that the editor shows, and the value that failed is not lost.
 */

/** How long after the last change the value is written. */
export const AUTOSAVE_DELAY_MS = 500;

/** The part of a timer that autosave needs. A spec supplies one that it moves by hand. */
export interface AutosaveTimer {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

/** The timer of the page. */
export const systemTimer: AutosaveTimer = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as number),
};

export interface AutosaveOptions<T> {
  /** Writes a value, for example `(document) => repository.save(id, { document })`. */
  readonly write: (value: T) => Promise<Outcome<unknown>>;
  readonly delayMs?: number;
  readonly timer?: AutosaveTimer;
  /** Told what each write came to: the value that was written, or why it was not. */
  readonly onResult?: (result: Outcome<T>) => void;
}

export interface Autosave<T> {
  /** The value to write once there have been no more changes for the delay. A later value replaces it. */
  schedule(value: T): void;
  /** Writes what is waiting, now, after any write that is under way. Answers whether anything was written. */
  flush(): Promise<Outcome<boolean>>;
  /** Forgets what is waiting, for a canvas that is closed or deleted. A write that is under way goes on. */
  cancel(): void;
  /** Whether a value has not been written yet: it is waiting for the delay, or it is being written, or the write failed. */
  readonly pending: boolean;
}

export function createAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
  const { write, delayMs = AUTOSAVE_DELAY_MS, timer = systemTimer, onResult } = options;

  /** The newest value that has not been written. It is kept when its write fails, so that the next call can try again. */
  let waiting: { readonly value: T } | undefined;
  /** The last value that was written, so that the very same one is never written again (ADR-0019). */
  let written: { readonly value: T } | undefined;
  let handle: unknown;
  /** The end of the writes that were asked for, so that they run one at a time, in order. */
  let last: Promise<unknown> = Promise.resolve();

  /** Tells the listener, which is the editor's, and which a failure of its own must not make this stop saving. */
  const report = (result: Outcome<T>): void => {
    try {
      onResult?.(result);
    } catch {
      // Nothing to do about it here, and the next write must still happen.
    }
  };

  async function writeWaiting(): Promise<Outcome<boolean>> {
    const current = waiting;
    if (current === undefined) {
      return succeed(false);
    }
    if (written !== undefined && Object.is(written.value, current.value)) {
      // It changed and changed back, before anything was written: there is nothing to say.
      waiting = undefined;
      return succeed(false);
    }

    let result: Outcome<unknown>;
    try {
      result = await write(current.value);
    } catch (error) {
      result = failure(classifyStorageError(error, 'use'));
    }

    if (!result.ok) {
      report(failure(result.error));
      return failure(result.error);
    }
    written = current;
    if (waiting === current) {
      // A value that came while this one was being written stays waiting, with a timer of its own.
      waiting = undefined;
    }
    report(succeed(current.value));
    return succeed(true);
  }

  const enqueue = (): Promise<Outcome<boolean>> => {
    const task = last.then(writeWaiting);
    last = task;
    return task;
  };

  const stopTimer = (): void => {
    if (handle !== undefined) {
      timer.clear(handle);
      handle = undefined;
    }
  };

  return {
    schedule(value) {
      if (waiting === undefined && written !== undefined && Object.is(written.value, value)) {
        return;
      }
      waiting = { value };
      stopTimer();
      handle = timer.set(() => {
        handle = undefined;
        void enqueue();
      }, delayMs);
    },
    flush() {
      stopTimer();
      return enqueue();
    },
    cancel() {
      stopTimer();
      waiting = undefined;
    },
    get pending() {
      return waiting !== undefined;
    },
  };
}
