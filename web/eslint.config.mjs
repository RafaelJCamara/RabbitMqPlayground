// @ts-check
import eslint from '@eslint/js';
import angular from 'angular-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';
import eslintConfigPrettier from 'eslint-config-prettier/flat';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
 * Dependency rules (ADR-0018). Who may import what is enforced here, and `tsc -b` adds the type-level half: the engine
 * and the domain have no DOM or Node typings. tools/boundaries/eslint.spec.ts lints sample code at each path and
 * proves that every rule below fires, so loosening one fails a test.
 *
 * A flat-config rule is replaced, not merged, by a later block that matches the same file. Each project therefore gets
 * one block that lists all of its restrictions.
 */

const PROJECTS = ['engine', 'domain', 'persistence', 'testing', 'app'];

/** A relative import that reaches into another project's sources. */
const reachesIntoAnotherProject = (self) => ({
  regex: `^(\\.\\./)+(${PROJECTS.filter((name) => name !== self).join('|')})/src/`,
  message: 'Reach another project through its `@rmq/*` alias, not through a relative path (ADR-0018).',
});

const noDeepImports = {
  group: ['@rmq/*/**'],
  message: 'Import a library through its entry point (`@rmq/<name>`), not a path inside it (ADR-0018).',
};

const testingIsForTests = {
  group: ['@rmq/testing'],
  message: '`@rmq/testing` may only be imported from specs, `e2e/` and `tools/` (ADR-0018).',
};

const noUiFramework = {
  group: ['@angular/**', 'rxjs', 'rxjs/**', '@foblex/**'],
  message: 'This project must not depend on Angular, RxJS or Foblex Flow (ADR-0018).',
};

/** Everything except relative imports and the listed packages. `allowed` entries are exact names or `name/…`. */
const onlyThesePackages = (allowed, message) => ({
  regex: `^(?!\\.{1,2}(/|$)${allowed.map((name) => `|${name.replace(/[/.]/g, '\\$&')}(/|$)`).join('')})`,
  message,
});

const noFoblex = {
  group: ['@foblex/**'],
  message: 'Foblex Flow may only be imported inside `canvas/flow/**` (ADR-0016, ADR-0018).',
};

const restrictImports = (...patterns) => ['error', { patterns }];

/** Browser, Node and clock globals that the engine and the domain take as inputs instead (ADR-0007, ADR-0018). */
const AMBIENT_GLOBALS = [
  'window',
  'document',
  'self',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'Worker',
  'alert',
  'console',
  'performance',
  'crypto',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'queueMicrotask',
  'process',
  'Buffer',
  'require',
  'module',
  'exports',
  '__dirname',
  '__filename',
];

const deterministicCode = {
  'no-restricted-globals': [
    'error',
    ...AMBIENT_GLOBALS.map((name) => ({
      name,
      message: `\`${name}\` is ambient. Engine and domain code take time, randomness and I/O as inputs (ADR-0018).`,
    })),
  ],
  'no-restricted-properties': [
    'error',
    { object: 'Math', property: 'random', message: 'Use the seeded PRNG from @rmq/engine (ADR-0007).' },
    { object: 'Date', property: 'now', message: 'Take the time as an input: a clock function (ADR-0018).' },
  ],
  'no-restricted-syntax': [
    'error',
    {
      selector: "NewExpression[callee.name='Date']",
      message: '`new Date` reads the clock. Take the time as an input (ADR-0018).',
    },
    {
      selector: "CallExpression[callee.name='Date']",
      message: '`Date()` reads the clock. Take the time as an input (ADR-0018).',
    },
    {
      selector: "Identifier[name='globalThis']",
      message: '`globalThis` is a way around the ambient-global ban (ADR-0018).',
    },
  ],
};

/** ADR-0015: a test is never skipped or disabled to get green. Conditional forms (`skipIf`, `runIf`) are fine. */
const testHygiene = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "MemberExpression[object.name=/^(describe|it|test)$/][property.name='only']",
      message: 'A focused test hides every other test. Remove `.only`.',
    },
    {
      selector: "MemberExpression[object.name=/^(describe|it|test)$/][property.name='skip']",
      message: 'Never skip a test to get green (ADR-0015). Fix it, or use `skipIf` with a stated reason.',
    },
    {
      selector: 'CallExpression[callee.name=/^(xit|xtest|xdescribe|fit|fdescribe)$/]',
      message: 'Never skip or focus a test (ADR-0015).',
    },
  ],
};

/** Angular 22 makes OnPush the default; `Eager` (and the deprecated `Default`) is the way to opt out. */
const noOptingOutOfOnPush = {
  'no-restricted-syntax': [
    'error',
    {
      selector: "MemberExpression[object.name='ChangeDetectionStrategy'][property.name=/^(Eager|Default)$/]",
      message: 'Components are OnPush, which is the Angular 22 default. Do not opt out (ADR-0018).',
    },
  ],
};

