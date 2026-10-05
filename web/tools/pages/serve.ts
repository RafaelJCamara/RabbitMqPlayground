import { startPagesServer } from './static-server';

/**
 * Serves a build the way GitHub Pages will. Used by Playwright's `webServer` (see playwright.config.ts).
 *
 *   DIST_DIR   the built site, default `dist/app-e2e/browser`
 *   BASE_PATH  default `/RabbitMqPlayground/`
 *   PORT       default 4173
 */
const server = await startPagesServer({
  root: process.env['DIST_DIR'] ?? 'dist/app-e2e/browser',
  basePath: process.env['BASE_PATH'] ?? '/RabbitMqPlayground/',
  port: Number(process.env['PORT'] ?? 4173),
});

console.log(`Serving ${process.env['DIST_DIR'] ?? 'dist/app-e2e/browser'} at ${server.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().finally(() => process.exit(0));
  });
}
