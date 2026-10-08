/**
 * "Edited 3 hours ago" (ADR-0073): when a canvas was last edited, in words that are the same on every machine. It is a function of two times, so
 * that a spec does not wait. Under a minute is "just now", then minutes, then hours up to a day; after that it counts the learner's own calendar
 * days, so that something done late yesterday is "yesterday" and not "20 hours ago" in the morning; from a week it is the date.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** The learner's calendar day that `time` is in, counted in days: two of them are as many days apart as there are midnights between, whatever the clocks did in between. */
function calendarDay(time: number): number {
  const day = new Date(time);
  return Date.UTC(day.getFullYear(), day.getMonth(), day.getDate()) / DAY;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'} ago`;

/** A date as a person writes it, in English: `8 Oct 2026`. */
export function dateWords(time: number): string {
  const day = new Date(time);
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

/** How long ago `then` was, as seen from `now`. A time in the future, which a clock that was set back makes, is "just now". */
export function ago(now: number, then: number): string {
  const elapsed = now - then;
  if (elapsed < MINUTE) {
    return 'just now';
  }
  if (elapsed < HOUR) {
    return plural(Math.floor(elapsed / MINUTE), 'minute');
  }
  if (elapsed < DAY) {
    return plural(Math.floor(elapsed / HOUR), 'hour');
  }
  // At least a whole day has gone, so it is "yesterday" at the least, even if the clocks went back and both times are on one date.
  const days = Math.max(1, calendarDay(now) - calendarDay(then));
  if (days === 1) {
    return 'yesterday';
  }
  return days < 7 ? plural(days, 'day') : `on ${dateWords(then)}`;
}
