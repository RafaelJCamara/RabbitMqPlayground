import { describe, expect, it } from 'vitest';
import { closestFraction, pointAtFraction, polylineOf } from './path';

/** The path that the library drew for an edge in the end-to-end suite, which the browser measures at 348.344 long. */
const CURVE = 'M 492 28 C 660 28, 140 148, 308.0002 148.0002';

describe('polylineOf (ADR-0044)', () => {
  it('reads a straight line, and knows how long it is', () => {
    const line = polylineOf('M 0 0 L 30 40');

    expect(line?.total).toBeCloseTo(50, 5);
    expect(line?.points[0]).toEqual({ x: 0, y: 0 });
    expect(line?.points.at(-1)).toEqual({ x: 30, y: 40 });
  });

  it('reads the curve that the library draws, and measures it as the browser does, within half a unit', () => {
    const line = polylineOf(CURVE);

    expect(line?.total).toBeGreaterThan(347.8);
    expect(line?.total).toBeLessThan(348.9);
    expect(line?.points[0]).toEqual({ x: 492, y: 28 });
    expect(line?.points.at(-1)?.x).toBeCloseTo(308.0002, 4);
  });

  it('reads a path with several segments, and numbers with signs, decimals and exponents', () => {
    expect(polylineOf('M 0 0 L 10 0 L 10 10 L 0 10')?.total).toBeCloseTo(30, 5);
    expect(polylineOf('M-5.5,-2.5L4.5,-2.5')?.total).toBeCloseTo(10, 5);
    expect(polylineOf('M 0 0 L 1e1 0')?.total).toBeCloseTo(10, 5);
  });

  it('reads the commas that the library puts between the points of a curve', () => {
    expect(polylineOf('M 0 0 C 10 0, 20 0, 30 0')?.total).toBeCloseTo(30, 3);
  });

  it('cuts a curve into 32 pieces, which is what keeps its length within half a unit of the browser’s', () => {
    // The control points are evenly spaced along a line, so the curve goes along it at a steady pace, and each piece is 30 / 32 long.
    const line = polylineOf('M 0 0 C 10 0, 20 0, 30 0')!;

    expect(line.points).toHaveLength(33);
    expect(line.points[1]?.x).toBeCloseTo(30 / 32, 6);
    expect(line.points[16]?.x).toBeCloseTo(15, 6);
    expect(line.distances[1]).toBeCloseTo(30 / 32, 6);
  });

  it('starts each curve where the one before it ended', () => {
    const line = polylineOf('M 0 0 C 10 0, 20 0, 30 0 C 40 0, 50 0, 60 0')!;

    expect(line.points).toHaveLength(65);
    expect(line.points[32]).toEqual({ x: 30, y: 0 });
    expect(line.points[33]?.x).toBeCloseTo(30 + 30 / 32, 6);
    expect(line.total).toBeCloseTo(60, 6);
  });

  it('is nothing for a path that has no line in it, so that an edge that is not drawn is left alone', () => {
    expect(polylineOf('')).toBeNull();
    expect(polylineOf('M 1 2')).toBeNull();
    expect(polylineOf('nonsense')).toBeNull();
    expect(polylineOf('L 1 2')).toBeNull();
  });

  it('keeps what it could read of a path that goes on with a command that it does not know', () => {
    expect(polylineOf('M 0 0 L 10 0 Z')?.total).toBeCloseTo(10, 5);
    // The rounded bend of the `segment` type of edge is a command that is not read, so a change of type has to teach it.
    expect(polylineOf('M 0 0 L 10 0 Q 20 0 20 10 L 20 20')?.total).toBeCloseTo(10, 5);
  });

  it('is nothing for a segment that lacks its numbers', () => {
    expect(polylineOf('M 0 0 L 10')).toBeNull();
    expect(polylineOf('M 0 0 C 1 2 3 4 5')).toBeNull();
    expect(polylineOf('M 0 0 L 10 0 L')).toBeNull();
  });

  it('is nothing when a number comes before any command', () => {
    expect(polylineOf('1 2 M 0 0 L 10 0')).toBeNull();
  });
});

