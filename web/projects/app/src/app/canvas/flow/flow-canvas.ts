import {
  afterNextRender,
  ChangeDetectorRef,
  Component,
  computed,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  type OnDestroy,
  output,
  signal,
  viewChild,
  type AfterViewInit,
} from '@angular/core';
import {
  FCanvasComponent,
  type FCanvasChangeEvent,
  type FCreateConnectionEvent,
  type FCreateNodeEvent,
  type FDeleteSelectedEvent,
  type FDragStartedEvent,
  FFlowComponent,
  FFlowModule,
  type FMoveNodesEvent,
  type FSelectionChangeEvent,
  FZoomDirective,
  provideFFlow,
  withA11y,
  withConnectionFlow,
} from '@foblex/flow';
import type { Id, LinkRules } from '@rmq/domain';
import { isVirtual } from '../../core/state/default-exchange';
import { Icon } from '../../core/ui/icon';
import { NOTHING_SELECTED, type Selection } from '../../core/state/selection-store';
import type { CanvasVm, EdgeVm } from '../model/canvas-vm';
import { inId, NOTHING, outId } from '../model/connector-ids';
import { classifyDrop } from '../model/drop';
import { watchDrawnEdges } from '../model/drawn-edges';
import { FlowViewport, type ViewportDriver } from '../model/flow-viewport';
import { deleteIntent, dropNewIntent, moveIntent, selectIntent } from '../model/from-events';
import { blocksFoblex, CONNECT_KEYS, GRAB_KEYS } from '../model/guard';
import { nodeIdAt, nodeIdOfTarget } from '../model/hit-test';
import type { CanvasIntent, LinkVia } from '../model/intents';
import { labelPlaces, samePlaces } from '../model/label-layout';
import { armedTargets } from '../model/link-targets';
import { RMQ_A11Y_MESSAGES } from '../model/messages';
import { closestFraction, polylineOf } from '../model/path';
import { fitViewport, type TransformModel } from '../model/transform';
import { FlowBridge } from './flow-bridge';

/** Room round the nodes when the canvas is fitted, in pixels, and the zoom that fit never goes past. */
const FIT_PADDING = 40;
const FIT_MAX_ZOOM = 1;

/** How long the labels wait for the geometry to be still before they are placed again, so that they do not move while a node is dragged (ADR-0044). */
const PLACEMENT_DELAY_MS = 120;
/** How far a press on a label moves, in pixels of the page, before it is a drag and not a click, and how near the ends of its edge a label is let go. */
const LABEL_DRAG_THRESHOLD = 3;
const LABEL_MIN = 0.05;
const LABEL_MAX = 0.95;

/** A press on the label of an edge, which becomes a click or a drag. */
interface LabelPress {
  readonly key: string;
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  moved: boolean;
}

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * The Foblex adapter (ADR-0016, ADR-0033): the one component that draws the canvas. The editor gives it a view model, a selection
 * and the link rules, and it gives back intents. Foblex's events never change what is on the canvas: each becomes an intent,
 * the editor decides which commands it is, and the document that results is drawn again.
 *
 * Everything here talks to the library, so it is left out of unit coverage and is covered by the end-to-end journeys and the
 * contract suite (e2e/foblex-contract.spec.ts). What can be pure is in `../model/`.
 */
@Component({
  selector: 'rmq-flow-canvas',
  imports: [FFlowModule, FlowBridge, Icon],
  providers: [
    provideFFlow(
      withA11y({
        keys: { connect: [...CONNECT_KEYS], grab: [...GRAB_KEYS] },
        messages: RMQ_A11Y_MESSAGES,
      }),
      withConnectionFlow('click'),
    ),
  ],
  templateUrl: './flow-canvas.html',
  host: { class: 'block h-full w-full', '[attr.data-ready]': 'ready() || null' },
})
export class FlowCanvas implements AfterViewInit, OnDestroy {
  readonly model = input.required<CanvasVm>();
  readonly selection = input<Selection>(NOTHING_SELECTED);
  readonly rules = input<LinkRules>();
  readonly intent = output<CanvasIntent>();

  private readonly page = inject(DOCUMENT);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  private readonly changes = inject(ChangeDetectorRef);
  private readonly viewport = inject(FlowViewport);

  private readonly flow = viewChild.required(FFlowComponent);
  private readonly canvas = viewChild.required(FCanvasComponent);
  private readonly zoom = viewChild.required(FZoomDirective);

  /** Whether the canvas has been drawn and fitted, so that a test, or an overlay, may read where things are. */
  protected readonly ready = signal(false);

