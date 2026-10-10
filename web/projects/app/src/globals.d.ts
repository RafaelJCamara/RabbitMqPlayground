/**
 * Replaced at build time by the `define` option of each configuration in angular.json.
 * It is `true` only in the `e2e` configuration, so code behind it is absent from the deployed bundle.
 */
declare const RMQ_E2E: boolean;

interface Window {
  /** How long a notice waits, in milliseconds, when a browser test sets it before the app starts (e2e/support/hold-notices.ts). Read only in the `e2e` build. */
  readonly __rmqToastMs?: number;
}
