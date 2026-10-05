import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workspaceRoot = new URL('../../', import.meta.url);

interface BaseConfig {
  compilerOptions: { paths: Record<string, string[]> };
}

/**
 * The `@rmq/*` aliases from `tsconfig.base.json`, as absolute paths for Vite and Vitest.
 * The `paths` in that file are the only place the aliases are declared (ADR-0018).
 */
export function rmqAliases(): Record<string, string> {
  const base = JSON.parse(readFileSync(new URL('tsconfig.base.json', workspaceRoot), 'utf8')) as BaseConfig;

  return Object.fromEntries(
    Object.entries(base.compilerOptions.paths).map(([alias, targets]) => [
      alias,
      fileURLToPath(new URL(targets[0] ?? '', workspaceRoot)),
    ]),
  );
}
