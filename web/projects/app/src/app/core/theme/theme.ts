/**
 * The theme (ADR-0010, ADR-0032): light, dark, or whatever the operating system says. The choice is kept in the browser's own
 * storage, because it is a preference of the person at this browser and not part of any canvas, and it is applied as
 * `data-theme` on the page, which the stylesheet reads. `system` leaves the attribute off, so that the operating system decides.
 */

export type ThemePreference = 'system' | 'light' | 'dark';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

export const THEME_STORAGE_KEY = 'rmq.theme';

/** What each choice is called on a screen. */
export const THEME_LABEL: Readonly<Record<ThemePreference, string>> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** The choice that a stored text stands for. Anything that is not one of the three is "system". */
export function parseTheme(raw: unknown): ThemePreference {
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

/** The storage may be missing, or may throw when it is touched (a private window, blocked site data). Nothing here may stop the app. */
export function readStoredTheme(storage: Pick<Storage, 'getItem'> | null): ThemePreference {
  try {
    return parseTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Keeps the choice, or forgets it for `system`, which is what a visitor who never chose has. A failure is not an error to show. */
export function writeStoredTheme(
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null,
  preference: ThemePreference,
): void {
  try {
    if (preference === 'system') {
      storage?.removeItem(THEME_STORAGE_KEY);
    } else {
      storage?.setItem(THEME_STORAGE_KEY, preference);
    }
  } catch {
    // The choice still holds until the page is closed, and that is all that can be done.
  }
}

/** Puts the choice on the page: `data-theme="light"` or `"dark"`, or no attribute at all for `system`. */
export function applyTheme(
  root: Pick<HTMLElement, 'setAttribute' | 'removeAttribute'>,
  preference: ThemePreference,
): void {
  if (preference === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', preference);
  }
}
