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
        test: { name, include: [`projects/${name}/src/**/*.spec.ts`], environment: 'node', setupFiles },
      })),
      {
        extends: true,
        test: { name: 'tools', include: ['tools/**/*.spec.ts'], environment: 'node', setupFiles },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['projects/{engine,domain,persistence}/src/**/*.ts'],
      exclude: ['**/*.spec.ts', '**/*.d.ts'],
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
