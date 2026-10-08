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

/**
 * Which way the folders of the app look (ADR-0030, ADR-0045, ADR-0057, ADR-0061): `core`, then `canvas/model`, then `canvas/overlay`, then `canvas/flow`, then
 * `command-bar`, then `simulation`, then `explain`, then `editor`. A folder may import what is before it and nothing after. The command bar and the simulation
 * do not look at each other, and the editor hosts both and the explanation.
 */
const coreStaysBelow = {
  regex: '^(\\.\\./)+(editor|canvas)(/|$)',
  message:
    '`core/` may not import from `editor/` or `canvas/`: the folders run core, canvas/model, canvas/flow, editor (ADR-0030).',
};
const canvasStaysBelowEditor = {
  regex: '^(\\.\\./)+editor(/|$)',
  message:
    '`canvas/` may not import from `editor/`: the folders run core, canvas/model, canvas/flow, editor (ADR-0030).',
};
const belowCommandBar = {
  regex: '^(\\.\\./)+command-bar(/|$)',
  message:
    '`core/` and `canvas/` may not import from `command-bar/`: the folders run core, canvas/model, canvas/flow, command-bar, editor (ADR-0045).',
};
const commandBarStaysBelowEditor = {
  regex: '^(\\.\\./)+(editor|canvas/flow)(/|$)',
  message:
    '`command-bar/` may not import from `editor/` or `canvas/flow/`: the folders run core, canvas/model, canvas/flow, command-bar, editor (ADR-0045).',
};
const modelStaysBelowFlow = {
  regex: '^(\\.\\./)+(canvas/)?flow(/|$)',
  message:
    '`canvas/model/` may not import from `canvas/flow/`: the folders run core, canvas/model, canvas/flow, editor (ADR-0030).',
};

const belowSimulation = {
  regex: '^(\\.\\./)+simulation(/|$)',
  message:
    '`core/`, `canvas/` and `command-bar/` may not import from `simulation/`: the folders run core, canvas/model, canvas/overlay, canvas/flow, command-bar, simulation, editor (ADR-0057).',
};
const simulationStaysBelowEditor = {
  regex: '^(\\.\\./)+(editor|canvas/flow|command-bar)(/|$)',
  message:
    '`simulation/` may not import from `editor/`, `canvas/flow/` or `command-bar/`: the folders run core, canvas/model, canvas/overlay, canvas/flow, command-bar, simulation, editor (ADR-0057).',
};
const SHARE_ORDER =
  'core, canvas/model, canvas/overlay, canvas/flow, command-bar, simulation, explain, share, editor, canvases';
const belowShare = {
  regex: '^(\\.\\./)+share(/|$)',
  message: `\`core/\`, \`canvas/\`, \`command-bar/\`, \`simulation/\` and \`explain/\` may not import from \`share/\`, which is above them: the folders run ${SHARE_ORDER} (ADR-0078).`,
};
/**
 * `core/share/` is core's, and `share/` is the folder of the panels that is above `explain/`. From a file two folders down in `core/` the first is `../share/` and the second `../../share/`, so only the second is
 * forbidden there, and from a file directly in `core/` the second is `../share/`.
 */
const coreStaysBelowShare = { regex: '^(\\.\\./){2,}share(/|$)', message: belowShare.message };
const coreFilesStayBelowShare = { regex: '^\\.\\./share(/|$)', message: belowShare.message };
const shareStaysBelowEditor = {
  regex: '^(\\.\\./)+editor(/|$)',
  message: `\`share/\` may not import from \`editor/\`, which is above it: the folders run ${SHARE_ORDER} (ADR-0078).`,
};
const belowCanvases = {
  regex: '^(\\.\\./)+canvases(/|$)',
  message:
    '`core/`, `canvas/`, `command-bar/`, `simulation/`, `explain/` and `editor/` may not import from `canvases/`, which is above them: the folders run core, canvas/model, canvas/overlay, canvas/flow, command-bar, simulation, explain, editor, canvases (ADR-0072).',
};
const belowExplain = {
  regex: '^(\\.\\./)+explain(/|$)',
  message:
    '`canvas/`, `command-bar/` and `simulation/` may not import from `explain/`: the folders run core, canvas/model, canvas/overlay, canvas/flow, command-bar, simulation, explain, editor (ADR-0061).',
};
/**
 * `core/explain/` is core's, and `explain/` is the folder of components that is above `simulation/`. From a file two folders down in `core/` the first is `../explain/` and the second `../../explain/`, so only the
 * second is forbidden there, and from a file directly in `core/` the second is `../explain/`.
 */
