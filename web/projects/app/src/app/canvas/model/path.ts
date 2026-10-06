import type { Point } from './transform';

/**
 * The path that the library draws for an edge, as a line that can be measured (ADR-0044). The library gives the `d` of an SVG path, in the
 * coordinates of the canvas, and a label has to be put at a fraction of its length and found again from a point of the pointer. The browser can
 * measure an SVG path, but only in a page, and the places of the labels are worked out by a pure function that a unit test reaches, so the
 * path is read here: its curves are cut into short straight pieces, and the length is the sum of the pieces.
 *
 * The library draws an edge of the type that the app uses, `bezier`, as `M x y C x1 y1, x2 y2, x y` (a cubic curve), and what it places
 * along it, as the content of a connection, is placed by length along a polyline of its own. This reads `M`, `L` and `C` with absolute
 * coordinates, and it keeps what it has read when the path goes on with a command that it does not know. The type that draws a rounded bend
 * (`segment`) is the one that uses `Q`, so an app that changes the type of its edges has to teach this its command, and the spec says
 * that a path with one is read as far as the command.
 */

export interface Polyline {
  readonly points: readonly Point[];
  /** How far along the path each point is: 0 for the first, and `total` for the last. */
  readonly distances: readonly number[];
  readonly total: number;
}

/** How many pieces a curve is cut into. 32 puts the length of the curves that the library draws within half a unit of the browser's. */
const CURVE_STEPS = 32;

/** A command letter, or a number: the `e` of an exponent belongs to the number that it is in, and no path command is called `e`. */
const TOKEN = /([A-DF-Za-df-z])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;

const ARGUMENTS: Readonly<Record<string, number>> = { M: 2, L: 2, C: 6 };

function cubic(from: Point, a: Point, b: Point, to: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * from.x + 3 * u * u * t * a.x + 3 * u * t * t * b.x + t ** 3 * to.x,
    y: u ** 3 * from.y + 3 * u * u * t * a.y + 3 * u * t * t * b.y + t ** 3 * to.y,
  };
}

/** The commands of a path with the numbers that each has, until one that is not understood. A command that lacks numbers makes the path unreadable. */
function commandsOf(d: string): { readonly command: string; readonly numbers: number[] }[] | null {
  const commands: { command: string; numbers: number[] }[] = [];
  for (const [, letter, number] of d.matchAll(TOKEN)) {
    if (letter !== undefined) {
      commands.push({ command: letter, numbers: [] });
    } else {
      const last = commands.at(-1);
      if (last === undefined) {
        return null;
      }
      last.numbers.push(Number(number));
    }
  }
  const understood: { command: string; numbers: number[] }[] = [];
  for (const entry of commands) {
    const size = ARGUMENTS[entry.command];
    if (size === undefined) {
      break;
    }
    if (entry.numbers.length === 0 || entry.numbers.length % size !== 0) {
      return null;
    }
    understood.push(entry);
  }
  return understood;
}

/** The path as a line that can be measured, or `null` when there is no line in it: an edge that has not been drawn has no path. */
export function polylineOf(d: string): Polyline | null {
  const commands = commandsOf(d);
  if (commands === null || commands[0]?.command !== 'M') {
    return null;
  }
  const points: Point[] = [];
  const at = (): Point => points.at(-1) as Point;
  for (const { command, numbers } of commands) {
    const size = ARGUMENTS[command] as number;
    for (let index = 0; index < numbers.length; index += size) {
      const n = numbers.slice(index, index + size) as [number, number, number, number, number, number];
      if (command === 'C') {
        const from = at();
        for (let step = 1; step <= CURVE_STEPS; step += 1) {
          points.push(
            cubic(from, { x: n[0], y: n[1] }, { x: n[2], y: n[3] }, { x: n[4], y: n[5] }, step / CURVE_STEPS),
          );
        }
      } else {
        // `M` and `L` both go to a point, and a second `M` in a path is taken as a line to it.
        points.push({ x: n[0], y: n[1] });
      }
    }
  }
  if (points.length < 2) {
    return null;
  }
  const distances = [0];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as Point;
    const to = points[index] as Point;
    distances.push((distances[index - 1] as number) + Math.hypot(to.x - from.x, to.y - from.y));
  }
  return { points, distances, total: distances.at(-1) as number };
}

/** The point that is `fraction` of the way along the line, by length. A fraction that is out of range is the start or the end. */
export function pointAtFraction(line: Polyline, fraction: number): Point {
  const { points, distances, total } = line;
  if (fraction <= 0 || total === 0) {
    return points[0] as Point;
  }
  if (fraction >= 1) {
    return points.at(-1) as Point;
  }
  // The line is longer than nothing and the fraction is inside it, so the piece that it falls in is found, and is not a piece of no length.
  const wanted = fraction * total;
  let index = 1;
  while ((distances[index] as number) < wanted) {
    index += 1;
  }
  const from = points[index - 1] as Point;
  const to = points[index] as Point;
  const start = distances[index - 1] as number;
  const along = (wanted - start) / ((distances[index] as number) - start);
  return { x: from.x + (to.x - from.x) * along, y: from.y + (to.y - from.y) * along };
}

/** How far along the line, from 0 to 1 and by length, the point of it that is nearest to `point` is. */
export function closestFraction(line: Polyline, point: Point): number {
  const { points, distances, total } = line;
  if (total === 0) {
    return 0;
  }
  let best = Number.POSITIVE_INFINITY;
  let found = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as Point;
    const to = points[index] as Point;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const square = dx * dx + dy * dy;
    const along =
      square === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / square));
    const nearest = { x: from.x + dx * along, y: from.y + dy * along };
    const apart = (point.x - nearest.x) ** 2 + (point.y - nearest.y) ** 2;
    if (apart < best) {
      best = apart;
      found = (distances[index - 1] as number) + along * Math.sqrt(square);
    }
  }
  return found / total;
}
