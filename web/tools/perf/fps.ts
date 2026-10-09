/**
 * The pure half of the frame-rate tool (issue #14, ADR-0086): the statistics of one measured run, the verdict against
 * the line of the plan and the name of a record. It imports nothing, because two projects compile it: the e2e project,
 * which measures in the browser and writes the record, and the tools project, which renders the table of the records.
 */

/** The line of the plan (section 7, ADR-0086): a median of this many frames a second or more... */
export const TARGET_FPS = 45;
/** ...with this many messages in flight or more at every moment of the run. */
export const TARGET_MESSAGES = 500;

/** What one measured run came to. Times are in milliseconds. */
export interface RunStats {
  readonly frames: number;
  readonly seconds: number;
  readonly averageFps: number;
  /** 1000 / the median interval between two frames. */
  readonly medianFps: number;
  /** 1000 / the 99th percentile of the intervals (the 1% low). */
  readonly lowFps: number;
  readonly worstFrameMs: number;
  /** How many intervals are longer than twice the median interval. */
  readonly longFrames: number;
}

/** The statistics of a run from the timestamps of its frames (ascending, in ms; at least 3, else a `RangeError`). */
export function summarise(stamps: readonly number[]): RunStats {
  if (stamps.length < 3) {
    throw new RangeError(`A run needs at least 3 frame timestamps, which make 2 intervals; it has ${stamps.length}.`);
  }
  const intervals = stamps.slice(1).map((stamp, index) => stamp - stamps[index]!);
  if (!intervals.every((interval) => Number.isFinite(interval) && interval >= 0)) {
    throw new RangeError('The frame timestamps of a run must be finite and ascending.');
  }
  // The input is the caller's: sort a copy.
  const sorted = [...intervals].sort((a, b) => a - b);
  const median = middle(sorted);
  if (median <= 0) {
    throw new RangeError('The median interval of a run is zero: its frames do not advance in time.');
  }
  const seconds = (stamps[stamps.length - 1]! - stamps[0]!) / 1000;
  // The first stamp only starts the clock: each interval after it is one frame that was drawn, so n stamps are n - 1 frames.
  const frames = intervals.length;
  return {
    frames,
    seconds,
    averageFps: frames / seconds,
    medianFps: 1000 / median,
    // Nearest rank: the smallest interval that 99% of the intervals are not longer than. The rank is computed in
    // integers, because 0.99 * 100 is a number that rounds the wrong way for some lengths.
    lowFps: 1000 / sorted[Math.ceil((99 * sorted.length) / 100) - 1]!,
    worstFrameMs: sorted[sorted.length - 1]!,
    longFrames: sorted.filter((interval) => interval > 2 * median).length,
  };
}

/** The middle of an ascending list: the mean of the two middle values when there is an even number of them. */
function middle(sorted: readonly number[]): number {
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[half - 1]! + sorted[half]!) / 2 : sorted[half]!;
}

export interface PowerState {
  /** On the charger: `null` when the machine or the browser cannot say. */
  readonly charging: boolean | null;
  readonly level: number | null;
  /** The power plan or mode of the operating system, as it names it. */
  readonly plan: string | null;
}

export interface Rate {
  /** The slowdown of the processor of the run: 1 is none. */
  readonly cpuThrottle: number;
  readonly stats: RunStats;
  /** The messages in flight during the run. */
  readonly travelling: { readonly min: number; readonly mean: number };
  /** The verdict against the target: only for cpuThrottle 1; null for a throttled run, which is a data point and not an answer. */
  readonly meets: boolean | null;
}

/** One file of `docs/performance/records/`: a laptop, how it was powered and the rates that were measured on it. */
export interface FpsRecord {
  readonly schema: 1;
  /** ISO 8601. */
  readonly date: string;
  readonly commit: string;
  readonly dirty: boolean;
  readonly scenario: {
    readonly nodes: number;
    readonly edges: number;
    readonly messagesTarget: number;
    readonly seconds: number;
  };
  readonly machine: {
    readonly cpu: string;
    readonly cores: number;
    readonly memoryGb: number;
    readonly platform: string;
    readonly release: string;
    readonly arch: string;
    readonly gpu: string;
    readonly browser: string;
    readonly displayHz: number;
    readonly devicePixelRatio: number;
    readonly screen: string;
  };
  readonly power: PowerState;
  readonly rates: readonly Rate[];
}

/** True when the median is at least TARGET_FPS and the fewest messages in flight is at least TARGET_MESSAGES. */
export function verdict(stats: RunStats, travellingMin: number): boolean {
  return stats.medianFps >= TARGET_FPS && travellingMin >= TARGET_MESSAGES;
}

/** A file name for a record, `2026-10-09-intel-r-core-tm-i9-14900hx-ac.json`: the day, the cpu as a slug, and `ac`, `battery` or `power-unknown`. */
export function recordFileName(record: Pick<FpsRecord, 'date' | 'machine' | 'power'>): string {
  // Lower case, every run of characters that are not letters or digits becomes one dash, none at either end. A name
  // that is only symbols leaves nothing, and a file name must not be `2026-10-09--ac.json`.
  const cpu =
    record.machine.cpu
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'unknown-cpu';
  return `${record.date.slice(0, 10)}-${cpu}-${powerName(record.power)}.json`;
}

function powerName({ charging }: PowerState): string {
  if (charging === null) {
    return 'power-unknown';
  }
  return charging ? 'ac' : 'battery';
}
