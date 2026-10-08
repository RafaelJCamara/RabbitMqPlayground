import type { Page } from '@playwright/test';
import { canvasFromText, snapshotAfter } from '@rmq/testing';
import { EditorPage } from './pages/editor-page';
import { ExportPage, LinkFailedPage, SharedViewPage, SharePage } from './pages/share-page';
import { SimulationPage } from './pages/simulation-page';
import { expectNoAxeViolations } from './support/axe';
import { fixture, payloadFor } from './support/links';
import { ORDERS, ORDERS_COMMANDS } from './support/orders';
import { buildDocument, seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * Accessibility of what S10 puts on the screen, in the light theme and in the dark one: axe, with every rule for WCAG 2.0 to 2.2 at A and AA and the best practices, in each new state, with no rule switched off.
 * A state is the panel that makes a link (with the link made, with the choice of messages, with the choice switched off for want of messages, with a link too long to send), the dialog that exports (with what it leaves
 * out, with a virtual host that cannot be one, with nothing to export), the page that a link opens (as it is, with a notice, with the problem of a copy that could not be kept), and the page of a link that cannot be opened.
 * Then the keyboard: the cursor goes into the dialog, stays in it, and goes back to the button that opened it.
 */

const usesTheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
  expect(await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(scheme === 'dark');
};

/** The same canvas with a message of ten thousand characters of noise, which a link cannot hold in the length that chat apps keep. */
const longCanvas = () => {
  let seed = 4_321;
  const noise = Array.from({ length: 10_000 }, () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[seed % 62];
  }).join('');
  return buildDocument([
    ...ORDERS_COMMANDS,
    { type: 'set', kind: 'producer', name: 'sender', changes: { payload: noise } },
  ]);
};

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`accessibility of sharing in the ${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test.describe('the panel that makes a link', () => {
      test('has no axe violations with the link made', async ({ page }) => {
        await seedCanvas(page, ORDERS, 'Orders flow');
        await new EditorPage(page).goto('?ff=editor');
        const share = new SharePage(page);

        await share.open();
        await share.address();

        await usesTheme(page, colorScheme);
        await expectNoAxeViolations(page);
      });

      test('has no axe violations with the choice of messages, either way, and with the choice switched off', async ({
        page,
      }) => {
        const simulation = await SimulationPage.open(page, ORDERS, {
          flags: 'editor,simulation',
          theme: colorScheme,
        });
        const share = new SharePage(page);
        await share.open();
        await expect(share.noMessages).toBeVisible();
        await expectNoAxeViolations(page);
        await share.close.click();

        await simulation.editor.select('Producer sender');
        await page.keyboard.press('p');
        await simulation.step(2);
        await share.open();
        await expectNoAxeViolations(page);
        await share.withMessages.check();
        await share.address();
        await expect(share.dialog).toContainText('Whoever opens the link sees the messages');
        await expectNoAxeViolations(page);
      });

      test('has no axe violations with a link too long to send, and the file offered instead', async ({ page }) => {
        await seedCanvas(page, longCanvas(), 'A long one');
        await new EditorPage(page).goto('?ff=editor');
        const share = new SharePage(page);

        await share.open();

        await expect(share.long).toBeVisible();
        await expectNoAxeViolations(page);
      });
    });

    test.describe('the dialog that exports for a broker', () => {
      test('has no axe violations with what it leaves out listed', async ({ page }) => {
        await seedCanvas(page, canvasFromText(fixture('export/warnings.commands')), 'Warnings');
        await new EditorPage(page).goto('?ff=editor');
        const exporting = new ExportPage(page);

        await exporting.open();

        await expect(exporting.warnings.first()).toBeVisible();
        await usesTheme(page, colorScheme);
        await expectNoAxeViolations(page);
      });

      test('has no axe violations with everything in the file, and with a virtual host that cannot be one', async ({
        page,
      }) => {
        await seedCanvas(page, canvasFromText(fixture('export/orders.commands')), 'Orders');
        await new EditorPage(page).goto('?ff=editor');
        const exporting = new ExportPage(page);
        await exporting.open();
        await expect(exporting.all).toBeVisible();
        await expectNoAxeViolations(page);

        await exporting.vhost.fill('');
        await exporting.download.click();

        await expect(exporting.error).toBeVisible();
        await expectNoAxeViolations(page);
      });

      test('has no axe violations when there is nothing to put in a file', async ({ page }) => {
        await seedCanvas(page, buildDocument([{ type: 'add-producer', name: 'sender' }]), 'Nothing yet');
        await new EditorPage(page).goto('?ff=editor');
        const exporting = new ExportPage(page);

        await exporting.open();

        await expect(exporting.empty).toBeVisible();
        await expectNoAxeViolations(page);
      });
    });

    test.describe('the page that a link opens', () => {
      test('has no axe violations', async ({ visitor }) => {
        const other = await visitor({ colorScheme });
        await other.goto(`?ff=editor#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`);
        const shared = new SharedViewPage(other);

        await shared.ready();

        await usesTheme(other, colorScheme);
        await expectNoAxeViolations(other);
      });

      test('has no axe violations with the notice that the messages are left out', async ({ visitor }) => {
        const other = await visitor({ colorScheme });
        const link = await payloadFor({
          name: 'Orders flow',
          document: ORDERS,
          simulation: snapshotAfter(ORDERS, 180),
        });
        await other.goto(`?ff=editor#c=${link}`);
        const shared = new SharedViewPage(other);

        await shared.ready();

        await expect(shared.notice).toBeVisible();
        await expectNoAxeViolations(other);
      });

      test('has no axe violations with the problem of a copy that cannot be kept', async ({ visitor }) => {
        const other = await visitor({ colorScheme });
        await other.addInitScript(() => {
          Object.defineProperty(window, 'indexedDB', {
            configurable: true,
            value: {
              open() {
                throw new DOMException('The operation is insecure.', 'SecurityError');
              },
            },
          });
        });
        await other.goto(`?ff=editor#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`);
        const shared = new SharedViewPage(other);
        await shared.ready();

        await shared.saveCopy.click();

        await expect(shared.problem).toContainText('A copy could not be saved.');
        await expect(shared.problem).toContainText('A copy would be gone when this tab is closed, so none was made.');
        await expect(shared.problem).toHaveAttribute('role', 'alert');
        await expect(shared.saveCopy).toBeEnabled();
        await expectNoAxeViolations(other);
      });
    });

    test('the page of a link that cannot be opened has no axe violations', async ({ visitor }) => {
      const other = await visitor({ colorScheme });
      await other.goto('?ff=editor#c=not-a-link');
      const failed = new LinkFailedPage(other);

      await expect(failed.title).toBeVisible();

      await usesTheme(other, colorScheme);
      await expectNoAxeViolations(other);
    });
  });
}

