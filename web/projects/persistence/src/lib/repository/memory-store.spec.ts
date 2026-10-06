import { describe, expect, it } from 'vitest';
import { createMemoryStore } from './memory-store';

/**
 * What the store in memory has to do to stand in for IndexedDB, beyond what the contract of the repository can see: it copies,
 * it keeps the order of the ids, it undoes a transaction that fails, and it runs one at a time.
 */

describe('the store in memory', () => {
  it('keeps a copy of what it is given, and gives a copy of what it keeps', async () => {
    const store = createMemoryStore();
    const given = { id: 'a', nested: { list: [1, 2] } };
    await store.transact('readwrite', (tx) => tx.putRecord(given));
    given.nested.list.push(3);

    const first = await store.transact('readonly', (tx) => tx.getRecord('a'));
    expect(first).toEqual({ id: 'a', nested: { list: [1, 2] } });
    (first?.['nested'] as { list: number[] }).list.push(99);

    expect(await store.transact('readonly', (tx) => tx.getRecord('a'))).toEqual({ id: 'a', nested: { list: [1, 2] } });
    const [listed] = await store.transact('readonly', (tx) => tx.getRecords());
    (listed?.['nested'] as { list: number[] }).list.push(99);
    expect(await store.transact('readonly', (tx) => tx.getRecord('a'))).toEqual({ id: 'a', nested: { list: [1, 2] } });
  });

  it('keeps a copy of a value of the meta store too, and does not keep what is frozen frozen', async () => {
    const store = createMemoryStore();
    const given = Object.freeze({ list: [1] });
    await store.transact('readwrite', (tx) => tx.putMeta('k', given));

    const kept = (await store.transact('readonly', (tx) => tx.getMeta('k'))) as { list: number[] };
    kept.list.push(2);
    expect(await store.transact('readonly', (tx) => tx.getMeta('k'))).toEqual({ list: [1] });
  });

  it('gives nothing for a record, or a value, that is not there', async () => {
    const store = createMemoryStore();

    expect(await store.transact('readonly', (tx) => tx.getRecord('nothing'))).toBeUndefined();
    expect(await store.transact('readonly', (tx) => tx.getMeta('nothing'))).toBeUndefined();
    expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([]);
  });

  it('lists the records in the order of their ids, as IndexedDB does: by code unit, so that capitals come first', async () => {
    const store = createMemoryStore();
    for (const id of ['b', 'a', 'C', 'B', '10', '9', 'é']) {
      await store.transact('readwrite', (tx) => tx.putRecord({ id }));
    }

    const ids = (await store.transact('readonly', (tx) => tx.getRecords())).map((record) => record['id']);
    expect(ids).toEqual(['10', '9', 'B', 'C', 'a', 'b', 'é']);
  });

  it('replaces a record that has the id, deletes one, and does not mind deleting one that is not there', async () => {
    const store = createMemoryStore();
    await store.transact('readwrite', async (tx) => {
      await tx.putRecord({ id: 'a', v: 1 });
      await tx.putRecord({ id: 'a', v: 2 });
      await tx.putRecord({ id: 'b' });
      await tx.deleteRecord('b');
      await tx.deleteRecord('nothing');
      await tx.putMeta('k', 1);
      await tx.putMeta('k', 2);
      await tx.putMeta('gone', 3);
      await tx.deleteMeta('gone');
      await tx.deleteMeta('nothing');
    });

    expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([{ id: 'a', v: 2 }]);
    expect(await store.transact('readonly', (tx) => tx.getMeta('k'))).toBe(2);
    expect(await store.transact('readonly', (tx) => tx.getMeta('gone'))).toBeUndefined();
  });

  describe('a transaction that throws', () => {
    it('keeps nothing of what it wrote, in either store, and gives the error', async () => {
      const store = createMemoryStore();
      await store.transact('readwrite', async (tx) => {
        await tx.putRecord({ id: 'keep', v: 1 });
        await tx.putMeta('keep', 1);
      });

      await expect(
        store.transact('readwrite', async (tx) => {
          await tx.putRecord({ id: 'keep', v: 2 });
          await tx.putRecord({ id: 'new' });
          await tx.deleteRecord('keep');
          await tx.putMeta('keep', 2);
          await tx.putMeta('new', 2);
          throw new Error('halfway');
        }),
      ).rejects.toThrow('halfway');

      expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([{ id: 'keep', v: 1 }]);
      expect(await store.transact('readonly', (tx) => tx.getMeta('keep'))).toBe(1);
      expect(await store.transact('readonly', (tx) => tx.getMeta('new'))).toBeUndefined();
    });

    it('does not stop the next one', async () => {
      const store = createMemoryStore();
      await expect(store.transact('readwrite', () => Promise.reject(new Error('no')))).rejects.toThrow('no');

      await store.transact('readwrite', (tx) => tx.putRecord({ id: 'a' }));
      expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([{ id: 'a' }]);
    });

    it('is refused if what it keeps cannot be copied, as IndexedDB refuses it, and keeps nothing of it', async () => {
      const store = createMemoryStore();

      await expect(store.transact('readwrite', (tx) => tx.putRecord({ id: 'a', f: () => 1 }))).rejects.toThrow();
      expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([]);
    });
  });

  it('runs one transaction at a time, in the order that they were asked for, even when each waits', async () => {
    const store = createMemoryStore();
    const log: string[] = [];
    const run = (name: string) =>
      store.transact('readwrite', async (tx) => {
        log.push(`${name} starts`);
        await tx.putRecord({ id: name });
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 1));
        log.push(`${name} ends`);
        return name;
      });

    expect(await Promise.all([run('first'), run('second'), run('third')])).toEqual(['first', 'second', 'third']);
    expect(log).toEqual(['first starts', 'first ends', 'second starts', 'second ends', 'third starts', 'third ends']);
  });

  it('can be closed, which changes nothing, because there is nothing to let go of', async () => {
    const store = createMemoryStore();
    await store.transact('readwrite', (tx) => tx.putRecord({ id: 'a' }));
    await store.close();

    expect(await store.transact('readonly', (tx) => tx.getRecords())).toEqual([{ id: 'a' }]);
  });

  it('is a store of its own for each, so that two do not share what they keep', async () => {
    const [one, other] = [createMemoryStore(), createMemoryStore()];
    await one.transact('readwrite', (tx) => tx.putRecord({ id: 'a' }));

    expect(await other.transact('readonly', (tx) => tx.getRecords())).toEqual([]);
  });
});
