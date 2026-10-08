import type { Page } from '@playwright/test';
import { OnboardingPage } from './pages/onboarding-page';
import { expectNoAxeViolations } from './support/axe';
import { expect, test } from './support/test';

/**
 * Accessibility of what S11 puts on the screen, in the light theme and in the dark one: axe, with every rule for WCAG 2.0 to 2.2 at A and AA and the best practices, in each new state. A state
 * is the question at the first run, the question from the home, a template that was opened (with the notice that says what to try), and the tour at its first step and at the step that lists the
 * five ways to link.
 */

const usesTheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
  expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
};

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of the first run in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('the question at the first run has no axe violations', async ({ page }) => {
      const onboarding = new OnboardingPage(page);

      await onboarding.firstRun();

      await usesTheme(page, colorScheme);
      await expectNoAxeViolations(page);
    });

    test('the question from the home has no axe violations', async ({ page }) => {
      const onboarding = new OnboardingPage(page);
      await onboarding.firstRun();
      await onboarding.scratch.click();
      await onboarding.canvases.editorReady();
      await onboarding.canvases.showHome();

      await onboarding.more.click();

      await expect(onboarding.dialog).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('a template that was opened, with the notice that says what to try, has no axe violations', async ({
      page,
    }) => {
      const onboarding = new OnboardingPage(page);
      await onboarding.firstRun();

      await onboarding.choose('Routing');

      await expect(onboarding.canvases.notices.getByTestId('toast-message')).toContainText('Opened “Routing”.');
      await expectNoAxeViolations(page);
    });

    test('the tour has no axe violations at its first step, nor at the step that lists the ways to link', async ({
      page,
    }) => {
      const onboarding = new OnboardingPage(page);
      await onboarding.firstRun();
      await onboarding.tour.click();
      await onboarding.canvases.editorReady();
      await expect(onboarding.progress).toHaveText('Step 1 of 6');
      await expectNoAxeViolations(page);

      await onboarding.editor.add('Producer');
      await onboarding.editor.add('Direct exchange');
      await onboarding.editor.add('Queue');
      await expect(onboarding.progress).toHaveText('Step 2 of 6');

      await expect(onboarding.ways).toHaveCount(5);
      await expectNoAxeViolations(page);
    });
  });
}
