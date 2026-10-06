import { emptyDocument } from '@rmq/domain';
import { idSequence, sampleDocument } from '@rmq/testing';
import 'fake-indexeddb/auto';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { openDB, unwrap, type IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, DB_VERSION } from '../storage';
import { createIdbStore, STRUCTURE_STEPS, type UpgradeStep } from './idb-store';
import { createIdbRepository } from './repositories';
import { createCanvasRepository } from './repository';
import type { RecordStore } from './store';

/**
 * What the store on IndexedDB does that the contract of the repository cannot see, because the memory store has nothing like it:
 * the structure of the database and how it is upgraded, and what happens to the connection when another tab, or the browser,
 * has a say. The browser is fake-indexeddb, which has the events of a real one.
 */

// What the store opens, so that a spec can reach the connection that it keeps.
vi.mock('idb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('idb')>();
  return { ...actual, openDB: vi.fn(actual.openDB) };
});

const ids = () => idSequence('c');
const clock = { now: () => 1_000_000 };

const repositoryOn = (store: RecordStore) => createCanvasRepository(store, { ...clock, newId: ids() });

/** A connection of a spec's own, which is not the store's, such as another tab has. */
const openRaw = (version?: number): Promise<IDBPDatabase> => openDB(DB_NAME, version);

const touch = (store: RecordStore) => store.transact('readonly', async () => undefined);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.mocked(openDB).mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the structure of the database', () => {
  it('has a step for each version, and the version is the number of steps', () => {
    expect(STRUCTURE_STEPS).toHaveLength(DB_VERSION);
    expect(DB_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('is made when the store is first used: canvases by id, the meta values by name, and no indexes', async () => {
    const store = createIdbStore();
    await touch(store);
    await store.close();

    const database = await openRaw();
    const transaction = database.transaction(['canvases', 'meta']);
    expect(database.name).toBe('rmq-playground');
    expect(database.version).toBe(DB_VERSION);
    expect([...database.objectStoreNames].sort()).toEqual(['canvases', 'meta']);
    expect(transaction.objectStore('canvases').keyPath).toBe('id');
    expect(transaction.objectStore('canvases').autoIncrement).toBe(false);
    expect([...transaction.objectStore('canvases').indexNames]).toEqual([]);
    expect(transaction.objectStore('meta').keyPath).toBeNull();
    expect([...transaction.objectStore('meta').indexNames]).toEqual([]);
    database.close();
  });

  it('keeps the canvases under their ids, and the values under their names, which is how they can be found from outside', async () => {
    const repository = repositoryOn(createIdbStore());
    await repository.create({ id: 'a', name: 'Orders', document: emptyDocument() });
    await repository.setMeta('lastOpenCanvas', 'a');
    await repository.close();

    const database = await openRaw();
    expect(await database.get('canvases', 'a')).toMatchObject({ id: 'a', name: 'Orders' });
    expect(await database.get('meta', 'lastOpenCanvas')).toBe('a');
    database.close();
  });

  it('is shared by two stores of the same database, as it is by two tabs', async () => {
    const [one, other] = [repositoryOn(createIdbStore()), repositoryOn(createIdbStore())];
    await one.create({ id: 'a', name: 'n', document: sampleDocument() });

    const listing = await other.list();
    expect(listing.ok && listing.value.canvases.map(({ id }) => id)).toEqual(['a']);
  });

  it('is a database of its own for each name, which is how a spec keeps two apart', async () => {
    const [one, other] = [
      repositoryOn(createIdbStore({ name: 'one' })),
      repositoryOn(createIdbStore({ name: 'other' })),
    ];
    await one.create({ id: 'a', name: 'n', document: emptyDocument() });

    const listing = await other.list();
    expect(listing.ok && listing.value.canvases).toEqual([]);
  });
});

describe('an upgrade of the structure', () => {
  /** A step that exists only here: version 2 has an index by name, and every name is in capitals, as if it had been rewritten. */
  const addIndexAndShout: UpgradeStep = async (_database, transaction) => {
    const canvases = transaction.objectStore('canvases');
    canvases.createIndex('by-name', 'name');
    let cursor = await canvases.openCursor();
    while (cursor) {
      await cursor.update({ ...cursor.value, name: String(cursor.value.name).toUpperCase() });
      cursor = await cursor.continue();
    }
  };
  const steps = [...STRUCTURE_STEPS, addIndexAndShout];

  it('goes from the version that the database has to the one that is wanted, and keeps what was kept', async () => {
    const before = repositoryOn(createIdbStore());
    await before.create({ id: 'a', name: 'Orders', document: sampleDocument() });
    await before.setMeta('lastBackupAt', 5);
    await before.close();

    const after = repositoryOn(createIdbStore({ version: 2, steps }));
    const listing = await after.list();

    expect(listing.ok && listing.value.canvases.map(({ id, name }) => [id, name])).toEqual([['a', 'ORDERS']]);
    const meta = await after.getMeta('lastBackupAt');
    expect(meta.ok && meta.value).toBe(5);

    const database = await openRaw();
    expect(database.version).toBe(2);
    expect([...database.transaction('canvases').store.indexNames]).toEqual(['by-name']);
    expect(await database.get('canvases', 'a')).toMatchObject({ name: 'ORDERS' });
    database.close();
  });

  it('makes the whole of the structure for a database that does not exist yet, by every step in turn', async () => {
    const repository = repositoryOn(createIdbStore({ version: 2, steps }));
    await repository.create({ id: 'a', name: 'n', document: emptyDocument() });

    const database = await openRaw();
    expect(database.version).toBe(2);
    expect([...database.objectStoreNames].sort()).toEqual(['canvases', 'meta']);
    expect([...database.transaction('canvases').store.indexNames]).toEqual(['by-name']);
    database.close();
  });

  it('is undone, and the database is as it was, when a step fails', async () => {
    const before = repositoryOn(createIdbStore());
    await before.create({ id: 'a', name: 'n', document: emptyDocument() });
    await before.close();
    const failing: UpgradeStep = async (_database, transaction) => {
      await transaction.objectStore('canvases').clear();
      throw new Error('this step is wrong');
    };

    const answer = await repositoryOn(createIdbStore({ version: 2, steps: [...STRUCTURE_STEPS, failing] })).list();

    expect(answer).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    const database = await openRaw();
    expect(database.version).toBe(1);
    expect(await database.count('canvases')).toBe(1);
    database.close();
  });

  it('is refused when a version has no step, because that is a bug in the list, and it does not start', async () => {
    const answer = await repositoryOn(createIdbStore({ version: 3, steps })).list();

    expect(answer).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });
});

describe('a database that another version of the app made', () => {
  it('is newer than this one, which says so and changes nothing', async () => {
    (await openDB(DB_NAME, 3, { upgrade: (db) => db.createObjectStore('whatever') })).close();

    const answer = await repositoryOn(createIdbStore()).list();

    expect(answer).toMatchObject({ ok: false, error: { kind: 'newer-database' } });
    expect(!answer.ok && answer.error.message).toContain('Reload the page to get the newest version.');
    const database = await openRaw();
    expect(database.version).toBe(3);
    database.close();
  });

  it('is tried again at the next call, because a refusal does not stick', async () => {
    (await openDB(DB_NAME, 3, { upgrade: (db) => db.createObjectStore('whatever') })).close();
    const repository = repositoryOn(createIdbStore());
    expect(await repository.list()).toMatchObject({ ok: false, error: { kind: 'newer-database' } });

    globalThis.indexedDB = new IDBFactory();
    expect(await repository.list()).toMatchObject({ ok: true });
  });
});

describe('another tab that has the database open', () => {
  const upgrading = { version: 2, steps: [...STRUCTURE_STEPS, () => undefined] };

  it('blocks an upgrade if it will not let go, and the call says so, and does not wait for ever', async () => {
    const seed = repositoryOn(createIdbStore());
    await seed.create({ id: 'a', name: 'n', document: emptyDocument() });
    await seed.close();
    const other = await openRaw(); // an older tab, with no handler that lets go
    const repository = repositoryOn(createIdbStore(upgrading));

    const answer = await repository.list();

    expect(answer).toMatchObject({ ok: false, error: { kind: 'blocked' } });
    expect(!answer.ok && answer.error.message).toBe(
      'Another tab of this app still has the saved canvases open in an older version, so this tab cannot open them yet. Close the other tabs of the app, then try again.',
    );
    expect(await repository.list()).toMatchObject({ ok: false, error: { kind: 'blocked' } });
    other.close();
  });

  it('is let through when the other tab lets go, and the next call works, with what was there', async () => {
    await repositoryOn(createIdbStore()).create({ id: 'a', name: 'n', document: emptyDocument() });
    const other = await openRaw();
    const repository = repositoryOn(createIdbStore(upgrading));
    expect(await repository.list()).toMatchObject({ ok: false, error: { kind: 'blocked' } });

    other.close();
    await vi.waitFor(async () => {
      const answer = await repository.list();
      expect(answer.ok && answer.value.canvases.map(({ id }) => id)).toEqual(['a']);
    });
    const database = await openRaw();
    expect(database.version).toBe(2);
    database.close();
  });

  it('is asked to let go by a newer tab, and does, so that the upgrade is not blocked', async () => {
    const older = repositoryOn(createIdbStore());
    await older.create({ id: 'a', name: 'n', document: emptyDocument() });

    const newer = repositoryOn(createIdbStore(upgrading));
    const answer = await newer.list();

    expect(answer).toMatchObject({ ok: true });
    expect(answer.ok && answer.value.canvases.map(({ id }) => id)).toEqual(['a']);
  });

  it('finds, after it let go, that the database is newer than it is, and says so', async () => {
    const older = repositoryOn(createIdbStore());
    await older.create({ id: 'a', name: 'n', document: emptyDocument() });
    await repositoryOn(createIdbStore(upgrading)).list();

    expect(await older.list()).toMatchObject({ ok: false, error: { kind: 'newer-database' } });
  });
});

describe('a browser that ends the connection', () => {
  /** The connection that the store opened, as `idb` made it. */
  const connectionOpened = async (index: number): Promise<IDBPDatabase> =>
    (await vi.mocked(openDB).mock.results[index]?.value) as IDBPDatabase;

  it('is opened again at the next call, which finds what was kept', async () => {
    const repository = repositoryOn(createIdbStore());
    await repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    forceCloseDatabase(unwrap(await connectionOpened(0)) as never);

    await vi.waitFor(async () => {
      expect(await repository.list()).toMatchObject({ ok: true });
    });
    const listing = await repository.list();
    expect(listing.ok && listing.value.canvases.map(({ id }) => id)).toEqual(['a']);
    expect(vi.mocked(openDB)).toHaveBeenCalledTimes(2);
  });

  it('is opened again, once, by a call that meets the closed connection before the event that says so', async () => {
    const repository = repositoryOn(createIdbStore());
    await repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    (await connectionOpened(0)).close();

    const listing = await repository.list();

    expect(listing.ok && listing.value.canvases.map(({ id }) => id)).toEqual(['a']);
    expect(vi.mocked(openDB)).toHaveBeenCalledTimes(2);
  });

  it('is not a reason to open it for ever: a call that meets another failure says what it is', async () => {
    const repository = repositoryOn(createIdbStore());
    await repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw Object.assign(new Error('closed'), { name: 'InvalidStateError' });
    });

    expect(await repository.list()).toMatchObject({ ok: false, error: { kind: 'failed' } });
  });
});

