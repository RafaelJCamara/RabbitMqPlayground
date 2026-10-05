import { defineConfig } from 'vitest/config';
import { rmqAliases } from './tools/config/aliases.ts';

/**
 * `npm run test:conformance`: the live run against a real RabbitMQ (tools/conformance/baseline.conformance.ts).
 * It is not part of the normal test run, because it needs Docker.
 */
export default defineConfig({
  resolve: { alias: rmqAliases() },
  test: {
    environment: 'node',
    include: ['tools/conformance/**/*.conformance.ts'],
    globalSetup: ['tools/conformance/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
