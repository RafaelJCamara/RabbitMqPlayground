/**
 * What each file says it is, and which version of its envelope this app writes and reads up to (ADR-0027). These are not the
 * schema version of the documents inside: an envelope changes when what is around a canvas changes.
 */

/** The file of one canvas. */
export const CANVAS_FILE_FORMAT = 'rmq-playground/canvas';
export const CANVAS_FILE_VERSION = 1;

/** The backup of many canvases. */
export const BACKUP_FORMAT = 'rmq-playground/backup';
export const BACKUP_VERSION = 1;