test.describe('the keyboard', () => {
  test('goes into the panel that makes a link, stays in it however far it is tabbed, and goes back to the button that opened it', async ({
    page,
  }) => {
    await seedCanvas(page, ORDERS, 'Orders flow');
    await new EditorPage(page).goto('?ff=editor');
    const share = new SharePage(page);

    await share.button.focus();
    await page.keyboard.press('Enter');
    await share.made();

    await expect(share.canvasOnly).toBeFocused();
    for (let tab = 0; tab < 8; tab += 1) {
      await page.keyboard.press('Tab');
      expect(await share.dialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    for (let tab = 0; tab < 8; tab += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await share.dialog.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');

    await expect(share.dialog).toHaveCount(0);
    await expect(share.button).toBeFocused();
  });

  test('selects the link when the field gets the cursor, so that the keys can copy it', async ({ page }) => {
    await seedCanvas(page, ORDERS, 'Orders flow');
    await new EditorPage(page).goto('?ff=editor');
    const share = new SharePage(page);
    await share.open();
    const link = await share.address();

    await share.link.focus();

    const selected = await share.link.evaluate((field: HTMLInputElement) =>
      field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0),
    );
    expect(selected).toBe(link);
  });

  test('reaches both buttons of the page of a link, and its Leave, with the keys alone', async ({ visitor }) => {
    const other = await visitor();
    await other.goto(`?ff=editor#c=${await payloadFor({ name: 'Orders flow', document: ORDERS })}`);
    const shared = new SharedViewPage(other);
    await shared.ready();

    await shared.saveCopy.focus();
    await expect(shared.saveCopy).toBeFocused();
    await other.keyboard.press('Tab');
    await expect(shared.leave).toBeFocused();
    await other.keyboard.press('Enter');

    await new EditorPage(other).saveState.filter({ hasText: 'All changes saved' }).waitFor();
    expect(other.url()).not.toContain('#c=');
  });
});
