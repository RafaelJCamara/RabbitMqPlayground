import { chipDisplay, isConditionsChip } from './labels';
import { pointAtFraction, type Polyline } from './path';
import type { Point, Size } from './transform';

/**
 * Where the labels of edges go (ADR-0044): a greedy pass, with no solver. It is a pure function of the lines that the library drew, the boxes of the
 * labels, and the nodes, so the same input gives the same places and a unit test can say what they are. It never writes anywhere: the places that
 * it finds are for drawing, and the document keeps only what a learner chose (the labels that have a place, which are put down first).
 */

/** The places that a label tries, in order: the middle first, then each side of it, never nearer to an end than a fifth. */
export const CANDIDATES: readonly number[] = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

export interface LabelBox {
  /** The key of the edge. */
  readonly key: string;
  /** Where the edge goes, in the coordinates of the canvas. */
  readonly line: Polyline;
  /** How big the label is, in the coordinates of the canvas. */
  readonly width: number;
  readonly height: number;
  /** Where the document keeps it, when a learner has put it somewhere. */
  readonly fixed?: number;
}

export type Rect = Point & Size;

/** What a label is made of: a chip is a row of its text with a little room round it, cut at a width, and the rows are stacked. */
const CHARACTER = 6.6;
const PADDING = 16;
const MAX_CHIP_WIDTH = 160;
const ROW = 20;
const GAP = 2;
/**
 * The chip of a headers binding is 118 wide at most, which is what fits in the line between two nodes that are laid out 160 apart, and goes on to more lines where its text is longer (ADR-0071): a
 * character is about 4.8 wide at the size of a chip, the sides take 14 and a line is 16 high with 4 of room above and below, so that a chip of one line is as high as a row.
 */
const MAX_CONDITIONS_WIDTH = 118;
const CONDITIONS_CHARACTER = 4.8;
const CONDITIONS_SIDES = 14;
const CONDITIONS_LINE = 16;
const CONDITIONS_ROOM = 4;

/**
 * How many lines a text takes in a room, filled as a browser does: a word at a time, a word on a line of its own when it does not fit after the others, and a word that is wider than a line broken
 * where the line ends. The words are those that the chip is drawn with, so that the dots and the count stay with the words they follow.
 */
function linesOf(text: string, room: number): number {
  let lines = 1;
  let used = 0;
  for (const word of chipDisplay(text).split(' ')) {
    const width = word.length * CONDITIONS_CHARACTER;
    if (used > 0 && used + CONDITIONS_CHARACTER + width <= room) {
      used += CONDITIONS_CHARACTER + width;
    } else {
      const taken = Math.max(1, Math.ceil(width / room));
      lines += (used > 0 ? 1 : 0) + taken - 1;
      used = width - (taken - 1) * room;
    }
  }
  return lines;
}

/** How big a chip is, from its text. */
function chipSize(text: string): Size {
  if (!isConditionsChip(text)) {
    return { width: Math.min(MAX_CHIP_WIDTH, text.length * CHARACTER + PADDING), height: ROW };
  }
  // A text of more than one line is longer than a line, so it is as wide as a chip can be.
  const lines = linesOf(text, MAX_CONDITIONS_WIDTH - CONDITIONS_SIDES);
  return {
    width: Math.min(MAX_CONDITIONS_WIDTH, text.length * CONDITIONS_CHARACTER + CONDITIONS_SIDES),
    height: lines * CONDITIONS_LINE + CONDITIONS_ROOM,
  };
}

/** How big a label of these chips is, from their text: it is worked out, and not measured, so that it can be done before anything is drawn. */
export function estimateLabelSize(chips: readonly string[], more: number): Size {
  const sizes = (more > 0 ? [...chips, `+${more} more`] : chips).map(chipSize);
  if (sizes.length === 0) {
    return { width: PADDING, height: ROW };
  }
  return {
    width: Math.max(PADDING, ...sizes.map(({ width }) => width)),
    height: sizes.reduce((sum, { height }) => sum + height, 0) + (sizes.length - 1) * GAP,
  };
}

/** How much of `a` is on `b`, as an area: nothing when they only touch, or are apart. */
const overlap = (a: Rect, b: Rect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

function boxAt(label: LabelBox, fraction: number): Rect {
  const point = pointAtFraction(label.line, fraction);
  return { x: point.x - label.width / 2, y: point.y - label.height / 2, width: label.width, height: label.height };
}

/**
 * The place of each label along its edge, as a fraction of its length. The labels that have a place are put down first, as things to keep away from,
 * and then each of the others, in the order that they are given, takes the first of the candidates where its box meets no label and no node, or if
 * there is none the one where it overlaps least, and the earlier of two that are as bad as each other.
 */
export function placeLabels(labels: readonly LabelBox[], obstacles: readonly Rect[]): Map<string, number> {
  const places = new Map<string, number>();
  const taken: Rect[] = [];
  for (const label of labels) {
    if (label.fixed !== undefined) {
      places.set(label.key, label.fixed);
      taken.push(boxAt(label, label.fixed));
    }
  }
  for (const label of labels) {
    if (label.fixed !== undefined) {
      continue;
    }
    let best = { fraction: CANDIDATES[0] as number, area: Number.POSITIVE_INFINITY };
    for (const fraction of CANDIDATES) {
      const box = boxAt(label, fraction);
      const area = [...taken, ...obstacles].reduce((sum, other) => sum + overlap(box, other), 0);
      if (area < best.area) {
        best = { fraction, area };
      }
      // Nothing is better than nothing, and a later place that is as good is not chosen over this one, so the rest are not looked at.
      if (area === 0) {
        break;
      }
    }
    places.set(label.key, best.fraction);
    taken.push(boxAt(label, best.fraction));
  }
  return places;
}
