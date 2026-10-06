import { Component, computed, DestroyRef, effect, inject } from '@angular/core';
import { linkRules } from '@rmq/domain';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import { buildCanvasVm, EMPTY_VM } from '../canvas/model/canvas-vm';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasIntent, ContextTarget } from '../canvas/model/intents';
import type { Point } from '../canvas/model/transform';
import { Announcer } from '../core/announcer';
import { DebugSources } from '../core/debug/debug-sources';
import { CanvasSession } from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { IntentHandler, type IntentSurface } from './intents';
import { saveText } from './save-text';
import { StatusBar } from './status-bar';
import { Toolbox } from './toolbox';
import { TopBar } from './top-bar';

/** How many of the canvas's reports the end-to-end build keeps. */
const INTENT_LOG_LIMIT = 200;

/**
 * The editor (ADR-0010, ADR-0030): a top bar, a toolbox on the left, the canvas in the middle, an inspector on the right and a status
 * strip at the bottom. It makes the state that it shares among its parts (ADR-0031), opens the one implicit canvas, and says
 * aloud what the learner needs to hear about keeping it.
 */
@Component({
  selector: 'rmq-editor',
  imports: [TopBar, StatusBar, Toolbox, FlowCanvas],
  providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, CanvasSession, FlowViewport, IntentHandler],
  template: `
    <div class="bg-surface text-fg flex h-dvh flex-col">
      <rmq-top-bar />
      <div class="flex min-h-0 flex-1">
        <aside class="border-line bg-panel w-52 shrink-0 overflow-y-auto border-r p-3" aria-label="Toolbox">
          <rmq-toolbox (add)="intents.add($event, 'gesture')" />
        </aside>
        <main class="bg-canvas relative min-w-0 flex-1" aria-label="Canvas">
          @if (ready()) {
            <rmq-flow-canvas
              [model]="model()"
              [selection]="selection.selection()"
              [rules]="rules()"
              (intent)="onIntent($event)"
            />
          } @else {
            <p class="text-muted p-6" data-testid="opening">Opening your canvas…</p>
          }
        </main>
        <aside class="border-line bg-panel w-72 shrink-0 border-l p-3" aria-label="Inspector"></aside>
      </div>
      <rmq-status-bar />
    </div>
  `,
})
export class Editor implements IntentSurface {
  private readonly session = inject(CanvasSession);
  private readonly announcer = inject(Announcer);
  private readonly store = inject(DocumentStore);
  private readonly viewport = inject(FlowViewport);
  protected readonly selection = inject(SelectionStore);
  protected readonly intents = inject(IntentHandler);

  protected readonly ready = computed(() => this.session.save().kind !== 'opening');
  private drawn = EMPTY_VM;
  protected readonly model = computed(() => (this.drawn = buildCanvasVm(this.store.document(), this.drawn)));
  protected readonly rules = computed(() => linkRules(this.store.document()));
  private readonly intentLog: CanvasIntent[] = [];

  constructor() {
    void this.session.open();
    inject(DestroyRef).onDestroy(() => this.session.close());
    this.intents.surface = this;

    if (RMQ_E2E) {
      const detach = inject(DebugSources).attach({
        document: () => this.store.document(),
        selection: () => this.selection.selection(),
        drawnEdges: () => [...this.viewport.drawn()],
        intents: () => this.intentLog,
        viewport: () => this.viewport.live(),
      });
      inject(DestroyRef).onDestroy(detach);
    }

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

  protected onIntent(intent: CanvasIntent): void {
    if (RMQ_E2E) {
      this.intentLog.push(intent);
      if (this.intentLog.length > INTENT_LOG_LIMIT) {
        this.intentLog.shift();
      }
    }
    this.intents.handle(intent);
  }

  openMenu(_target: ContextTarget, _client: Point): void {
    // The context menu comes with the commit that builds it.
  }

  startRename(_id: string): void {
    // The field for a name comes with the commit that builds it.
  }
}
