import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests (ADR-0015) run against a production-optimised build, served under the GitHub Pages base path.
 *
 *   npm run build:e2e && npm run test:e2e      the `chromium` project, against dist/app-e2e/browser
 *   LIVE_URL=https://… npm run test:e2e        the `live` project: the post-deploy smoke test, against the real site
 *
 * `PW_CHROMIUM_PATH` points at an installed Chromium where `playwright install` is not available (the cloud
 * container). CI installs its own browser and leaves it unset.
 */
const port = Number(process.env['E2E_PORT'] ?? 4173);
const localUrl = `http://127.0.0.1:${port}/RabbitMqPlayground/`;
const liveUrl = process.env['LIVE_URL'];
const inCi = Boolean(process.env['CI']);

const browser = {
  ...devices['Desktop Chrome'],
  launchOptions: {
    executablePath: process.env['PW_CHROMIUM_PATH'] || undefined,
    // Without these, a headless tab that is not in front can throttle timers and make timing-based checks flaky.
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  },
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: inCi,
  retries: 0, // a flaky test is fixed, never retried (ADR-0015)
  reporter: inCi ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: liveUrl ?? localUrl,
    trace: 'retain-on-failure',
  },
  projects: liveUrl
    ? [{ name: 'live', testMatch: '**/live.spec.ts', use: browser }]
    : [{ name: 'chromium', testIgnore: '**/live.spec.ts', use: browser }],
  webServer: liveUrl
    ? undefined
    : {
        command: 'npx tsx tools/pages/serve.ts',
        url: localUrl,
        reuseExistingServer: !inCi,
        env: { PORT: String(port), DIST_DIR: process.env['DIST_DIR'] ?? 'dist/app-e2e/browser' },
        stdout: 'pipe',
        timeout: 30_000,
      },
});
