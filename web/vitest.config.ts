import { defineConfig } from 'vitest/config';
import { rmqAliases } from './tools/config/aliases.ts';

const libraries = ['engine', 'domain', 'persistence', 'testing'] as const;
const setupFiles = ['projects/testing/src/vitest-setup.ts'];

/**
 * Tests for the libraries and the tools. The Angular app is tested by `ng test` (see angular.json).
 * Coverage thresholds follow ADR-0018: engine 95, domain 95, persistence 85 (statements, branches, functions, lines).
 */
export default defineConfig({
  resolve: { alias: rmqAliases() },
  test: {
    projects: [
      ...libraries.map((name) => ({
        extends: true,
        // The nightly fuzz job runs every property 5,000 times (FC_NUM_RUNS), which can take longer than the 5 s default
        // on a busy runner. A property that times out has found nothing, and hides what a real run would have found.
        test: {
          name,
          include: [`projects/${name}/src/**/*.spec.ts`],
          environment: 'node',
          setupFiles,
          testTimeout: 60_000,
        },
      })),
      {
        extends: true,
        // These specs build TypeScript programs, load the ESLint configuration and spawn processes. That takes seconds on
        // a loaded machine, such as the pre-push hook with lint, both coverage runs and a build running at once, so they
        // get a limit that fits the work. A test that fails is still a failure, and none is skipped.
        test: {
          name: 'tools',
          include: ['tools/**/*.spec.ts'],
          environment: 'node',
          setupFiles,
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['projects/{engine,domain,persistence}/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.bench.ts', '**/*.d.ts'],
      reporter: ['text-summary', 'text', 'lcovonly'],
      thresholds: {
        'projects/engine/src/**': threshold(95),
        'projects/domain/src/**': threshold(95),
        'projects/persistence/src/**': threshold(85),
      },
    },
  },
});

function threshold(percent: number) {
  return { statements: percent, branches: percent, functions: percent, lines: percent };
}
