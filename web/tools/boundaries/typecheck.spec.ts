import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * ADR-0018 keeps the engine and the domain free of browser and Node globals by giving them a narrow `lib` and no
 * `types`. These tests type-check snippets under each library's real tsconfig, so widening either setting fails here.
 */

type Library = 'engine' | 'domain' | 'persistence' | 'testing';

/** Type-checks every snippet as its own file in one program, and returns the error codes for each snippet. */
function analyse(library: Library, snippets: readonly string[]): Map<string, number[]> {
  const configPath = fileURLToPath(new URL(`../../projects/${library}/tsconfig.lib.json`, import.meta.url));
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
      },
    },
  );
  if (!parsed) {
    throw new Error(`Cannot read ${configPath}`);
  }

  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    composite: false,
    emitDeclarationOnly: false,
    incremental: false,
    declaration: false,
    tsBuildInfoFile: undefined,
  };
  const files = new Map(
    snippets.map((snippet, index) => [
      configPath.replace(/tsconfig\.lib\.json$/, `src/__snippet_${index}__.ts`),
      snippet,
    ]),
  );
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (name, ...rest) => {
    const text = files.get(name);
    return text === undefined ? getSourceFile.call(host, name, ...rest) : ts.createSourceFile(name, text, rest[0]);
  };
  host.fileExists = (name) => files.has(name) || fileExists.call(host, name);
  host.readFile = (name) => files.get(name) ?? readFile.call(host, name);

  const program = ts.createProgram({ rootNames: [...files.keys()], options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  return new Map(
    [...files].map(([name, snippet]) => [
      snippet,
      diagnostics.filter((diagnostic) => diagnostic.file?.fileName === name).map((diagnostic) => diagnostic.code),
    ]),
  );
}

const plain = 'export const x: number = Math.max(1, [1, 2, 3].at(-1) ?? 0);';
const browserGlobals = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'setTimeout(() => 0, 1)',
  'setInterval(() => 0, 1)',
  'requestAnimationFrame(() => 0)',
  'queueMicrotask(() => 0)',
  'performance.now()',
  'crypto.randomUUID()',
  'console.log(1)',
  'fetch("/")',
  'structuredClone(1)',
];
const nodeGlobals = ['process.env', 'Buffer.alloc(1)', 'require("fs")'];
const use = (expression: string) => `export const x = ${expression};`;

describe('library type environments', () => {
  describe.each(['engine', 'domain'] as const)('%s', (library) => {
    let results: Map<string, number[]>;
    beforeAll(() => {
      results = analyse(library, [plain, ...[...browserGlobals, ...nodeGlobals].map(use)]);
    });

    it('accepts plain ECMAScript (so the check is not failing everything)', () => {
      expect(results.get(plain)).toEqual([]);
    });

    it.each([...browserGlobals, ...nodeGlobals])('cannot use `%s`', (expression) => {
      expect(results.get(use(expression))?.length).toBeGreaterThan(0);
    });
  });

  describe('persistence', () => {
    it('can use browser globals, because it talks to IndexedDB, but not Node globals', () => {
      const results = analyse('persistence', [plain, use('window.indexedDB'), use('process.env')]);

      expect(results.get(plain)).toEqual([]);
      expect(results.get(use('window.indexedDB'))).toEqual([]);
      expect(results.get(use('process.env'))?.length).toBeGreaterThan(0);
    });
  });

  describe('testing', () => {
    it('can read the environment, but cannot touch the DOM', () => {
      const results = analyse('testing', [plain, use('process.env'), use('window')]);

      expect(results.get(plain)).toEqual([]);
      expect(results.get(use('process.env'))).toEqual([]);
      expect(results.get(use('window'))?.length).toBeGreaterThan(0);
    });
  });
});
