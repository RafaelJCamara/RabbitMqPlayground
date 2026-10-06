import { emptyDocument, validateDocument, type CanvasDocument } from '@rmq/domain';
import { arbDocument, idSequence, manualClock, manualTimer, sampleDocument } from '@rmq/testing';
import 'fake-indexeddb/auto';
import * as fc from 'fast-check';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createAutosave } from './autosave';
import type { LoadError, RepositoryError } from './errors';
import { parseBackup, writeBackup } from './files/backup';
import { parseCanvasFile, readCanvasFile, writeCanvasFile } from './files/canvas-file';
import { CANVAS_FILE_FORMAT, CANVAS_FILE_VERSION } from './files/formats';
import { loadCanvas } from './load/load';
import { failure, succeed, type Outcome } from './outcome';
import type { CanvasRecord } from './record';
import { createIdbStore } from './repository/idb-store';
import { createMemoryStore } from './repository/memory-store';
import { createCanvasRepository, type CanvasRepository, type MetaKey } from './repository/repository';
import type { RecordStore } from './repository/store';

/**
 * The properties that ADR-0015 and ADR-0027 ask of persistence. The seed and the number of runs come from FC_SEED and
 * FC_NUM_RUNS: a normal run explores the same cases every time, and the nightly fuzz job runs 5,000 of them with a seed of its own.
 *
 * A canvas that goes through JSON comes back the same through JSON, and not otherwise: JSON writes a zero with a sign as a zero.
 * IndexedDB copies, and does not write text, so it keeps the sign.
 */

const viaJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

const ERROR_KINDS: ReadonlySet<string> = new Set([
  'not-json',
  'not-an-object',
  'unknown-format',
  'newer-version',
  'unsupported-version',
  'migration-failed',
  'too-large',
  'invalid',
]);

/** What a refusal has to be: one of the kinds that there are, with a sentence, and every issue of an invalid one with its own. */
function expectTyped(error: LoadError): void {
  expect(ERROR_KINDS.has(error.kind), error.kind).toBe(true);
  expect(typeof error.message).toBe('string');
  expect(error.message.length).toBeGreaterThan(10);
  if (error.kind === 'invalid') {
    expect(error.issues.length).toBeGreaterThan(0);
    for (const issue of error.issues) {
      expect(issue.message.length).toBeGreaterThan(0);
    }
  }
}

describe('saving and loading', () => {
  const arbName = fc.constantFrom('Orders', '日本語', 'a "quoted" name', ' padded ', 'x'.repeat(200), '😀');

  it('gives back the same canvas from a file, through JSON, for any canvas that commands made', () => {
    fc.assert(
      fc.property(arbDocument, arbName, (document, name) => {
        const written = writeCanvasFile({ name, document });
        expect(written.ok).toBe(true);
        const read = written.ok ? parseCanvasFile(written.value) : undefined;

        expect(read?.ok).toBe(true);
        if (read?.ok) {
          expect(read.value.name).toBe(name);
          expect(viaJson(read.value.document)).toEqual(viaJson(document));
          expect(validateDocument(read.value.document)).toEqual([]);
        }
      }),
    );
  });

  it('gives back the same text when a canvas that was read is written again', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        const first = writeCanvasFile({ name: 'n', document });
        const read = first.ok ? parseCanvasFile(first.value) : undefined;
        const second = read?.ok ? writeCanvasFile(read.value) : undefined;

        expect(first.ok && second?.ok && second.value).toBe(first.ok && first.value);
      }),
    );
  });

  it('gives back the same canvases from a backup, through JSON, with their ids and times', () => {
    const arbRecords = fc.array(arbDocument, { minLength: 0, maxLength: 4 }).chain((documents) =>
      fc.constant(
        documents.map((document, index): CanvasRecord => ({
          id: `id-${index}`,
          name: `Canvas ${index}`,
          createdAt: index * 1000,
          updatedAt: index * 1000 + 7,
          document,
        })),
      ),
    );

    fc.assert(
      fc.property(arbRecords, fc.nat(2 ** 40), (records, exportedAt) => {
        const written = writeBackup(records, { exportedAt });
        const read = written.ok ? parseBackup(written.value) : undefined;

        expect(read?.ok).toBe(true);
        if (read?.ok) {
          expect(read.value.exportedAt).toBe(exportedAt);
          expect(read.value.entries.every((entry) => entry.ok)).toBe(true);
          expect(viaJson(read.value.entries.map((entry) => entry.ok && entry.canvas))).toEqual(viaJson(records));
        }
      }),
    );
  });

  it('gives back the very same canvas from a repository, down to the sign of a zero, in memory and on IndexedDB', async () => {
    const runs = Math.min(fc.readConfigureGlobal().numRuns ?? 100, 1000);
    const onIndexedDb = (): RecordStore => {
      globalThis.indexedDB = new IDBFactory();
      return createIdbStore();
    };
    for (const make of [createMemoryStore, onIndexedDb]) {
      await fc.assert(
        fc.asyncProperty(arbDocument, async (document) => {
          const store = make();
          const repository = createCanvasRepository(store, { now: manualClock().now, newId: idSequence('c') });
          const made = await repository.create({ name: 'n', document });
          const read = made.ok ? await repository.get(made.value.id) : made;
          await store.close();

          expect(read.ok).toBe(true);
          expect(read.ok && read.value.document).toEqual(document);
          expect(read.ok && read.value).toEqual(made.ok && made.value);
        }),
        { numRuns: runs },
      );
    }
  });
});

