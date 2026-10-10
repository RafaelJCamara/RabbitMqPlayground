import { classifyStorageError, reasonOf, type StorageError } from './errors';
import { failure, succeed, type Outcome } from './outcome';

/**
 * What the browser may do to the canvases, and what the app can ask of it (ADR-0028): a promise to keep them, which it gives
 * or does not, and how much room it allows and how much of that is used. They work over a storage manager that is passed in,
 * `navigator.storage` in the app, so that a spec does not need a browser.
 */

/** The part of `navigator.storage` that this uses. Every method may be missing, because a browser may not have it. */
export interface StorageManagerLike {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

export type PersistStatus = 'already' | 'granted' | 'denied' | 'unsupported' | 'failed';

export interface PersistResult {
  readonly status: PersistStatus;
  /** What it means for the learner, and what to do. */
  readonly message: string;
}

const BACKUP = 'Export a backup now and then.';

/**
 * Asks the browser to keep the canvases when the device runs low on space, once: it does not ask if it has promised already. A
 * browser may agree, refuse, or ask the learner, and one that does not have the call, or that fails, is not an error to show
 * but a reason to say that a backup is the way to be safe. It never throws.
 */
export async function requestPersistence(manager: StorageManagerLike | undefined): Promise<PersistResult> {
  if (manager?.persist === undefined) {
    return {
      status: 'unsupported',
      message: `This browser cannot promise to keep the canvases, so it may remove them if the device runs low on space. ${BACKUP}`,
    };
  }
  try {
    if (manager.persisted !== undefined && (await manager.persisted())) {
      return {
        status: 'already',
        message:
          'The browser has promised to keep the canvases, and will not remove them when the device runs low on space.',
      };
    }
    return (await manager.persist())
      ? {
          status: 'granted',
          message:
            'The browser agreed to keep the canvases, and will not remove them when the device runs low on space.',
        }
      : {
          status: 'denied',
          message: `The browser did not promise to keep the canvases. It may remove them if the device runs low on space, and some browsers remove what a site keeps when it has not been visited for a week. ${BACKUP}`,
        };
  } catch (error) {
    return {
      status: 'failed',
      message: `The browser could not be asked to keep the canvases (${reasonOf(error)}). It may remove them if the device runs low on space. ${BACKUP}`,
    };
  }
}

/** How much room the browser allows this app, and how much it has used. */
export interface StorageUsage {
  readonly usage: number;
  readonly quota: number;
  /** `usage` over `quota`. A browser may say that it is over 1. */
  readonly fraction: number;
}

const NOT_SAID: StorageError = {
  kind: 'unavailable',
  message: 'This browser does not say how much room is left for canvases.',
};

const isAmount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Asks the browser how much room there is. A browser that does not say is an answer, and so is one that fails. */
export async function readUsage(manager: StorageManagerLike | undefined): Promise<Outcome<StorageUsage, StorageError>> {
  if (manager?.estimate === undefined) {
    return failure(NOT_SAID);
  }
  try {
    const { usage, quota } = await manager.estimate();
    return isAmount(usage) && isAmount(quota) && quota > 0
      ? succeed({ usage, quota, fraction: usage / quota })
      : failure(NOT_SAID);
  } catch (error) {
    return failure(classifyStorageError(error, 'use'));
  }
}

/** A warning is raised when this much of the room is used, and a stronger one when this much is. */
export const QUOTA_LOW_AT = 0.8;
export const QUOTA_CRITICAL_AT = 0.95;

export type QuotaLevel = 'ok' | 'low' | 'critical';

/** A warning: the room is running out, or almost gone, and what to do about it. */
export interface QuotaWarning {
  readonly level: Exclude<QuotaLevel, 'ok'>;
  readonly message: string;
}

/** There is room, and nothing is said (ADR-0100): how much the canvases take is not shown. */
export interface QuotaFine {
  readonly level: 'ok';
}

const UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** A number of bytes in the unit that suits it, with one decimal if it has one: `12 KB`, `3.4 MB`. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${UNITS[unit]}`;
}

/** Whether the room is running out, and what to say to the learner about it: a warning, or `{ level: 'ok' }` when there is room. */
export function quotaWarning({ usage, quota, fraction }: StorageUsage): QuotaWarning | QuotaFine {
  // The percent is rounded down, so that a warning at 95% is never raised by something that says 94.
  const percent = Math.min(100, Math.floor(fraction * 100 + 1e-9));
  if (fraction >= QUOTA_CRITICAL_AT) {
    return {
      level: 'critical',
      message: `The browser has almost no room left for this app (${percent}% of ${formatBytes(quota)} is used). Saving may fail. Export a backup now, and delete the canvases that you no longer need.`,
    };
  }
  if (fraction >= QUOTA_LOW_AT) {
    return {
      level: 'low',
      message: `The browser has used ${percent}% of the room that it allows this app (${formatBytes(usage)} of ${formatBytes(quota)}). Export a backup, and delete the canvases that you no longer need, before it runs out.`,
    };
  }
  return { level: 'ok' };
}
