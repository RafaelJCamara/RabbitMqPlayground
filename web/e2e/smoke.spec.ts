import { AppPage } from './pages/app-page';
import { expectNoAxeViolations } from './support/axe';
import { expect, test } from './support/test';

test.describe('journey 1: smoke and axe at the base path', () => {
  test('opens under the base path, titled and headed with the product name', async ({ page }) => {
    const app = new AppPage(page);
    const response = await app.goto();

    expect(response?.status()).toBe(200);
    expect(new URL(page.url()).pathname).toBe('/RabbitMqPlayground/');
    await expect(page.locator('base')).toHaveAttribute('href', '/RabbitMqPlayground/');
    await expect(page).toHaveTitle((await app.heading.textContent()) ?? 'missing heading');
  });

  test('says it is not affiliated with Broadcom or the RabbitMQ project', async ({ page }) => {
    await new AppPage(page).goto();

    await expect(page.getByText('Not affiliated with, endorsed by or sponsored by Broadcom Inc.')).toBeVisible();
  });

  test('loads a deep link through 404.html, as GitHub Pages does, with its assets found', async ({ page }) => {
    const app = new AppPage(page);
    const response = await app.goto('some/deep/link');

    expect(response?.status()).toBe(404); // Pages answers 404 with the 404.html page; the app still starts
    await expect(app.heading).toBeVisible();
  });

  test('has no horizontal scrolling at 320 px wide, so text reflows (WCAG 1.4.10)', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await new AppPage(page).goto();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('the debug handle in the e2e build', () => {
  test('is a read-only property that is not listed', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    const descriptor = await page.evaluate(() => {
      const { writable, configurable, enumerable } = Object.getOwnPropertyDescriptor(window, '__rmq') ?? {};
      return { writable, configurable, enumerable, app: window.__rmq?.app };
    });

    expect(descriptor).toEqual({
      writable: false,
      configurable: false,
      enumerable: false,
      app: await app.heading.textContent(),
    });
  });
});

test.describe('feature flags', () => {
  test('are all off by default', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto();

    expect(await app.flags()).toEqual([]);
  });

  test('can be turned on with ?ff=', async ({ page }) => {
    const app = new AppPage(page);
    await app.goto('?ff=editor,simulation');

    expect(await app.flags()).toEqual(['editor', 'simulation']);
  });

  test('can be turned on in local storage, and add up with ?ff=', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('rmq.flags', 'headers'));
    const app = new AppPage(page);
    await app.goto('?ff=explain');

    expect(await app.flags()).toEqual(['explain', 'headers']);
  });

  test('ignore a name they do not know, and say so in the console', async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (message) => message.type() === 'warning' && warnings.push(message.text()));
    const app = new AppPage(page);
    await app.goto('?ff=edtior');

    expect(await app.flags()).toEqual([]);
    expect(warnings).toContain('Unknown feature flag(s) ignored: edtior');
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('has no axe violations', async ({ page }) => {
      await new AppPage(page).goto();

      await expectNoAxeViolations(page);
    });

    test('really uses the theme it is tested in', async ({ page }) => {
      await new AppPage(page).goto();

      const background = await page.evaluate(
        () => getComputedStyle(document.querySelector('rmq-root > div')!).backgroundColor,
      );
      expect(background).toBe(colorScheme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(11, 16, 32)');
    });
  });
}

test.describe('the theme can also be chosen on the page, which the theme switch will use', () => {
  test.use({ colorScheme: 'light' });

  test('data-theme="dark" wins over a light operating system setting, with no axe violations', async ({ page }) => {
    await new AppPage(page).goto();
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    await expect(page.locator('rmq-root > div')).toHaveCSS('background-color', 'rgb(11, 16, 32)');
    await expectNoAxeViolations(page);
  });

  test.describe('and the other way round', () => {
    test.use({ colorScheme: 'dark' });

    test('data-theme="light" wins over a dark operating system setting, with no axe violations', async ({ page }) => {
      await new AppPage(page).goto();
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));

      await expect(page.locator('rmq-root > div')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
      await expectNoAxeViolations(page);
    });
  });
});