describe('loadCanvas', () => {
  const arbAnything = fc.anything({
    maxDepth: 4,
    withBigInt: true,
    withDate: true,
    withMap: true,
    withSet: true,
    withNullPrototype: true,
    withObjectString: true,
    withTypedArray: true,
    withSparseArray: true,
    withBoxedValues: true,
  });

  /** An object that looks like a document up to a point, whose parts are anything, so that the data gets past the first check. */
  const arbAlmostADocument = fc.record({
    schemaVersion: fc.oneof(fc.constant(1), arbAnything),
    rabbitmqBaseline: fc.oneof(fc.constant('4.3'), arbAnything),
    vhost: fc.oneof(fc.constant('/'), arbAnything),
    exchanges: arbAnything,
    queues: arbAnything,
    bindings: arbAnything,
    producers: arbAnything,
    consumers: arbAnything,
    layout: fc.oneof(fc.record({ nodes: arbAnything, labels: arbAnything }), arbAnything),
    settings: arbAnything,
  });

  it('never throws, for anything at all, and says what is wrong in a typed error', () => {
    fc.assert(
      fc.property(arbAnything, (raw) => {
        const result = loadCanvas(raw);

        expect(typeof result.ok).toBe('boolean');
        if (!result.ok) {
          expectTyped(result.error);
        }
      }),
    );
  });

  it('never throws for data that looks like a canvas up to a point, and what it lets through is right', () => {
    fc.assert(
      fc.property(arbAlmostADocument, (raw) => {
        const result = loadCanvas(raw);

        if (result.ok) {
          expect(validateDocument(result.value.document)).toEqual([]);
        } else {
          expectTyped(result.error);
        }
      }),
    );
  });

  it('never throws for text that is not JSON, or is JSON of anything, in a file or in a backup', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.string({ unit: 'binary' }),
          arbAnything.map((value) => safeJson(value) ?? ''),
        ),
        (text) => {
          for (const result of [parseCanvasFile(text), parseBackup(text)]) {
            expect(typeof result.ok).toBe('boolean');
            if (!result.ok) {
              expectTyped(result.error);
            }
          }
        },
      ),
    );
  });

  it('never throws when what it is given as text is not text', () => {
    fc.assert(
      fc.property(arbAnything, (value) => {
        for (const result of [parseCanvasFile(value as never), parseBackup(value as never)]) {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expectTyped(result.error);
          }
        }
      }),
    );
  });

  it('never throws for a file that is right with one part of it damaged, and what it lets through is right', () => {
    fc.assert(
      fc.property(arbDocument, arbDamage(), (document, damage) => {
        const written = writeCanvasFile({ name: 'Orders', document });
        const file = written.ok ? (JSON.parse(written.value) as Json) : null;
        const damaged = damage(file);

        const result = readCanvasFile(damaged);
        if (result.ok) {
          expect(validateDocument(result.value.document)).toEqual([]);
        } else {
          expectTyped(result.error);
        }
        // The text of it as well, when it can be written down.
        const text = safeJson(damaged);
        if (text !== undefined) {
          expect(() => parseCanvasFile(text)).not.toThrow();
        }
      }),
    );
  });

  it('refuses a file that has a key that it should not have, wherever the key is, because everything in it is strict', () => {
    fc.assert(
      fc.property(arbDocument, fc.nat(), (document, pick) => {
        const written = writeCanvasFile({ name: 'Orders', document });
        const file = written.ok ? (JSON.parse(written.value) as Json) : null;
        const objects = pathsOf(file).filter((path) => isObject(at(file, path)));
        const path = objects[pick % objects.length] ?? [];

        const damaged = edit(file, path, (node) => ({ ...(node as object), zzz: null }));
        const result = readCanvasFile(damaged);

        expect(result.ok, JSON.stringify(path)).toBe(false);
        if (!result.ok) {
          expectTyped(result.error);
        }
      }),
    );
  });

  it('refuses a file that lacks a part of its envelope, or whose version is not the one that it says', () => {
    fc.assert(
      fc.property(
        arbDocument,
        fc.constantFrom('format', 'version', 'name', 'document'),
        fc.integer(),
        (document, key, version) => {
          const written = writeCanvasFile({ name: 'Orders', document });
          const file = (written.ok ? JSON.parse(written.value) : {}) as Record<string, unknown>;
          const { [key]: _removed, ...without } = file;

          expect(readCanvasFile(without).ok).toBe(false);
          // A format version that is not 1 is either not a version or is newer: it is never read.
          fc.pre(version !== CANVAS_FILE_VERSION);
          expect(readCanvasFile({ ...file, version }).ok).toBe(false);
          expect(readCanvasFile({ ...file, format: `${CANVAS_FILE_FORMAT}-x` }).ok).toBe(false);
        },
      ),
    );
  });
});

