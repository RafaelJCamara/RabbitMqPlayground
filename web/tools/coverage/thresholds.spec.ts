import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../../vitest.config.ts';

/**
 * ADR-0004 replaces review with automated gates, and ADR-0015 says that coverage thresholds are never lowered to get a
 * commit through. The pre-push hook and CI block a drop in coverage only while the thresholds stay where the plan put
 * them and nothing is quietly left out of the measurement. These tests fail when a threshold is lowered, and when an
 * exclusion is added. Raising a threshold is fine. Changing an exclusion means changing this spec in the same commit,
 * which is where the reason belongs.
 */

const METRICS = ['statements', 'branches', 'functions', 'lines'] as const;
type Metric = (typeof METRICS)[number];
type Thresholds = Readonly<Record<Metric, number>>;

const webRoot = fileURLToPath(new URL('../../', import.meta.url));

interface AngularJson {
  projects: {
    app: {
      architect: {
        test: { options: { coverageThresholds: Thresholds; coverageInclude: string[]; coverageExclude: string[] } };
      };
    };
  };
}
const app = (JSON.parse(readFileSync(`${webRoot}angular.json`, 'utf8')) as AngularJson).projects.app.architect.test
  .options;

const libraries = config.test?.coverage;
const libraryThresholds = (libraries?.thresholds ?? {}) as unknown as Readonly<Record<string, Thresholds>>;

describe('the coverage of the libraries (Vitest, v8)', () => {
  it.each([
    ['projects/engine/src/**', 95],
    ['projects/domain/src/**', 95],
    ['projects/persistence/src/**', 85],
  ] as const)('holds %s to at least %i percent on every metric', (glob, percent) => {
    for (const metric of METRICS) {
      expect(libraryThresholds[glob]?.[metric], `${glob} ${metric}`).toBeGreaterThanOrEqual(percent);
    }
  });

  it('has a threshold for exactly those libraries, so that a new library has to be given one', () => {
    expect(Object.keys(libraryThresholds).sort()).toEqual([
      'projects/domain/src/**',
      'projects/engine/src/**',
      'projects/persistence/src/**',
    ]);
  });

  it('measures every source file of those libraries, and leaves out only specs, benchmarks and declarations', () => {
    expect(libraries?.include).toEqual(['projects/{engine,domain,persistence}/src/**/*.ts']);
    expect(libraries?.exclude).toEqual(['**/*.spec.ts', '**/*.bench.ts', '**/*.d.ts']);
  });
});

describe('the coverage of the app (ng test)', () => {
  it('holds the app to at least 85% on every metric', () => {
    for (const metric of METRICS) {
      expect(app.coverageThresholds[metric], metric).toBeGreaterThanOrEqual(85);
    }
  });

  it('measures every source file of the app', () => {
    expect(app.coverageInclude).toEqual(['projects/app/src/**/*.ts']);
  });

  it('leaves out only specs, declarations, the test setup, the entry points and the Foblex adapter', () => {
    // The Foblex adapter is covered by the end-to-end journeys instead (ADR-0018). Anything added here hides code from
    // the gate, so it needs a reason, written in this spec.
    expect(app.coverageExclude).toEqual([
      'projects/app/src/**/*.spec.ts',
      'projects/app/src/**/*.d.ts',
      'projects/app/src/test-setup.ts',
      'projects/app/src/main.ts',
      'projects/app/src/app/app.config.ts',
      'projects/app/src/app/canvas/flow/**',
    ]);
  });
});
