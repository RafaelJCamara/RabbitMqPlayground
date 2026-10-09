import { withoutPointer } from './no-pointer';
import { expect, test } from './test';

/**
 * The page that cannot be used with a pointer (ADR-0085) is held by this test, since a journey that passes with a guard that guards nothing is a journey of the pointer: every call that presses, moves,
 * hovers, taps or drags throws, the keys and the other calls work, and when it is given back the pointer works again.
 */

const PAGE = 'data:text/html,<button id="b" onclick="document.title=\'pressed\'">Press</button><input id="f">';

/**
 * What the guard has to refuse, written out here. The names are not read from the lists that the guard is made of: a test that loops over the list that it guards cannot notice a name that is taken out of it
 * (the hand sweep of S12 took `click`, `down` and `tap` out and every one of them passed).
 */
const MUST_REFUSE = {
  locator: ['click', 'dblclick', 'hover', 'tap', 'dragTo', 'check', 'uncheck', 'setChecked', 'dispatchEvent'],
  page: ['click', 'dblclick', 'hover', 'tap', 'dragAndDrop', 'check', 'uncheck', 'setChecked', 'dispatchEvent'],
  mouse: ['move', 'down', 'up', 'click', 'dblclick', 'wheel'],
  touchscreen: ['tap'],
} as const;

test.describe('the page without a pointer (ADR-0085)', () => {
  test('refuses every call that presses, moves, hovers, taps or drags, on the page, its locators, its mouse and its touch screen', async ({
    page,
  }) => {
    await page.goto(PAGE);
    const release = withoutPointer(page);
    try {
      for (const name of MUST_REFUSE.locator) {
        const call = (page.locator('#b') as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!;
        expect(
          () => call.call(page.locator('#b'), ...(name === 'dragTo' ? [page.locator('#f')] : [])),
          `locator.${name}`,
        ).toThrow(/reached for the pointer/);
      }
      for (const name of MUST_REFUSE.page) {
        const call = (page as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!;
        expect(() => call.call(page, '#b', '#f'), `page.${name}`).toThrow(/reached for the pointer/);
      }
      for (const name of MUST_REFUSE.mouse) {
        const call = (page.mouse as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!;
        expect(() => call.call(page.mouse, 1, 1), `mouse.${name}`).toThrow(/reached for the pointer/);
      }
      for (const name of MUST_REFUSE.touchscreen) {
        const call = (page.touchscreen as unknown as Record<string, (...args: unknown[]) => unknown>)[name]!;
        expect(() => call.call(page.touchscreen, 1, 1), `touchscreen.${name}`).toThrow(/reached for the pointer/);
      }
    } finally {
      release();
    }
  });

  test('leaves the keys and the other calls alone: a field is typed in, a button is pressed with Enter, and the page is read', async ({
    page,
  }) => {
    await page.goto(PAGE);
    const release = withoutPointer(page);
    try {
      await page.locator('#f').focus();
      await page.keyboard.type('keys only');
      await page.locator('#b').focus();
      await page.keyboard.press('Enter');

      await expect(page.locator('#f')).toHaveValue('keys only');
      await expect(page).toHaveTitle('pressed');
    } finally {
      release();
    }
  });

  test('gives the pointer back when it is released, so that a test after the journey finds the page as it was', async ({
    page,
  }) => {
    await page.goto(PAGE);

    withoutPointer(page)();

    await page.locator('#b').click();
    await expect(page).toHaveTitle('pressed');
  });
});