/** The text of a value, or nothing if JSON cannot write it. */
function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Path = readonly (string | number)[];

const isObject = (value: unknown): value is Record<string, Json> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every place in a tree of JSON, the root included. */
function pathsOf(value: Json | undefined, prefix: Path = []): Path[] {
  if (Array.isArray(value)) {
    return [prefix, ...value.flatMap((inner, index) => pathsOf(inner, [...prefix, index]))];
  }
  if (isObject(value)) {
    return [prefix, ...Object.entries(value).flatMap(([key, inner]) => pathsOf(inner, [...prefix, key]))];
  }
  return [prefix];
}

const at = (root: Json | undefined, path: Path): unknown =>
  path.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key], root);

/** A copy of the tree with the node at the path replaced by what `change` makes of it. */
function edit(root: Json | undefined, path: Path, change: (node: unknown) => unknown): unknown {
  if (path.length === 0) {
    return change(root);
  }
  const copy = structuredClone(root) as Record<string | number, unknown>;
  const parent = path
    .slice(0, -1)
    .reduce<Record<string | number, unknown>>((node, key) => node[key] as Record<string | number, unknown>, copy);
  const key = path[path.length - 1] as string | number;
  parent[key] = change(parent[key]);
  return copy;
}

/** A way to damage a tree of JSON at some place that the damage itself picks: remove, replace, or turn into something else. */
function arbDamage(): fc.Arbitrary<(root: Json | null) => unknown> {
  const arbReplacement = fc.anything({ maxDepth: 2, withBigInt: true, withDate: true, withNullPrototype: true });
  return fc
    .record({
      pick: fc.nat(),
      kind: fc.constantFrom('remove', 'replace', 'null', 'wrong type', 'truncate'),
      replacement: arbReplacement,
    })
    .map(({ pick, kind, replacement }) => (root) => {
      const places = pathsOf(root ?? undefined);
      const path = places[pick % places.length] ?? [];
      switch (kind) {
        case 'remove': {
          if (path.length === 0) {
            return undefined;
          }
          const parentPath = path.slice(0, -1);
          const key = path[path.length - 1] as string | number;
          return edit(root ?? undefined, parentPath, (parent) => {
            if (Array.isArray(parent)) {
              return parent.filter((_, index) => index !== key);
            }
            const { [key as string]: _gone, ...rest } = parent as Record<string, unknown>;
            return rest;
          });
        }
        case 'replace':
          return edit(root ?? undefined, path, () => replacement);
        case 'null':
          return edit(root ?? undefined, path, () => null);
        case 'wrong type':
          return edit(root ?? undefined, path, (node) =>
            typeof node === 'string'
              ? 5
              : typeof node === 'number'
                ? String(node)
                : typeof node === 'boolean'
                  ? 0
                  : [node],
          );
        default:
          return edit(root ?? undefined, path, (node) =>
            Array.isArray(node)
              ? node.slice(0, Math.floor(node.length / 2))
              : typeof node === 'string'
                ? node.slice(0, 1)
                : node,
          );
      }
    });
}

