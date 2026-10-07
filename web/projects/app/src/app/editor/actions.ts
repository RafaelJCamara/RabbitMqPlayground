import { afterNextRender, inject, Injectable, Injector } from '@angular/core';
import { kindOf, nameOf, type Id } from '@rmq/domain';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import type { CommandOrigin } from '../core/state/origin';
import { SelectionStore } from '../core/state/selection-store';

/** What the editor shows as a result of an action: a field for a name, the inspector with the focus. */
export interface ActionSurface {
  startRename(id: Id, origin?: CommandOrigin): void;
  /** Gives the focus to the first field of the inspector. It answers whether there was one. */
  focusInspector(): boolean;
  /** Opens the command bar with the cursor in its field (ADR-0045). */
  openCommandBar(): void;
  /** Opens the cheat-sheet (ADR-0047). */
  openCheatSheet(): void;
  /** Shows the event log when it is hidden and hides it when it is shown (ADR-0061). It answers `false` when there is no log, which needs both flags. */
  toggleEventLog(): boolean;
}

/**
 * What the learner can ask of the editor as a whole (ADR-0035): undo and redo, auto-layout, the zoom, and the two actions that a key
 * starts for what is selected. The buttons of the top bar and the shortcuts both call these, so that each is done one way, with one
 * origin and one announcement, whichever way it was asked for.
 */
@Injectable()
export class EditorActions {
  private readonly bus = inject(CommandBus);
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);
  private readonly viewport = inject(FlowViewport);
  private readonly announcer = inject(Announcer);
  private readonly injector = inject(Injector);
  private readonly simulation = inject(Simulation);

  /** Set by the editor, which owns the field for a name and the inspector. */
  surface: ActionSurface | undefined;

  undo(origin: CommandOrigin): void {
    this.bus.undo(origin);
  }

  redo(origin: CommandOrigin): void {
    this.bus.redo(origin);
  }

  /** Puts every node in its place, and then shows all of them: the fit has to wait until they are where they were put. */
  layout(): void {
    const before = this.store.document();
    this.bus.apply({ type: 'layout' }, 'toolbar');
    if (this.store.document() !== before) {
      afterNextRender(() => this.viewport.fit(), { injector: this.injector });
    }
  }

  /** Shows or hides the default exchange, which is a setting of the canvas, so that it is saved, undone and logged like any other change (ADR-0043). */
  setDefaultExchange(on: boolean): void {
    this.bus.apply({ type: 'set', kind: 'canvas', changes: { showDefaultExchange: on } }, 'toolbar');
  }

  /** Shows the whole canvas, and says so, because the picture is all that changes. */
  fit(): void {
    this.viewport.fit();
    this.announcer.announce('Showing the whole canvas.');
  }

  zoomIn(): void {
    this.viewport.zoomIn();
  }

  zoomOut(): void {
    this.viewport.zoomOut();
  }

  resetZoom(): void {
    this.viewport.resetZoom();
  }

  /** Renames the node that is selected, where it is. It says what to do when there is not exactly one. */
  renameSelected(): void {
    const only = this.selection.only();
    if (only?.kind === 'node') {
      this.surface?.startRename(only.id, 'key');
    } else {
      this.announcer.announce('Select one node first, then press F2 to rename it.');
    }
  }

  /** Plays what is paused and pauses what plays, which are two commands, and the log has the one that it was (ADR-0054). */
  togglePlay(origin: CommandOrigin): void {
    this.bus.run({ type: this.simulation.running() ? 'pause' : 'play' }, origin);
  }

  step(origin: CommandOrigin): void {
    this.bus.run({ type: 'step' }, origin);
  }

  /** Publishes from the producer that is selected. It answers `false` when what is selected is not one, so that the key is left for the page. */
  publishSelected(origin: CommandOrigin): boolean {
    const only = this.selection.only();
    const document = this.store.document();
    const name =
      only?.kind === 'node' && kindOf(document, only.id) === 'producer'
        ? nameOf(document, 'producer', only.id)
        : undefined;
    if (name === undefined) {
      return false;
    }
    this.bus.run({ type: 'publish', from: { kind: 'producer', name } }, origin);
    return true;
  }

  openCommandBar(): void {
    this.surface?.openCommandBar();
  }

  openCheatSheet(): void {
    this.surface?.openCheatSheet();
  }

  /** Shows or hides the event log. It answers `false` when there is none, so that the key is left for the page. */
  toggleEventLog(): boolean {
    return this.surface?.toggleEventLog() ?? false;
  }

  /** Takes the learner to the fields of what is selected. It answers whether there was anything to take them to. */
  editSelected(): boolean {
    return this.selection.count() > 0 && this.surface?.focusInspector() === true;
  }
}
