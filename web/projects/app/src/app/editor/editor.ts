import { Component, computed, DestroyRef, effect, inject, signal, viewChild } from '@angular/core';
import { linkRules, type Id, type Issue } from '@rmq/domain';
import { FlowCanvas } from '../canvas/flow/flow-canvas';
import { buildCanvasVm, EMPTY_VM } from '../canvas/model/canvas-vm';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { lowerFirst } from '../canvas/model/labels';
import type { CanvasIntent, ContextTarget } from '../canvas/model/intents';
import type { Point, Size } from '../canvas/model/transform';
import { Announcer } from '../core/announcer';
import { DebugSources } from '../core/debug/debug-sources';
import { CanvasSession } from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import type { CommandOrigin } from '../core/state/origin';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { ContextMenu, type MenuAction } from './context-menu';
import { Inspector } from './inspector';
import { IntentHandler, type IntentSurface } from './intents';
import { RenameField, type RenameBy } from './rename-field';
import { saveText } from './save-text';
import { StatusBar } from './status-bar';
import { Toolbox } from './toolbox';
import { TopBar } from './top-bar';

/** How many of the canvas's reports the end-to-end build keeps. */
const INTENT_LOG_LIMIT = 200;

/** A node that is being renamed, and where its field is. */
interface Renaming {
  readonly id: Id;
  readonly name: string;
  readonly label: string;
  readonly origin: CommandOrigin;
  readonly rect: Point & Size;
  /** Why the last name was refused, while the field stays open. */
  readonly error: Issue | null;
}

/**
 * The editor (ADR-0010, ADR-0030): a top bar, a toolbox on the left, the canvas in the middle, an inspector on the right and a status
 * strip at the bottom. It makes the state that it shares among its parts (ADR-0031), opens the one implicit canvas, and says
 * aloud what the learner needs to hear about keeping it.
 */
@Component({
  selector: 'rmq-editor',
  imports: [TopBar, StatusBar, Toolbox, FlowCanvas, Inspector, RenameField, ContextMenu],
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
          @if (renaming(); as rename) {
            <rmq-rename-field
              [rect]="rename.rect"
              [value]="rename.name"
              [label]="rename.label"
              [error]="rename.error"
              (commit)="onRename($event)"
              (cancelled)="endRename()"
            />
          }
        </main>
        <aside class="border-line bg-panel w-80 shrink-0 overflow-y-auto border-l p-3" aria-label="Inspector">
          <rmq-inspector />
        </aside>
      </div>
      <rmq-status-bar />
      <rmq-context-menu (act)="onMenuAction($event)" (dismissed)="viewport.focus()" />
    </div>
  `,
})
export class Editor implements IntentSurface {
  private readonly session = inject(CanvasSession);
  private readonly announcer = inject(Announcer);
  private readonly store = inject(DocumentStore);
  private readonly status = inject(StatusStore);
  protected readonly viewport = inject(FlowViewport);
  protected readonly selection = inject(SelectionStore);
  protected readonly intents = inject(IntentHandler);

  protected readonly ready = computed(() => this.session.save().kind !== 'opening');
  private drawn = EMPTY_VM;
  protected readonly model = computed(() => (this.drawn = buildCanvasVm(this.store.document(), this.drawn)));
  protected readonly rules = computed(() => linkRules(this.store.document()));
  private readonly intentLog: CanvasIntent[] = [];
  private readonly menu = viewChild.required(ContextMenu);
  protected readonly renaming = signal<Renaming | null>(null);

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

  /** The menu is for what was pointed at, so that is what is selected, and what the inspector shows. */
  openMenu(target: ContextTarget, client: Point): void {
    if (target.kind === 'node') {
      if (!this.selection.selection().nodes.includes(target.id)) {
        this.selection.select([target.id]);
      }
      this.menu().open(target, client, `Actions for ${this.intents.describe(target.id) ?? 'this node'}`);
    } else {
      this.selection.select([], [target.key]);
      this.menu().open(target, client, 'Actions for this edge');
    }
  }

  /** Opens the field for a name over the node, with the name selected. */
  startRename(id: Id, origin: CommandOrigin = 'gesture'): void {
    const node = this.model().nodes.find((candidate) => candidate.id === id);
    const rect = node && this.viewport.onHost(node);
    if (node === undefined || !rect) {
      return;
    }
    this.renaming.set({ id, name: node.name, label: `Rename ${lowerFirst(node.label)}`, origin, rect, error: null });
  }

  /** A name is given. A refusal keeps the field open with its reason when Enter gave it, and closes it when the field was left. */
  protected onRename({ name, by }: { readonly name: string; readonly by: RenameBy }): void {
    const renaming = this.renaming();
    if (renaming === null) {
      return;
    }
    if (name === renaming.name) {
      this.endRename();
      return;
    }
    const result = this.intents.rename(renaming.id, name, renaming.origin);
    if (result === undefined || result.ok) {
      this.endRename();
    } else if (by === 'enter') {
      // The reason is under the field, so it is not also on the status line, and the bus has said it aloud.
      this.status.clearRefusalFrom(renaming.origin);
      this.renaming.set({ ...renaming, error: result.error });
    } else {
      this.endRename(false);
    }
  }

  protected endRename(focusCanvas = true): void {
    this.renaming.set(null);
    if (focusCanvas) {
      this.viewport.focus();
    }
  }

  protected onMenuAction({ action, target }: MenuAction): void {
    if (action === 'rename' && target.kind === 'node') {
      this.startRename(target.id, 'menu');
    } else if (action === 'delete') {
      this.intents.deleteTarget(target, 'menu');
      this.viewport.focus();
    }
  }
}
