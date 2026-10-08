import { InjectionToken } from '@angular/core';

/** What the library asks of the editor that is open: the canvas it opened, and a way to make it finish writing (ADR-0072). */
export interface OpenEditor {
  /** The id of the canvas that the editor actually opened, which is not the one it was asked for if that one could not be opened. */
  readonly id: string;
  /** Writes what is waiting now, and waits for a write that is under way. */
  flush(): Promise<void>;
}

/**
 * The workspace, as the session sees it (ADR-0072). `core/` does not import the folder of the canvases, so the workspace provides this and the session
 * asks it which canvas to open and tells it which editor is open. Without a workspace (the app without the flag `canvases`) there is none, and the
 * session picks the canvas as it always did.
 */
export interface CanvasHost {
  /** The id of the canvas that the editor is to open, or `undefined` if the workspace has no wish. */
  canvasToOpen(): string | undefined;
  /** The editor says that it has opened a canvas. The function that comes back says that the editor is gone. */
  attach(editor: OpenEditor): () => void;
}

export const CANVAS_HOST = new InjectionToken<CanvasHost | null>('CANVAS_HOST', {
  providedIn: 'root',
  factory: () => null,
});
