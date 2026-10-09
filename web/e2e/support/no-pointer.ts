import type { Page } from '@playwright/test';

/**
 * A page that cannot be used with a pointer (ADR-0085): for the length of a journey of the keyboard alone, every call that presses, moves, hovers, taps or drags throws, so that a test that reaches for
 * the pointer fails instead of passing. It patches the methods of the page, of its locators, of its mouse and of its touch screen, which are shared by every page of the process, so it is given back
 * when the journey ends (`finally`), and a test that runs after it finds them as they were.
 */

/** What a locator does with a pointer, and what the keyboard does not. */
const LOCATOR_POINTER = [
  'click',
  'dblclick',
  'hover',
  'tap',
  'dragTo',
  'check',
  'uncheck',
  'setChecked',
  'dispatchEvent',
] as const;
const PAGE_POINTER = [
  'click',
  'dblclick',
  'hover',
  'tap',
  'dragAndDrop',
  'check',
  'uncheck',
  'setChecked',
  'dispatchEvent',
] as const;
const MOUSE_POINTER = ['move', 'down', 'up', 'click', 'dblclick', 'wheel'] as const;
const TOUCH_POINTER = ['tap'] as const;

type Methods = Record<string, unknown>;

/** Makes the page refuse the pointer, and answers the function that gives it back. */
export function withoutPointer(page: Page): () => void {
  const patched: { readonly target: Methods; readonly name: string; readonly original: unknown }[] = [];
  const refuse = (target: object, names: readonly string[], owner: string): void => {
    for (const name of names) {
      const methods = target as Methods;
      patched.push({ target: methods, name, original: methods[name] });
      methods[name] = () => {
        throw new Error(`The keyboard-only journey reached for the pointer: ${owner}.${name}() was called`);
      };
    }
  };
  refuse(Object.getPrototypeOf(page.locator('html')) as object, LOCATOR_POINTER, 'locator');
  refuse(Object.getPrototypeOf(page) as object, PAGE_POINTER, 'page');
  refuse(Object.getPrototypeOf(page.mouse) as object, MOUSE_POINTER, 'page.mouse');
  refuse(Object.getPrototypeOf(page.touchscreen) as object, TOUCH_POINTER, 'page.touchscreen');
  return () => {
    for (const { target, name, original } of patched.reverse()) {
      target[name] = original;
    }
  };
}

/** The names of what a page refuses while it is without a pointer, for the test of the guard. */
export const REFUSED = {
  locator: LOCATOR_POINTER,
  page: PAGE_POINTER,
  mouse: MOUSE_POINTER,
  touchscreen: TOUCH_POINTER,
} as const;
