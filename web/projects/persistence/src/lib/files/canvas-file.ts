import type { CanvasDocument } from '@rmq/domain';
import { invalidError, type LoadError } from '../errors';
import { checkName } from '../load/caps';
import { loadCanvas } from '../load/load';
import { failure, succeed, type Outcome } from '../outcome';
import { underPath } from '../record';
import { keyIssues, nameIssues } from '../shape';
import { checkEnvelope, parseJsonText, type EnvelopeKind } from './envelope';
import { BACKUP_FORMAT, CANVAS_FILE_FORMAT, CANVAS_FILE_VERSION } from './formats';

/**
 * The file of one canvas (ADR-0027): an envelope with a `format`, a `version`, a `name` and the `document`. It has no id and
 * no time, because opening it makes a new canvas.
 */

const KIND: EnvelopeKind = {
  format: CANVAS_FILE_FORMAT,
  version: CANVAS_FILE_VERSION,
  of: 'file',
  noun: 'canvas file',
  mistaken: [
    {
      format: BACKUP_FORMAT,
      message: 'This is a backup of several canvases, and not the file of one canvas. Open it as a backup.',
    },
  ],
};

/** What a file holds: the name that its canvas had, and the document, brought up to date. */
export interface CanvasFile {
  readonly name: string;
  readonly document: CanvasDocument;
}

/** Reads a canvas file that is already data, which is what a share link will also give. It never throws. */
export function readCanvasFile(data: unknown): Outcome<CanvasFile, LoadError> {
  const envelope = checkEnvelope(data, KIND);
  if (!envelope.ok) {
    return envelope;
  }
  const raw = envelope.value;

  const name = raw['name'];
  const tooLong = typeof name === 'string' ? checkName(name) : null;
  if (tooLong !== null) {
    return failure(tooLong);
  }
  const issues = [
    ...keyIssues(raw, ['format', 'version', 'name', 'document'], [], 'The file'),
    ...(Object.hasOwn(raw, 'name') ? nameIssues(name, ['name']) : []),
  ];
  if (issues.length > 0) {
    return failure(invalidError(issues, 'This file'));
  }

  const loaded = loadCanvas(raw['document']);
  return loaded.ok
    ? succeed({ name: name as string, document: loaded.value.document })
    : failure(underPath(loaded.error, ['document']));
}

/** Reads the text of a canvas file, as someone opened it. It never throws. */
export function parseCanvasFile(text: string): Outcome<CanvasFile, LoadError> {
  const data = parseJsonText(text);
  return data.ok ? readCanvasFile(data.value) : data;
}

/**
 * The text of a canvas file: JSON with two spaces of indentation and a final newline. What it writes is checked by reading it
 * back, so it never writes a file that this app would refuse to open.
 */
export function writeCanvasFile(canvas: CanvasFile): Outcome<string, LoadError> {
  const envelope = {
    format: CANVAS_FILE_FORMAT,
    version: CANVAS_FILE_VERSION,
    name: canvas.name,
    document: canvas.document,
  };
  const read = readCanvasFile(envelope);
  return read.ok ? succeed(`${JSON.stringify(envelope, null, 2)}\n`) : read;
}