describe('a store that is closed while it is being opened', () => {
  it('lets go of the connection when it arrives, and the call that was waiting still gets its answer', async () => {
    const store = createIdbStore();
    const repository = repositoryOn(store);

    const pending = repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    await store.close();

    expect(await pending).toMatchObject({ ok: true });
    expect((await repository.list()).ok).toBe(true);
  });

  it('can be closed when it was never opened, and again, and opens at the next call', async () => {
    const store = createIdbStore();
    await store.close();
    await store.close();

    expect(await repositoryOn(store).list()).toMatchObject({ ok: true });
    expect(vi.mocked(openDB)).toHaveBeenCalledTimes(1);
  });
});

describe('a browser that does not let the site keep data', () => {
  it('has no IndexedDB, and the call says that the browser does not let the site keep canvases', async () => {
    vi.stubGlobal('indexedDB', undefined);

    const answer = await repositoryOn(createIdbStore()).list();

    expect(answer).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
    expect(!answer.ok && answer.error.message).toContain('private window');
  });

  it('refuses to open it, and says the same', async () => {
    vi.spyOn(globalThis.indexedDB, 'open').mockImplementation(() => {
      throw Object.assign(new Error('denied'), { name: 'SecurityError' });
    });

    expect(await repositoryOn(createIdbStore()).list()).toMatchObject({ ok: false, error: { kind: 'unavailable' } });
  });

  it('is tried again at the next call, in case the learner changed the setting', async () => {
    vi.stubGlobal('indexedDB', undefined);
    const repository = repositoryOn(createIdbStore());
    expect(await repository.list()).toMatchObject({ ok: false, error: { kind: 'unavailable' } });

    vi.unstubAllGlobals();
    globalThis.indexedDB = new IDBFactory();
    expect(await repository.list()).toMatchObject({ ok: true });
  });
});

