import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideDebugHandle } from './core/debug/debug-handle';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // RMQ_E2E is replaced at build time (see angular.json); it is true only in the `e2e` configuration.
    ...(RMQ_E2E ? [provideDebugHandle()] : []),
  ],
};
