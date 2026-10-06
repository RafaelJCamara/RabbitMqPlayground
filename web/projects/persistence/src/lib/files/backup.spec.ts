import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import { deepFreeze, sampleDocument } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { SIZE_CAPS } from '../load/caps';
import type { CanvasRecord } from '../record';
import { parseBackup, readBackup, writeBackup, type BackupEntry } from './backup';
import { BACKUP_FORMAT, BACKUP_VERSION } from './formats';

type Raw = Record<string, unknown>;

/** What some editors put at the start of a UTF-8 file. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** A fixture as text with a line feed for a line ending, whatever the checkout has (OPEN_QUESTIONS 5). */
const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../../../fixtures/schema/v1/${name}`, import.meta.url)), 'utf8').replaceAll(
    '\r\n',
    '\n',
  );

const indented = (text: string, spaces: number): string => text.trimEnd().replaceAll('\n', `\n${' '.repeat(spaces)}`);

/** A backup of one canvas as version 1 of the format writes it, down to the last space. It is never to change. */
const GOLDEN = `{
  "format": "rmq-playground/backup",
  "version": 1,
  "exportedAt": 1791273384000,
  "canvases": [
    {
      "id": "c1",
      "name": "Orders",
      "createdAt": 1000,
      "updatedAt": 2000,
      "document": ${indented(fixture('empty.json'), 6)}
    }
  ]
}
`;

const record = (id: string, change: Partial<CanvasRecord> = {}): CanvasRecord => ({
  id,
  name: `Canvas ${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  document: sampleDocument(),
  ...change,
});

const entryOf = (id: string, change: Raw = {}): Raw => ({
  id,
  name: `Canvas ${id}`,
  createdAt: 1000,
  updatedAt: 2000,
  document: JSON.parse(JSON.stringify(sampleDocument())),
  ...change,
});

const backup = (change: Raw = {}): Raw => ({
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  exportedAt: 1_791_273_384_000,
  canvases: [entryOf('c1')],
  ...change,
});

const failedRead = (data: unknown) => {
  const result = readBackup(data);
  if (result.ok) {
    throw new Error('expected a failure, and it was read');
  }
  return result.error;
};

const entriesOf = (data: unknown): readonly BackupEntry[] => {
  const result = readBackup(data);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value.entries;
};

