import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { backupReminder, REMIND_AFTER_MS, SNOOZE_MS, type ReminderFacts } from './reminder';
import type { CanvasSummary } from './summary';
import { EMPTY_THUMBNAIL } from './thumbnail';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date(2026, 9, 8, 12).getTime();

const canvas = (change: Partial<CanvasSummary> = {}): CanvasSummary => ({
  id: 'a',
  name: 'Canvas',
  createdAt: NOW - 100 * DAY,
  updatedAt: NOW - 50 * DAY,
  elements: 3,
  edges: 2,
  thumbnail: EMPTY_THUMBNAIL,
  ...change,
});

const facts = (change: Partial<ReminderFacts> = {}): ReminderFacts => ({
  now: NOW,
  canvases: [canvas()],
  lastBackupAt: undefined,
  snoozedUntil: undefined,
  ...change,
});

describe('backupReminder (ADR-0075)', () => {
  it('is two weeks and a week', () => {
    expect(REMIND_AFTER_MS).toBe(14 * DAY);
    expect(SNOOZE_MS).toBe(7 * DAY);
  });

  describe('when there has never been a backup', () => {
    it('is due when a canvas has an element on it and the oldest canvas is two weeks old, and says so in words', () => {
      const reminder = backupReminder(facts());

      expect(reminder).toEqual({
        due: true,
        text: 'You have never backed up your canvases. This browser keeps them on this device only, and they can be lost if the browser is cleared or the device is replaced.',
      });
    });

    it('counts from the oldest canvas, to the millisecond: not due a millisecond before the two weeks, due at them', () => {
      const created = NOW - REMIND_AFTER_MS + 1;
      expect(backupReminder(facts({ canvases: [canvas({ createdAt: created })] })).due).toBe(false);
      expect(backupReminder(facts({ canvases: [canvas({ createdAt: created - 1 })] })).due).toBe(true);
    });

    it('counts from the oldest of several canvases that have something on them, and not the newest', () => {
      const canvases = [canvas({ id: 'old' }), canvas({ id: 'new', createdAt: NOW - DAY })];

      expect(backupReminder(facts({ canvases })).due).toBe(true);
    });

    it('does not count from a canvas with nothing on it, because it has nothing to lose', () => {
      const canvases = [
        canvas({ id: 'empty', createdAt: NOW - 100 * DAY, elements: 0 }),
        canvas({ id: 'started', createdAt: NOW - DAY, elements: 2 }),
      ];

      expect(backupReminder(facts({ canvases })).due).toBe(false);
      expect(backupReminder(facts({ now: NOW + REMIND_AFTER_MS, canvases })).due).toBe(true);
    });

    it('is not due when every canvas is empty, because there is nothing to lose', () => {
      expect(backupReminder(facts({ canvases: [canvas({ elements: 0 }), canvas({ id: 'b', elements: 0 })] })).due).toBe(
        false,
      );
    });

    it('is due when only one of the canvases has something on it', () => {
      expect(backupReminder(facts({ canvases: [canvas({ elements: 0 }), canvas({ id: 'b', elements: 1 })] })).due).toBe(
        true,
      );
    });
  });

  describe('when there has been a backup', () => {
    it('is due two weeks after it when a canvas was edited since, and names the day', () => {
      const last = new Date(2026, 8, 1, 9).getTime();
      const reminder = backupReminder(
        facts({ now: last + REMIND_AFTER_MS, lastBackupAt: last, canvases: [canvas({ updatedAt: last + 1 })] }),
      );

      expect(reminder).toEqual({
        due: true,
        text: 'You have not backed up your canvases since 1 Sep 2026. This browser keeps them on this device only, and they can be lost if the browser is cleared or the device is replaced.',
      });
    });

    it('is not due a millisecond before the two weeks', () => {
      const last = NOW - REMIND_AFTER_MS + 1;

      expect(backupReminder(facts({ lastBackupAt: last, canvases: [canvas({ updatedAt: NOW })] })).due).toBe(false);
    });

    it('is not due when nothing was edited since the backup, however long ago it was', () => {
      const last = NOW - 90 * DAY;

      expect(backupReminder(facts({ lastBackupAt: last, canvases: [canvas({ updatedAt: last })] })).due).toBe(false);
      expect(backupReminder(facts({ lastBackupAt: last, canvases: [canvas({ updatedAt: last - 1 })] })).due).toBe(
        false,
      );
      expect(backupReminder(facts({ lastBackupAt: last, canvases: [canvas({ updatedAt: last + 1 })] })).due).toBe(true);
    });

    it('is due when only one of the canvases was edited since the backup', () => {
      const last = NOW - 90 * DAY;
      const canvases = [
        canvas({ id: 'before', updatedAt: last - DAY }),
        canvas({ id: 'after', updatedAt: last + DAY }),
      ];

      expect(backupReminder(facts({ lastBackupAt: last, canvases })).due).toBe(true);
    });

    it('does not count how much is on a canvas, because a canvas that was emptied has changed too', () => {
      const last = NOW - 90 * DAY;

      expect(
        backupReminder(facts({ lastBackupAt: last, canvases: [canvas({ elements: 0, updatedAt: last + 1 })] })).due,
      ).toBe(true);
    });
  });

  describe('when the learner said later', () => {
    it('is quiet until the time they were given, and not quiet at it', () => {
      expect(backupReminder(facts({ snoozedUntil: NOW + 1 })).due).toBe(false);
      expect(backupReminder(facts({ snoozedUntil: NOW })).due).toBe(true);
      expect(backupReminder(facts({ snoozedUntil: NOW - 1 })).due).toBe(true);
    });
  });

  it('is not due when there are no canvases', () => {
    expect(backupReminder(facts({ canvases: [] })).due).toBe(false);
  });

  it('is due or not by the rules, and in words when it is, for any facts', () => {
    const arbCanvas = fc.record({
      createdAt: fc.integer({ min: 0, max: 400 * DAY }),
      updatedAt: fc.integer({ min: 0, max: 400 * DAY }),
      elements: fc.integer({ min: 0, max: 3 }),
    });
    fc.assert(
      fc.property(
        fc.array(arbCanvas, { maxLength: 4 }),
        fc.option(fc.integer({ min: 0, max: 400 * DAY }), { nil: undefined }),
        fc.option(fc.integer({ min: 0, max: 450 * DAY }), { nil: undefined }),
        fc.integer({ min: 0, max: 450 * DAY }),
        (parts, lastBackupAt, snoozedUntil, now) => {
          const canvases = parts.map((part, index) => canvas({ id: `c${index}`, ...part }));
          const reminder = backupReminder({ now, canvases, lastBackupAt, snoozedUntil });

          if (reminder.due) {
            expect(canvases.length).toBeGreaterThan(0);
            expect(snoozedUntil === undefined || snoozedUntil <= now).toBe(true);
            expect(reminder.text).toMatch(/^You have (never backed up|not backed up) your canvases/);
          }
          if (canvases.length === 0) {
            expect(reminder.due).toBe(false);
          }
        },
      ),
    );
  });
});
