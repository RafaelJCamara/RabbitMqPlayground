import { BATCH_DOC, COMMAND_DOCS, SPECS, type CommandDoc } from '@rmq/domain';

/** What `help` shows (ADR-0045): every command with a sentence, or one command in full. */
export type HelpOutput =
  | {
      readonly kind: 'list';
      readonly commands: readonly { readonly name: string; readonly summary: string }[];
      /** What `;` does, which is not a command of its own. */
      readonly several: string;
    }
  | { readonly kind: 'one'; readonly doc: CommandDoc };

/** The words of a summary up to the first full stop that ends a sentence, which is one that a space or the end follows: `0.25` does not end one. */
export function firstSentence(summary: string): string {
  const match = /^.*?\.(?=\s|$)/s.exec(summary);
  return match === null ? `${summary}.` : match[0];
}

/**
 * The answer to `help` or `help <command>`, made from the registry, so that it says what the reference of commands says and a command that is added is in it.
 * It is `undefined` for a name that is not a command, which the parser does not let through.
 */
export function helpOutput(topic?: string): HelpOutput | undefined {
  if (topic === undefined) {
    return {
      kind: 'list',
      commands: SPECS.map(({ name, summary }) => ({ name, summary: firstSentence(summary) })),
      several: firstSentence(BATCH_DOC.summary),
    };
  }
  const doc = COMMAND_DOCS.find(({ name }) => name === topic && SPECS.some((spec) => spec.name === name));
  return doc === undefined ? undefined : { kind: 'one', doc };
}
