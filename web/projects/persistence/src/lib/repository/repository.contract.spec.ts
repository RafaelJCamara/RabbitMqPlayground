import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import { utf8Length } from '@rmq/engine';
import { idSequence, manualClock, sampleDocument, type ManualClock } from '@rmq/testing';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { StorageFailure } from '../errors';
import { SIZE_CAPS } from '../load/caps';
import type { CanvasRecord } from '../record';
import {
  createCanvasRepository,
  TOMBSTONE_TTL_MS,
  type CanvasRepository,
  type MetaKey,
  type RepositoryOptions,
} from './repository';
import { createIdbStore } from './idb-store';
import { createMemoryStore } from './memory-store';
import type { RecordStore } from './store';

/**
 * The contract of the repository (ADR-0028), which every store has to meet. It is a function that makes the `describe`, so that
 * one spec can run it on the store in memory and on IndexedDB, and say that they agree. What is held to account here is what a
 * caller can see: the rules are the repository's, and the store is what keeps the records and runs a transaction whole.
 */

interface Harness {
  /** A repository on a store that is empty. */
  readonly repository: CanvasRepository;
  /** The store under it, to plant what a spec needs, which the repository would never write. */
  readonly store: RecordStore;
  readonly clock: ManualClock;
  /** A repository on the same store, with other options, as another start of the app would make. */
  readonly another: (options?: Partial<RepositoryOptions>) => CanvasRepository;
  /** Lets go of everything, so that the next harness starts from nothing. */
  readonly dispose: () => Promise<void>;
}

type MakeHarness = (options?: Partial<RepositoryOptions>) => Promise<Harness>;

/** A harness made on a store, with a clock and ids that a spec moves and counts. */
function harnessOn(store: RecordStore, options: Partial<RepositoryOptions> = {}): Harness {
  const clock = manualClock(1_000_000);
  const base: RepositoryOptions = { now: clock.now, newId: idSequence('c'), ...options };
  return {
    repository: createCanvasRepository(store, base),
    store,
    clock,
    another: (other = {}) => createCanvasRepository(store, { ...base, ...other }),
    dispose: () => store.close(),
  };
}

type Raw = Record<string, unknown>;

const plainDocument = (): Raw => JSON.parse(JSON.stringify(sampleDocument())) as Raw;

