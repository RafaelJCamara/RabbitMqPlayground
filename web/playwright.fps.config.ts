import { defineConfig } from '@playwright/test';

/**
 * The frame-rate tool (docs/performance.md): one spec, e2e/fps.spec.ts, run by hand on a real machine and never by CI or by `npm run test:e2e`.
 *
 *   npm run build:e2e && npx playwright test --config playwright.fps.config.ts
 *
 * It opens a visible window, because a headless browser has no display to draw to and so no frame rate that means anything. The window is the machine's own, not a phone or
 * a desktop that Playwright made up: no `devices` preset (it fakes the pixel ratio and the screen) and no viewport (`null` is the size of the window). Keep it in front and leave
 * the machine alone while it runs.
 */
const port = Number(process.env['E2E_PORT'] ?? 4173);
const localUrl = `http://127.0.0.1:${port}/RabbitMqPlayground/`;
const inCi = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/fps.spec.ts',
  workers: 1, // one window at a time: two would share the processor and the display
  retries: 0,
  timeout: 300_000,
  reporter: [['list']],
  use: {
    baseURL: localUrl,
    headless: false,
    viewport: null,
    launchOptions: {
      executablePath: process.env['PW_CHROMIUM_PATH'] || undefined,
      args: [
        '--window-size=1440,900',
        // A window that another one covers must go on drawing, or its frames are those of nothing.
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-features=CalculateNativeWinOcclusion',
      ],
    },
  },
  webServer: {
    command: 'npx tsx tools/pages/serve.ts',
    url: localUrl,
    reuseExistingServer: !inCi,
    env: { PORT: String(port), DIST_DIR: process.env['DIST_DIR'] ?? 'dist/app-e2e/browser' },
    stdout: 'pipe',
    timeout: 30_000,
  },
});
