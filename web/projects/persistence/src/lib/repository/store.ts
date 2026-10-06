/**
 * What the repository needs from a place that keeps things (ADR-0028): records by id, small values by name, and a way to run a
 * few reads and writes as one transaction, which happens whole or not at all. There are two, one in memory and one on
 * IndexedDB, and the rules of the repository, which is what the contract spec holds to account, sit on top of either.
 *
 * What a store gives back is whatever it holds: `unknown`, and not a canvas, because what is kept may have been written by
 * an older version of the app, or by something else. The repository reads it, through the loader.
 */

/** A record as it is kept: an object with an `id`, and fields that are not to be trusted until they are read. */
export type StoredRecord = Readonly<Record<string, unknown>>;

export interface RecordTransaction {
  getRecord(id: string): Promise<StoredRecord | undefined>;
  /** Every record, the ones that are deleted too, by id. */
  getRecords(): Promise<readonly StoredRecord[]>;
  /** Keeps a record, in place of the one that has its `id`. */
  putRecord(record: StoredRecord): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  getMeta(key: string): Promise<unknown>;
  putMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
}

export type TransactionMode = 'readonly' | 'readwrite';

export interface RecordStore {
  /**
   * Runs `work` as one transaction. If it throws, none of what it wrote is kept. Inside it, only the calls of the transaction
   * may be waited for: anything else that it waits for may close the transaction before it is done, on IndexedDB.
   */
  transact<T>(mode: TransactionMode, work: (transaction: RecordTransaction) => Promise<T>): Promise<T>;
  /** Lets go of what the store holds open. A call after this opens it again. */
  close(): Promise<void>;
}