describe('a browser that runs out of room', () => {
  const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

  it('refuses a write, and the call says that there is no room, and nothing was kept', async () => {
    const repository = repositoryOn(createIdbStore());
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw quota();
    });

    const answer = await repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    put.mockRestore();

    expect(answer).toMatchObject({ ok: false, error: { kind: 'quota-exceeded' } });
    expect(await repository.list()).toMatchObject({ ok: true, value: { canvases: [] } });
  });

  it('undoes the writes before the one that is refused, so that a delete of everything is all or nothing', async () => {
    const repository = repositoryOn(createIdbStore());
    for (const id of ['a', 'b', 'c']) {
      await repository.create({ id, name: id, document: emptyDocument() });
    }
    const original = IDBObjectStore.prototype.put;
    let calls = 0;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      calls += 1;
      if (calls === 3) {
        throw quota();
      }
      return original.apply(this, args as Parameters<typeof original>);
    });

    const answer = await repository.softDeleteAll();
    put.mockRestore();

    expect(answer).toMatchObject({ ok: false, error: { kind: 'quota-exceeded' } });
    const listing = await repository.list();
    expect(listing.ok && listing.value.canvases.map(({ id }) => id)).toEqual(['a', 'b', 'c']);
  });
});

describe('an event that comes for a connection that has been replaced', () => {
  it('lets go of that one, and leaves the one that replaced it alone', async () => {
    const repository = repositoryOn(createIdbStore());
    await repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    const callbacks = vi.mocked(openDB).mock.calls[0]?.[2];
    const first = await vi.mocked(openDB).mock.results[0]?.value;
    first.close(); // the browser has closed it, and the event that says so has not come
    await repository.list(); // which a call finds, and opens it again
    expect(vi.mocked(openDB)).toHaveBeenCalledTimes(2);

    callbacks?.blocking?.(1, 2, new Event('versionchange') as never); // a request of another tab for it comes, late
    const listing = await repository.list();

    expect(listing.ok && listing.value.canvases.map(({ id }) => id)).toEqual(['a']);
    expect(vi.mocked(openDB)).toHaveBeenCalledTimes(2);
  });
});

