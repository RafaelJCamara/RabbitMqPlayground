import { describe, expect, it } from 'vitest';
import {
  type FpsRecord,
  type PowerState,
  recordFileName,
  type RunStats,
  summarise,
  TARGET_FPS,
  TARGET_MESSAGES,
  verdict,
} from './fps';

/** Timestamps that are these intervals apart, the first one at 0. */
function stampsOf(intervals: readonly number[]): number[] {
  const stamps = [0];
  for (const interval of intervals) {
    stamps.push(stamps[stamps.length - 1]! + interval);
  }
  return stamps;
}

/** `count` intervals of `interval` ms, then the given ones. */
const steady = (count: number, interval: number, ...rest: number[]): number[] => [
  ...Array.from({ length: count }, () => interval),
  ...rest,
];

function expectStats(actual: RunStats, expected: RunStats): void {
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const key of Object.keys(expected) as (keyof RunStats)[]) {
    expect(actual[key], key).toBeCloseTo(expected[key], 6);
  }
}

describe('the line of the plan', () => {
  it('is 45 frames a second with 500 messages in flight', () => {
    expect(TARGET_FPS).toBe(45);
    expect(TARGET_MESSAGES).toBe(500);
  });
});

describe('summarise', () => {
  it.each<{ name: string; intervals: number[]; expected: RunStats }>([
    {
      name: 'a steady run at 60 frames a second',
      intervals: steady(120, 1000 / 60),
      expected: {
        frames: 120,
        seconds: 2,
        averageFps: 60,
        medianFps: 60,
        lowFps: 60,
        worstFrameMs: 1000 / 60,
        longFrames: 0,
      },
    },
    {
      name: 'one long frame among fifty: the 1% low is the worst frame, the median does not move',
      intervals: steady(49, 20, 100),
      expected: {
        frames: 50,
        seconds: 1.08,
        averageFps: 50 / 1.08,
        medianFps: 50,
        lowFps: 10,
        worstFrameMs: 100,
        longFrames: 1,
      },
    },
    {
      name: 'one long frame among a hundred: the 99th of 100 is not it (nearest rank)',
      intervals: steady(99, 20, 100),
      expected: {
        frames: 100,
        seconds: 2.08,
        averageFps: 100 / 2.08,
        medianFps: 50,
        lowFps: 50,
        worstFrameMs: 100,
        longFrames: 1,
      },
    },
    {
      name: 'two long frames among a hundred: the 99th of 100 is one of them',
      intervals: steady(98, 20, 100, 100),
      expected: {
        frames: 100,
        seconds: 2.16,
        averageFps: 100 / 2.16,
        medianFps: 50,
        lowFps: 10,
        worstFrameMs: 100,
        longFrames: 2,
      },
    },
    {
      name: 'an even number of intervals: the median is the mean of the two in the middle',
      intervals: [40, 10, 30, 20],
      expected: { frames: 4, seconds: 0.1, averageFps: 40, medianFps: 40, lowFps: 25, worstFrameMs: 40, longFrames: 0 },
    },
    {
      name: 'an odd number of intervals: the median is the one in the middle, and twice it is not yet long',
      intervals: [10, 40, 20],
      expected: {
        frames: 3,
        seconds: 0.07,
        averageFps: 3 / 0.07,
        medianFps: 50,
        lowFps: 25,
        worstFrameMs: 40,
        longFrames: 0,
      },
    },
    {
      name: 'an interval a little above twice the median is a long frame',
      intervals: [10, 20, 41],
      expected: {
        frames: 3,
        seconds: 0.071,
        averageFps: 3 / 0.071,
        medianFps: 50,
        lowFps: 1000 / 41,
        worstFrameMs: 41,
        longFrames: 1,
      },
    },
    {
      name: 'the shortest run that can be summarised: three stamps',
      intervals: [10, 20],
      expected: {
        frames: 2,
        seconds: 0.03,
        averageFps: 2 / 0.03,
        medianFps: 1000 / 15,
        lowFps: 50,
        worstFrameMs: 20,
        longFrames: 0,
      },
    },
    {
      name: 'a repeated timestamp, so long as the median interval is not zero',
      intervals: [0, 10, 10],
      expected: {
        frames: 3,
        seconds: 0.02,
        averageFps: 150,
        medianFps: 100,
        lowFps: 100,
        worstFrameMs: 10,
        longFrames: 0,
      },
    },
  ])('$name', ({ intervals, expected }) => {
    expectStats(summarise(stampsOf(intervals)), expected);
  });

  it('measures from the intervals, not from where the clock started', () => {
    const origin = 123_456.5;

    expectStats(
      summarise(stampsOf(steady(10, 20)).map((stamp) => stamp + origin)),
      summarise(stampsOf(steady(10, 20))),
    );
  });

  it('does not change the list it is given (a frozen list is one that cannot be sorted in place)', () => {
    const stamps = Object.freeze([0, 30, 40, 100]);

    expect(summarise(stamps).worstFrameMs).toBe(60);
    expect(stamps).toEqual([0, 30, 40, 100]);
  });

  it.each([0, 1, 2])('throws a RangeError that says "at least 3" for %i stamps', (count) => {
    const stamps = Array.from({ length: count }, (_, index) => index * 10);

    expect(() => summarise(stamps)).toThrow(RangeError);
    expect(() => summarise(stamps)).toThrow(/at least 3 frame timestamps.*it has \d/);
  });

  it.each([
    { name: 'a stamp that goes back', stamps: [0, 20, 10, 30] },
    { name: 'a stamp that is not a number', stamps: [0, Number.NaN, 20] },
    { name: 'a stamp that is infinite', stamps: [0, 10, Number.POSITIVE_INFINITY] },
  ])('throws a RangeError for $name', ({ stamps }) => {
    expect(() => summarise(stamps)).toThrow(RangeError);
    expect(() => summarise(stamps)).toThrow(/finite and ascending/);
  });

  it.each([
    { name: 'one stamp repeated', stamps: [5, 5, 5] },
    { name: 'most of the stamps repeated', stamps: [0, 0, 0, 10] },
  ])('throws a RangeError for $name, which has no median interval to divide by', ({ stamps }) => {
    expect(() => summarise(stamps)).toThrow(RangeError);
    expect(() => summarise(stamps)).toThrow(/median interval/);
  });
});

