import { PAINT_TOKENS, tokenFor, type PaintToken } from './colors';
import type { Sprite } from './group';

/** The part of a 2D context that the painter draws with, so that a spec can give it one that writes down what it was asked. */
export type Paintable = Pick<
  CanvasRenderingContext2D,
  | 'setTransform'
  | 'clearRect'
  | 'beginPath'
  | 'arc'
  | 'fill'
  | 'stroke'
  | 'fillText'
  | 'strokeText'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'lineJoin'
  | 'font'
  | 'textBaseline'
>;

/** The colours that are drawn with, by the name of the token that they are of, in the form that a canvas takes: the theme that the page has now. */
export type Palette = Readonly<Record<PaintToken, string>>;

/** A shape, and where it is, in pixels of the canvas's host. */
export interface PlacedSprite extends Sprite {
  readonly x: number;
  readonly y: number;
}

/** How big a message is drawn, in pixels: the dot, and the ring that says that it is redelivered. */
export const RADIUS = 7;
export const RING_GAP = 3;

/** While there are no more shapes than this, the key of each is written beside it. More would be a wall of words. */
export const LABELLED_LIMIT = 12;

/** The longest that a key is written. */
const LABEL_LENGTH = 14;

const FONT = '600 12px system-ui, sans-serif';
const TAU = Math.PI * 2;

/** The palette from a way to read what a token is. A token that says nothing is left to draw with nothing, which a canvas takes as black. */
export const paletteFrom = (read: (token: PaintToken) => string): Palette =>
  Object.fromEntries(PAINT_TOKENS.map((token) => [token, read(token)])) as Palette;

/** A key as it is written beside a message: as it is, or cut short. */
export const labelOf = (key: string): string =>
  key.length <= LABEL_LENGTH ? key : `${key.slice(0, LABEL_LENGTH - 1)}…`;

/** The word beside a shape: its count when it stands for several, and else its key, while there are few shapes, and none for a message that has none. */
export function wordFor(sprite: Sprite, labelled: boolean): string {
  if (sprite.count > 1) {
    return `×${sprite.count}`;
  }
  return labelled && sprite.key !== null && sprite.key !== '' ? labelOf(sprite.key) : '';
}

/**
 * Draws the shapes (ADR-0055). A message is a dot of the colour of its routing key with an outline that sets it apart from the edge that it is on, and a ring for a message that is
 * redelivered, and a crowd is one dot with its count. A message that is still, which is what reduced motion draws, has the heavy outline of the text instead of the light one,
 * so that it reads as a place that messages are at and not as one that is on its way. The words have a halo of the canvas's colour, so that they are read over an edge.
 */
export function paint(
  context: Paintable,
  sprites: readonly PlacedSprite[],
  palette: Palette,
  options: { readonly width: number; readonly height: number; readonly scale: number; readonly still: boolean },
): void {
  context.setTransform(options.scale, 0, 0, options.scale, 0, 0);
  context.clearRect(0, 0, options.width, options.height);
  context.font = FONT;
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  const labelled = sprites.length <= LABELLED_LIMIT;
  for (const sprite of sprites) {
    const colour = palette[tokenFor(sprite.key)];
    context.beginPath();
    context.arc(sprite.x, sprite.y, RADIUS, 0, TAU);
    context.fillStyle = colour;
    context.fill();
    context.lineWidth = options.still ? 3 : 2;
    context.strokeStyle = options.still ? palette['--rmq-fg'] : palette['--rmq-message-outline'];
    context.stroke();
    if (sprite.redelivered) {
      context.beginPath();
      context.arc(sprite.x, sprite.y, RADIUS + RING_GAP, 0, TAU);
      context.lineWidth = 2;
      context.strokeStyle = palette['--rmq-warning'];
      context.stroke();
    }
    const word = wordFor(sprite, labelled);
    if (word !== '') {
      const x = sprite.x + RADIUS + RING_GAP + 4;
      context.lineWidth = 3;
      context.strokeStyle = palette['--rmq-canvas'];
      context.strokeText(word, x, sprite.y);
      context.fillStyle = palette['--rmq-fg'];
      context.fillText(word, x, sprite.y);
    }
  }
}
