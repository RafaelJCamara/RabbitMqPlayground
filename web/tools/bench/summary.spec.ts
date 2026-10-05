import { describe, expect, it } from 'vitest';
import { formatDuration, formatThroughput, renderBenchSummary } from './summary';

describe('formatThroughput', () => {
  it.each([
    [19_912_184.56, '19.9 M/s'],
    [1_000_000, '1.0 M/s'],
    [450_000, '450.0 k/s'],
    [1_000, '1.0 k/s'],
    [12.34, '12.3 /s'],
    [0, '0.0 /s'],
  ])('shows %d as %s', (ops, text) => {
    expect(formatThroughput(ops)).toBe(text);
  });
});

describe('formatDuration', () => {
  it.each([
    [50, '50 ns'],
    [999, '999 ns'],
    [1_500, '1.5 µs'],
    [2_500_000, '2.50 ms'],
  ])('shows %d ns as %s', (ns, text) => {
    expect(formatDuration(ns)).toBe(text);
  });
});

describe('renderBenchSummary', () => {
  const row = { suite: 'prng', name: 'next()', opsPerSecond: 19_912_184, meanNanoseconds: 50, p99Nanoseconds: 100 };

  it('renders a markdown table with one line per benchmark', () => {
    const text = renderBenchSummary([row, { ...row, name: 'nextInt(100)', opsPerSecond: 400_000 }]);

    expect(text).toContain('## Benchmarks');
    expect(text).toContain('| Benchmark | Throughput | Mean | p99 |');
    expect(text).toContain('| prng › next() | 19.9 M/s | 50 ns | 100 ns |');
    expect(text).toContain('| prng › nextInt(100) | 400.0 k/s | 50 ns | 100 ns |');
  });

  it('escapes a pipe in a benchmark name, so the table does not break', () => {
    expect(renderBenchSummary([{ ...row, name: 'a|b' }])).toContain('| prng › a\\|b |');
  });

  it('says so when nothing ran, which would otherwise look like a pass', () => {
    const text = renderBenchSummary([]);

    expect(text).toContain('_No benchmarks ran._');
    expect(text).not.toContain('| Benchmark |');
  });

  it('explains that only gross regressions fail the job', () => {
    expect(renderBenchSummary([row])).toContain('only on a gross regression');
  });
});
