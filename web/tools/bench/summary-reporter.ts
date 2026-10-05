import { appendFileSync } from 'node:fs';
import type { TestBenchmark } from 'vitest';
import type { Reporter, TestCase } from 'vitest/node';
import { renderBenchSummary, type BenchRow } from './summary';

/**
 * A Vitest reporter for `vitest bench` that prints the results as a markdown table, and appends the table to the
 * GitHub Actions job summary when it runs there. Loaded with `--reporter=./tools/bench/summary-reporter.ts`.
 */
export default class BenchSummaryReporter implements Reporter {
  private readonly rows: BenchRow[] = [];

  onTestCaseBenchmark(testCase: TestCase, benchmark: TestBenchmark): void {
    for (const task of benchmark.tasks) {
      this.rows.push({
        suite: testCase.fullName,
        name: task.name,
        opsPerSecond: task.throughput.mean,
        // Vitest reports latency in milliseconds.
        meanNanoseconds: task.latency.mean * 1e6,
        p99Nanoseconds: task.latency.p99 * 1e6,
      });
    }
  }

  onTestRunEnd(): void {
    const markdown = renderBenchSummary(this.rows);
    console.log(`\n${markdown}\n`);
    const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
    if (summaryFile) {
      appendFileSync(summaryFile, `${markdown}\n`);
    }
  }
}