// ---------------------------------------------------------------------------------------------------------------------
// The repository, against a model of it that is as simple as can be.

type Op =
  | { readonly t: 'create'; readonly doc: number; readonly name: number }
  | { readonly t: 'save'; readonly pick: number; readonly doc: number | undefined; readonly name: number | undefined }
  | { readonly t: 'delete'; readonly pick: number }
  | { readonly t: 'restore'; readonly pick: number }
  | { readonly t: 'deleteAll' }
  | { readonly t: 'restoreAll'; readonly picks: readonly number[] }
  | { readonly t: 'purge' }
  | { readonly t: 'tick'; readonly ms: number }
  | { readonly t: 'get'; readonly pick: number }
  | { readonly t: 'list' }
  | { readonly t: 'setMeta'; readonly key: number; readonly value: number }
  | { readonly t: 'getMeta'; readonly key: number }
  | { readonly t: 'deleteMeta'; readonly key: number }
  | { readonly t: 'estimate' };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  { weight: 6, arbitrary: fc.record({ t: fc.constant('create' as const), doc: fc.nat(), name: fc.nat() }) },
  {
    weight: 4,
    arbitrary: fc.record({
      t: fc.constant('save' as const),
      pick: fc.nat(),
      doc: fc.option(fc.nat(), { nil: undefined }),
      name: fc.option(fc.nat(), { nil: undefined }),
    }),
  },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('delete' as const), pick: fc.nat() }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('restore' as const), pick: fc.nat() }) },
  { weight: 1, arbitrary: fc.constant({ t: 'deleteAll' as const }) },
  {
    weight: 2,
    arbitrary: fc.record({ t: fc.constant('restoreAll' as const), picks: fc.array(fc.nat(), { maxLength: 5 }) }),
  },
  { weight: 2, arbitrary: fc.constant({ t: 'purge' as const }) },
  {
    weight: 4,
    arbitrary: fc.record({ t: fc.constant('tick' as const), ms: fc.constantFrom(1, 400, 999, 1000, 1001, 5000) }),
  },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('get' as const), pick: fc.nat() }) },
  { weight: 3, arbitrary: fc.constant({ t: 'list' as const }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('setMeta' as const), key: fc.nat(), value: fc.nat() }) },
  { weight: 2, arbitrary: fc.record({ t: fc.constant('getMeta' as const), key: fc.nat() }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('deleteMeta' as const), key: fc.nat() }) },
  { weight: 2, arbitrary: fc.constant({ t: 'estimate' as const }) },
);

const META_KEYS: readonly MetaKey[] = ['lastOpenCanvas', 'lastBackupAt', 'backupReminderSnoozedUntil'];
const NAMES = ['Orders', '日本語', 'a "quoted" name', ' padded ', 'x'.repeat(200)] as const;
const TTL = 1000;
const START = 1_000_000;

const metaValue = (key: MetaKey, value: number): string | number =>
  key === 'lastOpenCanvas' ? `c${value % 7}` : value;

/** What a call answers, with what does not matter taken out: an error is its kind, and a canvas is its fields. */
type Normal = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly kind: string };

const normalise = <T>(outcome: Outcome<T, RepositoryError>): Normal =>
  outcome.ok ? { ok: true, value: outcome.value } : { ok: false, kind: outcome.error.kind };

