import type { Issue } from '@rmq/domain';
import { describe, expect, it } from 'vitest';
import { applySuggestion } from './fixes';

const issue = (kind: Issue['kind'], line: string, words: string, ...suggestions: string[]): Issue => {
  const start = line.indexOf(words);
  return { kind, message: 'x', at: { start, end: start + words.length }, suggestions };
};

describe('applySuggestion (ADR-0045)', () => {
  it('puts the name of a command in place of the words that were not one', () => {
    const line = 'bnd orders -> billing';

    expect(applySuggestion(line, issue('unknown-command', line, 'bnd', 'bind'), 'bind')).toBe('bind orders -> billing');
  });

  it('puts both words of a command that has two in place of the words that were not one', () => {
    const line = 'declare exchang x type=topic';

    expect(
      applySuggestion(line, issue('unknown-command', line, 'declare exchang', 'declare exchange'), 'declare exchange'),
    ).toBe('declare exchange x type=topic');
  });

  it('puts a name where a name was not found, written the way the grammar reads it: bare if it can be, and quoted if it cannot', () => {
    const line = 'bind orders -> billng';

    expect(applySuggestion(line, issue('missing-element', line, 'billng', 'billing'), 'billing')).toBe(
      'bind orders -> billing',
    );
    expect(applySuggestion(line, issue('missing-element', line, 'billng', 'my queue'), 'my queue')).toBe(
      'bind orders -> "my queue"',
    );
  });

  it('keeps the kind that was written before the name', () => {
    const line = 'bind orders -> queue:billng';

    expect(applySuggestion(line, issue('missing-element', line, 'queue:billng', 'billing'), 'billing')).toBe(
      'bind orders -> queue:billing',
    );
  });

  it('puts a name that says its kind as it is, because the issue wrote it already', () => {
    const line = 'bind orders -> billing';

    expect(applySuggestion(line, issue('ambiguous-name', line, 'billing', 'queue:billing'), 'queue:billing')).toBe(
      'bind orders -> queue:billing',
    );
  });

  it('puts the name of an option in place of the one that is not, and keeps its value', () => {
    const line = 'declare exchange x type=topic durabl=false';

    expect(applySuggestion(line, issue('unknown-option', line, 'durabl=false', 'durable'), 'durable')).toBe(
      'declare exchange x type=topic durable=false',
    );
  });

  it('puts the name of an option in place of a word that has no value, and leaves it so', () => {
    const line = 'declare exchange x type=topic durabl';

    expect(applySuggestion(line, issue('unknown-option', line, 'durabl', 'durable'), 'durable')).toBe(
      'declare exchange x type=topic durable',
    );
  });

  it('puts a value in place of the one that was not a value, and keeps the name of the option', () => {
    const line = 'declare exchange x type=topik';

    expect(applySuggestion(line, issue('invalid-value', line, 'type=topik', 'topic'), 'topic')).toBe(
      'declare exchange x type=topic',
    );
  });

  it('puts a value in place of a word that had no option in front of it', () => {
    const line = 'set canvas x';

    expect(applySuggestion(line, issue('invalid-value', line, 'x', 'seed'), 'seed')).toBe('set canvas seed');
  });

  it('has nothing to put anything in place of when the issue does not say where the words were', () => {
    expect(
      applySuggestion('bnd a', { kind: 'unknown-command', message: 'x', suggestions: ['bind'] }, 'bind'),
    ).toBeUndefined();
  });
});