describe('a connection that arrives after the store was closed', () => {
  it('is closed at once, so that it cannot hold up an upgrade that another tab wants', async () => {
    const store = createIdbStore();
    const pending = repositoryOn(store).create({ id: 'a', name: 'n', document: emptyDocument() });
    await store.close();
    expect(await pending).toMatchObject({ ok: true });

    let blocked = false;
    const upgraded = await openDB(DB_NAME, 2, {
      upgrade: () => undefined,
      blocked: () => {
        blocked = true;
      },
    });

    expect(blocked).toBe(false);
    upgraded.close();
  });
});

describe('a repository that is closed', () => {
  it('lets go of its connection, and opens it again at the next call', async () => {
    const repository = repositoryOn(createIdbStore());
    await repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    expect(vi.mocked(openDB)).toHaveBeenCalledTimes(1);
    await repository.close();

    expect(await repository.list()).toMatchObject({ ok: true });
    expect(vi.mocked(openDB)).toHaveBeenCalledTimes(2);
  });
});

describe('a store that is closed while its open fails', () => {
  it('says why it failed, as it would have, and is not confused by being closed', async () => {
    (await openDB(DB_NAME, 3, { upgrade: (db) => db.createObjectStore('whatever') })).close();
    const store = createIdbStore();
    const pending = repositoryOn(store).list();
    await store.close();

    expect(await pending).toMatchObject({ ok: false, error: { kind: 'newer-database' } });
  });
});

