import { DOCUMENT, type EnvironmentProviders, inject, provideEnvironmentInitializer } from '@angular/core';
import type { CanvasDocument } from '@rmq/domain';
import { APP_NAME } from '../app-info';
import { FeatureFlags } from '../flags/feature-flags';
import type { FlagName } from '../flags/flags';
import type { SimulationState } from '../runtime/simulation';
import {
  DebugSources,
  type DebugEmphasis,
  type DebugEventLog,
  type DebugOverlayFrame,
  type DebugViewport,
} from './debug-sources';

/**
 * What `window.__rmq` offers to end-to-end tests. It only reads: nothing here changes the app. What the editor knows is
 * empty or `null` until the editor has started (ADR-0031).
 */
export interface RmqDebugHandle {
  readonly app: string;
  /** The feature flags that are on. */
  readonly flags: () => readonly FlagName[];
  /** The document that is open, or `null`. */
  readonly document: () => CanvasDocument | null;
  /** The nodes (by id) and edges (by key) that are selected. */
  readonly selection: () => { readonly nodes: readonly string[]; readonly edges: readonly string[] };
  /** The keys of the edges that the canvas has drawn. */
  readonly drawnEdges: () => readonly string[];
  /** What the canvas has reported: moves, selections, links, drops. Oldest first. */
  readonly intents: () => readonly unknown[];
  /** The live transform of the canvas, or `null`. */
  readonly viewport: () => DebugViewport | null;
  /** The simulation: the clock, whether it runs, how fast, when the next thing is, and the view of the engine. `null` until the editor has started, and without the flag. */
  readonly simulationState: () => SimulationState | null;
  /** What the overlay of the messages drew in its last frame: where each shape was, how many messages it stood for, and whether it was drawn still. `null` without the overlay. */
  readonly overlayFrame: () => DebugOverlayFrame | null;
  /** The rows of the event log: how many, how many went, and each as it was said. `null` until the editor has started, and without the flags `explain` and `simulation`. */
  readonly explainEventLog: () => DebugEventLog | null;
  /** What Why? lights, as marks of the edges and the nodes, and what its card says. `null` when nothing is lit. */
  readonly explainEmphasis: () => DebugEmphasis | null;
}

declare global {
  interface Window {
    /** Present only in the `e2e` build. See `provideDebugHandle`. */
    readonly __rmq?: RmqDebugHandle;
  }
}

export function createDebugHandle(flags: FeatureFlags, sources: DebugSources = new DebugSources()): RmqDebugHandle {
  return Object.freeze({
    app: APP_NAME,
    flags: () => [...flags.enabled],
    document: () => sources.current?.document() ?? null,
    selection: () => {
      const selection = sources.current?.selection();
      return { nodes: [...(selection?.nodes ?? [])], edges: [...(selection?.edges ?? [])] };
    },
    drawnEdges: () => [...(sources.current?.drawnEdges() ?? [])],
    intents: () => [...(sources.current?.intents() ?? [])],
    viewport: () => sources.current?.viewport() ?? null,
    simulationState: () => sources.current?.simulationState() ?? null,
    overlayFrame: () => sources.current?.overlayFrame() ?? null,
    explainEventLog: () => sources.current?.explainEventLog() ?? null,
    explainEmphasis: () => sources.current?.explainEmphasis() ?? null,
  });
}

/** Defines `__rmq` as a property that cannot be reassigned, redefined or listed. A second call changes nothing. */
export function installDebugHandle(target: object, handle: RmqDebugHandle): void {
  if (Object.hasOwn(target, '__rmq')) {
    return;
  }
  Object.defineProperty(target, '__rmq', { value: handle, writable: false, configurable: false, enumerable: false });
}

/**
 * Installs the handle when the app starts. app.config.ts only adds this provider when `RMQ_E2E` is true, which is set
 * by the `e2e` build configuration. In every other build the condition is a constant `false`, so this code and the
 * property are not in the bundle at all.
 */
export function provideDebugHandle(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const win = inject(DOCUMENT).defaultView;
    if (win) {
      installDebugHandle(win, createDebugHandle(inject(FeatureFlags), inject(DebugSources)));
    }
  });
}
