import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

/**
 * What a page is watched for: it must not have thrown, logged a console error, failed to load a script, style or other file, or broken its own content security policy (ADR-0078). The
 * list fills while the page is used, and `finish` adds what can only be known at the end.
 *
 * A navigation that answers 404 is allowed, because a deep link's document is a 404 on GitHub Pages on purpose, and the browser logs "Failed to load resource" for it. Only that one
 * console message is excused: a failing asset on the same page is still a problem.
 */
interface PageWatch {
  readonly problems: string[];
  finish(): string[];
}

async function watchPage(page: Page): Promise<PageWatch> {
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
  // The built page has a content security policy. The browser says what it refused in an event, which names the directive, and the console says it in a sentence as well.
  await page.exposeFunction('__rmqReportViolation', (text: string) =>
    problems.push(`content security policy refused: ${text}`),
  );
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __rmqReportViolation?: (text: string) => void }).__rmqReportViolation?.(
        `${event.violatedDirective}, ${event.blockedURI === '' ? 'inline code' : event.blockedURI}`,
      );
    });
  });

  return {
    problems,
    finish() {
      for (const { text, url } of consoleErrors) {
        const isTheIntentionalNavigation404 = text.startsWith('Failed to load resource') && failedNavigations.has(url);
        if (!isTheIntentionalNavigation404) {
          problems.push(`console.error: ${text}`);
        }
      }
      return problems;
    },
  };
}

/**
 * `E2E_CPU_SLOWDOWN=4 npm run test:e2e` runs every page on a processor that is four times slower, which is what a runner of CI is like next to a developer's machine, and what
 * shows a test that measures or types before the page is ready: it passed at once on the machine that it was written on. Left out, nothing is slowed.
 */
async function slowDown(page: Page): Promise<void> {
  const rate = Number(process.env['E2E_CPU_SLOWDOWN'] ?? '1');
  if (rate > 1) {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setCPUThrottlingRate', { rate });
  }
}

/**
 * The browser of a test is promised to keep the canvases. Left to itself, headless Chromium would not promise, and the app says so in a note under the canvas that
 * appears about 300 ms after the first change and makes the canvas smaller by its height, so a position that a test measures a moment after an add is not where it
 * is a moment later. The promise is given to the prototype, so that a test that makes its own (the ones about that note, in storage.spec.ts) still wins.
 */
async function promiseToKeep(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    // The first document of a page is not a secure context, where there is no storage manager.
    if (typeof StorageManager !== 'undefined') {
      StorageManager.prototype.persist = async () => true;
    }
  });
}

/**
 * `test` with a check that runs after every test: the page must run without errors (see `PageWatch`). A test that needs a second browser, such as the one of someone who is sent a link and has nothing of the
 * sender's, asks for a `visitor`: a page in a context of its own, with the same checks, and with nothing in its storage.
 */
export const test = base.extend<{
  problems: string[];
  keepsCanvases: void;
  slowCpu: void;
  visitor: (options?: { readonly colorScheme?: 'light' | 'dark' }) => Promise<Page>;
}>({
  slowCpu: [
    async ({ page }, use) => {
      await slowDown(page);
      await use();
    },
    { auto: true },
  ],
  keepsCanvases: [
    async ({ context }, use) => {
      await promiseToKeep(context);
      await use();
    },
    { auto: true },
  ],
  problems: [
    async ({ page }, use) => {
      const watch = await watchPage(page);

      await use(watch.problems);

      expect(watch.finish(), 'the page must run without errors').toEqual([]);
    },
    { auto: true },
  ],
  visitor: async ({ browser }, use, testInfo) => {
    const visits: { context: BrowserContext; watch: PageWatch }[] = [];
    await use(async (options = {}) => {
      const { baseURL, viewport, userAgent, deviceScaleFactor } = testInfo.project.use;
      const context = await browser.newContext({ baseURL, viewport, userAgent, deviceScaleFactor, ...options });
      await promiseToKeep(context);
      const page = await context.newPage();
      await slowDown(page);
      visits.push({ context, watch: await watchPage(page) });
      return page;
    });
    const found = visits.flatMap(({ watch }) => watch.finish());
    await Promise.all(visits.map(({ context }) => context.close()));
    expect(found, "a visitor's page must run without errors").toEqual([]);
  },
});

export { expect };
