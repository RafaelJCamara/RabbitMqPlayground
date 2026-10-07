import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  manualFrames,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import { render } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { FLAG_SOURCES } from '../../core/flags/feature-flags';
import { FRAME_SOURCE } from '../../core/runtime/frame-loop';
import { MOTION_QUERY } from '../../core/runtime/motion';
import { RUNTIME_SERVICES } from '../../core/runtime/services';
import { Simulation } from '../../core/runtime/simulation';
import { CommandBus } from '../../core/state/command-bus';
import { DocumentStore } from '../../core/state/document-store';
import { SelectionStore } from '../../core/state/selection-store';
import { StatusStore } from '../../core/state/status-store';
import { ThemeService } from '../../core/theme/theme-service';
import { FlowViewport } from '../model/flow-viewport';
import { PAINT_TOKENS } from './colors';
import { CANVAS_CONTEXT, MessageOverlay, PALETTE_READER, STILL_AT } from './overlay';
import { paletteFrom, type Paintable } from './painter';

/**
 * The overlay of the messages (ADR-0055): it asks the library for the path of the edge that a message is on, and draws the message there with the transform that the canvas has
 * now. The canvas here is a box of 800 by 600 at the corner of the page, whose edges are straight lines that the spec says, so that where a message is drawn is a number that it reads.
 * What was drawn is read from what the overlay says of its last frame, and from what the painter was asked.
 */

/** A producer `sender` that sends two messages at a time to the exchange `orders`, which sends them to the queue `billing`, which the consumer `worker` takes from. */
const traffic = (leg = 100): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 2 },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: leg, brokerMs: leg, deliverMs: leg } },
});

/** `sender` publishes straight to the queue `billing`, which `worker` takes from: the link goes through the default exchange, which the canvas draws or not. */
const direct = (showDefaultExchange: boolean): CanvasDocument => ({
  ...documentOf({
    queues: { Q: queueRecord('billing') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'queue', id: 'Q' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst: 1 },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: {
    ...emptyDocument().settings,
    showDefaultExchange,
    timing: { publishMs: 100, brokerMs: 100, deliverMs: 100 },
  },
});

/** The paths that the library has drawn, in the coordinates of the canvas. */
const PATHS: Record<string, string> = {
  'P>E': 'M 0 0 L 100 0',
  'E>Q': 'M 100 0 L 200 0',
  'Q>C': 'M 200 0 L 300 0',
  'P>Q': 'M 0 0 L 100 0',
  '~default>Q': 'M 100 0 L 200 0',
};

interface Strokes {
  readonly arcs: string[];
  clears: number;
  readonly strokes: string[];
}

/** A context that writes down what it was asked. */
function recordingContext() {
  const seen: Strokes = { arcs: [], clears: 0, strokes: [] };
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    font: '',
    textBaseline: 'alphabetic',
    setTransform: () => undefined,
    clearRect: () => {
      seen.clears += 1;
    },
    beginPath: () => undefined,
    arc: (x: number, y: number, r: number) => seen.arcs.push(`${x},${y},${r}`),
    fill: () => undefined,
    stroke() {
      seen.strokes.push(`${context.strokeStyle} ${context.lineWidth}`);
    },
    fillText: () => undefined,
    strokeText: () => undefined,
  };
  return { context: context as unknown as Paintable, seen };
}

async function renderOverlay(
  options: {
    readonly reduced?: boolean;
    readonly paths?: Record<string, string | null>;
    readonly viewport?: () => { x: number; y: number; zoom: number };
    readonly context?: boolean;
    /** How long each leg of a message takes, which is 100 ms. */
    readonly leg?: number;
    readonly document?: CanvasDocument;
  } = {},
) {
  const frames = manualFrames();
  const { context, seen } = recordingContext();
  const paletteRead = vi.fn((_host: HTMLElement) => paletteFrom((token) => `<${token}>`));
  // Each test has paths of its own, because one of them draws an edge another way, and that must not be what the next one finds.
  const paths: Record<string, string | null> = { ...(options.paths ?? PATHS) };
  const live = { x: 10, y: 20, zoom: 1, ...options.viewport?.() };
  const state = { transform: live, host: { width: 800, height: 600 } };
  const view = await render(MessageOverlay, {
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      FlowViewport,
      ...RUNTIME_SERVICES,
      { provide: FRAME_SOURCE, useValue: frames },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation' } },
      {
        provide: MOTION_QUERY,
        useValue: {
          matches: options.reduced === true,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
        },
      },
      { provide: CANVAS_CONTEXT, useValue: () => (options.context === false ? null : context) },
      { provide: PALETTE_READER, useValue: paletteRead },
    ],
  });
  const viewport = TestBed.inject(FlowViewport);
  viewport.attach({
    transform: () => ({
      position: { x: state.transform.x, y: state.transform.y },
      scaledPosition: { x: 0, y: 0 },
      scale: state.transform.zoom,
    }),
    host: () => ({ x: 0, y: 0, ...state.host }),
    fit: () => undefined,
    zoomIn: () => undefined,
    zoomOut: () => undefined,
    resetZoom: () => undefined,
    select: () => undefined,
    focus: () => undefined,
    edgePath: (id) => paths[id] ?? null,
  });
  const simulation = TestBed.inject(Simulation);
  const bus = TestBed.inject(CommandBus);
  TestBed.inject(DocumentStore).load(options.document ?? traffic(options.leg));
  simulation.execute({ type: 'pause' });
  const overlay = view.fixture.componentInstance;
  let started = false;
  let elapsed = 0;
  // A frame: the time of the page, which the loop turns into the time that a frame lasted.
  const frame = (time: number) => {
    frames.frame(time);
  };
  return {
    ...view,
    frames,
    frame,
    seen,
    paletteRead,
    paths,
    state,
    viewport,
    simulation,
    bus,
    store: TestBed.inject(DocumentStore),
    overlay,
    last: () => overlay.lastFrame(),
    send: () => bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'toolbar'),
    /** Lets the clock run for this long more, and gives the messages the frames that they move in, ten milliseconds apart. */
    play(ms: number) {
      bus.run({ type: 'play' }, 'toolbar');
      if (!started) {
        started = true;
        frame(0);
      }
      for (const end = elapsed + ms; elapsed < end;) {
        elapsed += 10;
        frame(elapsed);
      }
    },
  };
}

