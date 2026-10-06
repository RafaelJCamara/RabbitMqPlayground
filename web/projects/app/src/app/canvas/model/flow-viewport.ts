import { Injectable, signal } from '@angular/core';
import type { Id } from '@rmq/domain';
import {
  isInView,
  liveViewport,
  toCanvas,
  type Point,
  type Size,
  type TransformModel,
  type Viewport,
} from './transform';

/**
 * What the adapter can do to the canvas on behalf of the rest of the app, with no type of the library in sight (ADR-0033). The
 * adapter makes one and attaches it, and `FlowViewport` is what the editor steers the canvas with.
 */
export interface ViewportDriver {
  /** The transform model of the canvas, which is read live (ADR-0016, workaround 1). */
  readonly transform: () => TransformModel;
  /** Where the host of the canvas is on the page, and how big it is. */
  readonly host: () => Point & Size;
  readonly fit: () => void;
  readonly zoomIn: () => void;
  readonly zoomOut: () => void;
  readonly resetZoom: () => void;
  /** Selects these in the library, without telling anyone. */
  readonly select: (nodes: readonly Id[], edges: readonly string[]) => void;
  /** Gives the keyboard focus to the canvas. */
  readonly focus: () => void;
  /** The path that the library drew for an edge, in canvas coordinates, or `null` until it has. */
  readonly edgePath: (id: string) => string | null;
}

/** A node, as far as keeping it in view is concerned. */
export interface Placed {
  readonly id: Id;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The canvas as the rest of the app sees it (ADR-0016, ADR-0033): where it is, how far it is zoomed, which edges have been drawn,
 * and the few things that the app asks of it. Until an adapter is attached it does nothing and knows nothing, so that the app can
 * be tested without a library to draw with.
 */
@Injectable()
export class FlowViewport {
  private readonly zoomValue = signal(1);
  private readonly drawnEdges = signal<ReadonlySet<string>>(new Set());
  private driver: ViewportDriver | undefined;

  /** How far the canvas is zoomed, as the library last said. 1 is 100%. */
  readonly zoom = this.zoomValue.asReadonly();
  /** The keys of the edges whose paths the library has drawn. It draws them a moment after the elements appear (ADR-0016). */
  readonly drawn = this.drawnEdges.asReadonly();

  /** Steers the canvas with this driver until the function that it returns is called. */
  attach(driver: ViewportDriver): () => void {
    this.driver = driver;
    return () => {
      if (this.driver === driver) {
        this.driver = undefined;
        this.drawnEdges.set(new Set());
      }
    };
  }

  /** Where the canvas is on the screen now, read live, or `null` when there is no canvas. */
  live(): Viewport | null {
    return this.driver === undefined ? null : liveViewport(this.driver.transform());
  }

  /** A point of the page, as a pointer reports it, on the canvas, or `null` when there is no canvas. */
  toCanvas(client: Point): Point | null {
    const viewport = this.live();
    const host = this.driver?.host();
    return viewport === null || host === undefined
      ? null
      : toCanvas(viewport, { x: client.x - host.x, y: client.y - host.y });
  }

  fit(): void {
    this.driver?.fit();
  }

  zoomIn(): void {
    this.driver?.zoomIn();
  }

  zoomOut(): void {
    this.driver?.zoomOut();
  }

  resetZoom(): void {
    this.driver?.resetZoom();
  }

  /**
   * Brings a node into view. If it is not, the canvas is fitted to show everything, at 100% or less, and not panned to the node,
   * so that adding something off the screen does not hide what is already there. A node that is in view leaves the canvas alone.
   */
  reveal(node: Placed): void {
    const viewport = this.live();
    const host = this.driver?.host();
    if (viewport !== null && host !== undefined && !isInView(viewport, host, node)) {
      this.driver?.fit();
    }
  }

  select(nodes: readonly Id[], edges: readonly string[] = []): void {
    this.driver?.select(nodes, edges);
  }

  focus(): void {
    this.driver?.focus();
  }

  edgePath(id: string): string | null {
    return this.driver?.edgePath(id) ?? null;
  }

  /** The adapter says how far the canvas is zoomed. */
  setZoom(zoom: number): void {
    this.zoomValue.set(zoom);
  }

  /** The adapter says which edges have been drawn, and which are gone. */
  markDrawn(ids: readonly string[]): void {
    this.update((drawn) => ids.forEach((id) => drawn.add(id)));
  }

  markGone(ids: readonly string[]): void {
    this.update((drawn) => ids.forEach((id) => drawn.delete(id)));
  }

  private update(change: (drawn: Set<string>) => void): void {
    const next = new Set(this.drawnEdges());
    change(next);
    if (next.size !== this.drawnEdges().size || [...next].some((id) => !this.drawnEdges().has(id))) {
      this.drawnEdges.set(next);
    }
  }
}
