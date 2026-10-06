import { describe, expect, it } from 'vitest';
import type { SaveState } from '../core/session/canvas-session';
import { saveText } from './save-text';

describe('saveText', () => {
  it.each<[string, SaveState, string, string]>([
    ['opening', { kind: 'opening' }, 'Opening your canvas…', 'busy'],
    ['saving', { kind: 'saving' }, 'Saving…', 'busy'],
    ['saved', { kind: 'saved' }, 'All changes saved', 'ok'],
    [
      'a write that failed, with the reason of the repository first',
      { kind: 'failed', error: { kind: 'quota-exceeded', message: 'The browser has no room left.' } },
      'Not saved. The browser has no room left.',
      'bad',
    ],
    [
      'a canvas that is kept in memory, with the reason that nothing is kept',
      { kind: 'memory', reason: 'The browser keeps nothing.' },
      'Not kept after you close this tab. The browser keeps nothing.',
      'warn',
    ],
  ])('says, for %s, what it came to, and how it is to be taken', (_what, state, text, tone) => {
    expect(saveText(state)).toEqual({ text, tone });
  });
});
