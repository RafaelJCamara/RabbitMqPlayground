import { afterNextRender, inject, Injectable, Injector } from '@angular/core';
import { elementCount, kindOf, nameOf, type CanvasDocument, type Id } from '@rmq/domain';
import { writeCanvasFile } from '@rmq/persistence';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { FILE_DOWNLOADER } from '../core/files/downloader';
import { canvasFileName } from '../core/files/file-names';
import { Simulation } from '../core/runtime/simulation';
import { CanvasSession } from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import type { CommandOrigin } from '../core/state/origin';
import { SelectionStore } from '../core/state/selection-store';
import { ShareDialogs } from '../share/dialogs';

/** What the editor shows as a result of an action: a field for a name, the inspector with the focus. */
export interface ActionSurface {
  startRename(id: Id, origin?: CommandOrigin): void;
  /** Gives the focus to the first field of the inspector. It answers whether there was one. */
  focusInspector(): boolean;
  /** Opens the command bar with the cursor in its field (ADR-0045). */
  openCommandBar(): void;
  /** Closes the command bar when it is open, with the cursor going to the canvas, and opens it when it is not (ADR-0094). */
  toggleCommandBar(): void;
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
  private readonly session = inject(CanvasSession);
  private readonly dialogs = inject(ShareDialogs);
  private readonly downloader = inject(FILE_DOWNLOADER);

  /** Set by the editor, which owns the field for a name and the inspector. */
  surface: ActionSurface | undefined;

  undo(origin: CommandOrigin): void {
    this.bus.undo(origin);
  }

  redo(origin: CommandOrigin): void {
    this.bus.redo(origin);
  }

  /**
   * Takes everything off the canvas (ADR-0074): the command `clear`, with the origin of whoever asked. A canvas that has nothing on it has nothing to clear, which it says,
   * because a button that does nothing and says nothing is the one that a learner presses again.
   */
  clear(origin: CommandOrigin): void {
    if (elementCount(this.store.document()) === 0) {
      this.bus.say('The canvas is already empty.');
      return;
    }
    this.bus.apply({ type: 'clear' }, origin);
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

  toggleCommandBar(): void {
    this.surface?.toggleCommandBar();
  }

  openCheatSheet(): void {
    this.surface?.openCheatSheet();
  }

  /**
   * Opens the panel that makes a link to the canvas as it is on the screen (ADR-0078), with the messages that it holds as a choice. The panel gives the canvas
   * as a file when a link is too long to send.
   */
  share(): void {
    const name = this.session.name();
    const document = this.store.document();
    this.dialogs.share({
      name,
      document,
      saveAsFile: () => this.saveAsFile(name, document),
      messages: { count: this.simulation.messageCount(), snapshot: () => this.simulation.snapshot() },
    });
  }

  /** Opens the dialog that exports the canvas as it is on the screen as a definitions file for a broker (ADR-0079). */
  exportDefinitions(): void {
    this.dialogs.exportDefinitions({ name: this.session.name(), document: this.store.document() });
  }

  /** Gives the canvas as a file (ADR-0075), and says so. A canvas that the app could not open again is not given, and that is said. */
  private saveAsFile(name: string, document: CanvasDocument): void {
    const written = writeCanvasFile({ name, document });
    if (!written.ok) {
      this.announcer.announce(`“${name}” could not be saved as a file. ${written.error.message}`, 'assertive');
      return;
    }
    const file = canvasFileName(name);
    this.downloader.save(file, written.value);
    this.announcer.announce(`Saved “${name}” as ${file}.`);
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
