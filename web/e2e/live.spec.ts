import { AppPage } from './pages/app-page';
import { expect, test } from './support/test';

/**
 * The post-deploy smoke test. It runs against the real site (`LIVE_URL`) right after a deploy.
 *
 * GitHub Pages' CDN can keep serving the previous deploy for a few minutes, so the first test waits until the site
 * reports the commit that was just built (`EXPECTED_COMMIT`), instead of checking an old page and calling it good.
 */
test.describe('the deployed site', () => {
  test('is the build of the commit that was just pushed', async ({ request }) => {
    const expected = process.env['EXPECTED_COMMIT'];
    if (!expected) {
      throw new Error('EXPECTED_COMMIT is required for the live smoke test');
    }

    await expect
      .poll(
        async () => {
          const response = await request.get(`build-info.json?cache-bust=${Date.now()}`);
          return response.ok() ? ((await response.json()) as { commit: string }).commit : `HTTP ${response.status()}`;
        },
        { message: 'waiting for GitHub Pages to serve the new build', timeout: 5 * 60_000, intervals: [5_000] },
      )
      .toBe(expected);
  });

  test('starts, titled and headed with the product name, and without the debug handle', async ({ page }) => {
    const app = new AppPage(page);
    const response = await app.goto();

    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle((await app.heading.textContent()) ?? 'missing heading');
    expect(await page.evaluate(() => '__rmq' in window)).toBe(false);
  });

  test('loads a deep link through 404.html', async ({ page }) => {
    const app = new AppPage(page);
    const response = await app.goto('some/deep/link');

    expect(response?.status()).toBe(404);
    await expect(app.heading).toBeVisible();
  });
});
