import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Runs axe-core with every WCAG 2.0 to 2.2 A and AA rule, plus its best-practice rules, and fails on any violation.
 * ADR-0015 only requires "no serious or critical" violations; a screen this small can do better.
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();

  expect(
    results.violations.map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.map((n) => n.target),
    })),
    'axe violations',
  ).toEqual([]);
  expect(results.passes.length, 'axe actually ran its rules').toBeGreaterThan(10);
}