  /** The node whose handle is pressed, or that is selected alone: the one that a link would start from (workaround 2). */
  private readonly armedSource = signal<Id | null>(null);
  private readonly armed = computed(() => armedTargets(this.armedSource(), this.model().nodes, this.rules()));
  /** Whether the last thing that the learner did was a key press or a pointer, and whether a link is being dragged. */
  private lastInput: 'keyboard' | 'pointer' = 'pointer';
  private dragging = false;
  private cleanups: (() => void)[] = [];

  /** The places that the labels have been given along their edges, from the paths that the library drew (ADR-0044). */
  private readonly placed = signal<ReadonlyMap<string, number>>(new Map());
  private placementTimer: ReturnType<typeof setTimeout> | undefined;
  /** The label that is being dragged, and where it is along its edge, for as long as the pointer is down. */
  protected readonly labelDrag = signal<{ readonly key: string; readonly at: number } | null>(null);
  private press: LabelPress | null = null;

  /** Double-clicking a node renames it, so the library's double-click zoom is off. */
  protected readonly noDoubleClickZoom = (): boolean => false;
  protected readonly inId = inId;
  protected readonly outId = outId;

  constructor() {
    // The selection that the editor holds is pushed into the library once the nodes that it names are drawn.
    effect(() => {
      const { nodes, edges } = this.selection();
      this.model();
      afterNextRender(() => this.pushSelection(nodes, edges), { injector: this.injector });
      this.armedSource.set(nodes.length === 1 && edges.length === 0 ? (nodes[0] ?? null) : null);
    });

    // The labels are placed again when the document changes, and when the library draws an edge another way, once things are still.
    effect(() => {
      this.model();
      this.placeLabelsSoon();
    });

    // Capture-phase listeners on the page run before the library's own (workarounds 2 and the guard of ADR-0017).
    const armOnPointerDown = (event: PointerEvent) => {
      this.lastInput = 'pointer';
      const source = this.handleSourceOf(event.target);
      if (source !== null) {
        this.armedSource.set(source);
        // The library reads the list when the drag starts, a few pixels from here, so it has to be in the connector now.
        this.changes.detectChanges();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      this.lastInput = 'keyboard';
      if (event.target instanceof Node && this.host.contains(event.target) && blocksFoblex(event)) {
        event.stopPropagation();
      }
    };
    this.page.addEventListener('pointerdown', armOnPointerDown, true);
    this.page.addEventListener('keydown', onKeyDown, true);
    this.cleanups.push(
      () => this.page.removeEventListener('pointerdown', armOnPointerDown, true),
      () => this.page.removeEventListener('keydown', onKeyDown, true),
    );
  }

  ngAfterViewInit(): void {
    const canvas = this.canvas();
    const zoom = this.zoom();
    const flow = this.flow();
    const driver: ViewportDriver = {
      transform: () => canvas.transform as TransformModel,
      host: () => {
        const rect = this.host.getBoundingClientRect();
        return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
      },
      fit: () => this.fit(canvas),
      zoomIn: () => zoom.zoomIn(),
      zoomOut: () => zoom.zoomOut(),
      resetZoom: () => zoom.reset(),
      select: (nodes, edges) => flow.select([...nodes], [...edges], false),
      focus: () => this.hostFlow()?.focus({ preventScroll: true }),
      edgePath: (id) =>
        this.host.querySelector(`[data-edge="${CSS.escape(id)}"] path.f-connection-path`)?.getAttribute('d') ?? null,
    };
    this.cleanups.push(
      this.viewport.attach(driver),
      watchDrawnEdges(canvas.fConnectionsContainer().nativeElement, {
        drawn: (ids) => this.viewport.markDrawn(ids),
        gone: (ids) => this.viewport.markGone(ids),
        geometry: () => this.placeLabelsSoon(),
      this.watchTransform(canvas.hostElement),
      }),
    );
  }

  /** Works out where the labels go from the paths that are drawn, a moment after the last thing moved, and not while it still is moving. */
  private placeLabelsSoon(): void {
    clearTimeout(this.placementTimer);
    this.placementTimer = setTimeout(() => {
  /**
   * Tells the rest of the app when the canvas moves, while it moves: the library says so only when a gesture ends, and what is laid over the canvas, which
   * follows the live transform on every frame, has to be drawn again when the canvas is panned or zoomed while the clock is stopped (ADR-0055).
   */
  private watchTransform(canvas: HTMLElement): () => void {
    if (typeof MutationObserver !== 'function') {
      return () => undefined;
    }
    const observer = new MutationObserver(() => this.viewport.noteMoved());
    observer.observe(canvas, { attributes: true, attributeFilter: ['style', 'transform'] });
    return () => observer.disconnect();
  }

      const next = labelPlaces(this.model(), (key) => this.viewport.edgePath(key));
      if (!samePlaces(next, this.placed())) {
        this.placed.set(next);
      }
    }, PLACEMENT_DELAY_MS);
  }

  /** Where along its edge a label is drawn: where it is being dragged to, else where the document keeps it, else where the app placed it, else the middle. */
  protected labelAt(edge: EdgeVm): number {
    const drag = this.labelDrag();
    return drag?.key === edge.id ? drag.at : (edge.labelAt ?? this.placed().get(edge.id) ?? 0.5);
  }

  /** An edge that is not a binding of the document is drawn with a dashed line: the link to a queue, and the implicit bindings (ADR-0043). */
  protected isDashed(edge: EdgeVm): boolean {
    return edge.kind === 'implicit' || (edge.kind === 'link' && edge.chips.length > 0);
  }

  /**
   * The library starts a drag of the canvas, and a selection, from the first mouse or touch event of a press, and a press on a label is neither, so it
   * does not hear of it (ADR-0044). The label is ours: a click selects its edge and a drag moves it, from its own pointer events.
   */
  protected onLabelStart(event: Event): void {
    event.stopPropagation();
  }

  protected onLabelDown(event: PointerEvent, edge: EdgeVm): void {
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.press = { key: edge.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
    this.intent.emit({ type: 'peek', key: null });
  }

  protected onLabelMove(event: PointerEvent): void {
    const press = this.press;
    if (press === null || press.pointerId !== event.pointerId || isVirtual(press.key)) {
      return;
    }
    if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < LABEL_DRAG_THRESHOLD) {
      return;
    }
    press.moved = true;
    const d = this.viewport.edgePath(press.key);
    const line = d === null ? null : polylineOf(d);
    const point = this.viewport.toCanvas({ x: event.clientX, y: event.clientY });
    if (line !== null && point !== null) {
      const at = Math.min(LABEL_MAX, Math.max(LABEL_MIN, closestFraction(line, point)));
      this.labelDrag.set({ key: press.key, at });
    }
  }

  /** A click selects the edge, which the library would have done; a drag that moved the label is one `move-label`, where it was let go (the editor keeps it to a thousandth). */
  protected onLabelUp(event: PointerEvent): void {
    const press = this.press;
    if (press === null || press.pointerId !== event.pointerId) {
      return;
    }
    this.press = null;
    const drag = this.labelDrag();
    this.labelDrag.set(null);
    if (drag !== null) {
      this.intent.emit({ type: 'move-label', key: drag.key, at: drag.at });
    } else if (!press.moved) {
      this.intent.emit({ type: 'select', nodes: [], edges: [press.key] });
    }
  }

  protected onLabelCancel(event: PointerEvent): void {
    if (this.press?.pointerId === event.pointerId) {
      this.press = null;
      this.labelDrag.set(null);
    }
  }

  /**
   * A pointer that hovers over a label that has more than it shows asks for the list; a touch has no hover, and the inspector has the list. A press on a label does
   * not meet this: the pointer is over the label before it presses, and is captured by it after, so it enters no other.
   */
  protected onLabelEnter(event: PointerEvent, edge: EdgeVm): void {
    if (event.pointerType === 'touch' || edge.more.length === 0) {
      return;
    }
    const { left, top, width, height } = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.intent.emit({ type: 'peek', key: edge.id, rect: { x: left, y: top, width, height } });
  }

  protected onLabelLeave(event: PointerEvent, edge: EdgeVm): void {
    if (event.pointerType !== 'touch' && edge.more.length > 0) {
      this.intent.emit({ type: 'peek', key: null });
    }
  }

  /**
   * Shows every node: the viewport is worked out from where the nodes are and how big they are drawn (the library's own fit waits for
   * what it has measured of them, and does not always get it for the first node), written into the transform of the canvas, drawn, and
   * said, so that the percentage of the zoom follows.
   */
  private fit(canvas: FCanvasComponent): void {
    const { width, height } = this.host.getBoundingClientRect();
    const next = fitViewport(this.model().nodes, { width, height }, FIT_PADDING, FIT_MAX_ZOOM);
    if (next === null) {
      return;
    }
    canvas.transform.scale = next.zoom;
    canvas.transform.scaledPosition = { x: 0, y: 0 };
    canvas.transform.position = { x: next.x, y: next.y };
    canvas.redraw();
    canvas.emitCanvasChangeEvent();
  }

  ngOnDestroy(): void {
    clearTimeout(this.placementTimer);
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
  }

  /** The list of connectors that a handle may be joined to: the armed one carries it, and every other carries "nothing". */
  protected targetsFor(id: Id): string[] {
    return this.armedSource() === id ? this.armed() : NOTHING;
  }

  protected onSelection(event: FSelectionChangeEvent): void {
    this.intent.emit(selectIntent(event));
  }

  protected onMoveNodes(event: FMoveNodesEvent): void {
    this.intent.emit(moveIntent(event, this.lastInput));
  }

  protected onDelete(event: FDeleteSelectedEvent): void {
    this.intent.emit(deleteIntent(event, this.lastInput));
  }

  protected onCreateNode(event: FCreateNodeEvent): void {
    this.intent.emit(dropNewIntent(event));
  }

  protected onCanvasChange(event: FCanvasChangeEvent): void {
    this.viewport.setZoom(event.scale);
  }

  /** A canvas that has just been drawn shows everything that is on it, at 100% or less. */
  protected onFullRendered(): void {
    this.viewport.fit();
    this.ready.set(true);
  }

  protected onDragStarted(event: FDragStartedEvent): void {
    this.dragging = event.kind === 'create-connection';
  }

  protected onDragEnded(): void {
    this.dragging = false;
  }

  /**
   * A drop on a valid target, a drop on one that is not, and a drop on nothing all come from the library as a link, and the last two
   * as "no target" (workaround 4), so the pointer is hit-tested to tell them apart.
   */
  protected onCreateConnection(event: FCreateConnectionEvent): void {
    const client = event.dropPosition;
    const via: LinkVia = this.lastInput === 'keyboard' ? 'keyboard' : this.dragging ? 'drag' : 'click';
    this.intent.emit(
      classifyDrop({
        source: event.sourceId,
        targetConnector: event.targetId,
        nodeUnderPointer: nodeIdAt(this.page.elementsFromPoint(client.x, client.y), this.host),
        at: this.viewport.toCanvas(client) ?? client,
        client,
        via,
      }),
    );
  }

  protected onContextMenu(event: MouseEvent): void {
    const node = nodeIdOfTarget(event.target);
    const edge =
      event.target instanceof Element ? event.target.closest('[data-edge]')?.getAttribute('data-edge') : null;
    // The default exchange and its implicit edges are not the document's, have no menu, and leave the right click to the browser (ADR-0043).
    if (node !== null && !isVirtual(node)) {
      event.preventDefault();
      this.intent.emit({
        type: 'context-menu',
        target: { kind: 'node', id: node },
        client: { x: event.clientX, y: event.clientY },
      });
    } else if (edge !== null && edge !== undefined && !isVirtual(edge)) {
      event.preventDefault();
      this.intent.emit({
        type: 'context-menu',
        target: { kind: 'edge', key: edge },
        client: { x: event.clientX, y: event.clientY },
      });
    } else {
      this.contextMenuFromKeyboard(event);
    }
  }

  protected onDoubleClick(event: MouseEvent): void {
    const id = nodeIdOfTarget(event.target);
    if (id !== null && !isVirtual(id)) {
      this.intent.emit({ type: 'rename', id });
    }
  }

  /**
   * The menu key and Shift+F10 send the event to the canvas itself, so the menu is for the one thing that is selected. A pointer on
   * the empty canvas sends it to the canvas itself as well, so it is the last thing that was done, a key and not a press, that says
   * which it is: a right click on nothing is left to the browser.
   */
  private contextMenuFromKeyboard(event: MouseEvent): void {
    if (this.lastInput !== 'keyboard') {
      return;
    }
    const { nodes, edges } = this.selection();
    const [node] = nodes;
    const [edge] = edges;
    const target =
      nodes.length === 1 && edges.length === 0 && node !== undefined
        ? ({ kind: 'node', id: node } as const)
        : edges.length === 1 && nodes.length === 0 && edge !== undefined
          ? ({ kind: 'edge', key: edge } as const)
          : null;
    if (target === null || isVirtual(target.kind === 'node' ? target.id : target.key)) {
      return;
    }
    event.preventDefault();
    const element = this.host.querySelector(
      target.kind === 'node' ? `[data-node-id="${CSS.escape(target.id)}"]` : `[data-edge="${CSS.escape(target.key)}"]`,
    );
    const rect = (element ?? this.host).getBoundingClientRect();
    this.intent.emit({
      type: 'context-menu',
      target,
      client: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    });
  }

  private hostFlow(): HTMLElement | null {
    return this.host.querySelector('f-flow');
  }

  /** The node that owns the handle that a pointer went down on, if it is an output handle. */
  private handleSourceOf(target: EventTarget | null): Id | null {
    if (!(target instanceof Element) || !this.host.contains(target)) {
      return null;
    }
    return target.closest('[data-handle="out"]')?.closest('[data-node-id]')?.getAttribute('data-node-id') ?? null;
  }

  private pushSelection(nodes: readonly Id[], edges: readonly string[]): void {
    const current = this.flow().getSelection();
    if (!sameIds(current.fNodeIds, nodes) || !sameIds(current.fConnectionIds, edges)) {
      this.flow().select([...nodes], [...edges], false);
    }
  }
}
