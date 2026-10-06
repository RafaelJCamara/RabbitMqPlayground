import { manualTimer } from '@rmq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, createAutosave, systemTimer, type AutosaveOptions } from './autosave';
import type { RepositoryError } from './errors';
import { failure, succeed, type Outcome } from './outcome';

/** A write that a spec holds open until it says so, so that it can look at what happens meanwhile. */
function heldWrites() {
  const started: string[] = [];
  const releases: ((outcome: Outcome<unknown>) => void)[] = [];
  let running = 0;
  let overlapped = false;
  const write = (value: string): Promise<Outcome<unknown>> => {
    started.push(value);
    running += 1;
    overlapped ||= running > 1;
    return new Promise((resolve) => {
      releases.push((outcome) => {
        running -= 1;
        resolve(outcome);
      });
    });
  };
  return {
    write,
    started,
    release: (outcome: Outcome<unknown> = succeed(undefined)) => releases.shift()?.(outcome),
    get overlapped() {
      return overlapped;
    },
  };
}

/** Lets what is waiting on a promise run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

const noRoom: RepositoryError = { kind: 'quota-exceeded', message: 'No room.' };

function setup(options: Partial<AutosaveOptions<string>> = {}) {
  const timer = manualTimer();
  const written: string[] = [];
  const results: Outcome<string>[] = [];
  const autosave = createAutosave<string>({
    write: async (value) => {
      written.push(value);
      return succeed(undefined);
    },
    timer,
    onResult: (result) => results.push(result),
    ...options,
  });
  return { autosave, timer, written, results };
}

describe('autosave', () => {
  describe('writing once the changes stop', () => {
    it('writes the value after the delay, and not before', async () => {
      const { autosave, timer, written } = setup();
      autosave.schedule('a');

      timer.advance(AUTOSAVE_DELAY_MS - 1);
      await settle();
      expect(written).toEqual([]);

      timer.advance(1);
      await settle();
      expect(written).toEqual(['a']);
    });

    it('waits half a second unless it is told otherwise', () => {
      expect(AUTOSAVE_DELAY_MS).toBe(500);
    });

    it('waits for the delay that it is given', async () => {
      const { autosave, timer, written } = setup({ delayMs: 50 });
      autosave.schedule('a');

      timer.advance(49);
      await settle();
      expect(written).toEqual([]);
      timer.advance(1);
      await settle();
      expect(written).toEqual(['a']);
    });

    it('starts the delay again with every change, so that nothing is written while changes keep coming', async () => {
      const { autosave, timer, written } = setup();
      autosave.schedule('a');
      timer.advance(300);
      autosave.schedule('b');
      timer.advance(300);
      autosave.schedule('c');
      timer.advance(499);
      await settle();
      expect(written).toEqual([]);

      timer.advance(1);
      await settle();
      expect(written).toEqual(['c']);
    });

    it('writes only the last value of a burst of changes, and writes it once', async () => {
      const { autosave, timer, written } = setup();
      for (const value of ['a', 'b', 'c', 'd']) {
        autosave.schedule(value);
      }
      timer.advance(10_000);
      await settle();

      expect(written).toEqual(['d']);
      expect(timer.pending).toBe(0);
    });

    it('writes each value that comes after the one before was written', async () => {
      const { autosave, timer, written } = setup();
      autosave.schedule('a');
      timer.advance(500);
      await settle();
      autosave.schedule('b');
      timer.advance(500);
      await settle();

      expect(written).toEqual(['a', 'b']);
    });
  });

  describe('being told what was written', () => {
    it('says which value was written, each time', async () => {
      const { autosave, timer, results } = setup();
      autosave.schedule('a');
      timer.advance(500);
      await settle();
      autosave.schedule('b');
      await autosave.flush();

      expect(results).toEqual([
        { ok: true, value: 'a' },
        { ok: true, value: 'b' },
      ]);
    });

    it('does not say anything when nothing was written', async () => {
      const { autosave, results } = setup();
      await autosave.flush();
      await autosave.flush();

      expect(results).toEqual([]);
    });

    it('goes on saving when the one who listens fails, because that is theirs to mend', async () => {
      const { autosave, written } = setup({
        onResult: () => {
          throw new Error('the listener is broken');
        },
      });
      autosave.schedule('a');
      expect(await autosave.flush()).toEqual({ ok: true, value: true });
      autosave.schedule('b');
      expect(await autosave.flush()).toEqual({ ok: true, value: true });

      expect(written).toEqual(['a', 'b']);
    });

    it('may have nobody to tell', async () => {
      const autosave = createAutosave<string>({ write: async () => succeed(undefined), timer: manualTimer() });
      autosave.schedule('a');

      expect(await autosave.flush()).toEqual({ ok: true, value: true });
    });
  });

  describe('flushing', () => {
    it('writes what is waiting at once, and not again when the delay is over', async () => {
      const { autosave, timer, written } = setup();
      autosave.schedule('a');

      expect(await autosave.flush()).toEqual({ ok: true, value: true });
      expect(written).toEqual(['a']);
      expect(timer.pending).toBe(0);
      timer.advance(10_000);
      await settle();
      expect(written).toEqual(['a']);
    });

    it('says that nothing was written when nothing was waiting', async () => {
      const { autosave, written } = setup();

      expect(await autosave.flush()).toEqual({ ok: true, value: false });
      expect(written).toEqual([]);
    });

    it('says that nothing was written when what was waiting has been written', async () => {
      const { autosave } = setup();
      autosave.schedule('a');
      await autosave.flush();

      expect(await autosave.flush()).toEqual({ ok: true, value: false });
    });

    it('waits for a write that is under way, and then writes what came after it', async () => {
      const held = heldWrites();
      const { autosave, timer } = setup({ write: held.write });
      autosave.schedule('a');
      timer.advance(500);
      await settle();
      expect(held.started).toEqual(['a']);

      autosave.schedule('b');
      let flushed: Outcome<boolean> | undefined;
      void autosave.flush().then((result) => (flushed = result));
      await settle();
      expect(flushed).toBeUndefined();
      expect(held.started).toEqual(['a']);

      held.release();
      await settle();
      expect(held.started).toEqual(['a', 'b']);
      expect(flushed).toBeUndefined();

      held.release();
      await settle();
      expect(flushed).toEqual({ ok: true, value: true });
      expect(held.overlapped).toBe(false);
    });
  });

  describe('a write that is under way', () => {
    it('is not overlapped by the next one, which waits its turn, and the writes are in order', async () => {
      const held = heldWrites();
      const { autosave, timer } = setup({ write: held.write });
      autosave.schedule('a');
      timer.advance(500);
      await settle();
      autosave.schedule('b');
      timer.advance(500);
      await settle();

      expect(held.started).toEqual(['a']);
      held.release();
      await settle();
      expect(held.started).toEqual(['a', 'b']);
      held.release();
      await settle();

      expect(held.overlapped).toBe(false);
      expect(autosave.pending).toBe(false);
    });

    it('keeps a value that came meanwhile waiting, with its own timer, and writes it', async () => {
      const held = heldWrites();
      const { autosave, timer } = setup({ write: held.write });
      autosave.schedule('a');
      timer.advance(500);
      await settle();
      autosave.schedule('b');
      held.release();
      await settle();

      expect(autosave.pending).toBe(true);
      timer.advance(500);
      await settle();
      expect(held.started).toEqual(['a', 'b']);
      held.release();
      await settle();
      expect(autosave.pending).toBe(false);
    });

    it('goes on after a cancel, and is told what it came to', async () => {
      const held = heldWrites();
      const { autosave, timer, results } = setup({ write: held.write });
      autosave.schedule('a');
      timer.advance(500);
      await settle();
      autosave.cancel();
      held.release();
      await settle();

      expect(results).toEqual([{ ok: true, value: 'a' }]);
      expect(autosave.pending).toBe(false);
    });
  });

  describe('a value that is the one that was last written', () => {
    it('is not written again, and does not start a timer', async () => {
      const timer = manualTimer();
      const written: string[] = [];
      const auto = createAutosave<object>({
        write: async (value) => (written.push(JSON.stringify(value)), succeed(undefined)),
        timer,
      });
      const document = { name: 'a' };
      auto.schedule(document);
      await auto.flush();

      auto.schedule(document);
      expect(auto.pending).toBe(false);
      expect(timer.pending).toBe(0);
      expect(written).toEqual(['{"name":"a"}']);
    });

    it('is written, when it is another object that says the same, because only the very same one is known to be the same', async () => {
      const written: object[] = [];
      const timer = manualTimer();
      const auto = createAutosave<object>({
        write: async (value) => (written.push(value), succeed(undefined)),
        timer,
      });
      auto.schedule({ name: 'a' });
      await auto.flush();
      auto.schedule({ name: 'a' });
      await auto.flush();

      expect(written).toHaveLength(2);
    });

    it('is not written when it came back before anything was written: a change that was undone is no change', async () => {
      const { autosave, timer, written } = setup();
      autosave.schedule('a');
      await autosave.flush();
      autosave.schedule('b');
      autosave.schedule('a');
      timer.advance(500);
      await settle();

      expect(written).toEqual(['a']);
      expect(autosave.pending).toBe(false);
    });

    it('is the same value when it is a number that is NaN, because Object.is says so, and different when it is -0', async () => {
      const written: number[] = [];
      const auto = createAutosave<number>({
        write: async (value) => (written.push(value), succeed(undefined)),
        timer: manualTimer(),
      });
      auto.schedule(NaN);
      await auto.flush();
      auto.schedule(NaN);
      await auto.flush();
      auto.schedule(0);
      await auto.flush();
      auto.schedule(-0);
      await auto.flush();

      expect(written).toEqual([NaN, 0, -0]);
    });
  });

  describe('a write that fails', () => {
    it('is reported to the listener and to whoever flushed, with the error as it was', async () => {
      const { autosave, results } = setup({ write: async () => failure(noRoom) });
      autosave.schedule('a');

      expect(await autosave.flush()).toEqual({ ok: false, error: noRoom });
      expect(results).toEqual([{ ok: false, error: noRoom }]);
    });

    it('keeps the value, and does not write it again by itself', async () => {
      const writes: string[] = [];
      const { autosave, timer } = setup({
        write: async (value) => (writes.push(value), failure(noRoom)),
      });
      autosave.schedule('a');
      timer.advance(500);
      await settle();

      expect(autosave.pending).toBe(true);
      timer.advance(60_000);
      await settle();
      expect(writes).toEqual(['a']);
      expect(timer.pending).toBe(0);
    });

    it('is tried again by a flush, and by the next change, and is done when it is written', async () => {
      let room = false;
      const writes: string[] = [];
      const { autosave, timer, results } = setup({
        write: async (value) => (writes.push(value), room ? succeed(undefined) : failure(noRoom)),
      });
      autosave.schedule('a');
      expect(await autosave.flush()).toMatchObject({ ok: false });
      expect(await autosave.flush()).toMatchObject({ ok: false });

      room = true;
      expect(await autosave.flush()).toEqual({ ok: true, value: true });
      expect(autosave.pending).toBe(false);
      expect(writes).toEqual(['a', 'a', 'a']);

      room = false;
      autosave.schedule('b');
      timer.advance(500);
      await settle();
      expect(autosave.pending).toBe(true);
      room = true;
      autosave.schedule('c');
      timer.advance(500);
      await settle();

      expect(writes).toEqual(['a', 'a', 'a', 'b', 'c']);
      expect(results.map((result) => result.ok)).toEqual([false, false, true, false, true]);
    });

    it('is a failure that is typed when the write throws, with what it says, and one that is not an error as well', async () => {
      const { autosave } = setup({
        write: async () => {
          throw Object.assign(new Error('disk on fire'), { name: 'UnknownError' });
        },
      });
      autosave.schedule('a');
      expect(await autosave.flush()).toMatchObject({
        ok: false,
        error: { kind: 'failed', detail: 'UnknownError: disk on fire' },
      });

      const quota = setup({
        write: () => Promise.reject(new DOMException('full', 'QuotaExceededError')),
      });
      quota.autosave.schedule('a');
      expect(await quota.autosave.flush()).toMatchObject({ ok: false, error: { kind: 'quota-exceeded' } });

      const text = setup({ write: () => Promise.reject('just text') });
      text.autosave.schedule('a');
      expect(await text.autosave.flush()).toMatchObject({ ok: false, error: { kind: 'failed', detail: 'just text' } });
    });

    it('does not stop the next write, after the write threw', async () => {
      let throwing = true;
      const writes: string[] = [];
      const { autosave } = setup({
        write: async (value) => {
          writes.push(value);
          if (throwing) {
            throw new Error('once');
          }
          return succeed(undefined);
        },
      });
      autosave.schedule('a');
      await autosave.flush();
      throwing = false;
      autosave.schedule('b');

      expect(await autosave.flush()).toEqual({ ok: true, value: true });
      expect(writes).toEqual(['a', 'b']);
    });
  });

  describe('cancelling', () => {
    it('forgets what is waiting, and stops the timer', async () => {
      const { autosave, timer, written } = setup();
      autosave.schedule('a');
      autosave.cancel();

      expect(autosave.pending).toBe(false);
      expect(timer.pending).toBe(0);
      timer.advance(10_000);
      await settle();
      expect(written).toEqual([]);
      expect(await autosave.flush()).toEqual({ ok: true, value: false });
    });

    it('may be done when nothing is waiting', () => {
      const { autosave } = setup();

      expect(() => autosave.cancel()).not.toThrow();
    });
  });

  describe('what is pending', () => {
    it('is nothing at first, a value from the moment that it is scheduled, and nothing again once it is written', async () => {
      const { autosave, timer } = setup();
      expect(autosave.pending).toBe(false);

      autosave.schedule('a');
      expect(autosave.pending).toBe(true);
      timer.advance(500);
      await settle();
      expect(autosave.pending).toBe(false);
    });

    it('is still a value while it is being written', async () => {
      const held = heldWrites();
      const { autosave, timer } = setup({ write: held.write });
      autosave.schedule('a');
      timer.advance(500);
      await settle();

      expect(autosave.pending).toBe(true);
      held.release();
      await settle();
      expect(autosave.pending).toBe(false);
    });
  });
});

describe('the timer of the page', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs a callback after the delay, and not if it is cleared', () => {
    vi.useFakeTimers();
    const ran: string[] = [];
    systemTimer.set(() => ran.push('kept'), 100);
    const cleared = systemTimer.set(() => ran.push('cleared'), 100);
    systemTimer.clear(cleared);

    vi.advanceTimersByTime(99);
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(ran).toEqual(['kept']);
  });

  it('is what autosave uses when it is not given another', async () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const auto = createAutosave<string>({ write: async (value) => (written.push(value), succeed(undefined)) });
    auto.schedule('a');

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    expect(written).toEqual(['a']);
  });
});