const rejected = (kind: string): Normal => ({ ok: false, kind });

interface Held {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt?: number;
  readonly document: CanvasDocument;
}

/** The repository as a list of records and a table of values, with no store and no rules but the ones in the ADR. */
class Model {
  private readonly records = new Map<string, Held>();
  private readonly meta = new Map<MetaKey, string | number>();
  private created = 0;
  now = START;

  constructor(private readonly documents: readonly CanvasDocument[]) {}

  private live = (): Held[] => [...this.records.values()].filter((record) => record.deletedAt === undefined);
  /** The id that a pick means: one of the canvases that there are, or one that there is not. */
  known = (pick: number): string => {
    const ids = [...this.records.keys()];
    return pick % (ids.length + 1) === ids.length ? 'nothing' : (ids[pick % (ids.length + 1)] as string);
  };

  /** The ids that an operation is about, before it is done. */
  idsOf(op: Op): string[] {
    switch (op.t) {
      case 'save':
      case 'delete':
      case 'restore':
      case 'get':
        return [this.known(op.pick)];
      case 'restoreAll':
        return op.picks.map(this.known);
      default:
        return [];
    }
  }

  step(op: Op): Normal {
    switch (op.t) {
      case 'create': {
        this.created += 1;
        const record: Held = {
          id: `c${this.created}`,
          name: NAMES[op.name % NAMES.length] as string,
          createdAt: this.now,
          updatedAt: this.now,
          document: this.documents[op.doc % this.documents.length] as CanvasDocument,
        };
        this.records.set(record.id, record);
        return { ok: true, value: record };
      }
      case 'save': {
        const record = this.records.get(this.known(op.pick));
        if (record === undefined || record.deletedAt !== undefined) {
          return rejected('not-found');
        }
        if (op.doc === undefined && op.name === undefined) {
          return { ok: true, value: record };
        }
        const next: Held = {
          ...record,
          name: op.name === undefined ? record.name : (NAMES[op.name % NAMES.length] as string),
          document:
            op.doc === undefined ? record.document : (this.documents[op.doc % this.documents.length] as CanvasDocument),
          updatedAt: this.now,
        };
        this.records.set(record.id, next);
        return { ok: true, value: next };
      }
      case 'delete': {
        const record = this.records.get(this.known(op.pick));
        if (record === undefined || record.deletedAt !== undefined) {
          return rejected('not-found');
        }
        this.records.set(record.id, { ...record, deletedAt: this.now });
        return { ok: true, value: undefined };
      }
      case 'restore': {
        const record = this.records.get(this.known(op.pick));
        if (record === undefined || record.deletedAt === undefined) {
          return rejected('not-found');
        }
        const { deletedAt: _deletedAt, ...live } = record;
        this.records.set(record.id, live);
        return { ok: true, value: undefined };
      }
      case 'deleteAll': {
        const ids = this.live()
          .map(({ id }) => id)
          .sort();
        for (const id of ids) {
          this.records.set(id, { ...(this.records.get(id) as Held), deletedAt: this.now });
        }
        return { ok: true, value: ids };
      }
      case 'restoreAll': {
        const restored: string[] = [];
        for (const pick of op.picks) {
          const record = this.records.get(this.known(pick));
          if (record !== undefined && record.deletedAt !== undefined) {
            const { deletedAt: _deletedAt, ...live } = record;
            this.records.set(record.id, live);
            restored.push(record.id);
          }
        }
        return { ok: true, value: restored };
      }
      case 'purge': {
        let purged = 0;
        for (const record of [...this.records.values()]) {
          if (record.deletedAt !== undefined && record.deletedAt <= this.now - TTL) {
            this.records.delete(record.id);
            purged += 1;
          }
        }
        return { ok: true, value: purged };
      }
      case 'tick':
        this.now += op.ms;
        return { ok: true, value: undefined };
      case 'get': {
        const record = this.records.get(this.known(op.pick));
        return record === undefined || record.deletedAt !== undefined
          ? rejected('not-found')
          : { ok: true, value: record };
      }
      case 'list': {
        const canvases = this.live().sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1));
        return { ok: true, value: { canvases, unreadable: [] } };
      }
      case 'setMeta': {
        const key = META_KEYS[op.key % META_KEYS.length] as MetaKey;
        this.meta.set(key, metaValue(key, op.value));
        return { ok: true, value: undefined };
      }
      case 'getMeta':
        return { ok: true, value: this.meta.get(META_KEYS[op.key % META_KEYS.length] as MetaKey) };
      case 'deleteMeta':
        this.meta.delete(META_KEYS[op.key % META_KEYS.length] as MetaKey);
        return { ok: true, value: undefined };
      case 'estimate': {
        const all = [...this.records.values()];
        return {
          ok: true,
          value: {
            canvases: all.filter((r) => r.deletedAt === undefined).length,
            tombstones: all.filter((r) => r.deletedAt !== undefined).length,
          },
        };
      }
    }
  }
}

