import { Injectable } from '@angular/core';
import type { CanvasDocument } from '@rmq/domain';
import type { SimulationState } from '../runtime/simulation';

/** The live transform of the canvas: where its origin is on the screen, and how far it is zoomed. */
export interface DebugViewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/**
 * What the editor shows to end-to-end tests while it is open (ADR-0031). It only reads: nothing here changes the app. The
 * editor attaches it inside code that is behind `RMQ_E2E`, so that none of it is in the deployed bundle.
 */
export interface EditorDebugSources {
  readonly document: () => CanvasDocument;
  readonly selection: () => { readonly nodes: readonly string[]; readonly edges: readonly string[] };
  /** The edges whose paths the canvas has drawn. Foblex draws them a moment after their elements appear (ADR-0016). */
  readonly drawnEdges: () => readonly string[];
  /** What the canvas reported, oldest first: the contract suite reads it to tell a drop on a node from a drop on nothing. */
  readonly intents: () => readonly unknown[];
  readonly viewport: () => DebugViewport | null;
  /** The clock of the simulation, whether it runs, how fast, when the next thing is, and what the engine says of itself (ADR-0056). `null` without the flag. */
  readonly simulationState: () => SimulationState | null;
}

/** Where the editor says what it can show. The handle on the window reads from here, and answers nothing until there is an editor. */
@Injectable({ providedIn: 'root' })
export class DebugSources {
  private editor: EditorDebugSources | null = null;

  get current(): EditorDebugSources | null {
    return this.editor;
  }

  /** Offers these until the function that it returns is called. */
  attach(sources: EditorDebugSources): () => void {
    this.editor = sources;
    return () => {
      if (this.editor === sources) {
        this.editor = null;
      }
    };
  }
}
