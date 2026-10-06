/**
 * Where the canvas is (ADR-0016, ADR-0033): the live viewport, and the two ways across it. Foblex's documented events fire only
 * when a gesture ends, and its `getPosition()` leaves out the offset that zooming makes, so the adapter reads the transform
 * model itself, and this is the arithmetic that turns what it reads into the transform that the screen shows.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
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

/** A point of the page, as a mouse reports it, on the canvas. `host` is where the canvas's host is on the page. */
export const clientToCanvas = (
  viewport: Viewport,
  host: { readonly left: number; readonly top: number },
  client: Point,
): Point => toCanvas(viewport, { x: client.x - host.left, y: client.y - host.top });
