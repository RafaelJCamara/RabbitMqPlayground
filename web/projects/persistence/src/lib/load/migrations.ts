import { emptyDocument } from '@rmq/domain';
import { migrationFailed, reasonOf, unsupportedVersion, type LoadError } from '../errors';
import { failure, succeed, type Outcome } from '../outcome';

/**
 * Migrations (ADR-0027). A document that an older version of the app saved is brought up to date one version at a time, in
 * memory, when it is read. Nothing is rewritten until the learner saves.
 */

/** The schema version that this app writes, and understands up to. It is the domain's: there is no second number to forget. */
export const CURRENT_SCHEMA_VERSION: number = emptyDocument().schemaVersion;

type Raw = Readonly<Record<string, unknown>>;

export interface Migration {
  /** The schema version that this step reads. It gives back the next one, `from + 1`. */
  readonly from: number;
  /**
   * The document one version later. It may not change its input, which is frozen in the specs. It does not set `schemaVersion`:
   * the runner does.
   */
  readonly migrate: (document: Raw) => unknown;
}

/**
 * The migrations, and the list only grows. The step at index `n` reads version `n + 1`. A spec holds it to the schema: there is
 * one step for every version below the current one, so that changing the document's `schemaVersion` without writing one fails,
 * and so does writing one without the version. Version 1 is the first, so there is nothing to migrate yet.
 */
export const MIGRATIONS: readonly Migration[] = [];

const isRecord = (value: unknown): value is Raw => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Runs the steps that take a document from the version that it has (`found`) to `target`. A version with no step is
 * `unsupported-version`, and a step that throws, or that does not give back an object, is `migration-failed`. The steps and the
 * target can be given, so that a spec can run a chain of its own.
 */
export function runMigrations(
  document: Raw,
  found: number,
  target: number = CURRENT_SCHEMA_VERSION,
  steps: readonly Migration[] = MIGRATIONS,
): Outcome<Raw, LoadError> {
  let current = document;
  for (let version = found; version < target; version++) {
    const step = steps.find(({ from }) => from === version);
    if (step === undefined) {
      return failure(unsupportedVersion(found, target));
    }
    let next: unknown;
    try {
      next = step.migrate(current);
    } catch (error) {
      return failure(migrationFailed(version, version + 1, reasonOf(error)));
    }
    if (!isRecord(next)) {
      return failure(migrationFailed(version, version + 1, 'the step did not give back an object'));
    }
    current = { ...next, schemaVersion: version + 1 };
  }
  return succeed(current);
}
