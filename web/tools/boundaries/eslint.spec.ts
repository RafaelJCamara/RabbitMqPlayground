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
]);

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({ cwd: webRoot, overrideConfigFile: `${webRoot}eslint.config.mjs` });
});

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
