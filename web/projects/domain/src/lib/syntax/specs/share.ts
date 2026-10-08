import type { Share } from '../../commands/types';
import type { CommandSpec } from '../spec';

/**
 * `share` (ADR-0078): opens the panel that makes a link to the canvas. It is a command of the registry, so that it is typed, completed and documented like the others, and it is the app's, like `help`, because
 * it changes nothing in the document and is answered by a panel and not by the canvas. What the link carries is chosen in the panel.
 */
export const share: CommandSpec<Share> = {
  name: 'share',
  type: 'share',
  scope: 'app',
  syntax: 'share',
  summary:
    'Opens the panel that makes a link to the canvas, and to the messages that are queued if you want them. Anyone who has the link can read the whole canvas, with every name in it, and what they change is theirs. It changes nothing, and it cannot be one of several commands.',
  examples: ['share'],
  parse(cursor) {
    cursor.finish();
    return { type: 'share' };
  },
  format: () => 'share',
};
