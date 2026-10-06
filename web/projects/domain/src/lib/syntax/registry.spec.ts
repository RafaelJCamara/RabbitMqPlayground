import { deepFreeze, sampleDocument, sequentialIds } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands/apply';
import type { Command } from '../commands/types';
import { BATCH_DOC, COMMAND_DOCS } from '../command-docs';
import type { CanvasDocument } from '../document/schema';
import { validateDocument } from '../document/validate';
import { formatCommand } from './format';
import { parseCommand } from './parse';
import { matchSpec, nameWords, SPECS, specFor } from './registry';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());

/** Every command that a typed command can be, which is every type but the batch, which is written with `;`. */
const TYPES: readonly Exclude<Command['type'], 'batch'>[] = [
  'declare-exchange',
  'declare-queue',
  'add-producer',
  'add-consumer',
  'bind',
  'unbind',
  'link',
  'unlink',
  'subscribe',
  'unsubscribe',
  'set',
  'unset',
  'move',
  'move-label',
  'rename',
  'delete',
  'clear',
  'layout',
  'undo',
  'redo',
];

describe('the command registry (ADR-0011)', () => {
  it('has each command once, by name and by type, and has a command for every type there is', () => {
    expect(new Set(SPECS.map(({ name }) => name)).size).toBe(SPECS.length);
    expect(new Set(SPECS.map(({ type }) => type)).size).toBe(SPECS.length);
    expect(SPECS.map(({ type }) => type).sort()).toEqual([...TYPES].sort());
  });

  it('names a command with one word or two, in lower case, and a name is not the first words of another unless that is `move`', () => {
    for (const spec of SPECS) {
      expect(spec.name, spec.name).toMatch(/^[a-z]+( [a-z]+)?$/);
    }
    const oneWord = new Set(SPECS.filter((spec) => !spec.name.includes(' ')).map(({ name }) => name));
    const prefixes = SPECS.filter((spec) => spec.name.includes(' ')).map((spec) => nameWords(spec)[0] as string);

    expect(prefixes.filter((prefix) => oneWord.has(prefix))).toEqual(['move']);
  });

  it('says what each command is: its syntax begins with its name, it has a summary of whole sentences, and an example', () => {
    for (const spec of SPECS) {
      expect(spec.syntax.startsWith(spec.name), spec.name).toBe(true);
      expect(spec.summary.length, spec.name).toBeGreaterThan(20);
      expect(spec.summary.endsWith('.'), spec.name).toBe(true);
      expect(spec.summary, spec.name).not.toContain('\n');
      expect(spec.examples.length, spec.name).toBeGreaterThan(0);
      expect(['document', 'runtime', 'app']).toContain(spec.scope);
    }
  });

  it('puts undo and redo in the scope of the app and every other command in that of the document', () => {
    expect(SPECS.filter(({ scope }) => scope === 'app').map(({ name }) => name)).toEqual(['undo', 'redo']);
    expect(SPECS.filter(({ scope }) => scope === 'document')).toHaveLength(SPECS.length - 2);
  });

  describe('its examples, which are the examples of docs/commands.md', () => {
    it.each(SPECS.flatMap((spec) => spec.examples.map((example) => [spec.name, example] as const)))(
      '%s: %s is read as that command, is written back as it was typed, and applies to the sample canvas',
      (name, example) => {
        const spec = SPECS.find((candidate) => candidate.name === name);
        const parsed = parseCommand(example, sample());

        expect(parsed.ok, example).toBe(true);
        const command = parsed.ok ? parsed.value : { type: 'clear' as const };

        expect(command.type).toBe(spec?.type);
        expect(formatCommand(command, sample())).toBe(example);
        if (spec?.scope === 'document') {
          const applied = applyCommand(sample(), command as never, sequentialIds());

          expect(applied.ok, example).toBe(true);
          expect(applied.ok && validateDocument(applied.value), example).toEqual([]);
        }
      },
    );

    it('are enough to show every part of the syntax: a key, a mode, each type of value, exists, and the headers of a message', () => {
      const examples = SPECS.flatMap(({ examples: list }) => list).join('\n');

      for (const part of [
        'key=',
        'x-match=',
        '="',
        'exists(',
        'header:',
        'auto-delete=',
        'default-exchange=',
        ' at=',
      ]) {
        expect(examples, part).toContain(part);
      }
    });
  });

  describe('the documentation that it makes', () => {
    it('has an entry for each command and one for the batch, and the entries say what the specs say', () => {
      expect(COMMAND_DOCS.map(({ name }) => name).sort()).toEqual([...SPECS.map(({ name }) => name), 'batch'].sort());
      for (const spec of SPECS) {
        expect(COMMAND_DOCS.find(({ name }) => name === spec.name)).toEqual({
          name: spec.name,
          syntax: spec.syntax,
          summary: spec.summary,
          examples: spec.examples,
        });
      }
    });

    it('documents the batch with an example that is read as a batch and applies', () => {
      expect(BATCH_DOC.name).toBe('batch');
      for (const example of BATCH_DOC.examples) {
        const parsed = parseCommand(example, sample());

        expect(parsed.ok && parsed.value.type).toBe('batch');
        expect(parsed.ok && formatCommand(parsed.value, sample())).toBe(example);
        expect(
          parsed.ok && parsed.value.type === 'batch' && applyCommand(sample(), parsed.value, sequentialIds()).ok,
        ).toBe(true);
      }
    });
  });

  describe('matchSpec', () => {
    it('finds a command by its name, one word or two', () => {
      expect(matchSpec(['bind', 'orders'])).toMatchObject({ count: 1, spec: { name: 'bind' } });
      expect(matchSpec(['declare', 'queue', 'jobs'])).toMatchObject({ count: 2, spec: { name: 'declare queue' } });
      expect(matchSpec(['clear'])).toMatchObject({ count: 1 });
    });

    it('finds move label before move, and move for any other word after it', () => {
      expect(matchSpec(['move', 'label', 'a'])).toMatchObject({ count: 2, spec: { name: 'move label' } });
      expect(matchSpec(['move', 'billing'])).toMatchObject({ count: 1, spec: { name: 'move' } });
      expect(matchSpec(['move'])).toMatchObject({ count: 1, spec: { name: 'move' } });
    });

    it('finds nothing for words that are not a command, or no words, or a word that starts several commands', () => {
      expect(matchSpec([])).toBeUndefined();
      expect(matchSpec(['frobnicate'])).toBeUndefined();
      expect(matchSpec(['declare'])).toBeUndefined();
      expect(matchSpec(['declare', 'both'])).toBeUndefined();
      expect(matchSpec(['add'])).toBeUndefined();
    });

    it('does not find a command called like something that every object has', () => {
      expect(matchSpec(['constructor'])).toBeUndefined();
      expect(matchSpec(['toString'])).toBeUndefined();
      expect(matchSpec(['__proto__'])).toBeUndefined();
    });
  });

  describe('specFor', () => {
    it.each(TYPES)('finds the spec of a %s command', (type) => {
      expect(specFor(type).type).toBe(type);
    });
  });
});
