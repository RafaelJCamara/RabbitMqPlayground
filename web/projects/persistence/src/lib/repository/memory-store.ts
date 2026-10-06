import type { RecordStore, RecordTransaction, StoredRecord } from './store';

/**
 * A store that keeps everything in memory (ADR-0028). It behaves as IndexedDB does where that shows: what goes in and what
 * comes out is a copy, so that nothing is shared with the caller, records come back in the order of their ids, a transaction
 * that fails leaves nothing behind, and transactions run one at a time.
 */
export function createMemoryStore(): RecordStore {
  let canvases = new Map<string, StoredRecord>();
  let meta = new Map<string, unknown>();
  let last: Promise<unknown> = Promise.resolve();

  const view: RecordTransaction = {
    getRecord: async (id) => {
      const record = canvases.get(id);
      return record === undefined ? undefined : structuredClone(record);
    },
    getRecords: async () => [...canvases.keys()].sort().map((id) => structuredClone(canvases.get(id) as StoredRecord)),
    putRecord: async (record) => {
      canvases.set(String(record['id']), structuredClone(record));
    },
    deleteRecord: async (id) => {
      canvases.delete(id);
    },
    getMeta: async (key) => structuredClone(meta.get(key)),
    putMeta: async (key, value) => {
      meta.set(key, structuredClone(value));
    },
    deleteMeta: async (key) => {
      meta.delete(key);
    },
  };

  return {
    transact(_mode, work) {
      const run = last.then(async () => {
        const [canvasesBefore, metaBefore] = [new Map(canvases), new Map(meta)];
        try {
          return await work(view);
        } catch (error) {
          [canvases, meta] = [canvasesBefore, metaBefore];
          throw error;
        }
      });
      last = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    close: async () => undefined,
  };
}
