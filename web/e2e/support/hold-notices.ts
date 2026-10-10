import type { Page } from '@playwright/test';

/**
 * Makes the notices wait ten minutes instead of 5 seconds (ADR-0099), so that a test that makes three of them and then looks at the page, runs axe on it or crosses it with Tab does not lose them to the
 * time. Only the `e2e` build reads this. Call it before the page is opened. A test of the 5 seconds themselves moves the clock by hand and does not call it.
 */
export async function holdNotices(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __rmqToastMs: number }).__rmqToastMs = 600_000;
  });
}
