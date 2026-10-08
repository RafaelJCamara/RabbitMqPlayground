import { emptyDocument } from '@rmq/domain';
import { arbDocument, deepFreeze, idSequence, manualClock, sampleDocument } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { LoadError, RepositoryError } from '../errors';
import { SIZE_CAPS } from '../load/caps';
import type { CanvasRecord } from '../record';
import { createMemoryStore } from '../repository/memory-store';
import { createCanvasRepository, type CanvasRepository } from '../repository/repository';
import { readBackup, type Backup, type BackupEntry } from './backup';
import { planRestore, restoreBackup, restoredName, sameValue } from './restore';

const record = (id: string, change: Partial<CanvasRecord> = {}): CanvasRecord => ({
  id,
  name: `Canvas ${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  document: sampleDocument(),
  ...change,
});

const entry = (canvas: CanvasRecord, position = 0): BackupEntry => ({ ok: true, position, canvas });

const newer: LoadError = {
  kind: 'newer-version',
  of: 'schema',
  found: 9,
  understood: 1,
  message: 'This canvas was saved by a newer version.',
};

const refused: BackupEntry = { ok: false, position: 2, name: 'Broken', error: newer };

/** Text that has half of a pair of code units that make one character, at either end of it. */
function hasLoneSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true;
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

describe('sameValue', () => {
  it.each([
    ['the same number', 1, 1, true],
    ['two numbers', 1, 2, false],
    ['a number and its text', 1, '1', false],
    ['null and nothing', null, undefined, false],
    ['null and null', null, null, true],
    ['an object and null', {}, null, false],
    ['null and an object', null, {}, false],
    ['an empty list and an empty object', [], {}, false],
    ['an empty object and an empty list', {}, [], false],
    ['the same list', [1, [2, 3]], [1, [2, 3]], true],
    ['lists in another order', [1, 2], [2, 1], false],
    ['a list that is longer', [1, 2], [1, 2, 3], false],
    ['a list that is shorter', [1, 2, 3], [1, 2], false],
    ['objects with their keys in another order', { a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 }, true],
    ['an object with a key more', { a: 1 }, { a: 1, b: 2 }, false],
    ['an object with a key fewer', { a: 1, b: 2 }, { a: 1 }, false],
    ['an object with another key of the same number', { a: 1 }, { b: 1 }, false],
    ['an object whose key holds undefined and one that lacks it', { a: undefined }, {}, false],
    ['an object with a value that differs deep inside', { a: [{ b: 1 }] }, { a: [{ b: 2 }] }, false],
    ['a key that is inherited and one that is its own', { a: 1 }, Object.create({ a: 1 }) as object, false],
  ] as const)('says that %s are %s', (_what, a, b, same) => {
    expect(sameValue(a, b)).toBe(same);
    expect(sameValue(b, a)).toBe(same);
  });

  /** The same data with the keys of every object written in the other order. */
  const reversed = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reversed)
      : typeof value === 'object' && value !== null
        ? Object.fromEntries(
            Object.entries(value)
              .reverse()
              .map(([key, item]) => [key, reversed(item)]),
          )
        : value;

  it('holds a canvas to be the same as a copy of it, and as a copy with its keys in another order, for any canvas', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        expect(sameValue(document, structuredClone(document))).toBe(true);
        expect(sameValue(document, reversed(document))).toBe(true);
        expect(sameValue(reversed(document), document)).toBe(true);
      }),
    );
  });

  it('holds a canvas to be different from itself with one thing changed, for any canvas', () => {
    fc.assert(
      fc.property(arbDocument, fc.constantFrom('/', 'other'), (document, vhost) => {
        const changed = { ...document, vhost: document.vhost === vhost ? `${vhost}!` : vhost };
        expect(sameValue(document, changed)).toBe(false);
        const seeded = { ...document, settings: { ...document.settings, seed: document.settings.seed + 1 } };
        expect(sameValue(document, seeded)).toBe(false);
      }),
    );
  });
});

describe('restoredName', () => {
  it('adds what it is to a name', () => {
    expect(restoredName('Orders')).toBe('Orders (restored)');
  });

  it('leaves a name whole when the whole fits in the cap, to the last character', () => {
    const name = 'x'.repeat(SIZE_CAPS.name - ' (restored)'.length);

    expect(restoredName(name)).toBe(`${name} (restored)`);
    expect(restoredName(name)).toHaveLength(SIZE_CAPS.name);
  });

  it('cuts a name that would take the whole over the cap, by the one character that is too many', () => {
    const name = 'x'.repeat(SIZE_CAPS.name - ' (restored)'.length + 1);

    expect(restoredName(name)).toHaveLength(SIZE_CAPS.name);
    expect(restoredName(name)).toBe(`${name.slice(0, -1)} (restored)`);
  });

  it('never makes a name longer than the cap, for any name that is within it', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: SIZE_CAPS.name }), (name) => {
        expect(restoredName(name).length).toBeLessThanOrEqual(SIZE_CAPS.name);
        expect(restoredName(name).endsWith(' (restored)')).toBe(true);
      }),
    );
  });

  it('does not cut a character in half', () => {
    const name = `${'x'.repeat(SIZE_CAPS.name - ' (restored)'.length - 1)}😀 and more`;

    const cut = restoredName(name);

    expect(cut).toBe(`${'x'.repeat(SIZE_CAPS.name - ' (restored)'.length - 1)} (restored)`);
    expect(hasLoneSurrogate(cut)).toBe(false);
  });

  it('cuts a name of surrogates at a character, where the cut falls in the middle of one', () => {
    const emoji = '😀'.repeat(SIZE_CAPS.name / 2);

    const cut = restoredName(emoji);

    expect(hasLoneSurrogate(cut)).toBe(false);
    expect(cut.endsWith(' (restored)')).toBe(true);
    expect(cut.length).toBeLessThanOrEqual(SIZE_CAPS.name);
  });
});

describe('planRestore', () => {
  const nothing = { canvases: [], unreadableIds: [] };

  it('puts a canvas back as it was when its id is free', () => {
    const canvas = record('a');

    expect(planRestore([entry(canvas)], nothing)).toEqual([{ kind: 'put', record: canvas }]);
  });

  it('leaves a canvas alone when the same one is here, down to the order of the keys', () => {
    const canvas = record('a');
    const here = record('a', { updatedAt: 9999, document: structuredClone(canvas.document) });

    expect(planRestore([entry(canvas)], { canvases: [here], unreadableIds: [] })).toEqual([
      { kind: 'skip', record: canvas },
    ]);
  });

  it('makes a copy when the id is taken by a canvas with another name', () => {
    const canvas = record('a');
    const here = record('a', { name: 'Renamed' });

    expect(planRestore([entry(canvas)], { canvases: [here], unreadableIds: [] })).toEqual([
      { kind: 'copy', name: 'Canvas a (restored)', document: canvas.document, of: canvas },
    ]);
  });

  it('makes a copy when the id is taken by a canvas with another document', () => {
    const canvas = record('a');
    const here = record('a', { document: emptyDocument() });

    expect(planRestore([entry(canvas)], { canvases: [here], unreadableIds: [] })).toEqual([
      { kind: 'copy', name: 'Canvas a (restored)', document: canvas.document, of: canvas },
    ]);
  });

  it('makes a copy when the id is taken by a canvas that cannot be read, which is never written over', () => {
    const canvas = record('a');

    expect(planRestore([entry(canvas)], { canvases: [], unreadableIds: ['a'] })).toEqual([
      { kind: 'copy', name: 'Canvas a (restored)', document: canvas.document, of: canvas },
    ]);
  });

  it('says where a canvas that could not be read was, and what the file called it, and goes on with the others', () => {
    const plan = planRestore([entry(record('a'), 0), refused, entry(record('b'), 3)], nothing);

    expect(plan.map((step) => step.kind)).toEqual(['put', 'unreadable', 'put']);
    expect(plan[1]).toEqual({ kind: 'unreadable', position: 2, name: 'Broken', error: newer });
  });

  it('leaves out the name of a canvas that could not be read when the file did not give one', () => {
    const nameless: BackupEntry = { ok: false, position: 0, error: newer };

    expect(planRestore([nameless], nothing)).toEqual([{ kind: 'unreadable', position: 0, error: newer }]);
  });

  it('plans every canvas of the file, in its order, whatever is here', () => {
    const entries = [entry(record('a'), 0), entry(record('b'), 1), entry(record('c'), 2)];

    const plan = planRestore(entries, { canvases: [record('b')], unreadableIds: ['c'] });

    expect(plan.map((step) => step.kind)).toEqual(['put', 'skip', 'copy']);
  });
});

describe('restoreBackup', () => {
  function harness(options: { readonly wrap?: (repository: CanvasRepository) => CanvasRepository } = {}) {
    const clock = manualClock(1_000_000);
    const store = createMemoryStore();
    const base = createCanvasRepository(store, { now: clock.now, newId: idSequence('new') });
    return { store, base, repository: options.wrap?.(base) ?? base };
  }

  const backupOf = (...entries: BackupEntry[]): Backup => ({ exportedAt: 5, entries });

  const names = async (repository: CanvasRepository): Promise<string[]> => {
    const listed = await repository.list();
    return listed.ok ? listed.value.canvases.map((canvas) => canvas.name).sort() : [];
  };

  it('puts back what is not here, as the file has it: the id, the times and the document', async () => {
    const { repository } = harness();
    const canvas = record('a', { createdAt: 11, updatedAt: 22 });

    const report = await restoreBackup(repository, backupOf(entry(canvas)));

    expect(report.ok && report.value).toEqual({
      restored: [{ id: 'a', name: 'Canvas a' }],
      alreadyHere: [],
      copies: [],
      unreadable: [],
      failed: [],
    });
    const got = await repository.get('a');
    expect(got.ok && got.value).toEqual(canvas);
  });

  it('writes nothing for a canvas that is here already, and so makes nothing new when the same backup is put back twice', async () => {
    const { repository } = harness();
    const backup = backupOf(entry(record('a')), entry(record('b'), 1));

    await restoreBackup(repository, backup);
    const again = await restoreBackup(repository, backup);

    expect(again.ok && again.value).toMatchObject({
      restored: [],
      alreadyHere: [
        { id: 'a', name: 'Canvas a' },
        { id: 'b', name: 'Canvas b' },
      ],
      copies: [],
    });
    expect(await names(repository)).toEqual(['Canvas a', 'Canvas b']);
  });

  it('makes a new canvas, and leaves the one that is here as it is, when the id is taken by another', async () => {
    const { repository } = harness();
    await repository.create({ id: 'a', name: 'Mine', document: emptyDocument() });
    const canvas = record('a');

    const report = await restoreBackup(repository, backupOf(entry(canvas)));

    expect(report.ok && report.value.copies).toEqual([{ id: 'new1', name: 'Canvas a (restored)', of: 'Canvas a' }]);
    expect(await names(repository)).toEqual(['Canvas a (restored)', 'Mine']);
    const mine = await repository.get('a');
    expect(mine.ok && mine.value.document).toEqual(emptyDocument());
    const copy = await repository.get('new1');
    expect(copy.ok && copy.value.document).toEqual(canvas.document);
  });

  it('does not write over a canvas that cannot be read, and makes a new one beside it', async () => {
    const { repository, store } = harness();
    await store.transact('readwrite', async (transaction) =>
      transaction.putRecord({
        id: 'a',
        name: 'From a newer app',
        createdAt: 1,
        updatedAt: 1,
        document: { schemaVersion: 99 },
      }),
    );

    const report = await restoreBackup(repository, backupOf(entry(record('a'))));

    expect(report.ok && report.value.copies.map(({ name }) => name)).toEqual(['Canvas a (restored)']);
    const listed = await repository.list();
    expect(listed.ok && listed.value.unreadable.map(({ id }) => id)).toEqual(['a']);
    const raw = await store.transact('readonly', (transaction) => transaction.getRecord('a'));
    expect(raw?.['name']).toBe('From a newer app');
  });

  it('puts a canvas back over a tombstone of the same id, which is a canvas that was deleted a moment ago', async () => {
    const { repository } = harness();
    await repository.create({ id: 'a', name: 'Deleted', document: emptyDocument() });
    await repository.softDelete('a');

    const report = await restoreBackup(repository, backupOf(entry(record('a'))));

    expect(report.ok && report.value.restored).toEqual([{ id: 'a', name: 'Canvas a' }]);
    const got = await repository.get('a');
    expect(got.ok && got.value.name).toBe('Canvas a');
  });

  it('lists a canvas that could not be read with its place in the file counted from 1, and goes on', async () => {
    const { repository } = harness();

    const report = await restoreBackup(repository, backupOf(entry(record('a'), 0), refused, entry(record('b'), 3)));

    expect(report.ok && report.value.unreadable).toEqual([
      { position: 3, name: 'Broken', message: 'This canvas was saved by a newer version.' },
    ]);
    expect(report.ok && report.value.restored.map(({ id }) => id)).toEqual(['a', 'b']);
  });

  it('lists a canvas that could not be written, with the reason, and goes on with the rest', async () => {
    const failing: RepositoryError = {
      kind: 'failed',
      message: 'The browser failed to read or save canvases (boom).',
      detail: 'boom',
    };
    const { repository } = harness({
      wrap: (base) => ({
        ...base,
        put: async (canvas) => (canvas.id === 'a' ? { ok: false, error: failing } : base.put(canvas)),
      }),
    });

    const report = await restoreBackup(repository, backupOf(entry(record('a'), 0), entry(record('b'), 1)));

    expect(report.ok && report.value.failed).toEqual([{ name: 'Canvas a', message: failing.message }]);
    expect(report.ok && report.value.restored.map(({ id }) => id)).toEqual(['b']);
    expect(report.ok && report.value.outOfRoom).toBeUndefined();
  });

  it('lists a copy that could not be made, by the name that it would have had', async () => {
    const failing: RepositoryError = { kind: 'failed', message: 'It failed.', detail: 'x' };
    const { repository } = harness({
      wrap: (base) => ({ ...base, create: async () => ({ ok: false, error: failing }) }),
    });
    await repository.put(record('a', { name: 'Other' }));

    const report = await restoreBackup(repository, backupOf(entry(record('a'))));

    expect(report.ok && report.value.failed).toEqual([{ name: 'Canvas a (restored)', message: 'It failed.' }]);
  });

  it('stops at the first write that the browser refuses for lack of room, and says how many were not put back', async () => {
    const quota: RepositoryError = {
      kind: 'quota-exceeded',
      message: 'The browser has no room left to keep this canvas.',
    };
    let writes = 0;
    const { repository } = harness({
      wrap: (base) => ({
        ...base,
        put: async (canvas) => {
          writes += 1;
          return writes > 1 ? { ok: false, error: quota } : base.put(canvas);
        },
      }),
    });
    const backup = backupOf(
      entry(record('a'), 0),
      entry(record('b'), 1),
      entry(record('c'), 2),
      refused,
      entry(record('d'), 4),
    );

    const report = await restoreBackup(repository, backup);

    expect(writes).toBe(2);
    expect(report.ok && report.value.restored.map(({ id }) => id)).toEqual(['a']);
    expect(report.ok && report.value.outOfRoom).toEqual({ message: quota.message, notPutBack: 3 });
    expect(report.ok && report.value.failed).toEqual([]);
  });

  it('counts the copies that were not made as well as the canvases that were not put back', async () => {
    const quota: RepositoryError = { kind: 'quota-exceeded', message: 'No room.' };
    const { repository } = harness({
      wrap: (base) => ({ ...base, create: async () => ({ ok: false, error: quota }) }),
    });
    await repository.put(record('a', { name: 'Other' }));
    await repository.put(record('b', { name: 'Other' }));

    const report = await restoreBackup(
      repository,
      backupOf(entry(record('a'), 0), entry(record('b'), 1), entry(record('c'), 2)),
    );

    expect(report.ok && report.value.outOfRoom).toEqual({ message: 'No room.', notPutBack: 3 });
    expect(report.ok && report.value.restored).toEqual([]);
  });

  it('fails, and writes nothing, when the repository cannot be read', async () => {
    const error: RepositoryError = {
      kind: 'unavailable',
      message: 'The browser does not let this site keep canvases.',
    };
    const { repository } = harness({ wrap: (base) => ({ ...base, list: async () => ({ ok: false, error }) }) });

    const report = await restoreBackup(repository, backupOf(entry(record('a'))));

    expect(!report.ok && report.error).toEqual(error);
  });

  it('puts back the same canvases from the text of a backup as from the backup that was read', async () => {
    const { repository } = harness();
    const text = JSON.stringify({
      format: 'rmq-playground/backup',
      version: 1,
      exportedAt: 7,
      canvases: [record('a'), record('b', { name: 'Two' })],
    });

    const read = readBackup(JSON.parse(text) as unknown);
    const report = read.ok ? await restoreBackup(repository, read.value) : undefined;

    expect(report?.ok && report.value.restored).toEqual([
      { id: 'a', name: 'Canvas a' },
      { id: 'b', name: 'Two' },
    ]);
  });

  describe('for any backup', () => {
    const arbBackup = fc
      .array(
        fc.tuple(
          arbDocument,
          fc.string({ minLength: 1, maxLength: 30 }).filter((name) => /\S/.test(name)),
        ),
        {
          maxLength: 4,
        },
      )
      .map((parts): Backup =>
        backupOf(
          ...parts.map(([document, name], index) =>
            entry(
              { id: `id-${index}`, name, createdAt: index, updatedAt: index + 5, document: deepFreeze(document) },
              index,
            ),
          ),
        ),
      );

    it('makes nothing new the second time that it is put back, and the first time puts back every canvas of it', async () => {
      await fc.assert(
        fc.asyncProperty(arbBackup, async (backup) => {
          const { repository } = harness();

          const first = await restoreBackup(repository, backup);
          const second = await restoreBackup(repository, backup);

          expect(first.ok && first.value.restored).toHaveLength(backup.entries.length);
          expect(second.ok && second.value.alreadyHere).toHaveLength(backup.entries.length);
          expect(second.ok && second.value.restored).toHaveLength(0);
          expect(second.ok && second.value.copies).toHaveLength(0);
          const listed = await repository.list();
          expect(listed.ok && listed.value.canvases).toHaveLength(backup.entries.length);
        }),
      );
    });

    it('never changes a canvas that was here, whatever the file holds', async () => {
      await fc.assert(
        fc.asyncProperty(arbBackup, arbDocument, async (backup, mine) => {
          const { repository } = harness();
          for (const [index] of backup.entries.entries()) {
            await repository.create({ id: `id-${index}`, name: 'Mine', document: mine });
          }
          const before = await repository.list();

          const report = await restoreBackup(repository, backup);

          const after = await repository.list();
          for (const kept of before.ok ? before.value.canvases : []) {
            const now = after.ok ? after.value.canvases.find(({ id }) => id === kept.id) : undefined;
            expect(now).toEqual(kept);
          }
          expect(report.ok && report.value.restored).toHaveLength(0);
          expect(report.ok && report.value.copies.length + report.value.alreadyHere.length).toBe(backup.entries.length);
        }),
      );
    });
  });
});
