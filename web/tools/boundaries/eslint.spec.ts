import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR-0018's dependency table, enforced by eslint.config.mjs. Each case lints a snippet as if it lived at `file`, so a
 * rule that is loosened, mis-scoped or removed makes a case here fail.
 */

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const RESTRICTION_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-globals',
  'no-restricted-properties',
  'no-restricted-syntax',
  'no-eval',
  'no-new-func',
  'no-script-url',
  '@angular-eslint/template/no-outerhtml',
]);

let eslint: ESLint;
beforeAll(async () => {
  eslint = new ESLint({ cwd: webRoot, overrideConfigFile: `${webRoot}eslint.config.mjs` });
  // The first lint loads the whole configuration (typescript-eslint, angular-eslint), which takes seconds on a loaded
  // machine and, inside the first test, used to eat its 5 seconds. Loading it here keeps the cases themselves quick.
  await eslint.lintText('export {};\n', { filePath: `${webRoot}projects/engine/src/lib/warm-up.ts` });
}, 120_000);

async function violations(file: string, code: string): Promise<{ rule: string; text: string }[]> {
  const [result] = await eslint.lintText(code, { filePath: `${webRoot}${file}` });
  expect(result?.messages.filter((message) => message.fatal)).toEqual([]);
  return (result?.messages ?? [])
    .filter((message) => message.ruleId !== null && RESTRICTION_RULES.has(message.ruleId))
    .map((message) => ({ rule: message.ruleId ?? '', text: message.message }));
}

const importing = (source: string) => `import * as x from '${source}';\nexport { x };\n`;
const using = (expression: string) => `export const x = ${expression};\n`;

const ENGINE = 'projects/engine/src/lib/example.ts';
const DOMAIN = 'projects/domain/src/lib/example.ts';
const PERSISTENCE = 'projects/persistence/src/lib/example.ts';
const TESTING = 'projects/testing/src/lib/example.ts';
const APP = 'projects/app/src/app/editor/example.ts';
const FLOW = 'projects/app/src/app/canvas/flow/example.ts';
const CORE = 'projects/app/src/app/core/state/example.ts';
const MODEL = 'projects/app/src/app/canvas/model/example.ts';
const COMMAND_BAR = 'projects/app/src/app/command-bar/example.ts';
const OVERLAY = 'projects/app/src/app/canvas/overlay/example.ts';
const SIMULATION = 'projects/app/src/app/simulation/example.ts';
const EXPLAIN = 'projects/app/src/app/explain/example.ts';
const CORE_ROOT = 'projects/app/src/app/core/example.ts';
const CORE_EXPLAIN = 'projects/app/src/app/core/explain/example.ts';
const CANVASES = 'projects/app/src/app/canvases/example.ts';
const SHARE = 'projects/app/src/app/share/example.ts';
const CORE_SHARE = 'projects/app/src/app/core/share/example.ts';
const ONBOARDING = 'projects/app/src/app/onboarding/example.ts';

