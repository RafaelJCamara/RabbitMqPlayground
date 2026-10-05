import { COMMAND_DOCS, renderCommandReference } from '@rmq/domain';

/** The generated command reference (ADR-0011): `docs/commands.md`, from the command registry in @rmq/domain. */
export const COMMAND_REFERENCE_FILE = new URL('../../../docs/commands.md', import.meta.url);

export function generateCommandReference(): string {
  return renderCommandReference(COMMAND_DOCS);
}

export type DriftResult = { readonly upToDate: true } | { readonly upToDate: false; readonly reason: string };

/** Compares the committed file with what the registry produces now. `committed` is `null` when the file is missing. */
export function checkDrift(generated: string, committed: string | null): DriftResult {
  if (committed === null) {
    return { upToDate: false, reason: 'docs/commands.md does not exist.' };
  }

  // A checkout with CRLF line endings is the same text, not drift.
  const actual = committed.replaceAll('\r\n', '\n');
  if (actual === generated) {
    return { upToDate: true };
  }

  const expectedLines = generated.split('\n');
  const actualLines = actual.split('\n');
  const line = expectedLines.findIndex((text, index) => text !== actualLines[index]);
  const first = line === -1 ? Math.min(expectedLines.length, actualLines.length) : line;
  return {
    upToDate: false,
    reason: `docs/commands.md differs from the generated text, first at line ${first + 1}.`,
  };
}