describe('pointAtFraction', () => {
  it('is the start at 0, the end at 1, and the middle by length on a straight line', () => {
    const line = polylineOf('M 0 0 L 100 0')!;

    expect(pointAtFraction(line, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(line, 1)).toEqual({ x: 100, y: 0 });
    expect(pointAtFraction(line, 0.5)).toEqual({ x: 50, y: 0 });
    expect(pointAtFraction(line, 0.25)).toEqual({ x: 25, y: 0 });
  });

  it('goes by the length along the path, so a place is where the library puts it (about a pixel off over this curve)', () => {
    const point = pointAtFraction(polylineOf(CURVE)!, 0.25);

    // The browser's getPointAtLength gives (482.086, 58.934), and the library places its content at (481.117, 59.298).
    expect(Math.abs(point.x - 482.086)).toBeLessThan(1.5);
    expect(Math.abs(point.y - 58.934)).toBeLessThan(1.5);
  });

  it('goes round a corner', () => {
    const line = polylineOf('M 0 0 L 10 0 L 10 10')!;

    expect(pointAtFraction(line, 0.75)).toEqual({ x: 10, y: 5 });
  });

  it('stays on the path for a fraction that is out of range, however little it is out of it', () => {
    const line = polylineOf('M 0 0 L 100 0')!;

    expect(pointAtFraction(line, -1)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(line, -0.5)).toEqual({ x: 0, y: 0 });
    expect(pointAtFraction(line, 1.5)).toEqual({ x: 100, y: 0 });
    expect(pointAtFraction(line, 2)).toEqual({ x: 100, y: 0 });
  });

  it('is the one point of a line that has no length, and goes over a point that is given twice', () => {
    expect(pointAtFraction(polylineOf('M 5 5 L 5 5')!, 0.5)).toEqual({ x: 5, y: 5 });
    expect(pointAtFraction(polylineOf('M 0 0 L 0 0 L 10 0')!, 0.5)).toEqual({ x: 5, y: 0 });
    expect(pointAtFraction(polylineOf('M 0 0 L 10 0 L 10 0 L 10 10')!, 0.75)).toEqual({ x: 10, y: 5 });
  });
});

describe('closestFraction', () => {
  it('is how far along the path the nearest point to a point is, by length', () => {
    const line = polylineOf('M 0 0 L 100 0')!;

    expect(closestFraction(line, { x: 25, y: 30 })).toBeCloseTo(0.25, 5);
    expect(closestFraction(line, { x: 80, y: -5 })).toBeCloseTo(0.8, 5);
  });

  it('is 0 for a line that has no length, and goes over a point that is given twice', () => {
    expect(closestFraction(polylineOf('M 5 5 L 5 5')!, { x: 1, y: 2 })).toBe(0);
    expect(closestFraction(polylineOf('M 0 0 L 0 0 L 10 0')!, { x: 5, y: 3 })).toBeCloseTo(0.5, 5);
  });

  it('is 0 before the start and 1 after the end', () => {
    const line = polylineOf('M 0 0 L 100 0')!;

    expect(closestFraction(line, { x: -40, y: 10 })).toBe(0);
    expect(closestFraction(line, { x: 400, y: 10 })).toBe(1);
  });

  it('gives back the fraction that a point on the curve was taken at', () => {
    const line = polylineOf(CURVE)!;

    for (const at of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(closestFraction(line, pointAtFraction(line, at))).toBeCloseTo(at, 2);
    }
  });

  it('chooses the nearest part of a path that comes back near itself', () => {
    const line = polylineOf('M 0 0 L 100 0 L 100 10 L 0 10')!;

    expect(closestFraction(line, { x: 20, y: 9 })).toBeGreaterThan(0.6);
    expect(closestFraction(line, { x: 20, y: 1 })).toBeLessThan(0.2);
  });
});
