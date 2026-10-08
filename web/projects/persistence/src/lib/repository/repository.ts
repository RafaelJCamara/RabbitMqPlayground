import type { CanvasDocument } from '@rmq/domain';
import { utf8Length } from '@rmq/engine';
import {
  classifyStorageError,
  existsError,
  invalidError,
  notFound,
  StorageFailure,
  summarise,
  type LoadError,
} from '../errors';
import { SIZE_CAPS } from '../load/caps';
import { failure, succeed, type Outcome } from '../outcome';
import { readRecord, type CanvasRecord } from '../record';
import { CANVAS_ID_PATTERN } from '../shape';
import type { RecordStore, RecordTransaction, StoredRecord, TransactionMode } from './store';

/**
 * The repository of canvases (ADR-0028). Its rules are written once, here, on top of a `RecordStore`: what is valid, what a
 * tombstone is, the order of a list, what a meta value is. Nothing in it throws. A failure of the browser is an answer, and so
 * is data that cannot be read.
 */

/** How long a tombstone lives. It backs an Undo toast, and is not a bin. */
export const TOMBSTONE_TTL_MS = 60_000;

/** A canvas in storage that cannot be opened, and why. The learner can still delete it. */
export interface UnreadableCanvas {
  readonly id: string;
  /** What it was called, if the record still says. */
  readonly name?: string;
  readonly error: LoadError;
}

export interface CanvasListing {
  /** The canvases that are not deleted and can be read, the one edited last first. */
  readonly canvases: readonly CanvasRecord[];
  /** The ones that are not deleted and cannot be read, by id. */
  readonly unreadable: readonly UnreadableCanvas[];
}

export interface NewCanvas {
  readonly name: string;
  readonly document: CanvasDocument;
  /** The id to give it. Without it, one is made. */
  readonly id?: string;
}

export interface CanvasChange {
  readonly name?: string;
  readonly document?: CanvasDocument;
}

/** The small values that the repository keeps by name. */
export interface MetaValues {
  /** The canvas that was open when the app was last used, so that it opens again. */
  readonly lastOpenCanvas: string;
  /** When the learner last made a backup, for the reminder. */
  readonly lastBackupAt: number;
  /** The reminder to make a backup stays quiet until this time. */
  readonly backupReminderSnoozedUntil: number;
  /** The canvases that are open in the strip of the workspace (ADR-0072), by id, in the order of the strip. */
  readonly openCanvases: readonly string[];
}
export type MetaKey = keyof MetaValues;

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isCanvasId = (value: unknown): value is string => typeof value === 'string' && CANVAS_ID_PATTERN.test(value);

/** A list of ids that are valid, each different from the others, and no more of them than there can be canvases in a backup. */
const isIdList = (value: unknown): value is readonly string[] =>
  Array.isArray(value) &&
  value.length <= SIZE_CAPS.canvases &&
  value.every(isCanvasId) &&
  new Set<unknown>(value).size === value.length;

/** What each value has to be, for the sentence that says what is wrong with one. */
const META_WANTS: Readonly<Record<MetaKey, string>> = {
  lastOpenCanvas: 'the id of a canvas',
  lastBackupAt: 'a time, in milliseconds since 1970',
  backupReminderSnoozedUntil: 'a time, in milliseconds since 1970',
  openCanvases: 'a list of the ids of canvases, each one once',
};

const META_CHECKS: { readonly [K in MetaKey]: (value: unknown) => value is MetaValues[K] } = {
  lastOpenCanvas: isCanvasId,
  lastBackupAt: isTime,
  backupReminderSnoozedUntil: isTime,
  openCanvases: isIdList,
};

/** What the repository holds, as it can tell without opening a canvas. */
export interface RepositoryUsage {
  /** Canvases that are not deleted, readable or not. */
  readonly canvases: number;
  readonly tombstones: number;
  /** The bytes of the records as JSON. It is an estimate: what the browser keeps is not the same size. */
  readonly bytes: number;
}

