import { RABBITMQ_BASELINE } from '@rmq/engine';
import { SPECS } from './syntax/registry';

/** What the generated command reference says about one command. The command registry produces these. */
export interface CommandDoc {
  /** The verb as typed in the command bar, for example `bind`. */
  readonly name: string;
  readonly syntax: string;
  readonly summary: string;
  readonly examples: readonly string[];
}

/**
 * Several commands as one change. It is written with `;` and has no name of its own, so it is not in the registry of the
 * commands that are typed by name, and it is documented here.
 */
export const BATCH_DOC: CommandDoc = {
  name: 'batch',
  syntax: '<command>; <command>; ...',
  summary:
    'Several commands, one after the other, as one change. Each is read against the canvas that the ones before it made, so a command can name what an earlier one declared. If one is refused the whole batch is, and undo takes all of it back at once. Drag-to-create is a batch.',
  examples: ['declare queue jobs; bind orders -> jobs key=job.#'],
};

/** The registered commands: every command of the command bar, and the batch. */
export const COMMAND_DOCS: readonly CommandDoc[] = [
  ...SPECS.map(({ name, syntax, summary, examples }): CommandDoc => ({ name, syntax, summary, examples })),
  BATCH_DOC,
];

/** What every command shares: how a name, a value and a kind are written. It is the grammar of ADR-0025, in words. */
const WRITING_COMMANDS = [
  '## Writing commands',
  '',
  '- A command is one line. Several, with `;` between them, are one change, and undo takes them back together.',
  '- A name, a key or a value is written as it is, unless it has a space, a `;`, a `"`, an `=`, a `(`, a `)` or a `->` in it.',
  '  Then it is written in double quotes, with `\\"` and `\\\\` inside, as in `bind "my exchange" -> "my queue"`. The empty name,',
  '  which is the default exchange, is `""`.',
  '- A queue and an exchange may have the same name. Where a command takes either, say which: `queue:orders` or',
  '  `exchange:orders`. A producer is `producer:name` and a consumer `consumer:name`, and `canvas` in `set` is the canvas',
  '  itself, so a queue that is called that is `queue:canvas`.',
  '- A header value is typed by how it is written: `"1"` is a string, `1` an integer, `1.0` a float, `true` and `false` are',
  '  booleans, and any other bare word is a string. An integer has to be a whole number that a JavaScript number holds',
  '  exactly, from -9007199254740991 to 9007199254740991 ([ADR-0023](adr/0023-header-integers-are-limited-to-safe-integers.md)).',
  '- `exists(name)` asks only for a header to be there, whatever its value. A header that is called `key` or `x-match` is',
  '  written with its name in quotes, `"key"=1`, so that it is not taken for the option of that name.',
  '- `->` goes from where a message leaves to where it goes, and the spaces around it are not needed.',
  '',
];

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
    `[ADR-0011](adr/0011-explicit-linking-and-command-layer.md) and [ADR-0025](adr/0025-the-command-grammar.md). They model RabbitMQ ${RABBITMQ_BASELINE}.`,
    '',
    ...WRITING_COMMANDS,
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
