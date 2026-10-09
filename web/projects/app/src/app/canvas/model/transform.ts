/**
 * Where the canvas is (ADR-0016, ADR-0033): the live viewport, and the two ways across it. Foblex's documented events fire only
 * when a gesture ends, and its `getPosition()` leaves out the offset that zooming makes, so the adapter reads the transform
 * model itself, and this is the arithmetic that turns what it reads into the transform that the screen shows.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The part of Foblex's transform model that the live viewport is made of. */
export interface TransformModel {
  readonly position: Point;
  readonly scaledPosition: Point;
  readonly scale: number;
}

/** A point of the canvas is on the screen at `point * zoom + (x, y)`, measured from the top left of the canvas's host. */
export interface Viewport extends Point {
  readonly zoom: number;
}

/** The viewport that the screen shows now, from the transform model: the same sum that Foblex's own `getState()` reports. */
export function liveViewport(model: TransformModel): Viewport {
  return {
    x: model.position.x + model.scaledPosition.x,
    y: model.position.y + model.scaledPosition.y,
    zoom: model.scale,
  };
}

/** Where a point of the canvas is on the screen, measured from the top left of the host. */
export const toScreen = (viewport: Viewport, point: Point): Point => ({
  x: point.x * viewport.zoom + viewport.x,
  y: point.y * viewport.zoom + viewport.y,
});

/** Where a point of the screen, measured from the top left of the host, is on the canvas. */
export const toCanvas = (viewport: Viewport, point: Point): Point => ({
  x: (point.x - viewport.x) / viewport.zoom,
  y: (point.y - viewport.y) / viewport.zoom,
});

/**
 * Whether a rectangle of the canvas is in view: all of it is inside the host of the canvas, which is `size` big, with `margin`
 * pixels to spare, so that a node at the very edge, half hidden, is not in view.
 */
export function isInView(viewport: Viewport, size: Size, rect: Point & Size, margin = 24): boolean {
  const topLeft = toScreen(viewport, rect);
  const bottomRight = toScreen(viewport, { x: rect.x + rect.width, y: rect.y + rect.height });
  return (
    topLeft.x >= margin &&
    topLeft.y >= margin &&
    bottomRight.x <= size.width - margin &&
    bottomRight.y <= size.height - margin
  );
}

/**
 * The viewport that shows all of these rectangles of the canvas, in the middle of a host that is `host` big, with `padding` pixels
 * all round, and never zoomed in past `maxZoom`: a few small nodes are not blown up to fill the screen. It is `null` when there is
 * nothing to show, or no room to show it in. It is worked out from where the nodes are and how big they are drawn, which the
 * app knows, and not from what the library has measured, which it has only some moments after a node appears.
 */
export function fitViewport(
  boxes: readonly (Point & Size)[],
  host: Size,
  padding: number,
  maxZoom: number,
): Viewport | null {
  if (boxes.length === 0 || host.width <= 0 || host.height <= 0) {
    return null;
  }
  const left = Math.min(...boxes.map(({ x }) => x));
  const top = Math.min(...boxes.map(({ y }) => y));
  const width = Math.max(...boxes.map(({ x, width }) => x + width)) - left;
  const height = Math.max(...boxes.map(({ y, height }) => y + height)) - top;
  const zoom = Math.min(
    maxZoom,
    Math.max(host.width - 2 * padding, 1) / Math.max(width, 1),
    Math.max(host.height - 2 * padding, 1) / Math.max(height, 1),
  );
  return {
    zoom,
    x: (host.width - width * zoom) / 2 - left * zoom,
    y: (host.height - height * zoom) / 2 - top * zoom,
  };
}

/** The part of `host`, a box of the page, that a window of this size shows, measured from the top left of the host. A host that is wholly in the window is all of it. */
export function shownPart(host: Point & Size, window: Size): Point & Size {
  const x = Math.max(0, -host.x);
  const y = Math.max(0, -host.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(host.width, window.width - host.x) - x),
    height: Math.max(0, Math.min(host.height, window.height - host.y) - y),
  };
}

/** Where a popover goes, and the most height that it may have there. */
export interface Placement extends Point {
  /** The popover ends inside its room at this height, and scrolls inside itself when its content is taller. */
  readonly maxHeight: number;
}

/**
 * Where a box of this `size` goes so that it is by an `anchor`, inside the `room` that it has (ADR-0041, ADR-0085): just below the anchor, or above it when there is no room
 * below, and kept inside the room with `margin` to spare. The room is a part of the host measured from the host's top left, and what the window shows of it: a box is never put
 * where the learner cannot see it. Without an anchor the box is in the middle of the top of the room. A box that is taller than the room is placed as if it were as tall as the room,
 * and `maxHeight` is what is left of the room under its top, so that a box whose content is taller than it was thought to be, or than the room, ends inside the room and scrolls.
 */
export function popoverPosition(anchor: (Point & Size) | null, size: Size, room: Point & Size, margin = 8): Placement {
  const left = room.x + margin;
  const right = room.x + room.width - margin;
  const top = room.y + margin;
  const bottom = room.y + room.height - margin;
  const height = Math.min(size.height, Math.max(bottom - top, 0));
  const keep = (value: number, length: number, from: number, to: number): number =>
    Math.max(from, Math.min(value, to - length));
  if (anchor === null) {
    return {
      x: keep(room.x + (room.width - size.width) / 2, size.width, left, right),
      y: top,
      maxHeight: Math.max(bottom - top, 0),
    };
  }
  const below = anchor.y + anchor.height + 6;
  const fits = below + height <= bottom;
  const y = keep(fits ? below : anchor.y - height - 6, height, top, bottom);
  return { x: keep(anchor.x, size.width, left, right), y, maxHeight: Math.max(bottom - y, 0) };
}