describe('a transaction that cannot be started', () => {
  it('says that something failed, with the words of the browser, when it is for a reason other than a closed connection', async () => {
    const repository = repositoryOn(createIdbStore());
    await repository.create({ id: 'a', name: 'n', document: emptyDocument() });
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(() => {
      throw Object.assign(new Error('no such store'), { name: 'NotFoundError' });
    });

    expect(await repository.list()).toMatchObject({
      ok: false,
      error: { kind: 'failed', detail: 'NotFoundError: no such store' },
    });
    expect(await repository.list()).toMatchObject({ ok: true });
  });
});

describe('a transaction', () => {
  it('that only reads cannot write, which is what a read-only transaction is for', async () => {
    const store = createIdbStore();

    await expect(store.transact('readonly', (tx) => tx.putRecord({ id: 'a' }))).rejects.toMatchObject({
      name: 'ReadOnlyError',
    });
    expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([]);
  });

  it('that throws keeps nothing of what it wrote', async () => {
    const store = createIdbStore();
    await expect(
      store.transact('readwrite', async (tx) => {
        await tx.putRecord({ id: 'a' });
        await tx.putMeta('k', 1);
        throw new Error('halfway');
      }),
    ).rejects.toThrow('halfway');

    expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([]);
    expect(await store.transact('readonly', (tx) => tx.getMeta('k'))).toBeUndefined();
  });

  it('that is given what IndexedDB cannot keep is refused, and keeps nothing', async () => {
    const store = createIdbStore();

    await expect(store.transact('readwrite', (tx) => tx.putRecord({ id: 'a', f: () => 1 }))).rejects.toMatchObject({
      name: 'DataCloneError',
    });
    expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([]);
  });

  it('keeps the sign of a zero, which JSON does not, because IndexedDB copies and does not write text', async () => {
    const store = createIdbStore();
    await store.transact('readwrite', (tx) => tx.putRecord({ id: 'a', n: -0 }));

    const record = await store.transact('readonly', (tx) => tx.getRecord('a'));
    expect(Object.is(record?.['n'], -0)).toBe(true);
  });
});

describe('the repository that the app uses', () => {
  it('is made on IndexedDB, and works', async () => {
    const repository = createIdbRepository({ ...clock, newId: ids() });
    const made = await repository.create({ name: 'Orders', document: sampleDocument() });

    expect(made).toMatchObject({ ok: true, value: { id: 'c1' } });
    await repository.close();
    expect(await createIdbRepository({ ...clock, newId: ids() }).get('c1')).toMatchObject({ ok: true });
  });

  it('can be made on a database of its own, with steps of its own', async () => {
    const repository = createIdbRepository({
      ...clock,
      newId: ids(),
      database: { name: 'elsewhere', version: 2, steps: [...STRUCTURE_STEPS, () => undefined] },
    });
    await repository.create({ name: 'n', document: emptyDocument() });

    const database = await openDB('elsewhere');
    expect(database.version).toBe(2);
    database.close();
  });
});