describe('MessageOverlay (ADR-0055)', () => {
  it('is a canvas that takes no pointer and is hidden from a screen reader, over the whole of its host', async () => {
    const { container, fixture } = await renderOverlay();
    const host = fixture.nativeElement as HTMLElement;

    expect(host).toHaveAttribute('aria-hidden', 'true');
    expect(host).toHaveClass('pointer-events-none', 'absolute', 'inset-0');
    expect(container.querySelector('canvas')).toHaveClass('pointer-events-none');
  });

  it('draws nothing, and asks for no frame, when nothing is on the move', async () => {
    const { frame, seen, last, frames } = await renderOverlay();

    frame(0);

    expect(last().markers).toEqual([]);
    expect(seen.arcs).toEqual([]);
    expect(seen.clears).toBe(0);
    expect(frames.pending).toBe(0);
  });

  it('draws a message on the edge that it is on, where its time puts it, with the transform of the canvas, as one shape for a burst', async () => {
    const { send, play, seen, last } = await renderOverlay();
    send();

    play(50);

    // Two messages, 50 ms into a leg of 100, on a line from (0, 0) to (100, 0), with the canvas at (10, 20).
    expect(last().markers).toEqual([
      { edge: 'P>E', x: 60, y: 20, count: 2, key: 'new', redelivered: false, message: null },
    ]);
    expect(last().reducedMotion).toBe(false);
    expect(seen.arcs.at(-1)).toBe('60,20,7');
  });

  it('draws a message further along as time goes by, and on the next edge when it gets to it', async () => {
    const { send, play, last } = await renderOverlay();
    send();

    play(90);
    expect(last().markers).toMatchObject([{ edge: 'P>E', x: 100 }]);

    play(60);
    // Past the end of the leg to the broker, it is in the broker, on the binding, half way along it.
    expect(last().markers).toMatchObject([{ edge: 'E>Q', x: 160 }]);
  });

  it('follows the canvas when it is panned or zoomed, because the transform is read on every frame', async () => {
    const { send, play, last, state, frame } = await renderOverlay();
    send();
    play(50);
    expect(last().markers[0]).toMatchObject({ x: 60, y: 20 });
    // The frames go on from where they were.

    state.transform = { x: 110, y: 20, zoom: 2 };
    frame(60);

    // 60 ms into the leg: 60 px along the line, which is 120 px at twice the zoom, from the left of 110.
    expect(last().markers[0]?.x).toBeCloseTo(110 + 60 * 2, 5);
    expect(last().markers[0]?.y).toBe(20);
  });

  it('draws still, in the middle of the edge, when the learner asked for less motion, whatever the time, and says so', async () => {
    const { send, play, last, seen } = await renderOverlay({ reduced: true });
    send();

    play(30);
    const early = last().markers[0];
    play(20);

    expect(last().reducedMotion).toBe(true);
    expect(early).toMatchObject({ edge: 'P>E', count: 2, x: 10 + 100 * STILL_AT, y: 20 });
    expect(last().markers[0]).toMatchObject({ x: 60 });
    // The heavy outline of the text, which says that it is a place and not a message on its way.
    expect(seen.strokes).toContain('<--rmq-fg> 3');
  });

  it('wipes what it drew when the last message is gone, once', async () => {
    const { send, play, seen, last, bus, frame } = await renderOverlay();
    send();
    play(50);
    const before = seen.clears;

    bus.run({ type: 'clear-messages' }, 'toolbar');
    frame(1_000);
    frame(1_010);

    expect(last().markers).toEqual([]);
    expect(seen.clears).toBe(before + 1);
  });

  it('draws no message on an edge that the library has not drawn yet, or whose path it cannot read', async () => {
    const { send, play, last } = await renderOverlay({ paths: { 'P>E': null, 'E>Q': 'garbage', 'Q>C': 'M 200 0' } });
    send();

    play(50);

    expect(last().markers).toEqual([]);
  });

  it('reads a path again only when the library draws it another way', async () => {
    const { send, play, last, paths, frame } = await renderOverlay();
    send();
    play(50);
    expect(last().markers[0]).toMatchObject({ x: 60 });

    paths['P>E'] = 'M 0 100 L 100 100';
    frame(60);

    expect(last().markers[0]).toMatchObject({ y: 120 });
  });

  it('asks for a frame when the canvas moves, or an edge is drawn, or the canvas changes, even if the clock is stopped, and stops when it has drawn', async () => {
    const { send, frames, viewport, play, store, simulation, frame } = await renderOverlay();
    send();
    play(50);
    simulation.execute({ type: 'pause' });
    frame(100);
    frame(110);
    expect(frames.pending).toBe(0);

    viewport.noteMoved();
    TestBed.tick();
    expect(frames.pending).toBe(1);
    frame(120);
    expect(frames.pending).toBe(0);

    viewport.markDrawn(['P>E']);
    TestBed.tick();
    expect(frames.pending).toBe(1);
    frame(130);

    store.load(traffic());
    TestBed.tick();
    expect(frames.pending).toBe(1);
  });

  it('draws a step as a move of a quarter of a second, from where the picture was to where the clock is', async () => {
    const { send, simulation, frame, last } = await renderOverlay();
    send();
    // The first of the two messages gets to the broker at 100, and the clock goes there. The second is still on its way to it, at the end of its link in the clock and at the start of it in the picture.
    simulation.execute({ type: 'step' });
    frame(1_000);
    const onTheLink = () => last().markers.find(({ edge }) => edge === 'P>E')?.x;

    expect(onTheLink()).toBe(10);

    for (const time of [1_100, 1_200, 1_250]) {
      frame(time);
    }
    expect(onTheLink()).toBe(110);
  });

  it('asks for a frame when the theme or the preference for motion changes, and reads the colours again', async () => {
    const { send, play, paletteRead, frames, frame } = await renderOverlay();
    send();
    play(30);
    const reads = paletteRead.mock.calls.length;
    expect(reads).toBe(1);
    TestBed.inject(ThemeService).set('dark');
    TestBed.tick();
    expect(frames.pending).toBe(1);
    frame(1_000);

    expect(paletteRead.mock.calls.length).toBe(reads + 1);
    TestBed.inject(ThemeService).set('system');
  });

  it('reads the colours once for as long as it draws, and again after a while, so that a theme that the system changed is followed', async () => {
    const { send, play, paletteRead } = await renderOverlay();
    send();

    play(500);

    expect(paletteRead.mock.calls.length).toBeGreaterThan(1);
    expect(paletteRead.mock.calls.length).toBeLessThan(5);
  });

  it('sizes the canvas to its host, in the pixels of the screen, so that it is sharp', async () => {
    const { send, play, container } = await renderOverlay();
    Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
    try {
      send();
      play(20);

      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      expect([canvas.width, canvas.height]).toEqual([1_600, 1_200]);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    }
  });

  it('asks for a frame when its host changes size, and stops watching when it is gone', async () => {
    let tell: () => void = () => undefined;
    const watched: Element[] = [];
    let stopped = false;
    class Observer {
      constructor(callback: () => void) {
        tell = callback;
      }
      observe(element: Element): void {
        watched.push(element);
      }
      disconnect(): void {
        stopped = true;
      }
    }
    vi.stubGlobal('ResizeObserver', Observer);
    try {
      const { frames, frame, fixture } = await renderOverlay();
      frame(0);
      expect(watched).toEqual([fixture.nativeElement]);
      expect(frames.pending).toBe(0);

      tell();

      expect(frames.pending).toBe(1);
      fixture.destroy();
      expect(stopped).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('draws nothing, and does not fail, where a canvas has no context to draw with', async () => {
    const { send, play, last } = await renderOverlay({ context: false });
    send();

    play(50);

    expect(last().markers).toEqual([]);
  });

  it('draws nothing before the library has a canvas, which is when it does not know where anything is', async () => {
    const { send, play, last, viewport } = await renderOverlay();
    send();
    viewport.attach({
      transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
      host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      fit: () => undefined,
      zoomIn: () => undefined,
      zoomOut: () => undefined,
      resetZoom: () => undefined,
      select: () => undefined,
      focus: () => undefined,
      edgePath: () => null,
    })();

    play(50);

    expect(last().markers).toEqual([]);
  });

  it('keeps asking for frames for as long as the clock runs with something scheduled, and not after', async () => {
    const { send, play, frames, simulation } = await renderOverlay();
    send();

    play(1_000);

    expect(simulation.animating()).toBe(false);
    expect(frames.pending).toBe(0);
  });

  it('says that it has drawn nothing, and that it was not asked for less motion, before it has drawn anything', async () => {
    const { last } = await renderOverlay();

    expect(last()).toEqual({ reducedMotion: false, markers: [] });
  });

  it('reads the colours again every thirty frames that it draws, and not sooner or later', async () => {
    const { send, play, paletteRead } = await renderOverlay({ leg: 10_000 });
    send();

    play(290);
    expect(paletteRead.mock.calls.length).toBe(1);
    play(10);
    expect(paletteRead.mock.calls.length).toBe(2);
    play(290);
    expect(paletteRead.mock.calls.length).toBe(2);
    play(10);
    expect(paletteRead.mock.calls.length).toBe(3);
  });

  it('sizes the canvas to the nearest pixel of the screen when the host is not a whole number of them', async () => {
    const { send, play, container, state } = await renderOverlay();
    state.host = { width: 801, height: 601 };
    Object.defineProperty(window, 'devicePixelRatio', { value: 1.5, configurable: true });
    try {
      send();
      play(20);

      const canvas = container.querySelector('canvas') as HTMLCanvasElement;
      expect([canvas.width, canvas.height]).toEqual([1_202, 902]);
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: 1, configurable: true });
    }
  });

  it('sets the size of the canvas when the host changes in width or in height, and only then, since setting it clears what is drawn', async () => {
    const { send, play, container, state } = await renderOverlay({ leg: 10_000 });
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    const sets: string[] = [];
    let [width, height] = [canvas.width, canvas.height];
    Object.defineProperty(canvas, 'width', {
      configurable: true,
      get: () => width,
      set: (value: number) => {
        sets.push(`width ${value}`);
        width = value;
      },
    });
    Object.defineProperty(canvas, 'height', {
      configurable: true,
      get: () => height,
      set: (value: number) => {
        sets.push(`height ${value}`);
        height = value;
      },
    });
    send();

    play(30);
    expect(sets).toEqual(['width 800', 'height 600']);

    state.host = { width: 900, height: 600 };
    play(10);
    expect(sets).toEqual(['width 800', 'height 600', 'width 900', 'height 600']);

    state.host = { width: 900, height: 700 };
    play(10);
    expect(sets).toEqual(['width 800', 'height 600', 'width 900', 'height 600', 'width 900', 'height 700']);
  });

  it('works out again where the names are on the canvas when the canvas changes, so that a message waits where the canvas has it now', async () => {
    const { send, play, last, bus } = await renderOverlay({ document: direct(false) });
    send();

    // The default exchange is not drawn, so a message that is in the broker waits at the end of the link that it came along.
    play(150);
    expect(last().markers).toMatchObject([{ edge: 'P>Q', x: 110 }]);

    bus.apply({ type: 'set', kind: 'canvas', changes: { showDefaultExchange: true } }, 'toolbar');
    play(10);

    expect(last().markers).toMatchObject([{ edge: '~default>Q' }]);
  });

  it('wipes the canvas once when the last message is gone, and leaves it alone for the frames that follow', async () => {
    const { send, play, seen, bus, viewport, frame } = await renderOverlay();
    send();
    play(50);
    bus.run({ type: 'clear-messages' }, 'toolbar');
    frame(1_000);
    const wiped = seen.clears;

    viewport.noteMoved();
    TestBed.tick();
    frame(1_010);

    expect(seen.clears).toBe(wiped);
  });
});

describe('a press on a shape (ADR-0063)', () => {
  /** A press at a point of the host, in the capture phase on the region that the overlay is in, as the browser sends it: before anything under the region has it. */
  const press = (target: HTMLElement, type: string, x: number, y: number, init: MouseEventInit = {}) => {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };

  /** One message on its way to the broker, 50 ms into a leg of 100, at (60, 20) on the page, which is where a press is a press on it. */
  async function oneShape(burst = 1) {
    const view = await renderOverlay({
      document: {
        ...traffic(),
        producers: {
          P: producerRecord(
            'sender',
            { kind: 'exchange', id: 'E' },
            { message: { payload: 'hi', key: 'new', headers: [] }, burst },
          ),
        },
      },
    });
    view.send();
    view.play(50);
    const pressed = vi.fn();
    view.overlay.pressed.subscribe(pressed);
    const region = (view.fixture.nativeElement as HTMLElement).parentElement as HTMLElement;
    return { ...view, pressed, region };
  }

  it('says which shape is at a point of the host, or the nearest that is within reach, and none when there is no shape within reach', async () => {
    const { overlay } = await oneShape();

    expect(overlay.shapeAt(60, 20)).toMatchObject({ edge: 'P>E', message: 1, count: 1 });
    expect(overlay.shapeAt(60 + 12, 20)).toMatchObject({ message: 1 });
    expect(overlay.shapeAt(60 + 12.1, 20)).toBeNull();
    expect(overlay.shapeAt(60, 20 - 13)).toBeNull();
    expect(overlay.shapeAt(400, 300)).toBeNull();
  });

  it('takes a press on a shape when its owner says that a press is to be taken, tells which shape, and keeps the library from having it', async () => {
    const { fixture, region, pressed } = await oneShape();
    fixture.componentRef.setInput('pressable', true);
    const library = vi.fn();
    const child = region.ownerDocument.createElement('div');
    region.append(child);
    child.addEventListener('pointerdown', library);

    const event = press(child, 'pointerdown', 62, 22);

    expect(pressed).toHaveBeenCalledOnce();
    expect(pressed.mock.calls[0]?.[0]).toMatchObject({ message: 1, count: 1 });
    expect(library).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('also takes the mouse down and the touch start that a press makes, so that the library does not begin a gesture of its own', async () => {
    const { fixture, region, pressed } = await oneShape();
    fixture.componentRef.setInput('pressable', true);
    const library = vi.fn();
    const child = region.ownerDocument.createElement('div');
    region.append(child);
    child.addEventListener('mousedown', library);
    child.addEventListener('touchstart', library);

    const mouse = press(child, 'mousedown', 60, 20);
    const touch = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(touch, 'touches', { value: [{ clientX: 60, clientY: 20 }] });
    child.dispatchEvent(touch);

    expect(library).not.toHaveBeenCalled();
    expect(mouse.defaultPrevented).toBe(true);
    expect(touch.defaultPrevented).toBe(true);
    // Only the press itself tells the owner: the events that follow it do not make it open twice.
    expect(pressed).not.toHaveBeenCalled();
  });

  it('leaves the press to the library when its owner has not said that it is to be taken', async () => {
    const { region, pressed } = await oneShape();
    const library = vi.fn();
    const child = region.ownerDocument.createElement('div');
    region.append(child);
    child.addEventListener('pointerdown', library);

    const event = press(child, 'pointerdown', 60, 20);

    expect(library).toHaveBeenCalledOnce();
    expect(pressed).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('leaves a press that is not on a shape, and one with another button than the main one, and one that is a touch with nothing touched, to the library', async () => {
    const { fixture, region, pressed } = await oneShape();
    fixture.componentRef.setInput('pressable', true);
    const library = vi.fn();
    const child = region.ownerDocument.createElement('div');
    region.append(child);
    child.addEventListener('pointerdown', library);
    child.addEventListener('touchstart', library);

    press(child, 'pointerdown', 400, 300);
    press(child, 'pointerdown', 60, 20, { button: 2 });
    child.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));

    expect(library).toHaveBeenCalledTimes(3);
    expect(pressed).not.toHaveBeenCalled();
  });

  it('says that a crowd is a crowd, with no message, so that its owner can say that it stands for several', async () => {
    const { fixture, region, pressed } = await oneShape(3);
    fixture.componentRef.setInput('pressable', true);

    press(region, 'pointerdown', 60, 20);

    expect(pressed.mock.calls[0]?.[0]).toMatchObject({ count: 3, message: null });
  });

  it('stops listening to the region when it is gone', async () => {
    const { fixture, region, pressed } = await oneShape();
    fixture.componentRef.setInput('pressable', true);
    fixture.destroy();

    press(region, 'pointerdown', 60, 20);

    expect(pressed).not.toHaveBeenCalled();
  });
});

describe('what the overlay draws with in a browser (ADR-0055)', () => {
  it('asks the canvas for a 2D context, and has none where the canvas gives none', () => {
    const canvas = document.createElement('canvas');
    const getContext = vi.spyOn(canvas, 'getContext').mockReturnValue(null);

    expect(TestBed.inject(CANVAS_CONTEXT)(canvas)).toBeNull();
    expect(getContext).toHaveBeenCalledWith('2d');
  });

  it('reads each colour from a probe in its host, which the page gives the token to, and takes the probe away', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const given: { token: string; hidden: string | null; inside: boolean; display: string }[] = [];
    const computed = vi.spyOn(window, 'getComputedStyle').mockImplementation(((probe: HTMLElement) => {
      given.push({
        token: probe.style.color,
        hidden: probe.getAttribute('aria-hidden'),
        inside: probe.parentElement === host,
        display: probe.style.display,
      });
      return { color: `rgb(${given.length}, 0, 0)` } as CSSStyleDeclaration;
    }) as typeof window.getComputedStyle);
    try {
      const palette = TestBed.inject(PALETTE_READER)(host);

      expect(given.map(({ token }) => token)).toEqual(PAINT_TOKENS.map((token) => `var(${token})`));
      expect(given.every(({ hidden, inside, display }) => hidden === 'true' && inside && display === 'none')).toBe(
        true,
      );
      expect(Object.values(palette)).toEqual(PAINT_TOKENS.map((_, index) => `rgb(${index + 1}, 0, 0)`));
      expect(host.children).toHaveLength(0);
    } finally {
      computed.mockRestore();
      host.remove();
    }
  });
});
