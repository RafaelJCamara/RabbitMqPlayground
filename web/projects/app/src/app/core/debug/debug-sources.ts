import { Injectable } from '@angular/core';
import type { CanvasDocument } from '@rmq/domain';
import type { SimulationState } from '../runtime/simulation';

/** What the overlay of the messages drew in its last frame: where each shape was on the canvas's host, how many messages it stood for, and whether it was drawn still. */
export interface DebugOverlayFrame {
  readonly reducedMotion: boolean;
  readonly markers: readonly {
    readonly edge: string;
    readonly x: number;
    readonly y: number;
    readonly count: number;
    readonly key: string | null;
    readonly redelivered: boolean;
    readonly message: number | null;
  }[];
}

/** A row of the event log as it was said: what a test reads, in place of the rows that the panel draws, which are only the ones that the scroll shows (ADR-0061). */
export interface DebugLogRow {
  readonly seq: number;
  readonly at: number;
  readonly family: string;
  readonly kind: string;
  readonly text: string;
  readonly message: number | null;
}

/** What the event log holds: how many rows it keeps, how many went because it was full, and the rows. */
export interface DebugEventLog {
  readonly count: number;
  readonly dropped: number;
  readonly rows: readonly DebugLogRow[];
}

/** What Why? lights, as plain data: the marks of the edges, by their key, and of the nodes, by their id, and what the card says (ADR-0062). */
export interface DebugEmphasis {
  readonly source: 'row' | 'why' | 'queue' | 'auto' | 'what-if';
  readonly message: number | null;
  readonly title: string;
  readonly text: string;
  readonly edges: readonly { readonly key: string; readonly mark: string; readonly reason?: string }[];
  readonly nodes: readonly { readonly id: string; readonly mark: string }[];
  readonly gone: number;
}

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
  /** What the overlay of the messages drew in its last frame (ADR-0055). `null` without the overlay. */
  readonly overlayFrame: () => DebugOverlayFrame | null;
  /** The rows of the event log (ADR-0061). `null` without both flags that it needs. */
  readonly explainEventLog: () => DebugEventLog | null;
  /** What Why? lights now, and what its card says (ADR-0062). `null` when nothing is lit, and without both flags. */
  readonly explainEmphasis: () => DebugEmphasis | null;
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