/** What the repository does for the same operation. The ids that it is asked about are the ones that the model says. */
async function perform(
  repository: CanvasRepository,
  clock: { advance(ms: number): void },
  op: Op,
  ids: readonly string[],
  documents: readonly CanvasDocument[],
): Promise<Normal> {
  const [id] = ids as [string];
  switch (op.t) {
    case 'create':
      return normalise(
        await repository.create({
          name: NAMES[op.name % NAMES.length] as string,
          document: documents[op.doc % documents.length] as CanvasDocument,
        }),
      );
    case 'save':
      return normalise(
        await repository.save(id, {
          ...(op.name === undefined ? {} : { name: NAMES[op.name % NAMES.length] as string }),
          ...(op.doc === undefined ? {} : { document: documents[op.doc % documents.length] as CanvasDocument }),
        }),
      );
    case 'delete':
      return normalise(await repository.softDelete(id));
    case 'restore':
      return normalise(await repository.restore(id));
    case 'deleteAll':
      return normalise(await repository.softDeleteAll());
    case 'restoreAll':
      return normalise(await repository.restoreAll(ids));
    case 'purge':
      return normalise(await repository.purgeExpired());
    case 'tick':
      clock.advance(op.ms);
      return { ok: true, value: undefined };
    case 'get':
      return normalise(await repository.get(id));
    case 'list':
      return normalise(await repository.list());
    case 'setMeta': {
      const key = META_KEYS[op.key % META_KEYS.length] as MetaKey;
      return normalise(await repository.setMeta(key, metaValue(key, op.value) as never));
    }
    case 'getMeta':
      return normalise(await repository.getMeta(META_KEYS[op.key % META_KEYS.length] as MetaKey));
    case 'deleteMeta':
      return normalise(await repository.deleteMeta(META_KEYS[op.key % META_KEYS.length] as MetaKey));
    case 'estimate': {
      const estimate = await repository.estimate();
      return estimate.ok
        ? { ok: true, value: { canvases: estimate.value.canvases, tombstones: estimate.value.tombstones } }
        : normalise(estimate);
    }
  }
}

