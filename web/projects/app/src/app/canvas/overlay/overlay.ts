import {
  Component,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  InjectionToken,
  input,
  output,
  untracked,
  viewChild,
  type AfterViewInit,
} from '@angular/core';
import { FrameLoop } from '../../core/runtime/frame-loop';
import { MotionPreference } from '../../core/runtime/motion';
import { Simulation } from '../../core/runtime/simulation';
import { DocumentStore } from '../../core/state/document-store';
import { ThemeService } from '../../core/theme/theme-service';
import { FlowViewport } from '../model/flow-viewport';
import { pointAtFraction, polylineOf, type Polyline } from '../model/path';
import { toScreen } from '../model/transform';
import { markersOf, placesOf, type Places } from './edges';
import { groupMarkers } from './group';
import { paint, paletteFrom, type Paintable, type Palette, type PlacedSprite } from './painter';

/** Where a message is while it is still, which is what a person who asked for less motion is shown: in the middle of the edge, for as long as the leg lasts. */
export const STILL_AT = 0.5;

/** How many frames go by before the colours are read again, so that a theme that the system changed is followed while messages move, and the page is not asked all the time. */
const PALETTE_FRAMES = 30;

/** The context to draw with, or `null` where a canvas has none. A spec gives one that writes down what it was asked. */
export const CANVAS_CONTEXT = new InjectionToken<(canvas: HTMLCanvasElement) => Paintable | null>('CANVAS_CONTEXT', {
  providedIn: 'root',
  factory: () => (canvas) => canvas.getContext('2d'),
});

/** The colours of the theme that the page has: each token is given to a probe, and what the page makes of it, which `light-dark()` has settled, is read. */
export const PALETTE_READER = new InjectionToken<(host: HTMLElement) => Palette>('PALETTE_READER', {
  providedIn: 'root',
  factory: () => (host) => {
    const probe = host.ownerDocument.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.display = 'none';
    host.append(probe);
    try {
      return paletteFrom((token) => {
        probe.style.color = `var(${token})`;
        return (host.ownerDocument.defaultView as Window).getComputedStyle(probe).color;
      });
    } finally {
      probe.remove();
    }
  },
});

/** One shape that the last frame drew, as the end-to-end suite reads it (ADR-0055). */
export interface DrawnMarker {
  readonly edge: string;
  readonly x: number;
  readonly y: number;
  readonly count: number;
  readonly key: string | null;
  readonly redelivered: boolean;
  /** The number of the message that it stands for, or `null` for a crowd. */
  readonly message: number | null;
}

/** How far from the middle of a shape a press still is on it, in pixels: the dot is 14 across, and a target of the pointer is at least 24 (WCAG 2.5.8). */
export const HIT_RADIUS = 12;

/** What the last frame drew. */
export interface OverlayFrame {
  readonly reducedMotion: boolean;
  readonly markers: readonly DrawnMarker[];
}

const NOTHING: OverlayFrame = { reducedMotion: false, markers: [] };

/**
 * The messages on the canvas (ADR-0055): one `<canvas>` of 2D over the canvas of the editor, as large as its host and as sharp as the screen, that takes no pointer and
 * is hidden from a screen reader, because it is a picture of what the engine says and the counts are text elsewhere. A message is drawn on the edge that it is on, and the edge
 * is the one that the library drew: the overlay asks for its path, finds the point at a fraction of its length and puts it on the screen with the transform that the canvas has
 * now, on every frame, so that a pan, a zoom and a dragged node are followed with no copy of the geometry. It draws in the frames of the page, outside change detection, and the
 * loop stops when nothing moves: a canvas at rest costs no frames. It takes no pointer, and it can be asked what shape is under a point of its host, and for as long as its owner says that a press is
 * to be taken it takes a press that is on a shape, in the capture phase on the region that it is in, before the library, and says which shape (ADR-0063).
 */
@Component({
  selector: 'rmq-message-overlay',
  template: `<canvas
    #surface
    class="pointer-events-none absolute inset-0 size-full"
    data-testid="message-overlay"
  ></canvas>`,
  host: { class: 'pointer-events-none absolute inset-0 block', 'aria-hidden': 'true' },
})
export class MessageOverlay implements AfterViewInit {
  private readonly simulation = inject(Simulation);
  private readonly viewport = inject(FlowViewport);
  private readonly store = inject(DocumentStore);
  private readonly frames = inject(FrameLoop);
  private readonly motion = inject(MotionPreference);
  private readonly theme = inject(ThemeService);
  private readonly contextOf = inject(CANVAS_CONTEXT);
  private readonly readPalette = inject(PALETTE_READER);
  private readonly page = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Whether a press on a shape is taken: the owner says so, and the library has it as it always did while it does not. */
  readonly pressable = input(false);
  /** A press on a shape was taken. */
  readonly pressed = output<DrawnMarker>();
  private readonly surface = viewChild.required<ElementRef<HTMLCanvasElement>>('surface');

  /** What the engine's names are on the canvas, worked out again when the document is another one: asked for in the frame, so that a frame never draws by a canvas that has gone. */
  private places: Places | null = null;
  private placesOfDocument: object | null = null;
  private context: Paintable | null = null;
  private palette: Palette | null = null;
  private framesSincePalette = 0;
  /** The path of each edge as a line, kept until the path changes. */
  private readonly lines = new Map<string, { readonly d: string; readonly line: Polyline | null }>();
  /** Whether something is on the canvas, which has to be wiped when the last message is gone. */
  private painted = false;
  private last: OverlayFrame = NOTHING;

