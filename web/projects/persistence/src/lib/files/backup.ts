import { invalidError, summarise, tooLarge, type LoadError } from '../errors';
import { SIZE_CAPS } from '../load/caps';
import { failure, succeed, type Outcome } from '../outcome';
import { readRecord, type CanvasRecord } from '../record';
import { isRecord, keyIssues, shapeIssue, timeIssues } from '../shape';
import { checkEnvelope, parseJsonText, type EnvelopeKind } from './envelope';
import { BACKUP_FORMAT, BACKUP_VERSION, CANVAS_FILE_FORMAT } from './formats';

/**
 * The backup of many canvases (ADR-0027): an envelope with a `format`, a `version`, the time it was `exportedAt` and the
 * `canvases`, each of which has what a record has, without a tombstone. It keeps ids and times, so that a restore can put a
 * canvas back as it was. What to do with an id that is already taken is the importer's choice, and not the file's.
 */

const KIND: EnvelopeKind = {
  format: BACKUP_FORMAT,
  version: BACKUP_VERSION,
  of: 'backup',
  noun: 'backup',
  mistaken: [
    {
      format: CANVAS_FILE_FORMAT,
      message: 'This is the file of one canvas, and not a backup of several. Open it as a canvas.',
    },
  ],
};

/** One canvas of a backup: read, or why it could not be. One that cannot be read does not stop the others. */
export type BackupEntry =
  | { readonly ok: true; readonly position: number; readonly canvas: CanvasRecord }
  | {
      readonly ok: false;
      /** Where it was in the file, counting from 0. */
      readonly position: number;
      /** What the file called it, if it said. */
      readonly name?: string;
      readonly error: LoadError;
    };

export interface Backup {
  readonly exportedAt: number;
  readonly entries: readonly BackupEntry[];
}

function readEntry(raw: unknown, position: number, seen: Set<string>): BackupEntry {
  const read = readRecord(raw, { allowDeleted: false, path: ['canvases', String(position)] });
  const name = isRecord(raw) && typeof raw['name'] === 'string' ? raw['name'].slice(0, SIZE_CAPS.name) : undefined;
  if (!read.ok) {
    return { ok: false, position, ...(name === undefined ? {} : { name }), error: read.error };
  }
  const { id } = read.value;
  if (seen.has(id)) {
    const issue = {
      kind: 'duplicate-id' as const,
      message: `canvases.${position}.id: the id ${summarise(id)} is used by another canvas in this backup. An id belongs to one canvas.`,
      path: ['canvases', String(position), 'id'],
    };
    return { ok: false, position, name: read.value.name, error: invalidError([issue]) };
  }
  seen.add(id);
  return { ok: true, position, canvas: read.value };
}

/**
 * Reads a backup that is already data. The envelope has to be right, and then each canvas is read on its own, so that a backup
 * with one canvas from a newer version still gives back the others. It never throws.
 */
export function readBackup(data: unknown): Outcome<Backup, LoadError> {
  const envelope = checkEnvelope(data, KIND);
  if (!envelope.ok) {
    return envelope;
  }
  const raw = envelope.value;

  const canvases = raw['canvases'];
  const issues = [
    ...keyIssues(raw, ['format', 'version', 'exportedAt', 'canvases'], [], 'The backup'),
    ...(Object.hasOwn(raw, 'exportedAt') ? timeIssues(raw['exportedAt'], ['exportedAt']) : []),
    ...(Object.hasOwn(raw, 'canvases') && !Array.isArray(canvases)
      ? [shapeIssue(['canvases'], `the canvases are a list, and this is ${summarise(canvases)}.`)]
      : []),
  ];
  if (issues.length > 0 || !Array.isArray(canvases)) {
    return failure(invalidError(issues, 'This backup'));
  }
  if (canvases.length > SIZE_CAPS.canvases) {
    return failure(tooLarge('canvases', canvases.length, SIZE_CAPS.canvases));
  }

  const seen = new Set<string>();
  return succeed({
    exportedAt: raw['exportedAt'] as number,
    entries: canvases.map((entry: unknown, position) => readEntry(entry, position, seen)),
  });
}

/** Reads the text of a backup, as someone opened it. It never throws. */
export function parseBackup(text: string): Outcome<Backup, LoadError> {
  const data = parseJsonText(text);
  return data.ok ? readBackup(data.value) : data;
}

/**
 * The text of a backup of these canvases, in JSON with two spaces of indentation and a final newline. What it writes is
 * checked by reading it back, so a backup that has a canvas that this app would refuse, or one that is a tombstone, is not
 * written, and the error is the one that reading it would give.
 */
export function writeBackup(
  canvases: readonly CanvasRecord[],
  options: { readonly exportedAt: number },
): Outcome<string, LoadError> {
  const envelope = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: options.exportedAt,
    canvases: canvases.map(({ id, name, createdAt, updatedAt, deletedAt, document }) => ({
      id,
      name,
      createdAt,
      updatedAt,
      ...(deletedAt === undefined ? {} : { deletedAt }),
      document,
    })),
  };
  const read = readBackup(envelope);
  if (!read.ok) {
    return read;
  }
  const refused = read.value.entries.find((entry) => !entry.ok);
  if (refused !== undefined && !refused.ok) {
    return failure(refused.error);
  }
  return succeed(`${JSON.stringify(envelope, null, 2)}\n`);
}