describe('imports', () => {
  describe.each([
    // [description, file, source]
    ['the engine importing a package', ENGINE, 'zod', /engine imports nothing/],
    ['the engine importing a Node built-in', ENGINE, 'node:fs', /engine imports nothing/],
    ['the engine importing the domain', ENGINE, '@rmq/domain', /engine imports nothing/],
    ['the engine importing another project by relative path', ENGINE, '../../../domain/src/index', /alias/],
    ['the engine importing the testing library', ENGINE, '@rmq/testing', /engine imports nothing/],
    ['a deep import into a library', DOMAIN, '@rmq/engine/src/lib/prng', /entry point/],
    ['the domain importing persistence', DOMAIN, '@rmq/persistence', /may import only @rmq\/engine, zod/],
    ['the domain importing IndexedDB', DOMAIN, 'idb', /may import only @rmq\/engine, zod/],
    ['the domain importing Angular', DOMAIN, '@angular/core', /may import only @rmq\/engine, zod/],
    ['the domain importing the testing library', DOMAIN, '@rmq/testing', /may import only @rmq\/engine, zod/],
    ['persistence importing Angular', PERSISTENCE, '@angular/core', /no Angular, RxJS or Foblex/],
    ['persistence importing RxJS', PERSISTENCE, 'rxjs', /no Angular, RxJS or Foblex/],
    ['persistence importing an RxJS operator', PERSISTENCE, 'rxjs/operators', /no Angular, RxJS or Foblex/],
    ['persistence importing Foblex Flow', PERSISTENCE, '@foblex/flow', /no Angular, RxJS or Foblex/],
    ['persistence importing zod directly', PERSISTENCE, 'zod', /may import only @rmq\/domain, @rmq\/engine and idb/],
    ['persistence importing the testing library', PERSISTENCE, '@rmq/testing', /may import only @rmq\/domain/],
    ['the testing library importing persistence', TESTING, '@rmq/persistence', /may import only @rmq\/engine/],
    ['the testing library importing Angular', TESTING, '@angular/core', /no Angular, RxJS or Foblex/],
    ['the app importing Foblex Flow outside the adapter', APP, '@foblex/flow', /only be imported inside `canvas\/flow/],
    ['the app importing a Foblex helper outside the adapter', APP, '@foblex/utils', /only be imported inside/],
    ['the app importing the testing library', APP, '@rmq/testing', /only be imported from specs/],
    ['the app deep-importing a library', APP, '@rmq/domain/src/lib/command-docs', /entry point/],
    ['the app reaching into a library by relative path', APP, '../../../../engine/src/index', /alias/],
    // The folders of the app look one way: core, canvas/model, canvas/flow, editor (ADR-0030).
    ['core importing the editor', CORE, '../../editor/editor', /`core\/` may not import from `editor\/` or `canvas\/`/],
    ['core importing the canvas model', CORE, '../../canvas/model/canvas-vm', /`core\/` may not import/],
    ['core importing the Foblex adapter', CORE, '../../canvas/flow/flow-canvas', /`core\/` may not import/],
    ['core importing Foblex Flow', CORE, '@foblex/flow', /only be imported inside `canvas\/flow/],
    [
      'the canvas model importing the editor',
      MODEL,
      '../../editor/editor',
      /`canvas\/` may not import from `editor\/`/,
    ],
    ['the canvas model importing the Foblex adapter', MODEL, '../flow/flow-canvas', /`canvas\/model\/` may not import/],
    [
      'the canvas model importing the adapter by its path from the app',
      MODEL,
      '../../canvas/flow/flow-canvas',
      /may not import/,
    ],
    ['the canvas model importing Foblex Flow', MODEL, '@foblex/flow', /only be imported inside `canvas\/flow/],
    [
      'the Foblex adapter importing the editor',
      FLOW,
      '../../editor/editor',
      /`canvas\/` may not import from `editor\/`/,
    ],
    // The command bar sits between the canvas and the editor (ADR-0045): it reads core and the canvas model, and the editor hosts it.
    [
      'the command bar importing the editor',
      COMMAND_BAR,
      '../editor/editor',
      /`command-bar\/` may not import from `editor\/` or `canvas\/flow\/`/,
    ],
    [
      'the command bar importing the Foblex adapter',
      COMMAND_BAR,
      '../canvas/flow/flow-canvas',
      /`command-bar\/` may not import from/,
    ],
    // What the simulation draws on the canvas, and its controls, have a place of their own between the canvas and the editor (ADR-0057).
    [
      'the canvas overlay importing the editor',
      OVERLAY,
      '../../editor/editor',
      /`canvas\/` may not import from `editor\/`/,
    ],
    [
      'the canvas overlay importing the Foblex adapter',
      OVERLAY,
      '../flow/flow-canvas',
      /`canvas\/overlay\/` may not import from `canvas\/flow\/`/,
    ],
    [
      'the canvas overlay importing the adapter by its path from the app',
      OVERLAY,
      '../../canvas/flow/flow-canvas',
      /may not import from `canvas\/flow\/`/,
    ],
    ['the canvas overlay importing Foblex Flow', OVERLAY, '@foblex/flow', /only be imported inside `canvas\/flow/],
    ['the canvas overlay importing the testing library', OVERLAY, '@rmq/testing', /only be imported from specs/],
    [
      'the canvas overlay importing the command bar',
      OVERLAY,
      '../../command-bar/command-bar',
      /may not import from `command-bar\/`/,
    ],
    [
      'the canvas overlay importing the controls of the simulation',
      OVERLAY,
      '../../simulation/simulation-bar',
      /may not import from `simulation\/`/,
    ],
    [
      'the canvas model importing the overlay',
      MODEL,
      '../overlay/overlay',
      /`canvas\/model\/` may not import from `canvas\/overlay\/`/,
    ],
    [
      'the canvas model importing the controls of the simulation',
      MODEL,
      '../../simulation/simulation-bar',
      /may not import from `simulation\/`/,
    ],
    [
      'core importing the controls of the simulation',
      CORE,
      '../../simulation/simulation-bar',
      /may not import from `simulation\/`/,
    ],
    [
      'the Foblex adapter importing the controls of the simulation',
      FLOW,
      '../../simulation/simulation-bar',
      /may not import from `simulation\/`/,
    ],
    [
      'the command bar importing the controls of the simulation',
      COMMAND_BAR,
      '../simulation/simulation-bar',
      /may not import from `simulation\/`/,
    ],
    [
      'the controls of the simulation importing the editor',
      SIMULATION,
      '../editor/editor',
      /`simulation\/` may not import from `editor\/`, `canvas\/flow\/` or `command-bar\/`/,
    ],
    [
      'the controls of the simulation importing the Foblex adapter',
      SIMULATION,
      '../canvas/flow/flow-canvas',
      /`simulation\/` may not import from/,
    ],
    [
      'the controls of the simulation importing the command bar',
      SIMULATION,
      '../command-bar/command-bar',
      /`simulation\/` may not import from/,
    ],
    [
      'the controls of the simulation importing Foblex Flow',
      SIMULATION,
      '@foblex/flow',
      /only be imported inside `canvas\/flow/,
    ],
    [
      'the controls of the simulation importing the testing library',
      SIMULATION,
      '@rmq/testing',
      /only be imported from specs/,
    ],
    ['the command bar importing Foblex Flow', COMMAND_BAR, '@foblex/flow', /only be imported inside `canvas\/flow/],
    ['the command bar importing the testing library', COMMAND_BAR, '@rmq/testing', /only be imported from specs/],
    ['core importing the command bar', CORE, '../../command-bar/command-bar', /may not import from `command-bar\/`/],
    [
      'the canvas model importing the command bar',
      MODEL,
      '../../command-bar/command-bar',
      /may not import from `command-bar\/`/,
    ],
    [
      'the Foblex adapter importing the command bar',
      FLOW,
      '../../command-bar/command-bar',
      /may not import from `command-bar\/`/,
    ],
    // What the explanation draws has a place of its own between the simulation and the editor (ADR-0061). Its state is `core/explain/`, which is core's.
    [
      'core importing the components of the explanation',
      CORE,
      '../../explain/event-log-panel',
      /`core\/` may not import from `explain\/`/,
    ],
    [
      'a file directly in core importing the components of the explanation',
      CORE_ROOT,
      '../explain/event-log-panel',
      /`core\/` may not import from `explain\/`/,
    ],
    [
      'the state of the explanation importing the components of the explanation',
      CORE_EXPLAIN,
      '../../explain/event-log-panel',
      /`core\/` may not import from `explain\/`/,
    ],
    [
      'the canvas model importing the components of the explanation',
      MODEL,
      '../../explain/event-log-panel',
      /may not import from `explain\/`/,
    ],
    [
      'the canvas overlay importing the components of the explanation',
      OVERLAY,
      '../../explain/event-log-panel',
      /may not import from `explain\/`/,
    ],
    [
      'the Foblex adapter importing the components of the explanation',
      FLOW,
      '../../explain/event-log-panel',
      /may not import from `explain\/`/,
    ],
    [
      'the command bar importing the components of the explanation',
      COMMAND_BAR,
      '../explain/event-log-panel',
      /may not import from `explain\/`/,
    ],
    [
      'the controls of the simulation importing the components of the explanation',
      SIMULATION,
      '../explain/event-log-panel',
      /may not import from `explain\/`/,
    ],
    // The workspace of several canvases is above everything else, the editor included (ADR-0072).
    ['core importing the workspace', CORE, '../../canvases/workspace', /may not import from `canvases\/`/],
    [
      'a file directly in core importing the workspace',
      CORE_ROOT,
      '../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    [
      'the state of the explanation importing the workspace',
      CORE_EXPLAIN,
      '../../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    ['the canvas model importing the workspace', MODEL, '../../canvases/workspace', /may not import from `canvases\/`/],
    [
      'the canvas overlay importing the workspace',
      OVERLAY,
      '../../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    [
      'the Foblex adapter importing the workspace',
      FLOW,
      '../../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    [
      'the command bar importing the workspace',
      COMMAND_BAR,
      '../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    [
      'the controls of the simulation importing the workspace',
      SIMULATION,
      '../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    [
      'the components of the explanation importing the workspace',
      EXPLAIN,
      '../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    ['the editor importing the workspace', APP, '../canvases/workspace', /may not import from `canvases\/`/],
    [
      'the components of the explanation importing the editor',
      EXPLAIN,
      '../editor/editor',
      /`explain\/` may not import from `editor\/`, `canvas\/flow\/` or `command-bar\/`/,
    ],
    [
      'the components of the explanation importing the Foblex adapter',
      EXPLAIN,
      '../canvas/flow/flow-canvas',
      /`explain\/` may not import from/,
    ],
    [
      'the components of the explanation importing the command bar',
      EXPLAIN,
      '../command-bar/command-bar',
      /`explain\/` may not import from/,
    ],
    [
      'the components of the explanation importing Foblex Flow',
      EXPLAIN,
      '@foblex/flow',
      /only be imported inside `canvas\/flow/,
    ],
    [
      'the components of the explanation importing the testing library',
      EXPLAIN,
      '@rmq/testing',
      /only be imported from specs/,
    ],
    // The chooser and the tour have a place of their own beside the panels of sharing, between the explanation and the editor (ADR-0082).
    ['core importing the chooser', CORE, '../../onboarding/template-chooser', /may not import from `onboarding\/`/],
    [
      'a file directly in core importing the chooser',
      CORE_ROOT,
      '../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the canvas model importing the chooser',
      MODEL,
      '../../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the canvas overlay importing the chooser',
      OVERLAY,
      '../../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the Foblex adapter importing the chooser',
      FLOW,
      '../../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the command bar importing the chooser',
      COMMAND_BAR,
      '../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the controls of the simulation importing the chooser',
      SIMULATION,
      '../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the components of the explanation importing the chooser',
      EXPLAIN,
      '../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the panels of sharing importing the chooser',
      SHARE,
      '../onboarding/template-chooser',
      /may not import from `onboarding\/`/,
    ],
    [
      'the chooser importing the editor',
      ONBOARDING,
      '../editor/editor',
      /`onboarding\/` may not import from `editor\/` or `share\/`/,
    ],
    [
      'the chooser importing the panels of sharing',
      ONBOARDING,
      '../share/dialogs',
      /`onboarding\/` may not import from `editor\/` or `share\/`/,
    ],
    ['the chooser importing the workspace', ONBOARDING, '../canvases/library', /may not import from `canvases\/`/],
    // The panels that make a link and export for a broker have a place of their own between the explanation and the editor (ADR-0078). The link in the address is `core/share/`, which is core's.
    ['core importing the panels of sharing', CORE, '../../share/share-panel', /may not import from `share\/`/],
    [
      'a file directly in core importing the panels of sharing',
      CORE_ROOT,
      '../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the link in the address importing the panels of sharing',
      CORE_SHARE,
      '../../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the canvas model importing the panels of sharing',
      MODEL,
      '../../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the canvas overlay importing the panels of sharing',
      OVERLAY,
      '../../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the Foblex adapter importing the panels of sharing',
      FLOW,
      '../../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the command bar importing the panels of sharing',
      COMMAND_BAR,
      '../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the controls of the simulation importing the panels of sharing',
      SIMULATION,
      '../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the components of the explanation importing the panels of sharing',
      EXPLAIN,
      '../share/share-panel',
      /may not import from `share\/`/,
    ],
    [
      'the panels of sharing importing the editor',
      SHARE,
      '../editor/editor',
      /`share\/` may not import from `editor\/`, which is above it/,
    ],
    [
      'the panels of sharing importing the workspace',
      SHARE,
      '../canvases/workspace',
      /may not import from `canvases\/`/,
    ],
    ['the panels of sharing importing Foblex Flow', SHARE, '@foblex/flow', /only be imported inside `canvas\/flow/],
    ['the panels of sharing importing the testing library', SHARE, '@rmq/testing', /only be imported from specs/],
    ['the panels of sharing importing a library by a deep path', SHARE, '@rmq/persistence/src/index', /entry point/],
  ] as const)('%s', (_description, file, source, message) => {
    it('is refused', async () => {
      const found = await violations(file, importing(source));

      expect(found).toHaveLength(1);
      expect(found[0]?.rule).toBe('no-restricted-imports');
      expect(found[0]?.text).toMatch(message);
    });
  });

  describe.each([
    ['a relative import inside the engine', ENGINE, './prng'],
    ['a parent-relative import inside the engine', ENGINE, '../other/thing'],
    ['the domain importing the engine', DOMAIN, '@rmq/engine'],
    ['the domain importing zod', DOMAIN, 'zod'],
    ['the domain importing a zod sub-path', DOMAIN, 'zod/v4'],
    ['the domain importing dagre', DOMAIN, '@dagrejs/dagre'],
    ['persistence importing the domain', PERSISTENCE, '@rmq/domain'],
    ['persistence importing the engine', PERSISTENCE, '@rmq/engine'],
    ['persistence importing idb', PERSISTENCE, 'idb'],
    ['the testing library importing fast-check', TESTING, 'fast-check'],
    ['the testing library importing the engine and domain', TESTING, '@rmq/domain'],
    ['the app importing the engine', APP, '@rmq/engine'],
    ['the app importing the domain', APP, '@rmq/domain'],
    ['the app importing persistence', APP, '@rmq/persistence'],
    ['the app importing Angular', APP, '@angular/core'],
    ['the app importing RxJS', APP, 'rxjs'],
    ['the app importing its own code', APP, '../../core/app-info'],
    ['the app importing a folder that happens to be called engine', APP, '../engine/thing'],
    ['core importing core', CORE, '../announcer'],
    ['core importing a library and Angular', CORE, '@rmq/domain'],
    ['the canvas model importing core', MODEL, '../../core/state/selection-store'],
    ['the canvas model importing its own folder', MODEL, './canvas-vm'],
    ['the Foblex adapter importing the canvas model and core', FLOW, '../model/canvas-vm'],
    ['the Foblex adapter importing core', FLOW, '../../core/announcer'],
    ['the command bar importing core', COMMAND_BAR, '../core/state/command-bus'],
    ['the command bar importing the canvas model', COMMAND_BAR, '../canvas/model/flow-viewport'],
    ['the command bar importing its own folder', COMMAND_BAR, './history'],
    ['the canvas overlay importing core and the canvas model', OVERLAY, '../model/flow-viewport'],
    ['the canvas overlay importing core', OVERLAY, '../../core/runtime/simulation'],
    ['the canvas overlay importing its own folder', OVERLAY, './sprites'],
    ['the controls of the simulation importing core', SIMULATION, '../core/state/command-bus'],
    ['the controls of the simulation importing the canvas model', SIMULATION, '../canvas/model/flow-viewport'],
    ['the controls of the simulation importing the overlay', SIMULATION, '../canvas/overlay/overlay'],
    ['the controls of the simulation importing their own folder', SIMULATION, './simulation-bar'],
    ['the editor importing the controls of the simulation', APP, '../simulation/simulation-bar'],
    ['the editor importing the canvas overlay', APP, '../canvas/overlay/overlay'],
    ['the Foblex adapter importing the canvas overlay', FLOW, '../overlay/node-stats'],
    ['the editor importing the command bar', APP, '../command-bar/command-bar'],
    ['the editor importing the adapter', APP, '../canvas/flow/flow-canvas'],
    ['the editor importing the canvas model and core', APP, '../canvas/model/canvas-vm'],
    ['core importing the state of the explanation, which is core', CORE, '../explain/event-log'],
    ['the state of the explanation importing core', CORE_EXPLAIN, '../state/document-store'],
    ['the state of the explanation importing its own folder', CORE_EXPLAIN, './emphasis'],
    ['the Foblex adapter importing the state of the explanation', FLOW, '../../core/explain/emphasis'],
    [
      'the controls of the simulation importing the state of the explanation',
      SIMULATION,
      '../core/explain/explain-state',
    ],
    ['the components of the explanation importing core and its state', EXPLAIN, '../core/explain/explain-state'],
    ['the components of the explanation importing the canvas model', EXPLAIN, '../canvas/model/flow-viewport'],
    ['the components of the explanation importing the canvas overlay', EXPLAIN, '../canvas/overlay/overlay'],
    [
      'the components of the explanation importing the controls of the simulation',
      EXPLAIN,
      '../simulation/queue-messages',
    ],
    ['the components of the explanation importing their own folder', EXPLAIN, './event-log-panel'],
    ['the editor importing the components of the explanation', APP, '../explain/event-log-panel'],
    ['the workspace importing the editor', CANVASES, '../editor/editor'],
    ['the workspace importing core', CANVASES, '../core/session/canvas-storage'],
    ['the workspace importing the notices of core', CANVASES, '../core/ui/toasts'],
    ['the workspace importing the keys of the editor', CANVASES, '../editor/keyboard'],
    ['the workspace importing the canvas model', CANVASES, '../canvas/model/shapes'],
    ['the workspace importing its own folder', CANVASES, './library'],
    ['the root of the app importing the workspace', 'projects/app/src/app/example.ts', './canvases/workspace'],
    ['core importing the link in the address, which is core', CORE, '../share/link-opening'],
    ['a file directly in core importing the link in the address', CORE_ROOT, './share/link-opening'],
    ['the link in the address importing core', CORE_SHARE, '../flags/feature-flags'],
    ['the link in the address importing its own folder', CORE_SHARE, './page-address'],
    ['the panels of sharing importing core', SHARE, '../core/session/canvas-session'],
    ['the panels of sharing importing the link in the address', SHARE, '../core/share/page-address'],
    ['the panels of sharing importing their own folder', SHARE, './link-maker'],
    ['the chooser importing core', ONBOARDING, '../core/flags/feature-flags'],
    ['the chooser importing its own folder', ONBOARDING, './template-chooser'],
    ['the editor importing the tour', APP, '../onboarding/tour'],
    ['the workspace importing the chooser', CANVASES, '../onboarding/dialogs'],
    ['the panels of sharing importing the notices of core', SHARE, '../core/announcer'],
    ['the editor importing the panels of sharing', APP, '../share/dialogs'],
    ['the workspace importing the panels of sharing', CANVASES, '../share/dialogs'],
    ['the workspace importing the link in the address', CANVASES, '../core/share/link-opening'],
    [
      'the root of the app importing the link in the address',
      'projects/app/src/app/example.ts',
      './core/share/link-opening',
    ],
    ['the Foblex adapter importing Foblex Flow', FLOW, '@foblex/flow'],
    ['the Foblex adapter importing a Foblex helper', 'projects/app/src/app/canvas/flow/deep/more.ts', '@foblex/utils'],
  ] as const)('%s', (_description, file, source) => {
    it('is allowed', async () => {
      expect(await violations(file, importing(source))).toEqual([]);
    });
  });

  it('still refuses the testing library and deep imports inside the Foblex adapter', async () => {
    expect((await violations(FLOW, importing('@rmq/testing')))[0]?.text).toMatch(/only be imported from specs/);
    expect((await violations(FLOW, importing('@rmq/engine/src/index')))[0]?.text).toMatch(/entry point/);
  });

  describe('specs', () => {
    it('may use the testing library, Vitest, fast-check and Node in a library', async () => {
      const file = 'projects/engine/src/lib/example.spec.ts';
      for (const source of ['@rmq/testing', 'vitest', 'fast-check', 'node:fs']) {
        expect(await violations(file, importing(source)), source).toEqual([]);
      }
    });

    it('apply to benchmark files too, which are test code', async () => {
      const bench = 'projects/engine/src/lib/example.bench.ts';

      expect(await violations(bench, importing('vitest'))).toEqual([]);
      expect(await violations(bench, using('[performance, console]'))).toEqual([]);
      expect(await violations(bench, "it.only('x', () => {});\n")).toHaveLength(1);
      expect(await violations(bench, importing('@angular/core'))).toHaveLength(1);
    });

    it('may use `console` and `process`, which production engine code may not', async () => {
      expect(await violations('projects/engine/src/lib/example.spec.ts', using('[console, process]'))).toEqual([]);
    });

    it('still keep Angular, RxJS and Foblex out of the libraries', async () => {
      for (const library of ['engine', 'domain', 'persistence', 'testing']) {
        for (const source of ['@angular/core', 'rxjs', '@foblex/flow']) {
          const found = await violations(`projects/${library}/src/lib/example.spec.ts`, importing(source));

          expect(found, `${library} spec importing ${source}`).toHaveLength(1);
        }
      }
    });

    it('still refuse deep imports', async () => {
      const found = await violations('projects/domain/src/lib/example.spec.ts', importing('@rmq/engine/src/index'));

      expect(found[0]?.text).toMatch(/entry point/);
    });

    it('in the app may use the testing library, but not Foblex Flow outside the adapter', async () => {
      const file = 'projects/app/src/app/editor/example.spec.ts';

      expect(await violations(file, importing('@rmq/testing'))).toEqual([]);
      expect((await violations(file, importing('@foblex/flow')))[0]?.text).toMatch(/only be imported inside/);
      expect(await violations('projects/app/src/app/canvas/flow/example.spec.ts', importing('@foblex/flow'))).toEqual(
        [],
      );
    });
  });

  describe('tools and end-to-end specs', () => {
    it.each(['tools/conformance/example.ts', 'e2e/example.spec.ts', 'vitest.config.ts'])(
      '%s may use the libraries and the testing library',
      async (file) => {
        for (const source of ['@rmq/engine', '@rmq/domain', '@rmq/testing', 'node:fs', 'vitest']) {
          expect(await violations(file, importing(source)), `${file} importing ${source}`).toEqual([]);
        }
      },
    );

    it.each(['tools/conformance/example.ts', 'e2e/example.spec.ts', 'vitest.config.ts'])(
      '%s may not deep-import a library',
      async (file) => {
        expect((await violations(file, importing('@rmq/domain/src/index')))[0]?.text).toMatch(/entry point/);
      },
    );
  });
});

describe('ambient globals in the engine and the domain', () => {
  const globalsThatAreRefused = [
    'window',
    'document',
    'self',
    'navigator',
    'location',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'fetch',
    'console',
    'performance',
    'crypto',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    'setImmediate',
    'requestAnimationFrame',
    'requestIdleCallback',
    'queueMicrotask',
    'process',
    'Buffer',
    'require',
  ];

  describe.each([ENGINE, DOMAIN])('%s', (file) => {
    it.each(globalsThatAreRefused)('refuses `%s`', async (name) => {
      const found = await violations(file, using(name));

      expect(found).toHaveLength(1);
      expect(found[0]?.rule).toBe('no-restricted-globals');
      expect(found[0]?.text).toContain(`\`${name}\` is ambient`);
    });

    it('refuses Math.random and Date.now', async () => {
      expect((await violations(file, using('Math.random()')))[0]).toMatchObject({ rule: 'no-restricted-properties' });
      expect((await violations(file, using('Date.now()')))[0]).toMatchObject({ rule: 'no-restricted-properties' });
      expect((await violations(file, using('Math.random()')))[0]?.text).toMatch(/seeded PRNG/);
    });

    it('refuses `new Date`, `Date()` and `globalThis`', async () => {
      expect((await violations(file, using('new Date()')))[0]).toMatchObject({ rule: 'no-restricted-syntax' });
      expect((await violations(file, using('new Date(0)')))[0]).toMatchObject({ rule: 'no-restricted-syntax' });
      expect((await violations(file, using('Date()')))[0]).toMatchObject({ rule: 'no-restricted-syntax' });
      expect((await violations(file, using('globalThis')))[0]).toMatchObject({ rule: 'no-restricted-syntax' });
    });

    it('allows pure built-ins', async () => {
      const code = using('[Math.max(1, 2), new Map(), new Set(), Date.UTC(2026, 0, 1), JSON.stringify({}), BigInt(1)]');

      expect(await violations(file, code)).toEqual([]);
    });
  });

  it.each([PERSISTENCE, TESTING, APP, 'tools/example.ts'])('allows them in %s', async (file) => {
    const code = using('[window, console, Date.now(), Math.random(), new Date(), setTimeout]');

    expect(await violations(file, code)).toEqual([]);
  });
});

describe('components stay OnPush', () => {
  it.each([APP, FLOW])('refuses ChangeDetectionStrategy.Eager in %s', async (file) => {
    const found = await violations(file, using('ChangeDetectionStrategy.Eager'));

    expect(found).toHaveLength(1);
    expect(found[0]?.text).toMatch(/OnPush/);
  });

  it('refuses the deprecated ChangeDetectionStrategy.Default', async () => {
    expect(await violations(APP, using('ChangeDetectionStrategy.Default'))).toHaveLength(1);
  });

  it('allows ChangeDetectionStrategy.OnPush', async () => {
    expect(await violations(APP, using('ChangeDetectionStrategy.OnPush'))).toEqual([]);
  });
});

describe('plain text (ADR-0078)', () => {
  /** Where the code of the app lives: every one of these has the rules, because each has a block of its own. */
  const WHERE = [
    APP,
    FLOW,
    CORE,
    MODEL,
    COMMAND_BAR,
    OVERLAY,
    SIMULATION,
    EXPLAIN,
    CORE_ROOT,
    CORE_EXPLAIN,
    CANVASES,
    SHARE,
    CORE_SHARE,
    'projects/app/src/app/example.ts',
  ];

  describe.each([
    // [description, code, rule, message]
    [
      'assigning innerHTML',
      'export const x = (el: HTMLElement) => { el.innerHTML = name; };',
      'no-restricted-properties',
      /innerHTML/,
    ],
    [
      'reading innerHTML',
      'export const x = (el: HTMLElement) => el.innerHTML;',
      'no-restricted-properties',
      /innerHTML/,
    ],
    [
      'assigning outerHTML',
      'export const x = (el: HTMLElement) => { el.outerHTML = name; };',
      'no-restricted-properties',
      /outerHTML/,
    ],
    [
      'insertAdjacentHTML',
      "export const x = (el: HTMLElement) => el.insertAdjacentHTML('beforeend', name);",
      'no-restricted-properties',
      /insertAdjacentHTML/,
    ],
    ['document.write', 'export const x = () => document.write(name);', 'no-restricted-properties', /document\.write/],
    [
      'document.writeln',
      'export const x = () => document.writeln(name);',
      'no-restricted-properties',
      /document\.writeln/,
    ],
    [
      'bypassSecurityTrustHtml',
      'export const x = (s: { bypassSecurityTrustHtml(v: string): unknown }) => s.bypassSecurityTrustHtml(name);',
      'no-restricted-syntax',
      /trust a value/,
    ],
    [
      'bypassSecurityTrustResourceUrl',
      'export const x = (s: { bypassSecurityTrustResourceUrl(v: string): unknown }) => s.bypassSecurityTrustResourceUrl(name);',
      'no-restricted-syntax',
      /trust a value/,
    ],
    ['the DomSanitizer', 'export const x = inject(DomSanitizer);', 'no-restricted-syntax', /DomSanitizer/],
    [
      'createContextualFragment',
      "export const x = (range: Range) => range.createContextualFragment('<b>');",
      'no-restricted-syntax',
      /Do not make elements from text/,
    ],
    ['a DOMParser', 'export const x = new DOMParser();', 'no-restricted-syntax', /Do not make elements from text/],
    ['eval', "export const x = eval('1');", 'no-eval', /eval/],
    ['new Function', "export const x = new Function('return 1');", 'no-new-func', /Function/],
    [
      'a string for setTimeout to run',
      "export const x = setTimeout('go()', 0);",
      'no-restricted-syntax',
      /timer text to run/,
    ],
    [
      'a template for setInterval to run',
      'export const x = setInterval(`go()`, 0);',
      'no-restricted-syntax',
      /timer text to run/,
    ],
    [
      'a string for window.setTimeout to run',
      "export const x = window.setTimeout('go()', 0);",
      'no-restricted-syntax',
      /timer text to run/,
    ],
    ['a javascript: URL', "export const x = 'javascript:go()';", 'no-script-url', /Script URL/],
  ])('%s', (_description, code, rule, message) => {
    it.each(WHERE)('is refused in %s', async (file) => {
      const found = await violations(file, `${code}\n`);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ rule });
      expect(found[0]?.text).toMatch(message);
    });

    it('is allowed in a spec, which makes its own fixtures', async () => {
      expect(await violations('projects/app/src/app/editor/example.spec.ts', `${code}\n`)).toEqual([]);
    });
  });

  it('says why in every message, and what to do instead: that it is shown as text', async () => {
    const found = await violations(APP, 'export const x = (el: HTMLElement) => { el.innerHTML = name; };\n');

    expect(found[0]?.text).toContain('Everything that comes from a link is shown as text');
  });

  it('allows what shows text as text', async () => {
    const code = [
      'export const show = (el: HTMLElement, name: string) => {',
      '  el.textContent = name;',
      '  el.append(document.createTextNode(name));',
      "  el.setAttribute('title', name);",
      '};',
      '',
    ].join('\n');

    expect(await violations(APP, code)).toEqual([]);
  });

  describe('in a template', () => {
    const HTML = 'projects/app/src/app/example.html';

    it.each([
      ['a binding to innerHTML', '<div [innerHTML]="name"></div>'],
      ['a binding to innerHtml, which is the same property', '<div [innerHtml]="name"></div>'],
      ['a binding to innerHTML with bind-', '<div bind-innerHTML="name"></div>'],
      ['an interpolation into innerHTML', '<div innerHTML="{{ name }}"></div>'],
      ['a static innerHTML', '<div innerHTML="<b>x</b>"></div>'],
    ])('refuses %s', async (_description, template) => {
      const found = await violations(HTML, `${template}\n`);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ rule: 'no-restricted-syntax' });
      expect(found[0]?.text).toMatch(/Do not bind `innerHTML`\. Everything that comes from a link is shown as text/);
    });

    it('refuses a binding to outerHTML', async () => {
      const found = await violations(HTML, '<div [outerHTML]="name"></div>\n');

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ rule: '@angular-eslint/template/no-outerhtml' });
    });

    it('refuses innerHTML in the template of a component', async () => {
      const code = [
        "import { Component } from '@angular/core';",
        '@Component({ selector: "rmq-example", template: `<div [innerHTML]="name"></div>` })',
        'export class Example {',
        "  name = 'x';",
        '}',
        '',
      ].join('\n');

      const found = await violations(APP, code);

      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ rule: 'no-restricted-syntax' });
    });

    it('allows text in every way that a template shows it', async () => {
      const template = [
        '<p>{{ name }}</p>',
        '<p [textContent]="name"></p>',
        '<p [attr.title]="name" [title]="name"></p>',
        '<input [value]="name" [attr.aria-label]="name" />',
        '',
      ].join('\n');

      expect(await violations(HTML, template)).toEqual([]);
    });
  });
});