describe('verdict', () => {
  const statsAt = (medianFps: number): RunStats => ({
    frames: 100,
    seconds: 2,
    averageFps: medianFps,
    medianFps,
    lowFps: medianFps,
    worstFrameMs: 20,
    longFrames: 0,
  });

  it.each([
    { name: 'exactly on both lines', median: 45, messages: 500, meets: true },
    { name: 'one message short', median: 45, messages: 499, meets: false },
    { name: 'a hair under 45 frames a second', median: 44.999, messages: 500, meets: false },
    { name: 'a hair over both', median: 45.001, messages: 501, meets: true },
    { name: 'well above both', median: 60, messages: 1200, meets: true },
    { name: 'fast, but with few messages (a canvas that is not the one)', median: 144, messages: 20, meets: false },
    { name: 'many messages, but slow', median: 12, messages: 800, meets: false },
    { name: 'under both', median: 30, messages: 100, meets: false },
  ])('is $meets for $name', ({ median, messages, meets }) => {
    expect(verdict(statsAt(median), messages)).toBe(meets);
  });
});

describe('recordFileName', () => {
  const machine = (cpu: string): FpsRecord['machine'] => ({
    cpu,
    cores: 24,
    memoryGb: 32,
    platform: 'win32',
    release: '10.0.26300',
    arch: 'x64',
    gpu: 'NVIDIA GeForce RTX 4070 Laptop GPU',
    browser: 'Chromium 141.0',
    displayHz: 144,
    devicePixelRatio: 1.25,
    screen: '2560x1600',
  });
  const power = (charging: boolean | null): PowerState => ({ charging, level: null, plan: null });
  const nameOf = (cpu: string, charging: boolean | null, date = '2026-10-09T14:03:22.123Z'): string =>
    recordFileName({ date, machine: machine(cpu), power: power(charging) });

  it.each([
    { power: 'on the charger', charging: true, name: '2026-10-09-intel-r-core-tm-i9-14900hx-ac.json' },
    { power: 'on the battery', charging: false, name: '2026-10-09-intel-r-core-tm-i9-14900hx-battery.json' },
    { power: 'that is not known', charging: null, name: '2026-10-09-intel-r-core-tm-i9-14900hx-power-unknown.json' },
  ])('names a record of a machine $power', ({ charging, name }) => {
    expect(nameOf('Intel(R) Core(TM) i9-14900HX', charging)).toBe(name);
  });

  it.each([
    { cpu: 'AMD Ryzen 7 7840U w/ Radeon 780M Graphics', slug: 'amd-ryzen-7-7840u-w-radeon-780m-graphics' },
    { cpu: '  Apple M2 Pro  ', slug: 'apple-m2-pro' },
    { cpu: 'Intel(R) Core(TM) Ultra 7 155H', slug: 'intel-r-core-tm-ultra-7-155h' },
    { cpu: '13th Gen Intel(R) Core(TM) i7-1355U', slug: '13th-gen-intel-r-core-tm-i7-1355u' },
    {
      cpu: 'Qualcomm(R) Snapdragon(R) X Elite - X1E80100 @ 3.40 GHz',
      slug: 'qualcomm-r-snapdragon-r-x-elite-x1e80100-3-40-ghz',
    },
    { cpu: 'Ünïcode   CPU\t(prototype)', slug: 'n-code-cpu-prototype' },
    { cpu: '--Odd__name--', slug: 'odd-name' },
    { cpu: '???', slug: 'unknown-cpu' },
    { cpu: '', slug: 'unknown-cpu' },
  ])('makes "$cpu" the slug "$slug"', ({ cpu, slug }) => {
    const name = nameOf(cpu, true);

    expect(name).toBe(`2026-10-09-${slug}-ac.json`);
    expect(name).toMatch(/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(-[a-z0-9]+)*\.json$/);
  });

  it.each([
    { date: '2026-10-09T23:59:59.999Z', day: '2026-10-09' },
    { date: '2027-01-02T00:00:00.000Z', day: '2027-01-02' },
    { date: '2026-10-09T23:30:00-03:00', day: '2026-10-09' },
  ])('takes the day of the record from $date', ({ date, day }) => {
    expect(nameOf('Apple M2 Pro', false, date)).toBe(`${day}-apple-m2-pro-battery.json`);
  });
});
