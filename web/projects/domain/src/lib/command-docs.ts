import { RABBITMQ_BASELINE } from '@rmq/engine';

/** What the generated command reference says about one command. The command registry produces these. */
export interface CommandDoc {
  /** The verb as typed in the command bar, for example `bind`. */
  readonly name: string;
  readonly syntax: string;
  readonly summary: string;
  readonly examples: readonly string[];
}

/** The registered commands. The document and command layer fills this in (slice S2). */
export const COMMAND_DOCS: readonly CommandDoc[] = [];

/**
 * Renders `docs/commands.md`. The output depends only on its input, so `npm run docs:check` can regenerate it and
 * compare it with the committed file to catch a reference that has drifted from the code.
 */
export function renderCommandReference(docs: readonly CommandDoc[]): string {
  const seen = new Set<string>();
  for (const { name } of docs) {
    if (seen.has(name)) {
      throw new Error(`Duplicate command name: ${name}`);
    }
    seen.add(name);
  }

  const lines = [
    '<!-- Generated from the command registry in @rmq/domain. Do not edit by hand: run `npm run docs:generate` in web/. -->',
    '',
    '# Command reference',
    '',
    'The commands of the command bar (`/` or Ctrl/Cmd+K), described in',
    `[ADR-0011](adr/0011-explicit-linking-and-command-layer.md). They model RabbitMQ ${RABBITMQ_BASELINE}.`,
    '',
  ];

  if (docs.length === 0) {
    lines.push(
      '_No commands are registered yet. They arrive with the document and command layer (slice S2 of the',
      '[M1 plan](plans/m1.md))._',
      '',
    );
  }

  for (const doc of [...docs].sort(byName)) {
    lines.push(`## \`${doc.name}\``, '', doc.summary, '', `**Syntax:** \`${doc.syntax}\``, '');
    if (doc.examples.length > 0) {
      lines.push('**Examples:**', '', '```', ...doc.examples, '```', '');
    }
  }

  return lines.join('\n');
}

function byName(a: CommandDoc, b: CommandDoc): number {
  // Compared by code unit, not by locale, so that the output is the same on every machine.
  // Names are unique here (duplicates were refused above), so two names are never equal.
  return a.name < b.name ? -1 : 1;
}