const coreStaysBelowExplain = {
  regex: '^(\\.\\./){2,}explain(/|$)',
  message:
    '`core/` may not import from `explain/`, which is above it: the folders run core, canvas/model, canvas/overlay, canvas/flow, command-bar, simulation, explain, editor (ADR-0061).',
};
const coreFilesStayBelowExplain = {
  regex: '^\\.\\./explain(/|$)',
  message: coreStaysBelowExplain.message,
};
const explainStaysBelowEditor = {
  regex: '^(\\.\\./)+(editor|canvas/flow|command-bar)(/|$)',
  message:
    '`explain/` may not import from `editor/`, `canvas/flow/` or `command-bar/`: the folders run core, canvas/model, canvas/overlay, canvas/flow, command-bar, simulation, explain, editor (ADR-0061).',
};
const overlayStaysBelowFlow = {
  regex: '^(\\.\\./)+(canvas/)?flow(/|$)',
  message:
    '`canvas/overlay/` may not import from `canvas/flow/`: the folders run core, canvas/model, canvas/overlay, canvas/flow, editor (ADR-0057).',
};
const modelStaysBelowOverlay = {
  regex: '^(\\.\\./)+(canvas/)?overlay(/|$)',
  message:
    '`canvas/model/` may not import from `canvas/overlay/`: the folders run core, canvas/model, canvas/overlay, canvas/flow, editor (ADR-0057).',
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
const APP_CORE = 'projects/app/src/app/core/**/*.ts';
const CANVAS_MODEL = 'projects/app/src/app/canvas/model/**/*.ts';
const CANVAS_OVERLAY = 'projects/app/src/app/canvas/overlay/**/*.ts';
const SIMULATION_UI = 'projects/app/src/app/simulation/**/*.ts';
const COMMAND_BAR = 'projects/app/src/app/command-bar/**/*.ts';
const EXPLAIN_UI = 'projects/app/src/app/explain/**/*.ts';
const SHARE_UI = 'projects/app/src/app/share/**/*.ts';
const CORE_ROOT = 'projects/app/src/app/core/*.ts';

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
    // Inline templates are linted as files like these. A button with no type submits the form that it may one day be in.
    rules: { '@angular-eslint/template/button-has-type': 'error' },
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
        belowCanvases,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The folders of the app look one way (ADR-0030). These blocks come after the one above, which they replace for their files.
    files: [APP_CORE],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        coreStaysBelow,
        belowCommandBar,
        belowSimulation,
        coreStaysBelowExplain,
        coreStaysBelowShare,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The few files that are directly in `core/` are one folder closer to `explain/`.
    files: [CORE_ROOT],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        coreStaysBelow,
        belowCommandBar,
        belowSimulation,
        coreFilesStayBelowExplain,
        coreFilesStayBelowShare,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    files: [CANVAS_MODEL],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        canvasStaysBelowEditor,
        belowCommandBar,
        belowSimulation,
        modelStaysBelowFlow,
        modelStaysBelowOverlay,
        belowExplain,
        belowShare,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // What the simulation draws on the canvas reads core and the canvas model, and the editor hosts it (ADR-0055, ADR-0057).
    files: [CANVAS_OVERLAY],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        canvasStaysBelowEditor,
        belowCommandBar,
        belowSimulation,
        overlayStaysBelowFlow,
        belowExplain,
        belowShare,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The controls and the parts of the inspector that the simulation has read core and the canvas, and the editor hosts them (ADR-0056, ADR-0057).
    files: [SIMULATION_UI],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        simulationStaysBelowEditor,
        belowExplain,
        belowShare,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The parts of the explanation that are drawn read core, the canvas model and the simulation, and the editor hosts them (ADR-0061).
    files: [EXPLAIN_UI],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        explainStaysBelowEditor,
        belowShare,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The panels that make a link and export for a broker read core, and the editor and the home open them (ADR-0078, ADR-0079).
    files: [SHARE_UI],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        shareStaysBelowEditor,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The command bar reads core and the canvas model, and the editor hosts it (ADR-0045).
    files: [COMMAND_BAR],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        noFoblex,
        belowCanvases,
        commandBarStaysBelowEditor,
        belowSimulation,
        belowExplain,
        belowShare,
      ),
      ...noOptingOutOfOnPush,
    },
  },
  {
    // The Foblex adapter is the one place that may import Foblex Flow.
    files: [FLOW_ADAPTER],
    ignores: SPECS,
    rules: {
      'no-restricted-imports': restrictImports(
        noDeepImports,
        testingIsForTests,
        reachesIntoAnotherProject('app'),
        canvasStaysBelowEditor,
        belowCanvases,
        belowCommandBar,
        belowSimulation,
        belowExplain,
        belowShare,
      ),
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
