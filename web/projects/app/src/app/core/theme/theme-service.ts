import { DOCUMENT, inject, Injectable, signal } from '@angular/core';
import { applyTheme, readStoredTheme, writeStoredTheme, type ThemePreference } from './theme';

/** The browser's storage, or `null` when it will not give it (touching `localStorage` can throw). */
function localStorageOf(page: Document): Storage | null {
  try {
    return page.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The theme of the page (ADR-0032). It is applied when the app starts, by the root, so that a learner who chose a theme never sees
 * the page in the wrong one, and it is kept when it is changed.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly page = inject(DOCUMENT);
  private readonly storage = localStorageOf(this.page);
  private readonly current = signal<ThemePreference>(readStoredTheme(this.storage));

  readonly preference = this.current.asReadonly();

  constructor() {
    applyTheme(this.page.documentElement, this.current());
  }

  set(preference: ThemePreference): void {
    this.current.set(preference);
    applyTheme(this.page.documentElement, preference);
    writeStoredTheme(this.storage, preference);
  }
}
