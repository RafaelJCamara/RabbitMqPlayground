import { configureFastCheck } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ago, dateWords } from './ago';

configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Thursday 8 October 2026, half past three in the afternoon, by the clock of whoever runs the spec. */
const NOW = new Date(2026, 9, 8, 15, 30).getTime();
const at = (day: number, hour = 15, minute = 30): number => new Date(2026, 9, day, hour, minute).getTime();

describe('ago (ADR-0073)', () => {
  it.each([
    ['now', 0, 'just now'],
    ['59 seconds', 59 * SECOND, 'just now'],
    ['59.999 seconds', 59_999, 'just now'],
    ['a minute', MINUTE, '1 minute ago'],
    ['119 seconds', 119 * SECOND, '1 minute ago'],
    ['2 minutes', 2 * MINUTE, '2 minutes ago'],
    ['59 minutes', 59 * MINUTE, '59 minutes ago'],
    ['an hour', HOUR, '1 hour ago'],
    ['90 minutes', 90 * MINUTE, '1 hour ago'],
    ['2 hours', 2 * HOUR, '2 hours ago'],
    ['23 hours and 59 minutes', 23 * HOUR + 59 * MINUTE, '23 hours ago'],
  ])('says "%s" ago as "%s"', (_label, elapsed, expected) => {
    expect(ago(NOW, NOW - elapsed)).toBe(expected);
  });

  it('says "just now" for a time that has not come, which a clock that was set back makes', () => {
    expect(ago(NOW, NOW + 5 * MINUTE)).toBe('just now');
    expect(ago(NOW, NOW + 1)).toBe('just now');
  });

  it('says "yesterday" for the learner’s day before, from a whole day on', () => {
    expect(ago(NOW, at(7))).toBe('yesterday');
    expect(ago(NOW, at(7, 0, 0))).toBe('yesterday');
    expect(ago(NOW, at(7, 15, 29))).toBe('yesterday');
    expect(ago(at(8, 8, 0), at(7, 7, 0))).toBe('yesterday');
  });

  it('counts the learner’s days and not the hours, so that a late evening is not "a day" in the morning', () => {
    expect(ago(at(8, 8, 0), at(6, 23, 0))).toBe('2 days ago');
    expect(ago(at(8, 0, 10), at(7, 23, 50))).toBe('20 minutes ago');
  });

  it('says how many days from 2 to 6', () => {
    expect(ago(NOW, at(6))).toBe('2 days ago');
    expect(ago(NOW, at(3))).toBe('5 days ago');
    expect(ago(NOW, at(2))).toBe('6 days ago');
  });

  it('counts the learner’s calendar days from noon to noon, whatever the clocks did in between, for any day of the year', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 364 }), fc.integer({ min: 2, max: 6 }), (start, gap) => {
        const then = new Date(2026, 0, 1 + start, 12).getTime();
        const now = new Date(2026, 0, 1 + start + gap, 12).getTime();

        expect(ago(now, then)).toBe(`${gap} days ago`);
      }),
    );
  });

  it('says the date from a week', () => {
    expect(ago(NOW, at(1))).toBe('on 1 Oct 2026');
    expect(ago(NOW, new Date(2025, 11, 25, 10).getTime())).toBe('on 25 Dec 2025');
  });

  it('is in words for any two times, and says "just now" for any that are less than a minute apart', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 2 ** 41 }),
        fc.integer({ min: -(2 ** 40), max: 2 ** 40 }),
        (now, difference) => {
          const text = ago(now, now - difference);

          expect(text).toMatch(/^(just now|\d+ (minute|hour|day)s? ago|yesterday|on \d{1,2} [A-Z][a-z]{2} \d{4,})$/);
          if (difference < MINUTE) {
            expect(text).toBe('just now');
          }
        },
      ),
    );
  });
});

describe('dateWords', () => {
  it('writes the day, the month in three letters and the year', () => {
    expect(dateWords(new Date(2026, 0, 1).getTime())).toBe('1 Jan 2026');
    expect(dateWords(new Date(2026, 1, 28).getTime())).toBe('28 Feb 2026');
    expect(dateWords(new Date(2026, 5, 15).getTime())).toBe('15 Jun 2026');
    expect(dateWords(new Date(2026, 11, 31).getTime())).toBe('31 Dec 2026');
  });

  it('has the three letters of every month, in the order of the year', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    expect(months.map((_name, month) => dateWords(new Date(2026, month, 9).getTime()))).toEqual(
      months.map((name) => `9 ${name} 2026`),
    );
  });
});
