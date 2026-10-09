import { nodeSize, type ElementKind } from '@rmq/domain';

/**
 * What each kind of node looks like (ADR-0032): its size, which is the size that the domain's auto-layout leaves room for, and its
 * outline, as the path of an SVG that is drawn at that size. Colour is never the only sign of a kind: each has a shape of its own.
 *
 *   producer  a tab that points right, where a message leaves
 *   exchange  a hexagon
 *   queue     a rounded tray
 *   consumer  a pill
 */

export interface Frame {
  readonly width: number;
  readonly height: number;
}

/** The size of a node of this kind with this name, in canvas units: it is wider where the name needs room, up to 30 characters of it (ADR-0093). */
export const frameOf = (kind: ElementKind, name = ''): Frame => nodeSize(kind, name);

const f = (n: number): string => String(Math.round(n * 100) / 100);

/** How far the corner of a polygon or a pill is cut or rounded. */
const CUT = 14;
const ROUND = 10;

/**
 * The outline of a node of this kind, a closed path from (0, 0) to (width, height), at the size that it is drawn at unless another is
 * given. The handles are at the middle of the left and right sides, so every outline touches both of them there.
 */
export function shapePath(kind: ElementKind, frame: Frame = frameOf(kind)): string {
  const { width: w, height: h } = frame;
  const mid = h / 2;
  switch (kind) {
    case 'producer':
      // Rounded on the left, a point on the right where the message leaves.
      return `M${f(ROUND)},0 H${f(w - mid)} L${f(w)},${f(mid)} L${f(w - mid)},${f(h)} H${f(ROUND)} Q0,${f(h)} 0,${f(h - ROUND)} V${f(ROUND)} Q0,0 ${f(ROUND)},0 Z`;
    case 'exchange':
      return `M${f(CUT)},0 H${f(w - CUT)} L${f(w)},${f(mid)} L${f(w - CUT)},${f(h)} H${f(CUT)} L0,${f(mid)} Z`;
    case 'queue':
      return `M${f(ROUND)},0 H${f(w - ROUND)} Q${f(w)},0 ${f(w)},${f(ROUND)} V${f(h - ROUND)} Q${f(w)},${f(h)} ${f(w - ROUND)},${f(h)} H${f(ROUND)} Q0,${f(h)} 0,${f(h - ROUND)} V${f(ROUND)} Q0,0 ${f(ROUND)},0 Z`;
    case 'consumer':
      return `M${f(mid)},0 H${f(w - mid)} A${f(mid)},${f(mid)} 0 0 1 ${f(w - mid)},${f(h)} H${f(mid)} A${f(mid)},${f(mid)} 0 0 1 ${f(mid)},0 Z`;
  }
}
