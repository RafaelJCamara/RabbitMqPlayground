import { parseDocument, type CanvasDocument, type ParsedDocument } from '@rmq/domain';
import { invalidError, newerVersion, notAnObject, reasonOf, summarise, unknownFormat, type LoadError } from '../errors';
import { failure, succeed, type Outcome } from '../outcome';
import { isRecord } from '../shape';
import { checkCaps } from './caps';
import { CURRENT_SCHEMA_VERSION, MIGRATIONS, runMigrations, type Migration } from './migrations';

/** What a load gives back: the document, and the schema version that the data had before it was brought up to date. */
export interface Loaded {
  readonly document: CanvasDocument;
  readonly from: number;
}

/** The parts that a load is made of, which a spec can replace to prove the order that they run in. */
export interface Pipeline {
  readonly current: number;
  readonly migrations: readonly Migration[];
  readonly parse: (raw: unknown) => ParsedDocument;
}

const NOT_OURS = 'This does not look like a canvas that this app made:';
const ONLY_OURS = 'Only a canvas that this app saved can be opened.';

/** Runs the steps of ADR-0027 in order, and stops at the first that fails. It never throws. */
export function loadWith(raw: unknown, pipeline: Pipeline): Outcome<Loaded, LoadError> {
  try {
    if (!isRecord(raw)) {
      return failure(notAnObject(raw));
    }

    const version = raw['schemaVersion'];
    if (version === undefined) {
      return failure(unknownFormat(`${NOT_OURS} it does not say which schema version it has. ${ONLY_OURS}`));
    }
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return failure(
        unknownFormat(
          `${NOT_OURS} its schema version is ${summarise(version)}, and a schema version is a whole number from 1. ${ONLY_OURS}`,
        ),
      );
    }
    if (version > pipeline.current) {
      return failure(newerVersion('schema', version, pipeline.current));
    }

    const migrated = runMigrations(raw, version, pipeline.current, pipeline.migrations);
    if (!migrated.ok) {
      return migrated;
    }

    const tooBig = checkCaps(migrated.value);
    if (tooBig !== null) {
      return failure(tooBig);
    }

    const parsed = pipeline.parse(migrated.value);
    return parsed.ok ? succeed({ document: parsed.value, from: version }) : failure(invalidError(parsed.issues));
  } catch (error) {
    // Data that makes the code throw is data that cannot be read. A getter that throws is the way to find out.
    return failure(invalidError([{ kind: 'schema', message: `The data could not be read: ${reasonOf(error)}` }]));
  }
}

/**
 * Turns data from anywhere into a canvas document: a record that was read from storage, the document in a file or in a
 * backup, and, in S10, what a share link inflates to (ADR-0013, ADR-0027). It never throws, for any input.
 */
export const loadCanvas = (raw: unknown): Outcome<Loaded, LoadError> =>
  loadWith(raw, { current: CURRENT_SCHEMA_VERSION, migrations: MIGRATIONS, parse: parseDocument });
