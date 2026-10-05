import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { RABBITMQ_BASELINE } from '@rmq/engine';
import { countFixtures, type Fixture, type Manifest } from './fixtures';
import type { Observed } from './session';

/**
 * Verify mode: play the recorded inputs against a live broker and compare. Any difference is drift. Drift fails the
 * job and is investigated by a person; a fixture is never re-recorded to make it go away (ADR-0015).
 */

export type Verdict =
  | { readonly id: string; readonly drifted: false }
  | { readonly id: string; readonly drifted: true; readonly expected: Observed; readonly actual: Observed };

export function verifyCase(fixture: Fixture, actual: Observed): Verdict {
  return isDeepStrictEqual(fixture.observed, actual)
    ? { id: fixture.id, drifted: false }
    : { id: fixture.id, drifted: true, expected: fixture.observed, actual };
}

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

export function describeDrift(verdict: Verdict & { drifted: true }): string {
  return [
    `${verdict.id}: the broker no longer does what the fixture recorded.`,
    '',
    'Recorded:',
    pretty(verdict.expected),
    '',
    'Observed now:',
    pretty(verdict.actual),
  ].join('\n');
}

export interface LiveInfo {
  readonly serverVersion: string;
  readonly imageDigest: string;
}

export interface ManifestCheck {
  /** Things that make the fixture set unusable or out of step. They fail the job. */
  readonly problems: readonly string[];
  /** Things worth knowing, such as a new patch release of the broker. They do not fail the job. */
  readonly notes: readonly string[];
}

export function checkManifest(manifest: Manifest | null, fixtures: readonly Fixture[], live?: LiveInfo): ManifestCheck {
  if (manifest === null) {
    return { problems: ['There is no manifest.json. Record the fixtures first.'], notes: [] };
  }

  const problems: string[] = [];
  const notes: string[] = [];
  if (manifest.baseline !== RABBITMQ_BASELINE) {
    problems.push(
      `The manifest is for RabbitMQ ${manifest.baseline}, but the engine's baseline is ${RABBITMQ_BASELINE}.`,
    );
  }
  const counts = countFixtures(fixtures);
  for (const kind of ['routing', 'delivery'] as const) {
    if (counts[kind] !== manifest.counts[kind]) {
      problems.push(`The manifest says ${manifest.counts[kind]} ${kind} fixtures, but there are ${counts[kind]}.`);
    }
  }
  if (live && live.serverVersion !== manifest.serverVersion) {
    notes.push(`The broker is ${live.serverVersion}; the fixtures were recorded on ${manifest.serverVersion}.`);
  }
  if (live && live.imageDigest !== manifest.imageDigest) {
    notes.push(`The image is ${live.imageDigest}; the fixtures were recorded on ${manifest.imageDigest}.`);
  }
  return { problems, notes };
}

/** Writes what drifted so a person can diff it: `<id>.expected.json` and `<id>.actual.json`, and a `summary.md`. */
export function writeDiffs(dir: string, verdicts: readonly Verdict[], notes: readonly string[] = []): void {
  const drifted = verdicts.filter((verdict): verdict is Verdict & { drifted: true } => verdict.drifted);
  mkdirSync(dir, { recursive: true });

  const lines = ['# Conformance drift', ''];
  lines.push(drifted.length === 0 ? 'Nothing drifted.' : `${drifted.length} of ${verdicts.length} cases drifted:`, '');
  for (const verdict of drifted) {
    const name = verdict.id.replace('/', '__');
    writeFileSync(join(dir, `${name}.expected.json`), `${pretty(verdict.expected)}\n`);
    writeFileSync(join(dir, `${name}.actual.json`), `${pretty(verdict.actual)}\n`);
    lines.push(`- \`${verdict.id}\`: \`${name}.expected.json\` against \`${name}.actual.json\``);
  }
  if (notes.length > 0) {
    lines.push('', '## Notes', '', ...notes.map((note) => `- ${note}`));
  }
  writeFileSync(join(dir, 'summary.md'), `${lines.join('\n')}\n`);
}
