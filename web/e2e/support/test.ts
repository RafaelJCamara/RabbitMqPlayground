import { expect, test as base } from '@playwright/test';

/**
 * `test` with a check that runs after every test: the page must not have thrown, logged a console error, or failed to
 * load a script, style or other file.
 *
 * A navigation that answers 404 is allowed, because a deep link's document is a 404 on GitHub Pages on purpose, and
 * the browser logs "Failed to load resource" for it. Only that one console message is excused: a failing asset on the
 * same page is still a problem.
 */
export const test = base.extend<{ problems: string[] }>({
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
