import type { CanvasDocument } from '@rmq/domain';
import { invalidError, notAnObject, type LoadError } from './errors';
import { checkName } from './load/caps';
import { loadCanvas } from './load/load';
import { failure, succeed, type Outcome } from './outcome';
import { idIssues, isRecord, keyIssues, nameIssues, timeIssues } from './shape';

/**
 * The record that the repository keeps for each canvas (ADR-0027), and what a backup keeps for each canvas too, except that a
 * backup has no tombstones. A time is a number of milliseconds since 1970, from the injected clock.
 */
export interface CanvasRecord {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** When it was deleted, if it was. A record that has this is a tombstone: it backs an Undo toast, and is purged soon. */
  readonly deletedAt?: number;
  readonly document: CanvasDocument;
}

export interface ReadRecordOptions {
  /** A record may be a tombstone. A backup entry may not, and nor may what is just made, which is why this is false unless it is said. */
  readonly allowDeleted?: boolean;
  /** Where the record is inside what is being read, so that a problem says where: `['canvases', '3']`. */
  readonly path?: readonly string[];
  /** What the record is called when a problem is about the whole of it. */
  readonly whole?: string;
}

/** The problems of a document, which are about its own fields, say where the document is inside what is being read. */
export function underPath(error: LoadError, prefix: readonly string[]): LoadError {
  return error.kind === 'invalid'
    ? { ...error, issues: error.issues.map((issue) => ({ ...issue, path: [...prefix, ...(issue.path ?? [])] })) }
    : error;
}

/**
 * Reads a record from data that nothing vouches for: from the database, or from a backup. Its fields are checked, and a key
 * that it should not have is named, and then its document goes through `loadCanvas`, so that a record from an older version
 * is migrated and one from a newer version is refused. It never throws.
 */
export function readRecord(raw: unknown, options: ReadRecordOptions = {}): Outcome<CanvasRecord, LoadError> {
  const { allowDeleted = false, path = [], whole = 'The canvas' } = options;
  if (!isRecord(raw)) {
    return failure(notAnObject(raw));
  }

  const name = raw['name'];
  const tooLong = typeof name === 'string' ? checkName(name) : null;
  if (tooLong !== null) {
    return failure(tooLong);
  }

  const has = (key: string): boolean => Object.hasOwn(raw, key);
  const issues = [
    ...keyIssues(
      raw,
      ['id', 'name', 'createdAt', 'updatedAt', 'document'],
      allowDeleted ? ['deletedAt'] : [],
      whole,
      path,
    ),
    ...(has('id') ? idIssues(raw['id'], [...path, 'id']) : []),
    ...(has('name') ? nameIssues(name, [...path, 'name']) : []),
    ...(has('createdAt') ? timeIssues(raw['createdAt'], [...path, 'createdAt']) : []),
    ...(has('updatedAt') ? timeIssues(raw['updatedAt'], [...path, 'updatedAt']) : []),
    ...(allowDeleted && raw['deletedAt'] !== undefined ? timeIssues(raw['deletedAt'], [...path, 'deletedAt']) : []),
  ];
  if (issues.length > 0) {
    return failure(invalidError(issues));
  }

  const loaded = loadCanvas(raw['document']);
  if (!loaded.ok) {
    return failure(underPath(loaded.error, [...path, 'document']));
  }
  return succeed({
    id: raw['id'] as string,
    name: name as string,
    createdAt: raw['createdAt'] as number,
    updatedAt: raw['updatedAt'] as number,
    ...(allowDeleted && raw['deletedAt'] !== undefined ? { deletedAt: raw['deletedAt'] as number } : {}),
    document: loaded.value.document,
  });
}
