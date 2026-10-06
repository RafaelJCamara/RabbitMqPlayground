import { expect, test as base } from '@playwright/test';

/**
 * `test` with a check that runs after every test: the page must not have thrown, logged a console error, or failed to
 * load a script, style or other file.
 *
 * A navigation that answers 404 is allowed, because a deep link's document is a 404 on GitHub Pages on purpose, and
 * the browser logs "Failed to load resource" for it. Only that one console message is excused: a failing asset on the
 * same page is still a problem.
 */
export const test = base.extend<{ problems: string[]; keepsCanvases: void; slowCpu: void }>({
  /**
   * `E2E_CPU_SLOWDOWN=4 npm run test:e2e` runs every page on a processor that is four times slower, which is what a runner of CI is like next to a developer's machine, and what
   * shows a test that measures or types before the page is ready: it passed at once on the machine that it was written on. Left out, nothing is slowed.
   */
  slowCpu: [
    async ({ page }, use) => {
      const rate = Number(process.env['E2E_CPU_SLOWDOWN'] ?? '1');
      if (rate > 1) {
        const session = await page.context().newCDPSession(page);
        await session.send('Emulation.setCPUThrottlingRate', { rate });
      }
      await use();
    },
    { auto: true },
  ],
  /**
   * The browser of a test is promised to keep the canvases. Left to itself, headless Chromium would not promise, and the app says so in a note under the canvas that
   * appears about 300 ms after the first change and makes the canvas smaller by its height, so a position that a test measures a moment after an add is not where it
   * is a moment later. The promise is given to the prototype, so that a test that makes its own (the ones about that note, in storage.spec.ts) still wins.
   */
  keepsCanvases: [
    async ({ context }, use) => {
      await context.addInitScript(() => {
        // The first document of a page is not a secure context, where there is no storage manager.
        if (typeof StorageManager !== 'undefined') {
          StorageManager.prototype.persist = async () => true;
        }
      });
      await use();
    },
    { auto: true },
  ],
  problems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      const consoleErrors: { text: string; url: string }[] = [];
      const failedNavigations = new Set<string>();

      page.on('pageerror', (error) => problems.push(`uncaught error: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') {
          consoleErrors.push({ text: message.text(), url: message.location().url });
        }
      });
      page.on('response', (response) => {
        if (response.status() < 400) {
          return;
        }
        if (response.request().isNavigationRequest()) {
          failedNavigations.add(response.url());
        } else {
          problems.push(`${response.status()} for ${response.url()}`);
        }
      });
      page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));

      await use(problems);

      for (const { text, url } of consoleErrors) {
        const isTheIntentionalNavigation404 = text.startsWith('Failed to load resource') && failedNavigations.has(url);
        if (!isTheIntentionalNavigation404) {
          problems.push(`console.error: ${text}`);
        }
      }
      expect(problems, 'the page must run without errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