export interface CanvasRepository {
  /** The canvases that are not deleted. A canvas that cannot be read is listed apart, not as an error. */
  list(): Promise<Outcome<CanvasListing>>;
  get(id: string): Promise<Outcome<CanvasRecord>>;
  /** Makes a canvas, with the time that it is now for both of its times. */
  create(canvas: NewCanvas): Promise<Outcome<CanvasRecord>>;
  /** Changes the name or the document of a canvas, and sets the time that it was edited. */
  save(id: string, change: CanvasChange): Promise<Outcome<CanvasRecord>>;
  /** Keeps a record exactly as it is, in place of the one with its id: the door for an import. */
  put(record: CanvasRecord): Promise<Outcome<CanvasRecord>>;
  /** Puts a tombstone on a canvas. It disappears from the list, and `restore` brings it back until it is purged. */
  softDelete(id: string): Promise<Outcome<void>>;
  /** Puts a tombstone on every canvas that has none, and answers their ids, for an Undo. */
  softDeleteAll(): Promise<Outcome<readonly string[]>>;
  restore(id: string): Promise<Outcome<void>>;
  /** Brings back every one of these that is still a tombstone, and answers which. */
  restoreAll(ids: readonly string[]): Promise<Outcome<readonly string[]>>;
  /** Removes the tombstones that are older than the time that they live. It answers how many. */
  purgeExpired(): Promise<Outcome<number>>;
  getMeta<K extends MetaKey>(key: K): Promise<Outcome<MetaValues[K] | undefined>>;
  setMeta<K extends MetaKey>(key: K, value: MetaValues[K]): Promise<Outcome<void>>;
  deleteMeta(key: MetaKey): Promise<Outcome<void>>;
  estimate(): Promise<Outcome<RepositoryUsage>>;
  close(): Promise<void>;
}

export interface RepositoryOptions {
  /** The time now, in milliseconds. Nothing here reads the clock. */
  readonly now: () => number;
  /** A new id for a canvas. Nothing here makes one by itself. */
  readonly newId: () => string;
  /** How long a tombstone lives. */
  readonly tombstoneTtlMs?: number;
}

/** A record that has been deleted: it has a time of deletion that is a time. A time that is not one is a record that is wrong. */
const isTombstone = (raw: StoredRecord): boolean =>
  typeof raw['deletedAt'] === 'number' && Number.isFinite(raw['deletedAt']);

/**
 * The most recently edited first. A store gives its records by id and a sort keeps the order of what is equal, so two that were
 * edited at the same time stay by id, and the order is always the same.
 */
const newestFirst = (a: CanvasRecord, b: CanvasRecord): number => b.updatedAt - a.updatedAt;

function jsonBytes(value: unknown): number {
  try {
    return utf8Length(JSON.stringify(value));
  } catch {
    // A value that JSON cannot write, which a canvas of ours never is, counts for nothing.
    return 0;
  }
}

