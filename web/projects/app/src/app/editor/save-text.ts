import type { SaveState } from '../core/session/canvas-session';

export type SaveTone = 'ok' | 'busy' | 'bad' | 'warn';

export interface SaveText {
  readonly text: string;
  readonly tone: SaveTone;
}

/**
 * What the top bar says about keeping the canvas (ADR-0031): in words, because a colour alone is not a sign (WCAG 1.4.1). It
 * says the root cause that the repository gave when a write failed, and never only that it failed.
 */
export function saveText(state: SaveState): SaveText {
  switch (state.kind) {
    case 'opening':
      return { text: 'Opening your canvas…', tone: 'busy' };
    case 'saving':
      return { text: 'Saving…', tone: 'busy' };
    case 'saved':
      return { text: 'All changes saved', tone: 'ok' };
    case 'failed':
      return { text: `Not saved. ${state.error.message}`, tone: 'bad' };
    case 'memory':
      return { text: `Not kept after you close this tab. ${state.reason}`, tone: 'warn' };
  }
}
