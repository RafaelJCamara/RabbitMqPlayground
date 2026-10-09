import type { Page } from '@playwright/test';
import { OnboardingPage } from './pages/onboarding-page';
import { expectNoAxeViolations } from './support/axe';
import { expect, test } from './support/test';

/**
 * Accessibility of what S11 puts on the screen, in the light theme and in the dark one: axe, with every rule for WCAG 2.0 to 2.2 at A and AA and the best practices, in each new state. A state
 * is the question at the first run, the question from the home, a template that was opened (with the notice that says what to try), the page while a link is unpacked, and the tour at its first step, at the step that lists the
 * five ways to link, with a step done that waits for Next, and at each step to the last.
 *
 * Every state here is a row of docs/accessibility.md (ADR-0085), and a state without a row fails tools/accessibility/accessibility.spec.ts.
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

    test('the page while it unpacks the canvas of a link has no axe violations', async ({ page }) => {
      // A decompressor that never ends, so that the page stays as it is while the link is being unpacked.
      await page.addInitScript(() => {
        class NeverEnding {
          readonly readable: ReadableStream<Uint8Array>;
          readonly writable: WritableStream<Uint8Array>;
          constructor() {
            const stream = new TransformStream<Uint8Array, Uint8Array>({
              flush: () => new Promise<void>(() => undefined),
            });
            this.readable = stream.readable;
            this.writable = stream.writable;
          }
        }
        Object.defineProperty(window, 'DecompressionStream', { configurable: true, value: NeverEnding });
      });

      await page.goto('#c=v1.AAAA');

      await expect(page.getByTestId('opening-link')).toBeVisible();
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

    test('the tour has no axe violations with a step that is done and waits to be moved on, and at each step after the one that lists the ways to link, to the last', async ({
      page,
    }) => {
      const onboarding = new OnboardingPage(page);
      await onboarding.firstRun();
      await onboarding.tour.click();
      await onboarding.canvases.editorReady();
      await onboarding.editor.add('Producer');
      await onboarding.editor.add('Direct exchange');
      await onboarding.editor.add('Queue');
      await expect(onboarding.progress).toHaveText('Step 2 of 6');

      // A step that is done when the tour goes back to it waits to be moved on: it says so, and its main button is Next (ADR-0083).
      await onboarding.back.click();
      await expect(onboarding.progress).toHaveText('Step 1 of 6');
      await expect(onboarding.done).toHaveText('Done.');
      await expect(onboarding.next).toHaveText('Next');
      await expectNoAxeViolations(page);

      // The steps that follow are skipped, so that the tour is seen at each of them without the canvas being made to answer it.
      await onboarding.next.click();
      await expect(onboarding.progress).toHaveText('Step 2 of 6');
      for (const step of [3, 4, 5]) {
        await onboarding.next.click();
        await expect(onboarding.progress).toHaveText(`Step ${step} of 6`);
        await expect(onboarding.back).toBeVisible();
        await expectNoAxeViolations(page);
      }
      await onboarding.next.click();
      await expect(onboarding.progress).toHaveText('Step 6 of 6');
      await expect(onboarding.finish).toBeVisible();
      await expectNoAxeViolations(page);
    });
  });
}
