import { emptyDocument } from '@rmq/domain';
import { deepFreeze, sampleDocument } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { SIZE_CAPS } from './load/caps';
import { readRecord, underPath, type ReadRecordOptions } from './record';

type Raw = Record<string, unknown>;

const document = (): Raw => JSON.parse(JSON.stringify(sampleDocument())) as Raw;

const record = (change: Raw = {}): Raw => ({
  id: 'c1',
  name: 'Orders',
  createdAt: 1000,
  updatedAt: 2000,
  document: document(),
  ...change,
});

const stored: ReadRecordOptions = { allowDeleted: true };
const entry: ReadRecordOptions = { allowDeleted: false, path: ['canvases', '3'], whole: 'The canvas' };

const read = (raw: unknown, options = stored) => readRecord(raw, options);

const failed = (raw: unknown, options = stored) => {
  const result = read(raw, options);
  if (result.ok) {
    throw new Error('expected a failure, and it was read');
  }
  return result.error;
};

describe('readRecord', () => {
  describe('a record that is right', () => {
    it('is read, with its document loaded', () => {
      const result = read(record());

      expect(result.ok && result.value).toEqual({
        id: 'c1',
        name: 'Orders',
        createdAt: 1000,
        updatedAt: 2000,
        document: sampleDocument(),
      });
    });

    it('keeps the time of its deletion, if it is a tombstone and a tombstone may be read', () => {
      expect(read(record({ deletedAt: 3000 })).ok && read(record({ deletedAt: 3000 }))).toMatchObject({
        value: { deletedAt: 3000 },
      });
    });

    it('has no deletedAt when it has none, and not one that is undefined', () => {
      const result = read(record({ deletedAt: undefined }));

      expect(result.ok && Object.hasOwn(result.value, 'deletedAt')).toBe(false);
    });

    it('is read from frozen data, and leaves it as it was', () => {
      const raw = deepFreeze(record({ deletedAt: 5 }));

      expect(read(raw).ok).toBe(true);
      expect(raw['deletedAt']).toBe(5);
    });

    it('may have a name of at most so many characters, and any ones: a name has no rules of the broker', () => {
      expect(read(record({ name: 'x'.repeat(SIZE_CAPS.name) })).ok).toBe(true);
      expect(read(record({ name: ' 日本語 / "quotes" & <tags> ' })).ok).toBe(true);
    });
  });

  describe('data that is not a record', () => {
    it.each([null, undefined, 'x', 5, [], [record()], () => 1])('is refused: %j', (raw) => {
      expect(failed(raw).kind).toBe('not-an-object');
    });
  });

  describe('a record that has fields that are wrong', () => {
    const issues = (raw: unknown, options = stored) => {
      const error = failed(raw, options);
      return error.kind === 'invalid' ? error.issues.map(({ message, path }) => [path?.join('.'), message]) : error;
    };

    it('says which keys are missing', () => {
      expect(issues({})).toEqual([
        ['id', 'id: this is missing.'],
        ['name', 'name: this is missing.'],
        ['createdAt', 'createdAt: this is missing.'],
        ['updatedAt', 'updatedAt: this is missing.'],
        ['document', 'document: this is missing.'],
      ]);
    });

    it('does not say that a key that is missing is also wrong', () => {
      const raw = record();
      delete raw['id'];

      expect(issues(raw)).toEqual([['id', 'id: this is missing.']]);
    });

    it('names a key that a record does not have, because it is strict', () => {
      expect(issues(record({ colour: 'red', size: 3 }))).toEqual([
        ['', 'The canvas: Unrecognized key: "colour"'],
        ['', 'The canvas: Unrecognized key: "size"'],
      ]);
    });

    it('says what is wrong with each field, all of them at once, and in the order of the record', () => {
      const raw = record({ id: 'a b', name: ' ', createdAt: -1, updatedAt: 'x', deletedAt: NaN });

      expect(issues(raw)).toEqual([
        ['id', 'id: an id is 1 to 64 letters, digits, dots, colons, hyphens or underscores, and this is "a b".'],
        ['name', 'name: A canvas needs a name.'],
        ['createdAt', 'createdAt: a time is a number of milliseconds since 1970, from 0, and this is -1.'],
        ['updatedAt', 'updatedAt: a time is a number of milliseconds since 1970, from 0, and this is "x".'],
        ['deletedAt', 'deletedAt: a time is a number of milliseconds since 1970, from 0, and this is NaN.'],
      ]);
    });

    it('has a sentence that names the first problem and counts the rest', () => {
      expect(failed(record({ id: '', createdAt: 'x' })).message).toBe(
        'This canvas is not valid. The first of 2 problems: id: an id is 1 to 64 letters, digits, dots, colons, hyphens or underscores, and this is "".',
      );
    });

    it('does not allow a deletion, when a deletion is not allowed, as in a backup', () => {
      expect(issues(record({ deletedAt: 3000 }), entry)).toEqual([
        ['canvases.3', 'canvases.3: Unrecognized key: "deletedAt"'],
      ]);
    });

    it('says where in a backup the problem is, and still says it in words', () => {
      expect(issues(record({ id: 7 }), entry)).toEqual([
        [
          'canvases.3.id',
          'canvases.3.id: an id is 1 to 64 letters, digits, dots, colons, hyphens or underscores, and this is 7.',
        ],
      ]);
    });
  });

  describe('a name that is too long', () => {
    it('is not a problem with the shape, and says how long it is', () => {
      const error = failed(record({ name: 'x'.repeat(SIZE_CAPS.name + 1) }));

      expect(error).toMatchObject({
        kind: 'too-large',
        what: 'name',
        found: SIZE_CAPS.name + 1,
        limit: SIZE_CAPS.name,
      });
    });
  });

  describe('a record whose document cannot be loaded', () => {
    it('is refused as the loader refuses it, a newer version above all', () => {
      const newer = { ...document(), schemaVersion: 2 };

      expect(failed(record({ document: newer }))).toMatchObject({ kind: 'newer-version', of: 'schema', found: 2 });
    });

    it('is refused when the document is too big', () => {
      const big = {
        ...document(),
        exchanges: Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [`e${i}`, {}])),
      };

      expect(failed(record({ document: big }))).toMatchObject({ kind: 'too-large', what: 'elements' });
    });

    it('is refused as not valid, and says where the document is', () => {
      const broken = { ...document(), vhost: 5 };
      const error = failed(record({ document: broken }), entry);

      expect(error.kind === 'invalid' && error.issues.map(({ path }) => path?.join('.'))).toEqual([
        'canvases.3.document.vhost',
      ]);
      expect(error.message).toBe('This canvas is not valid: vhost: Invalid input: expected string, received number');
    });

    it('is refused when there is no document at all, or what is not one', () => {
      expect(failed(record({ document: null })).kind).toBe('not-an-object');
      expect(failed(record({ document: emptyDocument().exchanges })).kind).toBe('unknown-format');
    });
  });
});

describe('underPath', () => {
  const issue = { kind: 'schema' as const, message: 'x', path: ['queues', 'q1'] };

  it('puts the place that a document is in before the place of each of its problems', () => {
    const error = underPath({ kind: 'invalid', message: 'm', issues: [issue, { kind: 'schema', message: 'y' }] }, [
      'document',
    ]);

    expect(error).toEqual({
      kind: 'invalid',
      message: 'm',
      issues: [
        { kind: 'schema', message: 'x', path: ['document', 'queues', 'q1'] },
        { kind: 'schema', message: 'y', path: ['document'] },
      ],
    });
  });

  it('leaves every other error as it was, because they are about all of the document', () => {
    const newer = { kind: 'newer-version', of: 'schema', found: 2, understood: 1, message: 'm' } as const;

    expect(underPath(newer, ['document'])).toBe(newer);
  });
});
