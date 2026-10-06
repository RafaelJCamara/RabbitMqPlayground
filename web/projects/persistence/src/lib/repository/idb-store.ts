import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb';
import { classifyStorageError, StorageFailure } from '../errors';
import { DB_NAME, DB_VERSION, STORES } from '../storage';
import type { RecordStore, RecordTransaction, StoredRecord, TransactionMode } from './store';

/**
 * The store on IndexedDB, through `idb` (ADR-0028). The database has two stores: the canvases, each under its `id`, and the
 * meta values, each under its name. There are no indexes: the list is short, and is sorted in memory.
 */

interface Schema extends DBSchema {
  canvases: { key: string; value: StoredRecord };
  meta: { key: string; value: unknown };
}

export type CanvasDatabase = IDBPDatabase<Schema>;
type UpgradeTransaction = IDBPTransaction<unknown, string[], 'versionchange'>;

/**
 * One step in the structure of the database: what makes version `n + 1` of it from version `n`, as a spec of ADR-0015 checks.
 * It is about the stores and the shape of a record. It has nothing to do with `schemaVersion`, which is about a document and
 * is migrated when the document is read (ADR-0027). A step may wait for what the upgrade transaction gives, and for nothing else.
 * Its stores are not typed, because a step is about the structure that the types of today do not describe.
 */
export type UpgradeStep = (database: IDBPDatabase, transaction: UpgradeTransaction) => void | Promise<void>;

/** The steps, and the list only grows. The step at index `n` makes version `n + 1`. A spec holds it to `DB_VERSION`. */
export const STRUCTURE_STEPS: readonly UpgradeStep[] = [
  // Version 1: the canvases, and the small values.
  (database) => {
    database.createObjectStore(STORES.canvases, { keyPath: 'id' });
    database.createObjectStore(STORES.meta);
  },
];

export interface IdbStoreOptions {
  /** The name of the database. It is `DB_NAME`, and a spec gives it another so that two do not meet. */
  readonly name?: string;
  /** The version of the database that is wanted. It is `DB_VERSION`. */
  readonly version?: number;
  readonly steps?: readonly UpgradeStep[];
}

/** Another tab keeps an older version of the database open, so that this one cannot be upgraded until it lets go. */
class BlockedError extends Error {
  constructor() {
    super('Another tab keeps an older version of the database open.');
    this.name = 'BlockedError';
  }
}

interface Attempt {
  readonly opening: Promise<CanvasDatabase>;
  /** Rejects if the open is blocked. It does not settle if it is not. */
  readonly blocked: Promise<never>;
  /** The connection, once it is open. */
  database?: CanvasDatabase;
}

const isInvalidState = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'InvalidStateError';

/** The connection to the database: opened when it is first needed, kept, and let go of when someone else needs it. */
class Connection {
  private attempt: Attempt | undefined;

  constructor(
    private readonly name: string,
    private readonly version: number,
    private readonly steps: readonly UpgradeStep[],
  ) {}

  /** The open database. If it cannot be opened, this throws a `StorageFailure` that says why, and the next call tries again. */
  async get(): Promise<CanvasDatabase> {
    const attempt = (this.attempt ??= this.open());
    try {
      return await Promise.race([attempt.opening, attempt.blocked]);
    } catch (error) {
      throw new StorageFailure(classifyStorageError(error, 'open'));
    }
  }

  /**
   * Another tab wants this connection gone. Only the connection that the event is about is let go of: an event that comes late,
   * for one that a call has already replaced, must not take the new one with it, and that one has been closed already.
   */
  private release(attempt: Attempt): void {
    if (this.attempt === attempt) {
      this.forget();
    }
  }

  /** Forgets the connection and closes it, so that the next call opens it again. */
  forget(): void {
    const { attempt } = this;
    this.attempt = undefined;
    attempt?.database?.close();
  }

  private open(): Attempt {
    let block!: (error: Error) => void;
    const blocked = new Promise<never>((_, reject) => {
      block = reject;
    });
    // Nobody may be waiting when the open is blocked, and a rejection that nobody waits for is an error of its own.
    blocked.catch(() => undefined);

    const attempt: Attempt = {
      opening: (async () =>
        (await openDB(this.name, this.version, {
          upgrade: (database, oldVersion, _newVersion, transaction) =>
            this.upgrade(database, oldVersion, this.version, transaction),
          blocked: () => block(new BlockedError()),
          // Another tab wants a newer version of the database. It cannot have it while this one is open, so this lets go.
          blocking: () => this.release(attempt),
          // The browser may end the connection, when the learner clears the site's data. Nothing is done about it here: the next
          // call finds the connection closed, and opens it again (see `begin`).
        })) as unknown as CanvasDatabase)(),
      blocked,
    };
    attempt.opening.then(
      (database) => {
        attempt.database = database;
        if (this.attempt !== attempt) {
          // It was forgotten or closed while it was being opened, and nobody wants it.
          database.close();
        }
      },
      () => {
        if (this.attempt === attempt) {
          this.attempt = undefined;
        }
      },
    );
    return attempt;
  }

  /** Runs the steps from the version that the database has to the one that is wanted. One that fails undoes the upgrade. */
  private upgrade(
    database: IDBPDatabase,
    oldVersion: number,
    newVersion: number,
    transaction: UpgradeTransaction,
  ): void {
    const run = async (): Promise<void> => {
      for (let version = oldVersion; version < newVersion; version++) {
        // A version that has no step is a bug of the list, and it is a TypeError here, which undoes the upgrade like any step that fails.
        await (this.steps[version] as UpgradeStep)(database, transaction);
      }
    };
    run().catch(() => {
      // The upgrade is undone, and the open fails. Nobody else waits for the end of this transaction.
      transaction.done.catch(() => undefined);
      transaction.abort();
    });
  }
}

export function createIdbStore(options: IdbStoreOptions = {}): RecordStore {
  const { name = DB_NAME, version = DB_VERSION, steps = STRUCTURE_STEPS } = options;
  const connection = new Connection(name, version, steps);

  async function begin(requested: TransactionMode) {
    const stores = [STORES.canvases, STORES.meta] as const;
    // The types of a transaction that is only read from have no `put`. The mode that is asked for is what the browser enforces,
    // and a write in a read-only transaction is an error that the contract spec shows.
    const mode = requested as 'readwrite';
    const database = await connection.get();
    try {
      return database.transaction(stores, mode);
    } catch (error) {
      if (!isInvalidState(error)) {
        throw error;
      }
      // The browser closed the connection before the event that says so came. Opening it again is what the next call would do.
      connection.forget();
      return (await connection.get()).transaction(stores, mode);
    }
  }

  return {
    async transact(mode, work) {
      const transaction = await begin(mode);
      const canvases = transaction.objectStore(STORES.canvases);
      const meta = transaction.objectStore(STORES.meta);
      const view: RecordTransaction = {
        getRecord: (id) => canvases.get(id),
        getRecords: () => canvases.getAll(),
        putRecord: async (record) => {
          await canvases.put(record);
        },
        deleteRecord: (id) => canvases.delete(id),
        getMeta: (key) => meta.get(key),
        putMeta: async (key, value) => {
          await meta.put(value, key);
        },
        deleteMeta: (key) => meta.delete(key),
      };

      try {
        const result = await work(view);
        await transaction.done;
        return result;
      } catch (error) {
        try {
          transaction.abort();
        } catch {
          // It is over already: it committed, or something else ended it. Either way there is nothing to undo.
        }
        transaction.done.catch(() => undefined);
        throw error;
      }
    },

    close: async () => connection.forget(),
  };
}
