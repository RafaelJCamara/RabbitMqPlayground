import type { Help } from '../../commands/types';
import type { CommandSpec } from '../spec';

/**
 * `help` (ADR-0045). It is a command of the registry, so that it is completed and documented like the others, and it needs the names of every
 * command, itself included, which the registry gives it as a way to ask for them, because the list is made after it.
 */
export function helpSpec(names: () => readonly string[]): CommandSpec<Help> {
  return {
    name: 'help',
    type: 'help',
    scope: 'app',
    syntax: 'help [<command>]',
    summary:
      'Says what a command does and how it is written, with examples. Without a command it lists them all. It changes nothing, and it cannot be one of several commands.',
    examples: ['help', 'help bind', 'help declare queue'],
    parse(cursor) {
      const command = cursor.commandName(names());
      return command === undefined ? { type: 'help' } : { type: 'help', command };
    },
    format: ({ command }) => (command === undefined ? 'help' : `help ${command}`),
  };
}
