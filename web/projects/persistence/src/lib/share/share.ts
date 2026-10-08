import { readSnapshot, snapshotDisagrees, type CanvasDocument } from '@rmq/domain';
import type { EngineSnapshot } from '@rmq/engine';
import { invalidError, type LoadError } from '../errors';
import { BACKUP_FORMAT, CANVAS_FILE_FORMAT, SHARE_FORMAT, SHARE_VERSION } from '../files/formats';
import { checkEnvelope, type EnvelopeKind } from '../files/envelope';
import { checkName } from '../load/caps';
import { loadCanvas } from '../load/load';
import { failure, succeed, type Outcome } from '../outcome';
import { underPath } from '../record';
import { keyIssues, nameIssues, shapeIssue } from '../shape';

/**
 * What a share link carries (ADR-0077): a canvas, by its name and its document, and, when the sender asked for the messages that are queued, the snapshot of the
 * engine. It is the third envelope beside the file of a canvas and the backup, checked by the same function, and the document in it goes through the same loader, so
 * a link has the limits of a file and the errors of one. It is not the canvas file: that reader refuses the keys it does not know, and a link has a version of its own.
 */
export interface Shared {
  readonly name: string;
  readonly document: CanvasDocument;
  /** The engine as it was, with the messages in its queues. Left out, the link is of the topology only. */
  readonly simulation?: EngineSnapshot;
}

const KIND: EnvelopeKind = {
  format: SHARE_FORMAT,
  version: SHARE_VERSION,
  of: 'link',
  noun: 'link',
  mistaken: [
    {
      format: CANVAS_FILE_FORMAT,
      message: 'This is the file of one canvas, and not a link. Open it with “Open a file…” on the home.',
    },
    {
      format: BACKUP_FORMAT,
      message:
        'This is a backup of several canvases, and not a link. Put it back with “Restore a backup…” on the home.',
    },
  ],
};

/** The messages of a link are wrong: the link is refused whole (ADR-0077), and the sentence says where. */
const messagesIssue = (problem: string): Outcome<never, LoadError> =>
  failure(invalidError([shapeIssue(['simulation'], `${problem}.`)], 'This link'));

/** Reads data that is to be a link's envelope. It never throws. */
export function readShare(data: unknown): Outcome<Shared, LoadError> {
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
    ...keyIssues(raw, ['format', 'version', 'name', 'document'], ['simulation'], 'The link'),
    ...(Object.hasOwn(raw, 'name') ? nameIssues(name, ['name']) : []),
  ];
  if (issues.length > 0) {
    return failure(invalidError(issues, 'This link'));
  }

  const loaded = loadCanvas(raw['document']);
  if (!loaded.ok) {
    return failure(underPath(loaded.error, ['document']));
  }
  const document = loaded.value.document;
  if (!Object.hasOwn(raw, 'simulation')) {
    return succeed({ name: name as string, document });
  }

  const snapshot = readSnapshot(raw['simulation']);
  if (!snapshot.ok) {
    return messagesIssue(`the messages that it carries cannot be restored, because ${snapshot.message}`);
  }
  const problem = snapshotDisagrees(document, snapshot.value);
  if (problem !== null) {
    return messagesIssue(problem);
  }
  return succeed({ name: name as string, document, simulation: snapshot.value });
}