describe('the repository', () => {
  /** A few canvases to choose from, as a run of the property has: empty, full, and what commands made. */
  const documents: readonly CanvasDocument[] = [
    emptyDocument(),
    sampleDocument(),
    ...fc.sample(arbDocument, { numRuns: 6, seed: 4 }),
  ];

  const stores: readonly (readonly [string, () => RecordStore])[] = [
    ['in memory', createMemoryStore],
    [
      'on IndexedDB',
      () => {
        globalThis.indexedDB = new IDBFactory();
        return createIdbStore();
      },
    ],
  ];

  it.each(stores)('does what a plain list of records does, %s, for any run of operations', async (_name, makeStore) => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbOp, { minLength: 1, maxLength: 40 }), async (ops) => {
        const store = makeStore();
        const clock = manualClock(START);
        const repository = createCanvasRepository(store, {
          now: clock.now,
          newId: idSequence('c'),
          tombstoneTtlMs: TTL,
        });
        const model = new Model(documents);
        try {
          for (const op of ops) {
            const ids = model.idsOf(op);
            const expected = model.step(op);
            const actual = await perform(repository, clock, op, ids, documents);

            expect({ op: op.t, ...actual }).toEqual({ op: op.t, ...expected });
          }
        } finally {
          await store.close();
        }
      }),
      { numRuns: Math.min(fc.readConfigureGlobal().numRuns ?? 100, makeStore === createMemoryStore ? Infinity : 1500) },
    );
  });

  it('never holds a canvas that it cannot read back, whatever it was given', async () => {
    const arbGiven = fc.record({
      name: fc.oneof(fc.constantFrom('', ' ', 'ok', 'x'.repeat(201)), fc.anything() as fc.Arbitrary<string>),
      document: fc.oneof(arbDocument, fc.anything() as fc.Arbitrary<CanvasDocument>),
    });
    await fc.assert(
      fc.asyncProperty(arbGiven, async (given) => {
        const store = createMemoryStore();
        const repository = createCanvasRepository(store, { now: manualClock().now, newId: idSequence('c') });
        const made = await repository.create(given);
        const listing = await repository.list();

        expect(listing.ok && listing.value.unreadable).toEqual([]);
        if (made.ok) {
          expect(listing.ok && listing.value.canvases).toHaveLength(1);
        } else {
          expect(listing.ok && listing.value.canvases).toEqual([]);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------------

describe('autosave', () => {
  type Step =
    | { readonly t: 'schedule'; readonly value: number }
    | { readonly t: 'advance'; readonly ms: number }
    | { readonly t: 'flush' }
    | { readonly t: 'settle' }
    | { readonly t: 'room'; readonly has: boolean };

  const arbStep: fc.Arbitrary<Step> = fc.oneof(
    { weight: 5, arbitrary: fc.record({ t: fc.constant('schedule' as const), value: fc.nat(4) }) },
    {
      weight: 4,
      arbitrary: fc.record({ t: fc.constant('advance' as const), ms: fc.constantFrom(0, 100, 499, 500, 501, 2000) }),
    },
    { weight: 2, arbitrary: fc.constant({ t: 'flush' as const }) },
    { weight: 3, arbitrary: fc.constant({ t: 'settle' as const }) },
    { weight: 2, arbitrary: fc.record({ t: fc.constant('room' as const), has: fc.boolean() }) },
  );

  it('never writes two at once, writes in the order that the values came, and never loses the last value, whatever fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(arbStep, { maxLength: 40 }), async (steps) => {
        const objects = Array.from({ length: 5 }, (_, index) => ({ index }));
        const timer = manualTimer();
        let room = true;
        let running = 0;
        let overlapped = false;
        const written: number[] = [];
        const scheduled: number[] = [];
        const autosave = createAutosave<{ index: number }>({
          timer,
          write: async (value) => {
            running += 1;
            overlapped ||= running > 1;
            await Promise.resolve();
            await Promise.resolve();
            running -= 1;
            if (!room) {
              return failure({ kind: 'quota-exceeded', message: 'No room.' });
            }
            written.push(value.index);
            return succeed(undefined);
          },
        });
        const settle = async () => {
          for (let i = 0; i < 6; i++) {
            await Promise.resolve();
          }
        };

        for (const step of steps) {
          switch (step.t) {
            case 'schedule':
              scheduled.push(step.value);
              autosave.schedule(objects[step.value] as { index: number });
              break;
            case 'advance':
              timer.advance(step.ms);
              break;
            case 'flush':
              void autosave.flush();
              break;
            case 'settle':
              await settle();
              break;
            case 'room':
              room = step.has;
              break;
          }
        }
        room = true;
        const last = await autosave.flush();
        await settle();

        expect(overlapped).toBe(false);
        expect(last.ok).toBe(true);
        expect(autosave.pending).toBe(false);
        expect(timer.pending).toBe(0);
        // Every value that was written was scheduled, and they were written in the order that they were scheduled.
        let from = 0;
        for (const value of written) {
          const found = scheduled.indexOf(value, from);
          expect(found, JSON.stringify({ written, scheduled })).toBeGreaterThanOrEqual(from);
          from = found;
        }
        // And the last value that was scheduled is the one that was written last, which is the one that the learner sees.
        if (scheduled.length > 0) {
          expect(written.at(-1) ?? -1).toBe(scheduled.at(-1));
        }
      }),
    );
  });
});
