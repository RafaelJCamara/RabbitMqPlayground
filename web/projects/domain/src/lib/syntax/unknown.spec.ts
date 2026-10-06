import { describe, expect, it } from 'vitest';
import { isAtom, tokenize } from './tokenizer';
import { unknownCommand } from './unknown';

/** The words of a text as the parser has them, for a name that is only bare words. */
function read(text: string) {
  const tokenized = tokenize(text);
  if (!tokenized.ok) {
    throw new Error(tokenized.error.message);
  }
  const atoms = tokenized.tokens.filter(isAtom);
  return { atoms, words: atoms.map((atom) => (atom.kind === 'word' ? atom.text : '')) };
}

describe('unknownCommand', () => {
  const names = ['solo thing', 'pair one', 'pair two', 'single'];
  const issueFor = (text: string) => {
    const { atoms, words } = read(text);
    return unknownCommand(atoms, words, names);
  };

  it('says that a word that starts exactly one command of two words needs its second word, and which', () => {
    const { atoms, words } = read('solo');

    const issue = unknownCommand(atoms, words, names);

    expect(issue).toMatchObject({ kind: 'unknown-command', suggestions: ['solo thing'] });
    expect(issue.message).toBe("'solo' needs a second word: solo thing.");
    expect(issue.at).toEqual({ start: 0, end: 4 });
  });

  it('says that the two words are not a command when the second is not one of the words that can follow, and which can', () => {
    const { atoms, words } = read('solo thang');

    const issue = unknownCommand(atoms, words, names);

    expect(issue.message).toBe("'solo thang' is not a command: solo thing.");
    expect(issue.suggestions).toEqual(['solo thing']);
    expect(issue.at).toEqual({ start: 0, end: 10 });
  });

  it('lists the words that can follow when there are several, closest first, and all of them when none is close', () => {
    expect(issueFor('pair')).toMatchObject({
      message: "'pair' needs a second word: pair one or pair two.",
      suggestions: ['pair one', 'pair two'],
    });
    expect(issueFor('pair twp')).toMatchObject({ suggestions: ['pair two'] });
    expect(issueFor('pair xyz')).toMatchObject({ suggestions: ['pair one', 'pair two'] });
  });

  it('says that there is no such command, with the names that are close, for a word that starts none of two words', () => {
    const { atoms, words } = read('singel');

    const issue = unknownCommand(atoms, words, names);

    expect(issue).toMatchObject({ kind: 'unknown-command', suggestions: ['single'] });
    expect(issue.message).toBe("There is no command 'singel'. Did you mean 'single'?");
  });

  it('says how a command starts when there is no word to say anything about', () => {
    const { atoms } = read('"quoted"');

    const issue = unknownCommand(atoms, [], names);

    expect(issue).toMatchObject({
      kind: 'syntax',
      message: 'A command starts with its name, for example bind orders -> billing.',
    });
  });
});
