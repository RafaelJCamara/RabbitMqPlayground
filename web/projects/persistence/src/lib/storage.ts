/** The IndexedDB database that holds the user's canvases (ADR-0012). */
export const DB_NAME = 'rmq-playground';

/**
 * The database schema version. Raising it needs an `upgrade` step and a migration test for every earlier version
 * (ADR-0015).
 */
export const DB_VERSION = 1;

/** The object stores in the database. */
export const STORES = {
  /** One record per canvas, including soft-deleted ones that an Undo toast can still bring back. */
  canvases: 'canvases',
  /** Small key-value records: the last-open canvas, the backup reminder, and similar. */
  meta: 'meta',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];
