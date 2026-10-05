import { DOCUMENT, inject, Injectable, InjectionToken } from '@angular/core';
import { type FlagName, type FlagSources, readFlagSources, resolveFlags } from './flags';

/** Where flags are read from. The default reads the real window; tests provide their own. */
export const FLAG_SOURCES = new InjectionToken<FlagSources>('FLAG_SOURCES', {
  providedIn: 'root',
  factory: () => readFlagSources(inject(DOCUMENT).defaultView),
});

/** The flags for this page load. They are read once and never change while the page is open. */
@Injectable({ providedIn: 'root' })
export class FeatureFlags {
  private readonly resolved = resolveFlags(inject(FLAG_SOURCES));

  /** The flags that are on. Treat it as a set: the order is not meaningful. */
  readonly enabled: readonly FlagName[] = [...this.resolved.enabled];

  constructor() {
    if (this.resolved.unknown.length > 0) {
      console.warn(`Unknown feature flag(s) ignored: ${this.resolved.unknown.join(', ')}`);
    }
  }

  isEnabled(flag: FlagName): boolean {
    return this.resolved.enabled.has(flag);
  }
}
