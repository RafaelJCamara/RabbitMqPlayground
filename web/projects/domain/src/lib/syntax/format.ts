import { applyCommand } from '../commands/apply';
import type { Command } from '../commands/types';
import type { CanvasDocument } from '../document/schema';
import { specFor } from './registry';
import { scratchIds } from './scratch';

/**
 * Writing a command (ADR-0011, ADR-0025). This is the "equivalent command" that the log shows beside every gesture, so
 * that a learner sees how what they did is said in words, and it is written so that `parseCommand` reads it back as the
 * same command: a name is bare when it can be and quoted when it cannot, and an element has its kind in front only where
 * the name alone would not say which it is on this canvas.
 *
 * `document` is the canvas that the command is about to be applied to. A batch is written as its commands with `; `
 * between them, each against the canvas that the ones before it make.
 */
export function formatCommand(command: Command, document: CanvasDocument): string {
  if (command.type !== 'batch') {
    return specFor(command.type).format(command, document);
  }
  let working = document;
  return command.commands
    .map((each) => {
      const text = formatCommand(each, working);
      const applied = applyCommand(
        working,
        each,
        scratchIds(() => working),
      );
      if (applied.ok) {
        working = applied.value;
      }
      return text;
    })
    .join('; ');
}