/** A record as it would be if something else had written it: it can be as wrong as a spec likes. */
const raw = (id: string, change: Raw = {}): Raw => ({
  id,
  name: `Canvas ${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  document: plainDocument(),
  ...change,
});

const unwrap = <T>(
  outcome: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown },
): T => {
  if (!outcome.ok) {
    throw new Error(`expected a value, and got ${JSON.stringify(outcome.error)}`);
  }
  return outcome.value;
};

const errorKind = (outcome: {
  readonly ok: boolean;
  readonly error?: { readonly kind: string };
}): string | undefined => (outcome.ok ? undefined : outcome.error?.kind);

/** A store that fails its first transaction with this, and then works. */
function failingOnce(store: RecordStore, thrown: unknown): RecordStore {
  let armed = true;
  return {
    transact(mode, work) {
      if (armed) {
        armed = false;
        return Promise.reject(thrown);
      }
      return store.transact(mode, work);
    },
    close: () => store.close(),
  };
}

const named = (name: string, message = 'boom') => Object.assign(new Error(message), { name });

function describeTheRepository(storeName: string, make: MakeHarness): void {
  describe(`the repository, on ${storeName}`, () => {
    /** Makes a harness, and lets go of it when the spec is over. */
    async function withHarness(
      run: (harness: Harness) => Promise<void>,
      options?: Partial<RepositoryOptions>,
    ): Promise<void> {
      const harness = await make(options);
      try {
        await run(harness);
      } finally {
        await harness.dispose();
      }
    }

    const plant = (harness: Harness, record: Raw) => harness.store.transact('readwrite', (tx) => tx.putRecord(record));

    describe('a canvas that is made', () => {
      it('has the id that the repository was given, the name and document that it was given, and the time as both of its times', () =>
        withHarness(async ({ repository }) => {
          const made = unwrap(await repository.create({ name: 'Orders', document: sampleDocument() }));

          expect(made).toEqual({
            id: 'c1',
            name: 'Orders',
            createdAt: 1_000_000,
            updatedAt: 1_000_000,
            document: sampleDocument(),
          });
        }));

      it('is the next canvas that is read, and is listed', () =>
        withHarness(async ({ repository }) => {
          const made = unwrap(await repository.create({ name: 'Orders', document: sampleDocument() }));

          expect(unwrap(await repository.get('c1'))).toEqual(made);
          expect(unwrap(await repository.list())).toEqual({ canvases: [made], unreadable: [] });
        }));

      it('has a new id each time', () =>
        withHarness(async ({ repository }) => {
          const ids = [];
          for (let i = 0; i < 3; i++) {
            ids.push(unwrap(await repository.create({ name: 'n', document: emptyDocument() })).id);
          }

          expect(ids).toEqual(['c1', 'c2', 'c3']);
        }));

      it('may be given its own id', () =>
        withHarness(async ({ repository }) => {
          expect(unwrap(await repository.create({ id: 'mine', name: 'n', document: emptyDocument() })).id).toBe('mine');
          expect(unwrap(await repository.get('mine')).name).toBe('n');
        }));

      it('is refused, with the id, if there is a canvas with that id, and it changes nothing', () =>
        withHarness(async ({ repository }) => {
          const first = unwrap(await repository.create({ id: 'mine', name: 'first', document: emptyDocument() }));
          const second = await repository.create({ id: 'mine', name: 'second', document: sampleDocument() });

          expect(second).toEqual({
            ok: false,
            error: {
              kind: 'exists',
              id: 'mine',
              message: 'There is already a canvas with the id "mine", so a new one could not be made with it.',
            },
          });
          expect(unwrap(await repository.get('mine'))).toEqual(first);
        }));

      it('is refused if the id is that of a canvas that was deleted, because it can still come back', () =>
        withHarness(async ({ repository }) => {
          await repository.create({ id: 'mine', name: 'n', document: emptyDocument() });
          unwrap(await repository.softDelete('mine'));

          expect(errorKind(await repository.create({ id: 'mine', name: 'n', document: emptyDocument() }))).toBe(
            'exists',
          );
        }));

      it('is not copied, so that changing what it was made from changes nothing', () =>
        withHarness(async ({ repository }) => {
          const document = plainDocument() as unknown as { vhost: string; queues: Record<string, { name: string }> };
          unwrap(await repository.create({ name: 'n', document: document as unknown as CanvasDocument }));
          document.vhost = 'changed';
          (document.queues['Q1'] as { name: string }).name = 'changed';

          expect(unwrap(await repository.get('c1')).document).toEqual(sampleDocument());
        }));

      it('can be made from a canvas that is frozen', () =>
        withHarness(async ({ repository }) => {
          const frozen = Object.freeze(sampleDocument());

          expect(unwrap(await repository.create({ name: 'n', document: frozen })).document).toEqual(sampleDocument());
        }));

      it.each([
        ['has no name', { name: '' }, 'invalid'],
        ['has a name that is blank', { name: '   ' }, 'invalid'],
        ['has a name that is too long', { name: 'x'.repeat(SIZE_CAPS.name + 1) }, 'too-large'],
        ['has an id that is not one', { id: 'no good' }, 'invalid'],
        [
          'is not a canvas that is right',
          { document: { ...sampleDocument(), vhost: '' } as CanvasDocument },
          'invalid',
        ],
        [
          'is too big',
          {
            document: {
              ...emptyDocument(),
              exchanges: Object.fromEntries(Array.from({ length: SIZE_CAPS.elements + 1 }, (_, i) => [`e${i}`, {}])),
            } as unknown as CanvasDocument,
          },
          'too-large',
        ],
      ])('is refused, and nothing is kept, when it %s', (_why, change, kind) =>
        withHarness(async ({ repository }) => {
          const result = await repository.create({ name: 'Orders', document: emptyDocument(), ...change });

          expect(errorKind(result)).toBe(kind);
          expect(unwrap(await repository.list())).toEqual({ canvases: [], unreadable: [] });
        }),
      );

      it('is refused when the ids that the repository was given are not ids, because that is a bug that it can say', () =>
        withHarness(
          async ({ repository }) => {
            expect(errorKind(await repository.create({ name: 'n', document: emptyDocument() }))).toBe('invalid');
          },
          { newId: () => 'not an id!' },
        ));

      it('is refused when the clock gives a time that is not one', () =>
        withHarness(
          async ({ repository }) => {
            expect(errorKind(await repository.create({ name: 'n', document: emptyDocument() }))).toBe('invalid');
          },
          { now: () => NaN },
        ));
    });

    describe('reading', () => {
      it('is a refusal that says which canvas is not there, for one that never was', () =>
        withHarness(async ({ repository }) => {
          expect(await repository.get('nothing')).toEqual({
            ok: false,
            error: {
              kind: 'not-found',
              id: 'nothing',
              message: 'There is no canvas with the id "nothing". It may have been deleted.',
            },
          });
        }));

      it('lists nothing when there is nothing', () =>
        withHarness(async ({ repository }) => {
          expect(unwrap(await repository.list())).toEqual({ canvases: [], unreadable: [] });
        }));

      it('lists the canvas edited last first, and by id when two were edited at the same time', () =>
        withHarness(async ({ repository, clock }) => {
          await repository.create({ id: 'b', name: 'b', document: emptyDocument() });
          await repository.create({ id: 'a', name: 'a', document: emptyDocument() });
          expect(unwrap(await repository.list()).canvases.map(({ id }) => id)).toEqual(['a', 'b']);
          clock.advance(10);
          await repository.create({ id: 'c', name: 'c', document: emptyDocument() });
          clock.advance(10);
          await repository.save('b', { name: 'b again' });

          const order = unwrap(await repository.list()).canvases.map(({ id }) => id);
          expect(order).toEqual(['b', 'c', 'a']);

          clock.advance(10);
          await repository.save('a', { name: 'a again' });
          await repository.save('c', { name: 'c again' });
          expect(unwrap(await repository.list()).canvases.map(({ id }) => id)).toEqual(['a', 'c', 'b']);
        }));

      it('reads a canvas as it was made, with the numbers and the text of every document that there is', () =>
        withHarness(async ({ repository }) => {
          const document = {
            ...sampleDocument(),
            vhost: 'v / é 😀',
            settings: { ...sampleDocument().settings, seed: 4_294_967_295 },
          };
          unwrap(await repository.create({ name: '日本語 "quoted"', document }));

          expect(unwrap(await repository.get('c1'))).toMatchObject({ name: '日本語 "quoted"', document });
        }));
    });

    describe('saving', () => {
      it('changes the document, and sets the time that it was edited and nothing else', () =>
        withHarness(async ({ repository, clock }) => {
          const made = unwrap(await repository.create({ name: 'Orders', document: emptyDocument() }));
          clock.advance(5000);
          const saved = unwrap(await repository.save('c1', { document: sampleDocument() }));

          expect(saved).toEqual({ ...made, updatedAt: 1_005_000, document: sampleDocument() });
          expect(unwrap(await repository.get('c1'))).toEqual(saved);
        }));

      it('changes the name, and sets the time that it was edited', () =>
        withHarness(async ({ repository, clock }) => {
          unwrap(await repository.create({ name: 'Orders', document: sampleDocument() }));
          clock.advance(1);
          const saved = unwrap(await repository.save('c1', { name: 'Renamed' }));

          expect(saved).toMatchObject({
            name: 'Renamed',
            createdAt: 1_000_000,
            updatedAt: 1_000_001,
            document: sampleDocument(),
          });
        }));

      it('changes both at once', () =>
        withHarness(async ({ repository, clock }) => {
          unwrap(await repository.create({ name: 'Orders', document: emptyDocument() }));
          clock.advance(1);
          const saved = unwrap(await repository.save('c1', { name: 'Both', document: sampleDocument() }));

          expect(saved).toMatchObject({ name: 'Both', updatedAt: 1_000_001, document: sampleDocument() });
        }));

      it('is a canvas that is read as it was, when nothing is to change, and it is not edited then', () =>
        withHarness(async ({ repository, clock }) => {
          const made = unwrap(await repository.create({ name: 'Orders', document: sampleDocument() }));
          clock.advance(500);

          expect(unwrap(await repository.save('c1', {}))).toEqual(made);
          expect(unwrap(await repository.get('c1')).updatedAt).toBe(1_000_000);
        }));

      it('is refused for a canvas that is not there, and for one that was deleted', () =>
        withHarness(async ({ repository }) => {
          expect(errorKind(await repository.save('nothing', { name: 'x' }))).toBe('not-found');
          await repository.create({ name: 'n', document: emptyDocument() });
          await repository.softDelete('c1');

          expect(errorKind(await repository.save('c1', { name: 'x' }))).toBe('not-found');
        }));

      it('is refused, and changes nothing, when the document is not right or the name is not one', () =>
        withHarness(async ({ repository, clock }) => {
          const made = unwrap(await repository.create({ name: 'Orders', document: sampleDocument() }));
          clock.advance(10);

          expect(
            errorKind(await repository.save('c1', { document: { ...sampleDocument(), vhost: '' } as CanvasDocument })),
          ).toBe('invalid');
          expect(errorKind(await repository.save('c1', { name: ' ' }))).toBe('invalid');
          expect(errorKind(await repository.save('c1', { name: 'x'.repeat(SIZE_CAPS.name + 1) }))).toBe('too-large');
          expect(unwrap(await repository.get('c1'))).toEqual(made);
        }));

      it('is refused for a canvas that cannot be read, so that what a newer version wrote is never written over', () =>
        withHarness(async (harness) => {
          const newer = { ...plainDocument(), schemaVersion: 2 };
          await plant(harness, raw('newer', { document: newer }));
          const result = await harness.repository.save('newer', { name: 'x' });

          expect(result).toMatchObject({ ok: false, error: { kind: 'newer-version', found: 2 } });
          const kept = await harness.store.transact('readonly', (tx) => tx.getRecord('newer'));
          expect(kept).toMatchObject({ name: 'Canvas newer', document: { schemaVersion: 2 } });
        }));
    });

    describe('putting a record', () => {
      it('keeps it exactly as it is, with its id and its times, and does not use the clock', () =>
        withHarness(async ({ repository }) => {
          const record: CanvasRecord = {
            id: 'old',
            name: 'Old',
            createdAt: 5,
            updatedAt: 6,
            document: sampleDocument(),
          };

          expect(unwrap(await repository.put(record))).toEqual(record);
          expect(unwrap(await repository.get('old'))).toEqual(record);
        }));

      it('replaces the canvas that has its id', () =>
        withHarness(async ({ repository }) => {
          await repository.create({ id: 'x', name: 'before', document: emptyDocument() });
          const record: CanvasRecord = {
            id: 'x',
            name: 'after',
            createdAt: 1,
            updatedAt: 2,
            document: sampleDocument(),
          };
          unwrap(await repository.put(record));

          expect(unwrap(await repository.get('x'))).toEqual(record);
          expect(unwrap(await repository.list()).canvases).toHaveLength(1);
        }));

      it('may be a tombstone, which is kept, and is not listed', () =>
        withHarness(async ({ repository }) => {
          const record: CanvasRecord = {
            id: 'gone',
            name: 'n',
            createdAt: 1,
            updatedAt: 2,
            deletedAt: 3,
            document: emptyDocument(),
          };
          unwrap(await repository.put(record));

          expect(unwrap(await repository.list()).canvases).toEqual([]);
          unwrap(await repository.restore('gone'));
          const { deletedAt: _deletedAt, ...live } = record;
          expect(unwrap(await repository.get('gone'))).toEqual(live);
        }));

      it('is refused, and changes nothing, when the record is not right', () =>
        withHarness(async ({ repository }) => {
          await repository.create({ id: 'x', name: 'before', document: emptyDocument() });
          const record = { id: 'x', name: '', createdAt: 1, updatedAt: 2, document: emptyDocument() };

          expect(errorKind(await repository.put(record))).toBe('invalid');
          expect(unwrap(await repository.get('x')).name).toBe('before');
        }));
    });

    describe('a canvas that is deleted', () => {
      const makeThree = async ({ repository, clock }: Harness) => {
        for (const id of ['a', 'b', 'c']) {
          await repository.create({ id, name: id, document: emptyDocument() });
          clock.advance(1);
        }
      };

      it('is not listed, and cannot be read, but is kept', () =>
        withHarness(async (harness) => {
          await makeThree(harness);
          unwrap(await harness.repository.softDelete('b'));

          expect(unwrap(await harness.repository.list()).canvases.map(({ id }) => id)).toEqual(['c', 'a']);
          expect(errorKind(await harness.repository.get('b'))).toBe('not-found');
          expect(unwrap(await harness.repository.estimate())).toMatchObject({ canvases: 2, tombstones: 1 });
        }));

      it('comes back as it was, with the time that it was edited as it was, when it is restored', () =>
        withHarness(async (harness) => {
          await makeThree(harness);
          const before = unwrap(await harness.repository.get('b'));
          unwrap(await harness.repository.softDelete('b'));
          harness.clock.advance(30_000);
          unwrap(await harness.repository.restore('b'));

          expect(unwrap(await harness.repository.get('b'))).toEqual(before);
          expect(unwrap(await harness.repository.estimate())).toMatchObject({ canvases: 3, tombstones: 0 });
        }));

      it('cannot be deleted twice, restored twice, or restored if it is not deleted', () =>
        withHarness(async (harness) => {
          await makeThree(harness);
          unwrap(await harness.repository.softDelete('a'));

          expect(errorKind(await harness.repository.softDelete('a'))).toBe('not-found');
          expect(errorKind(await harness.repository.softDelete('nothing'))).toBe('not-found');
          expect(errorKind(await harness.repository.restore('b'))).toBe('not-found');
          expect(errorKind(await harness.repository.restore('nothing'))).toBe('not-found');
          unwrap(await harness.repository.restore('a'));
          expect(errorKind(await harness.repository.restore('a'))).toBe('not-found');
        }));

      it('is deleted once when two calls try at the same time', () =>
        withHarness(async (harness) => {
          await makeThree(harness);
          const results = await Promise.all([harness.repository.softDelete('a'), harness.repository.softDelete('a')]);

          expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
          expect(results.map((result) => errorKind(result)).filter(Boolean)).toEqual(['not-found']);
        }));

      it('is made once when two calls try to make it with one id at the same time', () =>
        withHarness(async ({ repository }) => {
          const results = await Promise.all([
            repository.create({ id: 'same', name: 'one', document: emptyDocument() }),
            repository.create({ id: 'same', name: 'two', document: emptyDocument() }),
          ]);

          expect(results.map((result) => errorKind(result)).sort()).toEqual(['exists', undefined]);
          expect(unwrap(await repository.list()).canvases).toHaveLength(1);
        }));

      it('can be a canvas that cannot be read, which the learner can delete and bring back', () =>
        withHarness(async (harness) => {
          await plant(harness, raw('broken', { createdAt: 'x' }));
          expect(unwrap(await harness.repository.list()).unreadable.map(({ id }) => id)).toEqual(['broken']);

          unwrap(await harness.repository.softDelete('broken'));
          expect(unwrap(await harness.repository.list())).toEqual({ canvases: [], unreadable: [] });
          unwrap(await harness.repository.restore('broken'));
          expect(unwrap(await harness.repository.list()).unreadable.map(({ id }) => id)).toEqual(['broken']);
        }));
    });

    describe('every canvas deleted at once', () => {
      it('puts a tombstone on every one that has none, answers their ids, and leaves the list empty', () =>
        withHarness(async ({ repository }) => {
          for (const id of ['c', 'a', 'b']) {
            await repository.create({ id, name: id, document: emptyDocument() });
          }

          expect(unwrap(await repository.softDeleteAll())).toEqual(['a', 'b', 'c']);
          expect(unwrap(await repository.list())).toEqual({ canvases: [], unreadable: [] });
          expect(unwrap(await repository.softDeleteAll())).toEqual([]);
        }));

      it('is undone by restoring the ids, all of them or none', () =>
        withHarness(async (harness) => {
          for (const id of ['a', 'b']) {
            await harness.repository.create({ id, name: id, document: emptyDocument() });
          }
          const ids = unwrap(await harness.repository.softDeleteAll());

          expect(unwrap(await harness.repository.restoreAll(ids))).toEqual(['a', 'b']);
          expect(
            unwrap(await harness.repository.list())
              .canvases.map(({ id }) => id)
              .sort(),
          ).toEqual(['a', 'b']);
        }));

      it('does not take with it what was deleted before, and does not bring it back either', () =>
        withHarness(async ({ repository, clock }) => {
          for (const id of ['a', 'b', 'c']) {
            await repository.create({ id, name: id, document: emptyDocument() });
          }
          await repository.softDelete('a');
          clock.advance(40_000);
          const ids = unwrap(await repository.softDeleteAll());
          clock.advance(30_000);

          expect(ids).toEqual(['b', 'c']);
          // 'a' was deleted 70 seconds ago, and the others 30.
          expect(unwrap(await repository.purgeExpired())).toBe(1);
          expect(unwrap(await repository.restoreAll(['a', 'b', 'c']))).toEqual(['b', 'c']);
        }));

      it('puts a tombstone on canvases that cannot be read, too, because they are the learner’s to delete', () =>
        withHarness(async (harness) => {
          await harness.repository.create({ id: 'a', name: 'a', document: emptyDocument() });
          await plant(harness, raw('broken', { document: 5 }));

          expect(unwrap(await harness.repository.softDeleteAll())).toEqual(['a', 'broken']);
          expect(unwrap(await harness.repository.estimate())).toMatchObject({ canvases: 0, tombstones: 2 });
        }));

      it('brings back only the ids that are still tombstones, in the order that it was given them, and ignores the rest', () =>
        withHarness(async ({ repository }) => {
          for (const id of ['a', 'b', 'c']) {
            await repository.create({ id, name: id, document: emptyDocument() });
          }
          await repository.softDelete('a');
          await repository.softDelete('c');

          expect(unwrap(await repository.restoreAll(['c', 'nothing', 'b', 'a', 'a']))).toEqual(['c', 'a']);
          expect(unwrap(await repository.restoreAll([]))).toEqual([]);
        }));
    });

    describe('tombstones that have lived their time', () => {
      it('are removed after the time that a tombstone lives, and not a moment before', () =>
        withHarness(
          async ({ repository, clock }) => {
            await repository.create({ id: 'a', name: 'a', document: emptyDocument() });
            await repository.softDelete('a');

            clock.advance(999);
            expect(unwrap(await repository.purgeExpired())).toBe(0);
            clock.advance(1);
            expect(unwrap(await repository.purgeExpired())).toBe(1);
            expect(unwrap(await repository.estimate())).toMatchObject({ canvases: 0, tombstones: 0, bytes: 0 });
          },
          { tombstoneTtlMs: 1000 },
        ));

      it('live for a minute unless the repository is told otherwise', () =>
        withHarness(async ({ repository, clock }) => {
          expect(TOMBSTONE_TTL_MS).toBe(60_000);
          await repository.create({ id: 'a', name: 'a', document: emptyDocument() });
          await repository.softDelete('a');

          clock.advance(59_999);
          expect(unwrap(await repository.purgeExpired())).toBe(0);
          clock.advance(1);
          expect(unwrap(await repository.purgeExpired())).toBe(1);
        }));

      it('cannot be brought back once they are removed', () =>
        withHarness(async ({ repository, clock }) => {
          await repository.create({ id: 'a', name: 'a', document: emptyDocument() });
          await repository.softDelete('a');
          clock.advance(TOMBSTONE_TTL_MS);
          await repository.purgeExpired();

          expect(errorKind(await repository.restore('a'))).toBe('not-found');
          expect(errorKind(await repository.get('a'))).toBe('not-found');
        }));

      it('are all that is removed: canvases are not, and nor are tombstones that are young', () =>
        withHarness(async ({ repository, clock }) => {
          for (const id of ['old', 'young', 'live']) {
            await repository.create({ id, name: id, document: emptyDocument() });
          }
          await repository.softDelete('old');
          clock.advance(50_000);
          await repository.softDelete('young');
          clock.advance(20_000);

          expect(unwrap(await repository.purgeExpired())).toBe(1);
          expect(unwrap(await repository.estimate())).toMatchObject({ canvases: 1, tombstones: 1 });
          expect(unwrap(await repository.get('live')).name).toBe('live');
          expect(unwrap(await repository.restoreAll(['old', 'young']))).toEqual(['young']);
        }));

      it('are removed by another start of the app, which is when the app asks', () =>
        withHarness(async (harness) => {
          await harness.repository.create({ id: 'a', name: 'a', document: emptyDocument() });
          await harness.repository.softDelete('a');
          harness.clock.advance(TOMBSTONE_TTL_MS);

          expect(unwrap(await harness.another().purgeExpired())).toBe(1);
        }));
    });

    describe('a canvas that cannot be read', () => {
      it('is listed apart, with its id, its name if it has one, and why, and does not hide the others', () =>
        withHarness(async (harness) => {
          await harness.repository.create({ id: 'fine', name: 'fine', document: sampleDocument() });
          await plant(harness, raw('z-newer', { document: { ...plainDocument(), schemaVersion: 2 } }));
          await plant(harness, raw('a-fields', { createdAt: 'yesterday', colour: 'red' }));
          await plant(harness, raw('m-document', { document: 'not a document' }));
          await plant(harness, { id: 'no-name', createdAt: 1, updatedAt: 2, document: plainDocument() });

          const listing = unwrap(await harness.repository.list());

          expect(listing.canvases.map(({ id }) => id)).toEqual(['fine']);
          expect(listing.unreadable.map(({ id, name, error }) => [id, name, error.kind])).toEqual([
            ['a-fields', 'Canvas a-fields', 'invalid'],
            ['m-document', 'Canvas m-document', 'not-an-object'],
            ['no-name', undefined, 'invalid'],
            ['z-newer', 'Canvas z-newer', 'newer-version'],
          ]);
        }));

      it('gives the error when it is read, so that the app can say why', () =>
        withHarness(async (harness) => {
          await plant(harness, raw('newer', { document: { ...plainDocument(), schemaVersion: 3 } }));
          const result = await harness.repository.get('newer');

          expect(result).toMatchObject({
            ok: false,
            error: { kind: 'newer-version', of: 'schema', found: 3, understood: 1 },
          });
          expect(!result.ok && result.error.message).toContain('Reload the page to get the newest version');
        }));

      it('is a canvas that is too big, as far as the list can see, and says so', () =>
        withHarness(async (harness) => {
          const big = {
            ...plainDocument(),
            exchanges: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`e${i}`, {}])),
          };
          await plant(harness, raw('big', { document: big }));

          expect(unwrap(await harness.repository.list()).unreadable).toMatchObject([
            { id: 'big', error: { kind: 'too-large', what: 'elements' } },
          ]);
        }));

      it('is a canvas with a deletion that is not a time, which is not a tombstone but a record that is wrong', () =>
        withHarness(async (harness) => {
          await plant(harness, raw('odd', { deletedAt: 'when?' }));
          await plant(harness, raw('nan', { deletedAt: NaN }));

          expect(unwrap(await harness.repository.list()).unreadable.map(({ id }) => id)).toEqual(['nan', 'odd']);
          expect(unwrap(await harness.repository.purgeExpired())).toBe(0);
        }));

      it('is read as a canvas that has none when its deletion is undefined, as the browser may keep it', () =>
        withHarness(async (harness) => {
          await plant(harness, raw('old', { deletedAt: undefined }));

          expect(unwrap(await harness.repository.get('old')).name).toBe('Canvas old');
        }));
    });

    describe('the meta store', () => {
      const values = [
        ['lastOpenCanvas', 'c1', 'c2'],
        ['lastBackupAt', 1_791_273_384_000, 0],
        ['backupReminderSnoozedUntil', 5, 1_791_273_384_001],
      ] as const;

      it.each(values)('keeps %s, replaces it, and forgets it', (key, first, second) =>
        withHarness(async ({ repository }) => {
          expect(unwrap(await repository.getMeta(key))).toBeUndefined();
          unwrap(await repository.setMeta(key, first as never));
          expect(unwrap(await repository.getMeta(key))).toBe(first);
          unwrap(await repository.setMeta(key, second as never));
          expect(unwrap(await repository.getMeta(key))).toBe(second);
          unwrap(await repository.deleteMeta(key));
          expect(unwrap(await repository.getMeta(key))).toBeUndefined();
          unwrap(await repository.deleteMeta(key));
        }),
      );

      it('keeps each value apart from the others, and from the canvases', () =>
        withHarness(async ({ repository }) => {
          await repository.create({ id: 'lastOpenCanvas', name: 'n', document: emptyDocument() });
          unwrap(await repository.setMeta('lastOpenCanvas', 'c1'));
          unwrap(await repository.setMeta('lastBackupAt', 7));

          expect(unwrap(await repository.getMeta('lastOpenCanvas'))).toBe('c1');
          expect(unwrap(await repository.getMeta('lastBackupAt'))).toBe(7);
          expect(unwrap(await repository.getMeta('backupReminderSnoozedUntil'))).toBeUndefined();
          expect(unwrap(await repository.list()).canvases).toHaveLength(1);
          expect(unwrap(await repository.estimate())).toMatchObject({ canvases: 1 });
        }));

      it.each([
        ['lastOpenCanvas', 'not an id'],
        ['lastOpenCanvas', 5],
        ['lastBackupAt', -1],
        ['lastBackupAt', 'yesterday'],
        ['backupReminderSnoozedUntil', NaN],
      ] as const)('does not keep %s as %j, and says what it has to be', (key, value) =>
        withHarness(async ({ repository }) => {
          const result = await repository.setMeta(key as MetaKey, value as never);

          expect(errorKind(result)).toBe('invalid');
          expect(!result.ok && result.error.message).toContain(`${key}: this has to be `);
          expect(unwrap(await repository.getMeta(key))).toBeUndefined();
        }),
      );

      it('reads a value that is not what its key says as not there, which is how a value of another version looks', () =>
        withHarness(async (harness) => {
          await harness.store.transact('readwrite', async (tx) => {
            await tx.putMeta('lastOpenCanvas', { not: 'an id' });
            await tx.putMeta('lastBackupAt', 'yesterday');
            await tx.putMeta('backupReminderSnoozedUntil', -5);
          });

          expect(unwrap(await harness.repository.getMeta('lastOpenCanvas'))).toBeUndefined();
          expect(unwrap(await harness.repository.getMeta('lastBackupAt'))).toBeUndefined();
          expect(unwrap(await harness.repository.getMeta('backupReminderSnoozedUntil'))).toBeUndefined();
        }));
    });

    describe('what the repository holds', () => {
      it('is nothing when it is empty', () =>
        withHarness(async ({ repository }) => {
          expect(unwrap(await repository.estimate())).toEqual({ canvases: 0, tombstones: 0, bytes: 0 });
        }));

      it('is how many canvases, how many tombstones, and how many bytes the records come to as JSON', () =>
        withHarness(async (harness) => {
          const a = unwrap(await harness.repository.create({ id: 'a', name: 'Orders', document: sampleDocument() }));
          const b = unwrap(await harness.repository.create({ id: 'b', name: '日本語', document: emptyDocument() }));
          unwrap(await harness.repository.softDelete('b'));

          const size = (record: unknown) => utf8Length(JSON.stringify(record));
          const estimate = unwrap(await harness.repository.estimate());

          expect(estimate).toMatchObject({ canvases: 1, tombstones: 1 });
          expect(estimate.bytes).toBe(size(a) + size({ ...b, deletedAt: harness.clock.now() }));
        }));

      it('counts a canvas that cannot be read, which is there, and its bytes, however odd it is', () =>
        withHarness(async (harness) => {
          await plant(harness, { id: 'odd', value: 10n });
          await plant(harness, raw('plain'));
          const estimate = unwrap(await harness.repository.estimate());

          expect(estimate.canvases).toBe(2);
          expect(estimate.bytes).toBe(utf8Length(JSON.stringify(raw('plain'))));
        }));
    });

    describe('when the browser says no', () => {
      interface Answer {
        readonly ok: boolean;
        readonly error?: { readonly message: string };
      }
      const calls: readonly (readonly [string, (repository: CanvasRepository) => Promise<Answer>])[] = [
        ['list', (r) => r.list()],
        ['get', (r) => r.get('c1')],
        ['create', (r) => r.create({ name: 'n', document: emptyDocument() })],
        ['save', (r) => r.save('c1', { name: 'n' })],
        ['put', (r) => r.put({ id: 'x', name: 'n', createdAt: 1, updatedAt: 2, document: emptyDocument() })],
        ['softDelete', (r) => r.softDelete('c1')],
        ['softDeleteAll', (r) => r.softDeleteAll()],
        ['restore', (r) => r.restore('c1')],
        ['restoreAll', (r) => r.restoreAll(['c1'])],
        ['purgeExpired', (r) => r.purgeExpired()],
        ['getMeta', (r) => r.getMeta('lastBackupAt')],
        ['setMeta', (r) => r.setMeta('lastBackupAt', 1)],
        ['deleteMeta', (r) => r.deleteMeta('lastBackupAt')],
        ['estimate', (r) => r.estimate()],
      ];

      it.each(calls)('%s answers that there is no room, and does not throw', (_name, call) =>
        withHarness(async (harness) => {
          const refusing = createCanvasRepository(failingOnce(harness.store, named('QuotaExceededError')), {
            now: harness.clock.now,
            newId: idSequence('c'),
          });
          const answer = await call(refusing);

          expect(answer).toMatchObject({ ok: false, error: { kind: 'quota-exceeded' } });
          expect(answer.error?.message).toContain('Nothing was saved.');
        }),
      );

      it('says what the store says when it knows, as it is', () =>
        withHarness(async (harness) => {
          const blocked = new StorageFailure({ kind: 'blocked', message: 'Close the other tabs.' });
          const refusing = createCanvasRepository(failingOnce(harness.store, blocked), {
            now: harness.clock.now,
            newId: idSequence('c'),
          });

          expect(await refusing.list()).toEqual({
            ok: false,
            error: { kind: 'blocked', message: 'Close the other tabs.' },
          });
        }));

      it('says that something failed, with the words of the browser, for anything else, even what is not an error', () =>
        withHarness(async (harness) => {
          const failing = (thrown: unknown) =>
            createCanvasRepository(failingOnce(harness.store, thrown), {
              now: harness.clock.now,
              newId: idSequence('c'),
            });

          expect(await failing(named('UnknownError', 'disk on fire')).list()).toMatchObject({
            ok: false,
            error: { kind: 'failed', detail: 'UnknownError: disk on fire' },
          });
          expect(await failing('just text').list()).toMatchObject({
            ok: false,
            error: { kind: 'failed', detail: 'just text' },
          });
        }));

      it('is a call that fails, and the next one that works, because nothing stays broken', () =>
        withHarness(async (harness) => {
          const once = createCanvasRepository(failingOnce(harness.store, named('QuotaExceededError')), {
            now: harness.clock.now,
            newId: idSequence('c'),
          });

          expect(errorKind(await once.create({ name: 'n', document: emptyDocument() }))).toBe('quota-exceeded');
          expect(unwrap(await once.list())).toEqual({ canvases: [], unreadable: [] });
          expect(unwrap(await once.create({ name: 'n', document: emptyDocument() })).id).toBe('c1');
        }));
    });

    describe('the store under it', () => {
      it('goes on working after it is closed, because it opens again', () =>
        withHarness(async ({ repository }) => {
          await repository.create({ id: 'a', name: 'a', document: emptyDocument() });
          await repository.close();

          expect(unwrap(await repository.list()).canvases.map(({ id }) => id)).toEqual(['a']);
        }));

      it('is the same for another start of the app: what was kept is there', () =>
        withHarness(async (harness) => {
          const made = unwrap(await harness.repository.create({ id: 'a', name: 'a', document: sampleDocument() }));
          await harness.repository.setMeta('lastOpenCanvas', 'a');
          const restarted = harness.another();

          expect(unwrap(await restarted.get('a'))).toEqual(made);
          expect(unwrap(await restarted.getMeta('lastOpenCanvas'))).toBe('a');
        }));
    });
  });
}

describeTheRepository('memory', async (options) => harnessOn(createMemoryStore(), options));

describeTheRepository('IndexedDB, by way of fake-indexeddb', async (options) => {
  // A database of its own for each spec, so that nothing one keeps is there for the next.
  globalThis.indexedDB = new IDBFactory();
  return harnessOn(createIdbStore(), options);
});
