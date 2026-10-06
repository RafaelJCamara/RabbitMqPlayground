import { Component, computed, DestroyRef, effect, inject } from '@angular/core';
import { Announcer } from '../core/announcer';
import { CanvasSession } from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { saveText } from './save-text';
import { StatusBar } from './status-bar';
import { TopBar } from './top-bar';

/**
 * The editor (ADR-0010, ADR-0030): a top bar, a toolbox on the left, the canvas in the middle, an inspector on the right and a status
 * strip at the bottom. It makes the state that it shares among its parts (ADR-0031), opens the one implicit canvas, and says
 * aloud what the learner needs to hear about keeping it.
 */
@Component({
  selector: 'rmq-editor',
  imports: [TopBar, StatusBar],
  providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, CanvasSession],
  template: `
    <div class="bg-surface text-fg flex h-dvh flex-col">
      <rmq-top-bar />
      <div class="flex min-h-0 flex-1">
        <aside class="border-line bg-panel w-48 shrink-0 border-r p-3" aria-label="Toolbox"></aside>
        <main class="bg-canvas relative min-w-0 flex-1" aria-label="Canvas">
          @if (!ready()) {
            <p class="text-muted p-6" data-testid="opening">Opening your canvas…</p>
          }
        </main>
        <aside class="border-line bg-panel w-72 shrink-0 border-l p-3" aria-label="Inspector"></aside>
      </div>
      <rmq-status-bar />
    </div>
  `,
})
export class Editor {
  private readonly session = inject(CanvasSession);
  private readonly announcer = inject(Announcer);

  protected readonly ready = computed(() => this.session.save().kind !== 'opening');

  constructor() {
    void this.session.open();
    inject(DestroyRef).onDestroy(() => this.session.close());

    // What concerns keeping the canvas is said aloud when it happens, and not each time that it is saved.
    effect(() => {
      const state = this.session.save();
      if (state.kind === 'failed') {
        this.announcer.announce(saveText(state).text, 'assertive');
      }
    });
    effect(() => {
      const warning = this.session.quota();
      if (warning !== null) {
        this.announcer.announce(warning.message, warning.level === 'critical' ? 'assertive' : 'polite');
      }
    });
    effect(() => {
      const note = this.session.persistence();
      if (note !== null) {
        this.announcer.announce(note.message);
      }
    });
  }
}
