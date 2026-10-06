import type { Command } from '../commands/types';
import { findId } from '../document/elements';
import type { ElementKind, ElementRef } from '../document/issue';
import type { CanvasDocument } from '../document/schema';
import type { Cursor } from './cursor';
import { wordText } from './words';

/**
 * What the command layer knows about one command (ADR-0011, ADR-0025): how it is written and how it is described. The
 * registry of these is what the command bar reads, what `help` shows, and what `docs/commands.md` is generated from, so
 * that the reference never drifts from the code: its examples are parsed by the tests.
 */
export interface CommandSpec<C extends Command = Command> {
  /** What the command is called in the command bar: `bind`, or two words, `declare exchange`. */
  readonly name: string;
  readonly type: C['type'];
  /** Whether it changes the document, runs the simulation or is about the app. Only the first two are in M1 so far. */
  readonly scope: 'document' | 'runtime' | 'app';
  readonly syntax: string;
  readonly summary: string;
  /** Written the way that `format` writes them, and each one applies to the sample canvas of the specs. */
  readonly examples: readonly string[];
  /**
   * Reads the words after the name. It throws what the cursor throws, and `parseCommand` catches it. (These two are
   * methods, so that a list of specs of different commands is a list of `CommandSpec`.)
   */
  parse(cursor: Cursor): C;
  /** The command as it is written in the log: what `parse` reads back as the same command. */
  format(command: C, document: CanvasDocument): string;
}

/**
 * How an element is written where the command takes one of several kinds: by its name when that says which, and with its
 * kind in front (`queue:billing`) when the name could be another kind's too. Where only one kind goes, the name is enough,
 * because the position says what it is.
 */
export function refText(document: CanvasDocument, ref: ElementRef, allowed: readonly ElementKind[]): string {
  const name = wordText(ref.name);
  if (allowed.length === 1) {
    return name;
  }
  const holders = allowed.filter((kind) => findId(document, kind, ref.name) !== undefined);
  return holders.length === 1 && holders[0] === ref.kind ? name : `${ref.kind}:${name}`;
}
