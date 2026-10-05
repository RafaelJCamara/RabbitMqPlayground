import { DOCUMENT, type EnvironmentProviders, inject, provideEnvironmentInitializer } from '@angular/core';
import { APP_NAME } from '../app-info';
import { FeatureFlags } from '../flags/feature-flags';
import type { FlagName } from '../flags/flags';

/**
 * What `window.__rmq` offers to end-to-end tests. It only reads: nothing here changes the app. Later slices add the
 * document, the engine's view and the drawn edges.
 */
export interface RmqDebugHandle {
  readonly app: string;
  /** The feature flags that are on. */
  readonly flags: () => readonly FlagName[];
}

declare global {
  interface Window {
    /** Present only in the `e2e` build. See `provideDebugHandle`. */
    readonly __rmq?: RmqDebugHandle;
  }
}

export function createDebugHandle(flags: FeatureFlags): RmqDebugHandle {
  return Object.freeze({ app: APP_NAME, flags: () => [...flags.enabled] });
}

/** Defines `__rmq` as a property that cannot be reassigned, redefined or listed. A second call changes nothing. */
export function installDebugHandle(target: object, handle: RmqDebugHandle): void {
  if (Object.hasOwn(target, '__rmq')) {
    return;
  }
  Object.defineProperty(target, '__rmq', { value: handle, writable: false, configurable: false, enumerable: false });
}

/**
 * Installs the handle when the app starts. app.config.ts only adds this provider when `RMQ_E2E` is true, which is set
 * by the `e2e` build configuration. In every other build the condition is a constant `false`, so this code and the
 * property are not in the bundle at all.
 */
export function provideDebugHandle(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const win = inject(DOCUMENT).defaultView;
    if (win) {
      installDebugHandle(win, createDebugHandle(inject(FeatureFlags)));
    }
  });
}
