/**
 * The product name, kept in this one constant so it can be changed in one place (ADR-0020).
 * The static `<title>` in `index.html` must match it; a test in `tools/` checks that.
 */
export const APP_NAME = 'RabbitMQ Playground';

/** Shown wherever the app is presented. "RabbitMQ" is a trademark of Broadcom Inc. and/or its subsidiaries. */
export const APP_DISCLAIMER =
  'Not affiliated with, endorsed by or sponsored by Broadcom Inc. or the RabbitMQ project. ' +
  'RabbitMQ is a trademark of Broadcom Inc. and/or its subsidiaries.';
