import { AppPage } from '../pages/app-page';
import { test } from './test';

/**
 * Proof that the check in support/test.ts has teeth. Each test misbehaves on purpose, and is marked `test.fail()`, so
 * it passes only if the check reports the problem. If the check were weakened, these would start passing for real and
 * Playwright would report them as unexpectedly passing.
 */
test.describe('the page-problems check fails a test when', () => {
  test('the page logs a console error', async ({ page }) => {
    test.fail(true, 'the check must report this');
    await new AppPage(page).goto();

    await page.evaluate(() => console.error('boom'));
  });

  test('the app reports an uncaught error', async ({ page }) => {
    test.fail(true, 'the check must report this');
    await new AppPage(page).goto();

    // The app installs Angular's global error listeners, which handle the error and log it to the console.
    const logged = page.waitForEvent('console', (message) => message.type() === 'error');
    await page.evaluate(() =>
      setTimeout(() => {
        throw new Error('late failure');
      }, 0),
    );
    await logged;
  });

  test('a script or style fails to load', async ({ page }) => {
    test.fail(true, 'the check must report this');
    await new AppPage(page).goto();

    await page.evaluate(() => fetch('missing-asset.js'));
  });
});

test.describe('the page-problems check also fails a test when', () => {
  test('the page breaks its own content security policy (ADR-0078)', async ({ page }) => {
    test.fail(true, 'the check must report this');
    await new AppPage(page).goto();

    // The listener of the check was added when the document was made, so it runs first, and what it reports is on its way to the test before this answers.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          document.addEventListener('securitypolicyviolation', () => resolve(), { once: true });
          const script = document.createElement('script');
          script.textContent = 'window.ran = true';
          document.head.append(script);
        }),
    );
  });
});
