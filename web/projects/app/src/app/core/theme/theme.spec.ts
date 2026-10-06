import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeService } from './theme-service';
import {
  applyTheme,
  parseTheme,
  readStoredTheme,
  THEME_LABEL,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  writeStoredTheme,
} from './theme';

const memoryStorage = (initial: Record<string, string> = {}) => {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
    items,
  };
};

describe('parseTheme', () => {
  it('knows light and dark, and takes anything else to be the system', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
    for (const other of [null, undefined, '', 'Dark', 'blue', 3, {}]) {
      expect(parseTheme(other)).toBe('system');
    }
  });

  it('has a name on screen for each of the three choices', () => {
    expect(THEME_PREFERENCES.map((choice) => THEME_LABEL[choice])).toEqual(['System', 'Light', 'Dark']);
  });
});

describe('readStoredTheme and writeStoredTheme', () => {
  it('give back what was kept, and the system for a visitor who never chose', () => {
    const storage = memoryStorage();

    expect(readStoredTheme(storage)).toBe('system');
    writeStoredTheme(storage, 'dark');
    expect(storage.items.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readStoredTheme(storage)).toBe('dark');
    writeStoredTheme(storage, 'light');
    expect(readStoredTheme(storage)).toBe('light');
  });

  it('forget the key for the system, so that it is as if nothing was ever chosen', () => {
    const storage = memoryStorage({ [THEME_STORAGE_KEY]: 'dark' });

    writeStoredTheme(storage, 'system');

    expect(storage.items.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it('read a value that is not a theme as the system', () => {
    expect(readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBe('system');
  });

  it('do not mind storage that is missing, or that throws when it is touched', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };

    expect(readStoredTheme(null)).toBe('system');
    expect(readStoredTheme(throwing)).toBe('system');
    expect(() => writeStoredTheme(null, 'dark')).not.toThrow();
    expect(() => writeStoredTheme(throwing, 'dark')).not.toThrow();
    expect(() => writeStoredTheme(throwing, 'system')).not.toThrow();
  });
});

describe('applyTheme', () => {
  it('sets data-theme for light and dark, and takes it off for the system, so that the operating system decides', () => {
    const root = document.createElement('html');

    applyTheme(root, 'dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme(root, 'light');
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme(root, 'system');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('ThemeService', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('starts as the system, with no data-theme, for a visitor who never chose', () => {
    const theme = TestBed.inject(ThemeService);

    expect(theme.preference()).toBe('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('applies the choice that was kept, when the app starts', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    const theme = TestBed.inject(ThemeService);

    expect(theme.preference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies and keeps a new choice, and forgets it again for the system', () => {
    const theme = TestBed.inject(ThemeService);

    theme.set('light');
    expect(theme.preference()).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

    theme.set('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it('still works, for as long as the page is open, when the browser will not keep the choice', () => {
    const page = TestBed.inject(DOCUMENT);
    vi.spyOn(page.defaultView as Window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('blocked');
    });
    TestBed.resetTestingModule();

    const theme = TestBed.inject(ThemeService);
    theme.set('dark');

    expect(theme.preference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    vi.restoreAllMocks();
  });
});