  constructor() {
    const stop = this.frames.add(() => this.draw());
    this.destroyRef.onDestroy(stop);
    // What can move something on the screen without the clock moving: the canvas (a pan, a zoom, a node that is dragged, which move paths), an edge that is drawn, the theme and
    // the preference for motion. A frame is asked for, and it draws once. A change of the document wakes the loop by itself, as the simulation follows it.
    effect(() => {
      this.viewport.moved();
      this.viewport.drawn();
      this.motion.reduced();
      this.theme.preference();
      untracked(() => {
        this.palette = null;
        this.frames.wake();
      });
    });
  }

  ngAfterViewInit(): void {
    this.listenForPresses();
    this.context = this.contextOf(this.surface().nativeElement);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => this.frames.wake());
      observer.observe(this.host);
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
    this.frames.wake();
  }

  /** What the last frame drew: where each shape was, and whether it was drawn still. */
  lastFrame(): OverlayFrame {
    return this.last;
  }

  /** The shape that the last frame drew at a point of the host, or the nearest within reach of it, or `null` when there is none. */
  shapeAt(x: number, y: number): DrawnMarker | null {
    let nearest: DrawnMarker | null = null;
    let best = HIT_RADIUS;
    for (const marker of this.last.markers) {
      const distance = Math.hypot(marker.x - x, marker.y - y);
      if (distance <= best) {
        best = distance;
        nearest = marker;
      }
    }
    return nearest;
  }

  /**
   * Takes a press on a shape, before the library, in the capture phase on the region that the overlay is in: the press is not the canvas's then, so the edge under the shape is not selected, and the mouse and the
   * finger have a way to a message. The events that a press makes after the pointer, a mouse down and a touch start, are taken too, so that the library does not start a gesture of its own from them.
   */
  private listenForPresses(): void {
    const region = this.host.parentElement;
    if (region === null) {
      return;
    }
    const take = (event: Event, point: { readonly clientX: number; readonly clientY: number } | undefined): void => {
      if (!this.pressable() || point === undefined || ('button' in event && (event as MouseEvent).button !== 0)) {
        return;
      }
      const box = this.host.getBoundingClientRect();
      const shape = this.shapeAt(point.clientX - box.left, point.clientY - box.top);
      if (shape === null) {
        return;
      }
      event.stopPropagation();
      event.preventDefault();
      if (event.type === 'pointerdown') {
        this.pressed.emit(shape);
      }
    };
    const onPointer = (event: Event) => take(event, event as PointerEvent);
    const onMouse = (event: Event) => take(event, event as MouseEvent);
    const onTouch = (event: Event) => take(event, (event as TouchEvent).touches?.[0]);
    region.addEventListener('pointerdown', onPointer, true);
    region.addEventListener('mousedown', onMouse, true);
    // A listener of a touch is passive by default on some targets, and a passive one cannot take a press.
    region.addEventListener('touchstart', onTouch, { capture: true, passive: false });
    this.destroyRef.onDestroy(() => {
      region.removeEventListener('pointerdown', onPointer, true);
      region.removeEventListener('mousedown', onMouse, true);
      region.removeEventListener('touchstart', onTouch, true);
    });
  }

  /** One frame: what is on the move, put where it is on the screen. It answers whether the frames go on, which they do for as long as something moves. */
  private draw(): boolean {
    this.paintFrame();
    return this.simulation.animating();
  }

  private paintFrame(): void {
    const canvas = this.surface().nativeElement;
    const size = this.viewport.hostSize();
    const live = this.viewport.live();
    const flights = this.simulation.flights();
    if (this.context === null || size === null || live === null || (flights.length === 0 && !this.painted)) {
      this.last = { reducedMotion: this.motion.reduced(), markers: [] };
      return;
    }
    const scale = (this.page.defaultView as Window).devicePixelRatio;
    const [width, height] = [Math.round(size.width * scale), Math.round(size.height * scale)];
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.framesSincePalette += 1;
    if (this.palette === null || this.framesSincePalette >= PALETTE_FRAMES) {
      this.palette = this.readPalette(this.host);
      this.framesSincePalette = 0;
    }
    const reduced = this.motion.reduced();
    const document = this.store.document();
    if (this.places === null || this.placesOfDocument !== document) {
      this.places = placesOf(document);
      this.placesOfDocument = document;
    }
    const markers = markersOf(flights, this.places, this.simulation.visualTime()).map((marker) =>
      reduced ? { ...marker, at: STILL_AT } : marker,
    );
    const placed: PlacedSprite[] = [];
    for (const sprite of groupMarkers(markers)) {
      const line = this.lineOf(sprite.edge);
      if (line !== null) {
        const { x, y } = toScreen(live, pointAtFraction(line, sprite.at));
        placed.push({ ...sprite, x, y });
      }
    }
    paint(this.context, placed, this.palette, { width: size.width, height: size.height, scale, still: reduced });
    this.painted = placed.length > 0;
    this.last = {
      reducedMotion: reduced,
      markers: placed.map(({ edge, x, y, count, key, redelivered, message }) => ({
        edge,
        x,
        y,
        count,
        key,
        redelivered,
        message,
      })),
    };
  }

  /** The path of an edge as a line, read again only when the library draws it another way. An edge that has not been drawn has none. */
  private lineOf(edge: string): Polyline | null {
    const d = this.viewport.edgePath(edge);
    if (d === null) {
      return null;
    }
    let known = this.lines.get(edge);
    if (known?.d !== d) {
      known = { d, line: polylineOf(d) };
      this.lines.set(edge, known);
    }
    return known.line;
  }
}