export function createCanvasRepository(store: RecordStore, options: RepositoryOptions): CanvasRepository {
  const { now, newId, tombstoneTtlMs = TOMBSTONE_TTL_MS } = options;

  /** Runs reads and writes as one transaction, and turns what the browser throws into an answer. */
  async function guard<T>(
    mode: TransactionMode,
    work: (transaction: RecordTransaction) => Promise<Outcome<T>>,
  ): Promise<Outcome<T>> {
    try {
      return await store.transact(mode, work);
    } catch (error) {
      return failure(error instanceof StorageFailure ? error.error : classifyStorageError(error, 'use'));
    }
  }

  /** What is kept for a canvas that was written by us: the fields of the record, so that nothing else is. */
  const toStored = (record: CanvasRecord): StoredRecord => ({ ...record });

  async function restoreIn(transaction: RecordTransaction, ids: readonly string[]): Promise<string[]> {
    const restored: string[] = [];
    for (const id of ids) {
      const raw = await transaction.getRecord(id);
      if (raw !== undefined && isTombstone(raw)) {
        const { deletedAt: _deletedAt, ...live } = raw;
        await transaction.putRecord(live);
        restored.push(id);
      }
    }
    return restored;
  }

  return {
    list: () =>
      guard('readonly', async (transaction) => {
        const canvases: CanvasRecord[] = [];
        const unreadable: UnreadableCanvas[] = [];
        for (const raw of await transaction.getRecords()) {
          if (isTombstone(raw)) {
            continue;
          }
          const read = readRecord(raw, { allowDeleted: true });
          if (read.ok) {
            canvases.push(read.value);
          } else {
            const name = raw['name'];
            unreadable.push({
              id: String(raw['id']),
              ...(typeof name === 'string' ? { name } : {}),
              error: read.error,
            });
          }
        }
        return succeed({ canvases: canvases.sort(newestFirst), unreadable });
      }),

    get: (id) =>
      guard('readonly', async (transaction) => {
        const raw = await transaction.getRecord(id);
        if (raw === undefined || isTombstone(raw)) {
          return failure(notFound(id));
        }
        return readRecord(raw, { allowDeleted: true });
      }),

    create: (canvas) =>
      guard('readwrite', async (transaction) => {
        const id = canvas.id ?? newId();
        const time = now();
        const read = readRecord({ id, name: canvas.name, createdAt: time, updatedAt: time, document: canvas.document });
        if (!read.ok) {
          return read;
        }
        if ((await transaction.getRecord(id)) !== undefined) {
          return failure(existsError(id));
        }
        await transaction.putRecord(toStored(read.value));
        return read;
      }),

    save: (id, change) =>
      guard('readwrite', async (transaction) => {
        const raw = await transaction.getRecord(id);
        if (raw === undefined || isTombstone(raw)) {
          return failure(notFound(id));
        }
        const current = readRecord(raw, { allowDeleted: true });
        if (!current.ok || (change.name === undefined && change.document === undefined)) {
          return current;
        }
        const next = readRecord({
          id,
          name: change.name ?? current.value.name,
          createdAt: current.value.createdAt,
          updatedAt: now(),
          document: change.document ?? current.value.document,
        });
        if (next.ok) {
          await transaction.putRecord(toStored(next.value));
        }
        return next;
      }),

    put: (record) =>
      guard('readwrite', async (transaction) => {
        const read = readRecord(record, { allowDeleted: true });
        if (read.ok) {
          await transaction.putRecord(toStored(read.value));
        }
        return read;
      }),

    softDelete: (id) =>
      guard('readwrite', async (transaction) => {
        const raw = await transaction.getRecord(id);
        if (raw === undefined || isTombstone(raw)) {
          return failure(notFound(id));
        }
        await transaction.putRecord({ ...raw, deletedAt: now() });
        return succeed(undefined);
      }),

    softDeleteAll: () =>
      guard('readwrite', async (transaction) => {
        const time = now();
        const deleted: string[] = [];
        for (const raw of await transaction.getRecords()) {
          if (!isTombstone(raw)) {
            await transaction.putRecord({ ...raw, deletedAt: time });
            deleted.push(String(raw['id']));
          }
        }
        return succeed(deleted);
      }),

    restore: (id) =>
      guard('readwrite', async (transaction) =>
        (await restoreIn(transaction, [id])).length === 0 ? failure(notFound(id)) : succeed(undefined),
      ),

    restoreAll: (ids) => guard('readwrite', async (transaction) => succeed(await restoreIn(transaction, ids))),

    purgeExpired: () =>
      guard('readwrite', async (transaction) => {
        const cutoff = now() - tombstoneTtlMs;
        let purged = 0;
        for (const raw of await transaction.getRecords()) {
          if (isTombstone(raw) && (raw['deletedAt'] as number) <= cutoff) {
            await transaction.deleteRecord(String(raw['id']));
            purged += 1;
          }
        }
        return succeed(purged);
      }),

    getMeta: (key) =>
      guard('readonly', async (transaction) => {
        const value = await transaction.getMeta(key);
        return succeed(META_CHECKS[key](value) ? (value as never) : undefined);
      }),

    setMeta: (key, value) =>
      guard('readwrite', async (transaction) => {
        if (!META_CHECKS[key](value)) {
          const issue = {
            kind: 'invalid-value' as const,
            message: `${key}: this has to be ${META_WANTS[key]}, and it is ${summarise(value)}.`,
            path: [key],
          };
          return failure(invalidError([issue], 'This value'));
        }
        await transaction.putMeta(key, value);
        return succeed(undefined);
      }),

    deleteMeta: (key) =>
      guard('readwrite', async (transaction) => {
        await transaction.deleteMeta(key);
        return succeed(undefined);
      }),

    estimate: () =>
      guard('readonly', async (transaction) => {
        let [canvases, tombstones, bytes] = [0, 0, 0];
        for (const raw of await transaction.getRecords()) {
          if (isTombstone(raw)) {
            tombstones += 1;
          } else {
            canvases += 1;
          }
          bytes += jsonBytes(raw);
        }
        return succeed({ canvases, tombstones, bytes });
      }),

    close: () => store.close(),
  };
}
