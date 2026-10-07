import { describe, expect, it } from 'vitest';
import { isDocumentCommand, isRuntimeCommand } from './kinds';
import type { Command } from './types';

const document: Command[] = [
  { type: 'declare-queue', name: 'q', durable: true },
  { type: 'add-producer', name: 'p' },
  { type: 'bind', source: 'x', destination: { kind: 'queue', name: 'q' }, key: '' },
  { type: 'set', kind: 'canvas', changes: { seed: 1 } },
  { type: 'delete', target: { kind: 'queue', name: 'q' } },
  { type: 'clear' },
  { type: 'layout' },
  { type: 'batch', commands: [] },
];
const runtime: Command[] = [
  { type: 'publish', from: { kind: 'producer', name: 'p' } },
  { type: 'purge', queue: 'q' },
  { type: 'play' },
  { type: 'pause' },
  { type: 'step' },
  { type: 'speed', factor: 2 },
  { type: 'clear-messages' },
  { type: 'reset-counters' },
];
const about: Command[] = [{ type: 'undo' }, { type: 'redo' }, { type: 'help' }];

describe('the kinds of command', () => {
  it.each(document)(
    'has the command that changes the canvas $type as one that changes the document, and as nothing else',
    (command) => {
      expect(isDocumentCommand(command)).toBe(true);
      expect(isRuntimeCommand(command)).toBe(false);
    },
  );

  it.each(runtime)(
    'has the command that runs the simulation $type as one of the runtime, and not as one that changes the document',
    (command) => {
      expect(isRuntimeCommand(command)).toBe(true);
      expect(isDocumentCommand(command)).toBe(false);
    },
  );

  it.each(about)('has the command that answers about the app $type as neither', (command) => {
    expect(isRuntimeCommand(command)).toBe(false);
    expect(isDocumentCommand(command)).toBe(false);
  });
});
