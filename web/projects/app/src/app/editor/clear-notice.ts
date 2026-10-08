import { DestroyRef, inject, Injectable } from '@angular/core';
import { succeed } from '@rmq/persistence';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { Toasts } from '../core/ui/toasts';
import { formatChord } from './keyboard';

/**
 * The notice that follows a `clear` (ADR-0074), from whichever way it was asked for: the button, the command bar, a script. Its Undo is the editor's Undo, so the
 * history has one step for the clear as the log of equivalent commands has one line, and it is true only while the document is the one that the clear left: a change
 * after it, or an Undo with the keys, takes the notice away. It goes with the editor, because an Undo of a canvas that is no longer open would do nothing and say it did.
 */
@Injectable()
export class ClearNotice {
  constructor() {
    const bus = inject(CommandBus);
    const store = inject(DocumentStore);
    const toasts = inject(Toasts);
    const shown = new Set<number>();
    const stop = bus.onApplied(({ command, after }) => {
      if (command.type === 'clear') {
        shown.add(
          toasts.show({
            message: 'Cleared the canvas.',
            undo: {
              label: 'Undo',
              keys: formatChord({ key: 'z', mod: true }),
              run: async () => {
                bus.undo('toolbar');
                return succeed(undefined);
              },
            },
            stillTrue: () => store.document() === after,
          }),
        );
      }
    });
    inject(DestroyRef).onDestroy(() => {
      stop();
      for (const id of shown) {
        toasts.dismiss(id);
      }
    });
  }
}
