import { isConditionsChip } from './labels';
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
/** The chip of a headers binding is wider than a key (ADR-0070): the same number as the stylesheet. */
const MAX_CONDITIONS_CHIP_WIDTH = 300;
const ROW = 20;
const GAP = 2;

/** How big a label of these chips is, from its text: it is worked out, and not measured, so that it can be done before anything is drawn. */
export function estimateLabelSize(chips: readonly string[], more: number): Size {
  const texts = more > 0 ? [...chips, `+${more} more`] : chips;
  const rows = Math.max(1, texts.length);
  const widths = texts.map((text) =>
    Math.min(isConditionsChip(text) ? MAX_CONDITIONS_CHIP_WIDTH : MAX_CHIP_WIDTH, text.length * CHARACTER + PADDING),
  );
  return { width: Math.max(PADDING, ...widths), height: rows * ROW + (rows - 1) * GAP };
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
