import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { rmqAliases } from './aliases';

const projectsDir = new URL('../../projects/', import.meta.url);

describe('rmqAliases', () => {
  const aliases = rmqAliases();

  it('points every alias at an entry point that exists', () => {
    for (const [alias, file] of Object.entries(aliases)) {
      expect(existsSync(file), `${alias} -> ${file}`).toBe(true);
    }
  });

  it('has an alias for every library and none for the app', () => {
    const libraries = readdirSync(fileURLToPath(projectsDir), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== 'app')
      .map((entry) => `@rmq/${entry.name}`)
      .sort();

    expect(Object.keys(aliases).sort()).toEqual(libraries);
  });

  it('exposes each library only through its src/index.ts entry point', () => {
    for (const [alias, file] of Object.entries(aliases)) {
      // `fileURLToPath` gives backslashes on Windows.
      expect(file.replaceAll('\\', '/').endsWith(`/projects/${alias.slice('@rmq/'.length)}/src/index.ts`), alias).toBe(
        true,
      );
    }
  });
});