describe('the backup of many canvases', () => {
  describe('writing', () => {
    it('is JSON with two spaces of indentation and a final newline, in the order format, version, exportedAt, canvases', () => {
      const written = writeBackup([record('c1', { name: 'Orders', document: emptyDocument() })], {
        exportedAt: 1_791_273_384_000,
      });

      expect(written).toEqual({ ok: true, value: GOLDEN });
    });

    it('writes a backup of no canvases, which is a backup', () => {
      const written = writeBackup([], { exportedAt: 5 });

      expect(written.ok && JSON.parse(written.value)).toEqual({
        format: BACKUP_FORMAT,
        version: 1,
        exportedAt: 5,
        canvases: [],
      });
      expect(written.ok && parseBackup(written.value)).toEqual({ ok: true, value: { exportedAt: 5, entries: [] } });
    });

    it('keeps the order of the canvases, and the id and the times of each', () => {
      const written = writeBackup([record('b', { createdAt: 1 }), record('a', { updatedAt: 9 }), record('c')], {
        exportedAt: 1,
      });
      const read = written.ok ? parseBackup(written.value) : written;

      expect(
        read.ok &&
          read.value.entries.map(
            (entry) => entry.ok && [entry.canvas.id, entry.canvas.createdAt, entry.canvas.updatedAt],
          ),
      ).toEqual([
        ['b', 1, 2000],
        ['a', 1000, 9],
        ['c', 1000, 2000],
      ]);
    });

    it('writes from canvases that are frozen', () => {
      expect(writeBackup(deepFreeze([record('c1'), record('c2')]), { exportedAt: 1 }).ok).toBe(true);
    });

    it('does not write a canvas that has a deletion, because a canvas that was deleted is not backed up', () => {
      const written = writeBackup([record('c1'), record('c2', { deletedAt: 5 })], { exportedAt: 1 });

      expect(written).toMatchObject({ ok: false, error: { kind: 'invalid' } });
      expect(!written.ok && written.error.message).toContain('Unrecognized key: "deletedAt"');
    });

    it('does not write a canvas that this app would refuse to read, and says which', () => {
      const broken = { ...sampleDocument(), vhost: '' } as CanvasDocument;
      const written = writeBackup([record('c1'), record('c2', { document: broken })], { exportedAt: 1 });

      expect(written.ok).toBe(false);
      expect(
        !written.ok && written.error.kind === 'invalid' && written.error.issues.map(({ path }) => path?.join('.')),
      ).toEqual(['canvases.1.document.vhost']);
    });

    it('does not write two canvases with one id', () => {
      const written = writeBackup([record('c1'), record('c1')], { exportedAt: 1 });

      expect(written).toMatchObject({ ok: false, error: { kind: 'invalid' } });
    });

    it('does not write a time that is not a time, or more canvases than a backup may have', () => {
      expect(writeBackup([], { exportedAt: NaN })).toMatchObject({ ok: false, error: { kind: 'invalid' } });
      const many = Array.from({ length: SIZE_CAPS.canvases + 1 }, (_, i) =>
        record(`c${i}`, { document: emptyDocument() }),
      );

      expect(writeBackup(many, { exportedAt: 1 })).toMatchObject({
        ok: false,
        error: { kind: 'too-large', what: 'canvases', found: SIZE_CAPS.canvases + 1, limit: SIZE_CAPS.canvases },
      });
    });
  });

  describe('reading', () => {
    it('reads what it wrote, with every canvas the same', () => {
      const canvases = ['empty', 'sample', 'typed-headers', 'unicode', 'limits'].map((name, index) =>
        record(`id-${index}`, {
          name,
          createdAt: index,
          updatedAt: index * 2,
          document: JSON.parse(fixture(`${name}.json`)) as CanvasDocument,
        }),
      );
      const written = writeBackup(canvases, { exportedAt: 77 });

      expect(written.ok && parseBackup(written.value)).toEqual({
        ok: true,
        value: { exportedAt: 77, entries: canvases.map((canvas, position) => ({ ok: true, position, canvas })) },
      });
    });

    it('reads the backup as version 1 wrote it, and will read it in every later version', () => {
      expect(parseBackup(GOLDEN)).toEqual({
        ok: true,
        value: {
          exportedAt: 1_791_273_384_000,
          entries: [{ ok: true, position: 0, canvas: record('c1', { name: 'Orders', document: emptyDocument() }) }],
        },
      });
    });

    it('reads a backup with the line endings of Windows, and one that has a byte order mark', () => {
      expect(parseBackup(GOLDEN.replaceAll('\n', '\r\n')).ok).toBe(true);
      expect(parseBackup(`${BYTE_ORDER_MARK}${GOLDEN}`).ok).toBe(true);
    });

    it('reads data that is already parsed', () => {
      expect(readBackup(backup()).ok).toBe(true);
    });
  });

  describe('a canvas in it that cannot be read', () => {
    it('does not stop the others, and says which it was, where it was, and why', () => {
      const newer = { ...(entryOf('c2')['document'] as Raw), schemaVersion: 2 };
      const entries = entriesOf(
        backup({ canvases: [entryOf('c1'), entryOf('c2', { document: newer }), entryOf('c3')] }),
      );

      expect(entries.map((entry) => [entry.ok, entry.position])).toEqual([
        [true, 0],
        [false, 1],
        [true, 2],
      ]);
      expect(entries[1]).toMatchObject({
        ok: false,
        position: 1,
        name: 'Canvas c2',
        error: { kind: 'newer-version', of: 'schema', found: 2, understood: 1 },
      });
    });

    it('says what is wrong with it, and where in the backup', () => {
      const entries = entriesOf(backup({ canvases: [entryOf('c1'), entryOf('c2', { id: 'a b' })] }));
      const bad = entries[1];

      expect(
        bad?.ok === false && bad.error.kind === 'invalid' && bad.error.issues.map(({ path }) => path?.join('.')),
      ).toEqual(['canvases.1.id']);
    });

    it('has no name when the file gave none, and no more than a name may have when it gave a long one', () => {
      const entries = entriesOf(
        backup({ canvases: [{ id: 'c1' }, 5, null, entryOf('c4', { name: 'n'.repeat(500) })] }),
      );

      expect(entries.map((entry) => !entry.ok && 'name' in entry)).toEqual([false, false, false, true]);
      expect(entries[3]).toMatchObject({ ok: false, error: { kind: 'too-large', what: 'name' } });
      expect(entries[3]?.ok === false && entries[3].name).toBe('n'.repeat(SIZE_CAPS.name));
    });

    it('is refused when it has an id that an earlier canvas has, because an id belongs to one canvas', () => {
      const entries = entriesOf(backup({ canvases: [entryOf('c1'), entryOf('c2'), entryOf('c1', { name: 'Again' })] }));

      expect(entries.map((entry) => entry.ok)).toEqual([true, true, false]);
      expect(entries[2]).toMatchObject({
        ok: false,
        position: 2,
        name: 'Again',
        error: {
          kind: 'invalid',
          message:
            'This canvas is not valid: canvases.2.id: the id "c1" is used by another canvas in this backup. An id belongs to one canvas.',
        },
      });
      const duplicate = entries[2];
      expect(duplicate?.ok === false && duplicate.error.kind === 'invalid' && duplicate.error.issues).toEqual([
        {
          kind: 'duplicate-id',
          message: 'canvases.2.id: the id "c1" is used by another canvas in this backup. An id belongs to one canvas.',
          path: ['canvases', '2', 'id'],
        },
      ]);
    });
  });

  describe('text that is not a backup', () => {
    it('is refused when it is not JSON, when it is too long, and when it is not an object', () => {
      expect(parseBackup('{')).toMatchObject({ ok: false, error: { kind: 'not-json' } });
      expect(parseBackup('x'.repeat(SIZE_CAPS.file + 1))).toMatchObject({
        ok: false,
        error: { kind: 'too-large', what: 'file' },
      });
      expect(parseBackup('[]')).toMatchObject({ ok: false, error: { kind: 'not-an-object' } });
    });
  });

  describe('an object that is not a backup', () => {
    it('says that it does not say what it is, and what a backup says', () => {
      expect(failedRead({ canvases: [] })).toEqual({
        kind: 'unknown-format',
        message:
          'This is not a backup of this app: it does not say what it is. A backup has "format": "rmq-playground/backup" at the top.',
      });
      expect(failedRead(backup({ format: 'other' })).message).toContain('its format is "other".');
    });

    it('is told to open the file of one canvas as a canvas', () => {
      expect(failedRead(backup({ format: 'rmq-playground/canvas' }))).toEqual({
        kind: 'unknown-format',
        message: 'This is the file of one canvas, and not a backup of several. Open it as a canvas.',
      });
    });
  });

  describe('a version of the format', () => {
    it('that is not a version is refused', () => {
      expect(failedRead(backup({ version: 0 })).message).toBe(
        'This is not a backup of this app: its format version is 0, and a format version is a whole number from 1.',
      );
    });

    it('that is newer than the app’s is refused, with the version it has, the one the app reads, and what to do', () => {
      expect(failedRead(backup({ version: 3 }))).toEqual({
        kind: 'newer-version',
        of: 'backup',
        found: 3,
        understood: 1,
        message:
          'This backup was saved by a newer version of this app. It is backup format 3, and this version reads up to format 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.',
      });
    });

    it('that is newer is refused before anything else is looked at', () => {
      expect(failedRead({ format: BACKUP_FORMAT, version: 2, canvases: 'x', surprise: true }).kind).toBe(
        'newer-version',
      );
    });
  });

  describe('a backup that is the wrong shape', () => {
    const problems = (data: unknown) => {
      const error = failedRead(data);
      return error.kind === 'invalid' ? error.issues.map(({ message }) => message) : error;
    };

    it('says which keys are missing, and which it should not have, because it is strict', () => {
      expect(problems({ format: BACKUP_FORMAT, version: 1 })).toEqual([
        'exportedAt: this is missing.',
        'canvases: this is missing.',
      ]);
      expect(problems(backup({ colour: 'red' }))).toEqual(['The backup: Unrecognized key: "colour"']);
    });

    it('says what is wrong with the time, and with canvases that are not a list', () => {
      expect(problems(backup({ exportedAt: 'yesterday' }))).toEqual([
        'exportedAt: a time is a number of milliseconds since 1970, from 0, and this is "yesterday".',
      ]);
      expect(problems(backup({ canvases: {} }))).toEqual(['canvases: the canvases are a list, and this is an object.']);
    });

    it('has a sentence that says it is the backup that is not valid', () => {
      expect(failedRead(backup({ exportedAt: -1 })).message).toBe(
        'This backup is not valid: exportedAt: a time is a number of milliseconds since 1970, from 0, and this is -1.',
      );
    });

    it('is refused when it has more canvases than a backup may', () => {
      const canvases = Array.from({ length: SIZE_CAPS.canvases + 1 }, () => null);

      expect(failedRead(backup({ canvases }))).toMatchObject({
        kind: 'too-large',
        what: 'canvases',
        found: SIZE_CAPS.canvases + 1,
        limit: SIZE_CAPS.canvases,
      });
      expect(readBackup(backup({ canvases: canvases.slice(0, SIZE_CAPS.canvases) })).ok).toBe(true);
    });
  });
});