const SPECS = ['**/*.spec.ts', '**/*.bench.ts'];
const APP_SOURCES = ['projects/app/src/**/*.ts'];
const FLOW_ADAPTER = 'projects/app/src/app/canvas/flow/**';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    'dist/**',
    '.angular/**',
    '.tsbuild/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'bench-results/**',
    'conformance-diff/**',
    'fixtures/**',
  ]),

  // Everything
  {
    files: ['**/*.ts', '**/*.mjs'],
    extends: [eslint.configs.recommended],
  },
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.recommended, tseslint.configs.stylistic],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.mjs', '*.config.ts', 'tools/**/*.ts', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // Angular: the app only
  {
    files: APP_SOURCES,
    extends: [angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/component-selector': ['error', { type: 'element', prefix: 'rmq', style: 'kebab-case' }],
      '@angular-eslint/directive-selector': ['error', { type: 'attribute', prefix: 'rmq', style: 'camelCase' }],
    },
  },
  {
    files: ['projects/app/src/**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
  },

  // Dependency rules, one block per project (production code only; specs follow below)
  {
    files: ['projects/engine/src/**/*.ts'],
    ignores: SPECS,
    rules: {
      ...deterministicCode,
      'no-restricted-imports': restrictImports(
        noDeepImports,
        reachesIntoAnotherProject('engine'),
        onlyThesePackages([], 'The engine imports nothing: no package and no other project (ADR-0018).'),
      ),
    },
  },
  {
    files: ['projects/domain/src/**/*.ts'],
    ignores: SPECS,
    rules: {
      ...deterministicCode,
      'no-restricted-imports': restrictImports(
        noDeepImports,
        reachesIntoAnotherProject('domain'),
        onlyThesePackages(
          ['@rmq/engine', 'zod', '@dagrejs/dagre'],
          'The domain may import only @rmq/engine, zod and @dagrejs/dagre (ADR-0018).',
        ),
      ),
    },
  },
  {
    files: ['projects/persistence/src/**/*.ts'],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        reachesIntoAnotherProject('persistence'),
        onlyThesePackages(
          ['@rmq/domain', '@rmq/engine', 'idb'],
          'Persistence may import only @rmq/domain, @rmq/engine and idb. It has no Angular, RxJS or Foblex Flow (ADR-0018).',
        ),
      ),
    },
  },
  {
    files: ['projects/testing/src/**/*.ts'],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        reachesIntoAnotherProject('testing'),
        onlyThesePackages(
          ['@rmq/engine', '@rmq/domain', 'fast-check'],
          '@rmq/testing may import only @rmq/engine, @rmq/domain and fast-check. It has no Angular, RxJS or Foblex Flow (ADR-0018).',
        ),
      ),
    },
  },
  {
    files: APP_SOURCES,
    ignores: [...SPECS, FLOW_ADAPTER],
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The Foblex adapter is the one place that may import Foblex Flow.
    files: [FLOW_ADAPTER],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(noDeepImports, testingIsForTests, reachesIntoAnotherProject('app')),
      ...noOptingOutOfOnPush,
    },
  },

  // Specs may use `@rmq/testing`, Vitest and Node, but the libraries' specs still keep the UI frameworks out.
  {
    files: ['projects/{engine,domain,persistence,testing}/src/**/*.{spec,bench}.ts'],
    rules: {
      'no-restricted-imports': restrictImports(noDeepImports, noUiFramework),
      ...testHygiene,
    },
  },
  {
    files: ['projects/app/src/**/*.spec.ts'],
    ignores: [FLOW_ADAPTER],
    rules: {
      'no-restricted-imports': restrictImports(noDeepImports, noFoblex),
      ...testHygiene,
    },
  },
  {
    files: [`${FLOW_ADAPTER}/*.spec.ts`],
    rules: {
      'no-restricted-imports': restrictImports(noDeepImports),
      ...testHygiene,
    },
  },
  {
    files: ['tools/**/*.{spec,bench}.ts'],
    rules: { ...testHygiene },
  },

  // Tools and end-to-end specs: free to import what they need, but never a path inside a library, and never `.only`.
  {
    files: ['tools/**/*.ts', 'e2e/**/*.ts', '*.config.ts'],
    ignores: ['tools/**/*.{spec,bench}.ts'],
    rules: { 'no-restricted-imports': restrictImports(noDeepImports) },
  },
  {
    files: ['e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name=/^(describe|it|test)$/][property.name='only']",
          message: 'A focused test hides every other test. Remove `.only`.',
        },
      ],
    },
  },

  // Prettier owns formatting. This goes last so that it wins over any stylistic rule above.
  eslintConfigPrettier,
]);
