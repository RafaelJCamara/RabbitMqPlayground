import type { AppCommand, Command, DocumentCommand, RuntimeCommand } from './types';

/**
 * Which of the three kinds a command is (ADR-0054): one that changes the document, one that runs the simulation, or one that answers about the history or the
 * commands. The app hands each to the one that does it, and a batch holds only the first.
 */

const RUNTIME: ReadonlySet<string> = new Set<RuntimeCommand['type']>([
  'publish',
  'purge',
  'play',
  'pause',
  'step',
  'speed',
  'clear-messages',
  'reset-counters',
]);

const ABOUT_THE_APP: ReadonlySet<string> = new Set<AppCommand['type']>(['undo', 'redo', 'help']);

export const isRuntimeCommand = (command: Command): command is RuntimeCommand => RUNTIME.has(command.type);

export const isDocumentCommand = (command: Command): command is DocumentCommand =>
  !RUNTIME.has(command.type) && !ABOUT_THE_APP.has(command.type);
