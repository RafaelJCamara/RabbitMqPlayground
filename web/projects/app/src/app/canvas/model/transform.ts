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
