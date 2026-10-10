import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { failure, succeed, type Outcome } from '@rmq/persistence';
import { manualTimer, type ManualTimer } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../announcer';
import { MAX_TOASTS, TOAST_TIMER, TOAST_TTL_MS, Toasts, UNDO_KEEP_MS, type ToastUndo } from './toasts';

function setup(ttl = 5_000) {
  const timer: ManualTimer = manualTimer();
  TestBed.configureTestingModule({
    providers: [
      { provide: TOAST_TIMER, useValue: timer },
      { provide: TOAST_TTL_MS, useValue: ttl },
    ],
  });
  const announce = vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
  return { toasts: TestBed.inject(Toasts), timer, announce };
}

const undoing = (
  result: Outcome<void, string> = succeed(undefined),
  keys: string | null = 'Ctrl+Z',
): ToastUndo & { run: ReturnType<typeof vi.fn> } => ({
  label: 'Undo',
  ...(keys === null ? {} : { keys }),
  run: vi.fn(async () => result),
});

describe('Toasts (ADR-0074)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('showing a notice', () => {
    it('shows it, with its message and its action, and gives an id', () => {
      const { toasts } = setup();
      const undo = undoing();

      const id = toasts.show({ message: 'Deleted “Orders”.', undo });

      expect(toasts.visible()).toEqual([{ id, message: 'Deleted “Orders”.', undo, problem: null }]);
    });

    it('gives each notice an id of its own', () => {
      const { toasts } = setup();

      expect(
        new Set([toasts.show({ message: 'a' }), toasts.show({ message: 'b' }), toasts.show({ message: 'c' })]).size,
      ).toBe(3);
    });

    it('says the message once, politely, and, when the action has keys, how to do it with them', () => {
      const { toasts, announce } = setup();

      toasts.show({ message: 'Cleared the canvas.' });
      toasts.show({ message: 'Deleted “Orders”.', undo: undoing() });
      toasts.show({ message: 'Copied.', undo: undoing(succeed(undefined), null) });

      expect(announce.mock.calls).toEqual([
        ['Cleared the canvas.'],
        ['Deleted “Orders”. Press Ctrl+Z to undo.'],
        ['Copied.'],
      ]);
    });

    it('keeps the newest three and lets the oldest go, and stops its time', () => {
      const { toasts, timer } = setup();
      const ids = ['a', 'b', 'c', 'd'].map((message) => toasts.show({ message }));

      expect(MAX_TOASTS).toBe(3);
      expect(toasts.visible().map(({ id }) => id)).toEqual(ids.slice(1));
      expect(timer.pending).toBe(3);
      timer.advance(5_000);
      expect(toasts.visible()).toEqual([]);
    });
  });

  describe('how long a notice waits', () => {
    it('waits 5 seconds, to the millisecond, and then goes (ADR-0099)', () => {
      const { toasts, timer } = setup();
      toasts.show({ message: 'a' });

      timer.advance(4_999);
      expect(toasts.visible()).toHaveLength(1);
      timer.advance(1);
      expect(toasts.visible()).toEqual([]);
    });

    it('is 5 seconds for every notice unless a token says otherwise, and the kept action 50', () => {
      TestBed.configureTestingModule({});

      expect(TestBed.inject(TOAST_TTL_MS)).toBe(5_000);
      expect(UNDO_KEEP_MS).toBe(50_000);
    });

    it('waits as long as the token says', () => {
      const { toasts, timer } = setup(1_000);
      toasts.show({ message: 'a' });

      timer.advance(999);
      expect(toasts.visible()).toHaveLength(1);
      timer.advance(1);
      expect(toasts.visible()).toEqual([]);
    });

    it('has a time of its own for each notice', () => {
      const { toasts, timer } = setup();
      toasts.show({ message: 'first' });
      timer.advance(2_000);
      toasts.show({ message: 'second' });

      timer.advance(3_000);

      expect(toasts.visible().map(({ message }) => message)).toEqual(['second']);
    });

    it('stops while the pointer or the focus is on it, and waits the whole time again when they leave', () => {
      const { toasts, timer } = setup();
      const id = toasts.show({ message: 'a' });
      timer.advance(4_000);

      toasts.pause(id);
      timer.advance(60_000);
      expect(toasts.visible()).toHaveLength(1);

      toasts.resume(id);
      timer.advance(4_999);
      expect(toasts.visible()).toHaveLength(1);
      timer.advance(1);
      expect(toasts.visible()).toEqual([]);
    });

    it('does not start a time for a notice that is gone', () => {
      const { toasts, timer } = setup();
      const id = toasts.show({ message: 'a' });
      toasts.dismiss(id);

      toasts.resume(id);
      expect(timer.pending).toBe(0);
      const other = toasts.show({ message: 'b' });
      timer.advance(5_000);

      expect(toasts.visible().map(({ id: seen }) => seen)).not.toContain(other);
      expect(toasts.visible()).toEqual([]);
    });

    it('waits again for the notice that was let go, whatever else is on the screen', () => {
      const { toasts, timer } = setup();
      const first = toasts.show({ message: 'first' });
      toasts.show({ message: 'second' });

      toasts.pause(first);
      timer.advance(60_000);
      expect(toasts.visible().map(({ message }) => message)).toEqual(['first']);
      toasts.resume(first);
      timer.advance(5_000);

      expect(toasts.visible()).toEqual([]);
    });

    it('does not mind being paused or resumed twice', () => {
      const { toasts, timer } = setup();
      const id = toasts.show({ message: 'a' });

      toasts.pause(id);
      toasts.pause(id);
      toasts.resume(id);
      toasts.resume(id);
      timer.advance(5_000);

      expect(toasts.visible()).toEqual([]);
    });
  });

  describe('dismissing', () => {
    it('takes a notice away at once, and only that one', () => {
      const { toasts } = setup();
      const first = toasts.show({ message: 'a' });
      const second = toasts.show({ message: 'b' });

      toasts.dismiss(first);

      expect(toasts.visible().map(({ id }) => id)).toEqual([second]);
    });

    it('is not a problem for a notice that is not there', () => {
      const { toasts } = setup();

      expect(() => toasts.dismiss(99)).not.toThrow();
    });
  });

  describe('the action of a notice', () => {
    it('runs it, and takes the notice away when it worked', async () => {
      const { toasts } = setup();
      const undo = undoing();
      const id = toasts.show({ message: 'a', undo });

      await toasts.undo(id);

      expect(undo.run).toHaveBeenCalledOnce();
      expect(toasts.visible()).toEqual([]);
    });

    it('keeps the notice, says why it did not work on the notice and aloud, and can be tried again', async () => {
      const { toasts, announce } = setup();
      const undo = undoing(failure('“Orders” is gone for good.'));
      const id = toasts.show({ message: 'a', undo });
      announce.mockClear();

      await toasts.undo(id);

      expect(toasts.visible()).toHaveLength(1);
      expect(toasts.visible()[0]?.problem).toBe('“Orders” is gone for good.');
      expect(announce).toHaveBeenCalledExactlyOnceWith('“Orders” is gone for good.', 'assertive');
      undo.run.mockResolvedValue(succeed(undefined));
      await toasts.undo(id);
      expect(toasts.visible()).toEqual([]);
    });

    it('says why on the notice whose action did not work, and on no other', async () => {
      const { toasts } = setup();
      const other = toasts.show({ message: 'other', undo: undoing() });
      const id = toasts.show({ message: 'a', undo: undoing(failure('It did not work.')) });

      await toasts.undo(id);

      expect(toasts.visible().map(({ id: seen, problem }) => [seen, problem])).toEqual([
        [other, null],
        [id, 'It did not work.'],
      ]);
    });

    it('does nothing for a notice that has no action, or is not there', async () => {
      const { toasts, announce } = setup();
      const id = toasts.show({ message: 'a' });
      announce.mockClear();

      await toasts.undo(id);
      await toasts.undo(99);

      expect(toasts.visible()).toHaveLength(1);
      expect(announce).not.toHaveBeenCalled();
    });
  });

  describe('a notice whose action cannot be true any more', () => {
    it('goes when its condition turns false, and is there while it holds', () => {
      const { toasts } = setup();
      const holds = signal(true);
      toasts.show({ message: 'a', undo: undoing(), stillTrue: holds });

      expect(toasts.visible()).toHaveLength(1);
      holds.set(false);
      expect(toasts.visible()).toEqual([]);
      holds.set(true);
      expect(toasts.visible()).toHaveLength(1);
    });
  });

  describe('an action that outlives its notice (ADR-0099)', () => {
    it('is still the newest action after the notice went by its time, until 50 seconds after it was shown, to the millisecond', () => {
      const { toasts, timer } = setup();
      const id = toasts.show({ message: 'a', undo: undoing() });

      timer.advance(5_000);
      expect(toasts.visible()).toEqual([]);
      expect(toasts.latestUndo()?.id).toBe(id);
      timer.advance(44_999);
      expect(toasts.latestUndo()?.id).toBe(id);
      timer.advance(1);
      expect(toasts.latestUndo()).toBeUndefined();
    });

    it('is 50 seconds from when the notice was shown, whatever the pointer did to its time on the screen', () => {
      const { toasts, timer } = setup();
      const id = toasts.show({ message: 'a', undo: undoing() });
      toasts.pause(id);
      timer.advance(49_999);
      expect(toasts.visible()).toHaveLength(1);
      toasts.resume(id);

      timer.advance(1);
      expect(toasts.latestUndo()?.id).toBe(id);
      expect(toasts.visible()).toHaveLength(1);
      timer.advance(5_000);
      expect(toasts.visible()).toEqual([]);
      expect(toasts.latestUndo()).toBeUndefined();
    });

    it('keeps nothing for a notice that was closed with Dismiss', () => {
      const { toasts, timer } = setup();
      const id = toasts.show({ message: 'a', undo: undoing() });

      toasts.dismiss(id);
      timer.advance(5_000);

      expect(toasts.latestUndo()).toBeUndefined();
    });

    it('keeps nothing for a notice whose condition turned false', () => {
      const { toasts, timer } = setup();
      const holds = signal(true);
      toasts.show({ message: 'a', undo: undoing(), stillTrue: holds });

      holds.set(false);
      timer.advance(5_000);

      expect(toasts.latestUndo()).toBeUndefined();
    });

    it('stops asking a kept action whose condition turns false after the notice went', () => {
      const { toasts, timer } = setup();
      const holds = signal(true);
      toasts.show({ message: 'a', undo: undoing(), stillTrue: holds });
      timer.advance(5_000);
      expect(toasts.latestUndo()).toBeDefined();

      holds.set(false);

      expect(toasts.latestUndo()).toBeUndefined();
    });

    it('keeps the action of an old notice that a fourth one pushed off the screen', () => {
      const { toasts } = setup();
      const old = toasts.show({ message: 'old', undo: undoing() });
      ['b', 'c', 'd'].forEach((message) => toasts.show({ message }));

      expect(toasts.visible().map(({ id }) => id)).not.toContain(old);
      expect(toasts.latestUndo()?.id).toBe(old);
    });

    it('prefers a notice on the screen to a kept one, and the newest of each', () => {
      const { toasts, timer } = setup();
      toasts.show({ message: 'kept one', undo: undoing() });
      const kept = toasts.show({ message: 'kept two', undo: undoing() });
      timer.advance(5_000);
      expect(toasts.latestUndo()?.id).toBe(kept);
      const onScreen = toasts.show({ message: 'on screen', undo: undoing() });

      expect(toasts.latestUndo()?.id).toBe(onScreen);
    });

    it('runs a kept action, forgets it when it worked, and says what happened aloud, since no notice is there to show it', async () => {
      const { toasts, timer, announce } = setup();
      const undo = undoing();
      const id = toasts.show({ message: 'Deleted “Orders”.', undo });
      timer.advance(5_000);
      announce.mockClear();

      await toasts.undo(id);

      expect(undo.run).toHaveBeenCalledOnce();
      expect(announce).toHaveBeenCalledExactlyOnceWith('Undone: Deleted “Orders”.');
      expect(toasts.latestUndo()).toBeUndefined();
    });

    it('says aloud, assertively, why a kept action did not work, and keeps it to be tried again', async () => {
      const { toasts, timer, announce } = setup();
      const undo = undoing(failure('“Orders” is gone for good.'));
      const id = toasts.show({ message: 'a', undo });
      timer.advance(5_000);
      announce.mockClear();

      await toasts.undo(id);

      expect(announce).toHaveBeenCalledExactlyOnceWith('“Orders” is gone for good.', 'assertive');
      expect(toasts.latestUndo()?.id).toBe(id);
      undo.run.mockResolvedValue(succeed(undefined));
      await toasts.undo(id);
      expect(toasts.latestUndo()).toBeUndefined();
    });

    it('keeps no action for a notice that has none', () => {
      const { toasts, timer } = setup();
      toasts.show({ message: 'a' });

      timer.advance(5_000);

      expect(toasts.latestUndo()).toBeUndefined();
    });
  });

  describe('the newest action', () => {
    it('is the newest notice that has one, and is still true', () => {
      const { toasts } = setup();
      const old = toasts.show({ message: 'old', undo: undoing() });
      const holds = signal(true);
      toasts.show({ message: 'newer', undo: undoing(), stillTrue: holds });
      toasts.show({ message: 'newest, with nothing to undo' });

      expect(toasts.latestUndo()?.message).toBe('newer');
      holds.set(false);
      expect(toasts.latestUndo()?.id).toBe(old);
    });

    it('is nothing when no notice has one', () => {
      const { toasts } = setup();
      toasts.show({ message: 'a' });

      expect(toasts.latestUndo()).toBeUndefined();
    });
  });
});