describe('test hygiene (ADR-0015)', () => {
  const specs = [
    'projects/engine/src/lib/example.spec.ts',
    'projects/app/src/app/example.spec.ts',
    'projects/app/src/app/canvas/flow/example.spec.ts',
    'tools/example.spec.ts',
  ];

  describe.each(specs)('%s', (file) => {
    it.each(['describe.only', 'it.only', 'test.only', 'it.skip', 'describe.skip', 'test.skip'])(
      'refuses %s',
      async (call) => {
        const found = await violations(file, `${call}('x', () => {});\n`);

        expect(found).toHaveLength(1);
        expect(found[0]?.rule).toBe('no-restricted-syntax');
      },
    );

    it.each(['xit', 'xtest', 'xdescribe', 'fit', 'fdescribe'])('refuses %s', async (call) => {
      expect(await violations(file, `${call}('x', () => {});\n`)).toHaveLength(1);
    });

    it('allows conditional skips that state their condition, and ordinary tests', async () => {
      const code = "it.skipIf(false)('x', () => {});\ndescribe.runIf(true)('y', () => {});\nit('z', () => {});\n";

      expect(await violations(file, code)).toEqual([]);
    });
  });

  it('refuses .only in end-to-end specs', async () => {
    expect(await violations('e2e/example.spec.ts', "test.only('x', async () => {});\n")).toHaveLength(1);
  });
});
