import { BATCH_DOC, COMMAND_DOCS, SPECS } from '@rmq/domain';
import { describe, expect, it } from 'vitest';
import { firstSentence, helpOutput } from './help';

describe('firstSentence', () => {
  it('is the words up to the first full stop, with the stop', () => {
    expect(firstSentence('Puts a queue on the canvas. A queue that is not durable is refused.')).toBe(
      'Puts a queue on the canvas.',
    );
  });

  it('is the whole text when it is one sentence, with or without its stop', () => {
    expect(firstSentence('Takes back the last change.')).toBe('Takes back the last change.');
    expect(firstSentence('Takes back the last change')).toBe('Takes back the last change.');
  });

  it('does not stop at a full stop that has no space after it, as in a number or a name', () => {
    expect(firstSentence('Puts the label at 0.25 of the edge. Then more.')).toBe('Puts the label at 0.25 of the edge.');
  });
});

describe('helpOutput (ADR-0045)', () => {
  it('lists every command of the registry, in its order, each with its first sentence, and the batch as a note', () => {
    const output = helpOutput();

    expect(output.kind).toBe('list');
    if (output.kind !== 'list') {
      return;
    }
    expect(output.commands.map(({ name }) => name)).toEqual(SPECS.map(({ name }) => name));
    for (const { name, summary } of output.commands) {
      const doc = COMMAND_DOCS.find((candidate) => candidate.name === name);
      expect(summary, name).toBe(firstSentence(doc?.summary ?? ''));
      expect(summary.length, name).toBeGreaterThan(10);
      expect(summary.endsWith('.'), name).toBe(true);
    }
    expect(output.several).toBe(firstSentence(BATCH_DOC.summary));
  });

  it('says how a command is written, what it does and its examples, for a command of one word and one of two', () => {
    const bind = helpOutput('bind');
    const queue = helpOutput('declare queue');

    expect(bind).toEqual({ kind: 'one', doc: COMMAND_DOCS.find(({ name }) => name === 'bind') });
    expect(queue).toEqual({ kind: 'one', doc: COMMAND_DOCS.find(({ name }) => name === 'declare queue') });
    expect(bind.kind === 'one' && bind.doc.examples.length).toBeGreaterThan(0);
  });

  it('answers for every command that the registry has, and gives the list for a topic that is not one, which is how to find it', () => {
    for (const { name } of SPECS) {
      expect(helpOutput(name).kind, name).toBe('one');
    }
    expect(helpOutput('frobnicate')).toEqual(helpOutput());
    expect(helpOutput('declare')).toEqual(helpOutput());
    // The batch is documented, but it is not a command that is named.
    expect(helpOutput('batch')).toEqual(helpOutput());
  });

  it('is what the generated reference says, because both are made from the registry', () => {
    for (const { name, syntax, summary, examples } of COMMAND_DOCS.filter(({ name }) => name !== 'batch')) {
      const output = helpOutput(name);
      expect(output).toEqual({ kind: 'one', doc: { name, syntax, summary, examples } });
    }
  });
});
