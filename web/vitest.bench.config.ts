import { defineConfig } from 'vitest/config';
import { rmqAliases } from './tools/config/aliases.ts';

/**
 * `npm run bench`. A benchmark file is `*.bench.ts` next to the code it measures. Every project would run every
 * benchmark file in `vitest bench`, so benchmarks have their own single-project config instead of the one in
 * vitest.config.ts.
 */
export default defineConfig({
  resolve: { alias: rmqAliases() },
  test: {
    environment: 'node',
    include: [],
    benchmark: { include: ['projects/*/src/**/*.bench.ts', 'tools/**/*.bench.ts'] },
  },
});
