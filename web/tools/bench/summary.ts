/** One line of the benchmark summary: what a benchmark measured. */
export interface BenchRow {
  readonly suite: string;
  readonly name: string;
  readonly opsPerSecond: number;
  readonly meanNanoseconds: number;
  readonly p99Nanoseconds: number;
}

export function formatThroughput(opsPerSecond: number): string {
  if (opsPerSecond >= 1e6) {
    return `${(opsPerSecond / 1e6).toFixed(1)} M/s`;
  }
  if (opsPerSecond >= 1e3) {
    return `${(opsPerSecond / 1e3).toFixed(1)} k/s`;
  }
  return `${opsPerSecond.toFixed(1)} /s`;
}

export function formatDuration(nanoseconds: number): string {
  if (nanoseconds >= 1e6) {
    return `${(nanoseconds / 1e6).toFixed(2)} ms`;
  }
  if (nanoseconds >= 1e3) {
    return `${(nanoseconds / 1e3).toFixed(1)} µs`;
  }
  return `${nanoseconds.toFixed(0)} ns`;
}

/** The markdown that goes to the CI job summary and to the console. */
export function renderBenchSummary(rows: readonly BenchRow[]): string {
  const lines = ['## Benchmarks', ''];

  if (rows.length === 0) {
    lines.push('_No benchmarks ran._');
  } else {
    lines.push('| Benchmark | Throughput | Mean | p99 |', '|---|---:|---:|---:|');
    for (const row of rows) {
      const name = `${row.suite} › ${row.name}`.replaceAll('|', '\\|');
      lines.push(
        `| ${name} | ${formatThroughput(row.opsPerSecond)} | ${formatDuration(row.meanNanoseconds)} | ${formatDuration(row.p99Nanoseconds)} |`,
      );
    }
  }

  lines.push(
    '',
    'A benchmark fails the job only on a gross regression. CI runners are shared, so read these numbers relatively.',
  );
  return lines.join('\n');
}
