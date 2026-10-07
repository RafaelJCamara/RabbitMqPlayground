import { describe, expect, it } from 'vitest';
import { CANDIDATES, estimateLabelSize, placeLabels, type LabelBox } from './label-placement';
import { polylineOf } from './path';

const line = (d: string) => polylineOf(d)!;
/** A horizontal line of this length, which is where labels of a known size can be put against one another. */
const across = (length: number, y = 0) => line(`M 0 ${y} L ${length} ${y}`);
const label = (key: string, length = 400, y = 0, more: Partial<LabelBox> = {}): LabelBox => ({
  key,
  line: across(length, y),
  width: 40,
  height: 20,
  ...more,
});

describe('placeLabels (ADR-0044)', () => {
  it('puts a label that has nothing in its way in the middle of its edge', () => {
    expect(placeLabels([label('a')], []).get('a')).toBe(0.5);
  });

  it('says nothing of an edge that has no label', () => {
    expect(placeLabels([], []).size).toBe(0);
  });

  it('moves a label that would sit on another to the next place, and keeps the first where it is', () => {
    const places = placeLabels([label('a'), label('b')], []);

    expect(places.get('a')).toBe(0.5);
    expect(places.get('b')).toBe(0.4);
  });

  it('lets two labels that only touch stay where they are', () => {
    // 400 long: 0.5 is at 200 and 0.4 at 160, and the boxes are 40 wide, so one ends where the other starts.
    const places = placeLabels([label('a'), label('b')], []);

    expect(places.get('b')).toBe(0.4);
    // A unit wider and they overlap, at 0.6 as well, and the first place with room is 0.3.
    expect(placeLabels([label('a', 400, 0, { width: 41 }), label('b', 400, 0, { width: 41 })], []).get('b')).toBe(0.3);
  });

  it('goes through the places in a fixed order, 0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8', () => {
    expect(CANDIDATES).toEqual([0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8]);
    const labels = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((key) => label(key, 1000));

    const places = placeLabels(labels, []);

    expect(labels.map(({ key }) => places.get(key))).toEqual(CANDIDATES);
  });

  it('never goes nearer to an end than a fifth, so that a label does not sit on a handle', () => {
    const places = placeLabels(
      Array.from({ length: 30 }, (_, index) => label(`l${index}`, 1000)),
      [],
    );

    for (const at of places.values()) {
      expect(at).toBeGreaterThanOrEqual(0.2);
      expect(at).toBeLessThanOrEqual(0.8);
    }
  });

  it('keeps a label away from a node, which is as much in the way as another label', () => {
    // A node over the middle of the edge, from 150 to 250.
    const places = placeLabels([label('a')], [{ x: 150, y: -50, width: 100, height: 100 }]);

    expect(places.get('a')).toBe(0.3);
  });

  it('takes the place where it overlaps least when every place has something in it', () => {
    const wall = { x: 0, y: -50, width: 400, height: 100 };
    const places = placeLabels([label('a')], [wall, { x: 0, y: -50, width: 80, height: 100 }]);

    expect(places.get('a')).toBe(0.5);
    const partly = placeLabels(
      [label('a')],
      [
        { x: 180, y: -50, width: 40, height: 100 }, // all of 0.5
        { x: 140, y: -50, width: 40, height: 50 }, // half of 0.4
        { x: 220, y: -50, width: 40, height: 100 }, // all of 0.6
        { x: 100, y: -50, width: 40, height: 100 }, // all of 0.3
        { x: 260, y: -50, width: 40, height: 100 }, // all of 0.7
        { x: 60, y: -50, width: 40, height: 100 }, // all of 0.2
        { x: 300, y: -50, width: 40, height: 100 }, // all of 0.8
      ],
    );
    expect(partly.get('a')).toBe(0.4);
    expect(wall).toBeDefined();
  });

  it('prefers the earlier of two places that are as bad as one another', () => {
    const everywhere = { x: -100, y: -100, width: 1000, height: 200 };

    expect(placeLabels([label('a')], [everywhere]).get('a')).toBe(0.5);
  });

  it('puts a label that has a place where it is, whatever is there, and keeps the others out of its way', () => {
    const places = placeLabels([label('free'), label('chosen', 400, 0, { fixed: 0.5 })], []);

    expect(places.get('chosen')).toBe(0.5);
    expect(places.get('free')).toBe(0.4);
  });

  it('puts the labels that have a place down first, whatever order they are given in', () => {
    const places = placeLabels([label('free'), label('chosen', 400, 0, { fixed: 0.5 })], []);
    const again = placeLabels([label('chosen', 400, 0, { fixed: 0.5 }), label('free')], []);

    expect(again.get('free')).toBe(places.get('free'));
  });

  it('puts the box of a label round the point of its edge, and not beside it', () => {
    // The label is 40 wide and 20 high, so in the middle of 400 it covers 180 to 220 across, and -10 to 10 down.
    // A node from 170 to 185 is on its left, and one from -15 to -5 down is on its top: each is in the way, and neither would be if the box began at the point.
    expect(placeLabels([label('a')], [{ x: 170, y: -50, width: 15, height: 100 }]).get('a')).toBe(0.6);
    expect(placeLabels([label('a')], [{ x: 150, y: -15, width: 100, height: 10 }]).get('a')).toBe(0.3);
    // The top of the box is at -10, so a node that ends at -9 is in the way by a unit, and one that ends at -11 is not.
    expect(placeLabels([label('a')], [{ x: 150, y: -15, width: 100, height: 6 }]).get('a')).toBe(0.3);
    expect(placeLabels([label('a')], [{ x: 150, y: -15, width: 100, height: 4 }]).get('a')).toBe(0.5);
  });

  it('counts an overlap of less than a unit, across and down, as one', () => {
    // 40.5 wide: the boxes at 0.5 and 0.4 of 400 meet by half a unit, so the second goes on to 0.3 where there is room.
    const wide = { width: 40.5 };
    expect(placeLabels([label('a', 400, 0, wide), label('b', 400, 0, wide)], []).get('b')).toBe(0.3);
    // 20 high, on lines that are 19.5 apart: they meet by half a unit down, so the second goes to 0.4, which is where it is clear across.
    expect(placeLabels([label('a'), label('b', 400, 19.5)], []).get('b')).toBe(0.4);
  });

  it('does not let labels on other edges that are far away get in the way', () => {
    const places = placeLabels([label('a', 400, 0), label('b', 400, 500)], []);

    expect(places.get('a')).toBe(0.5);
    expect(places.get('b')).toBe(0.5);
  });

  it('gives the same places for the same input, and does not change what it was given', () => {
    const labels = [label('a'), label('b'), label('c')];
    const obstacles = [{ x: 100, y: -10, width: 30, height: 30 }];

    const first = placeLabels(labels, obstacles);

    expect([...placeLabels(labels, obstacles)]).toEqual([...first]);
    expect(labels[1]).toEqual(label('b'));
  });
});

describe('estimateLabelSize', () => {
  it('is as wide as the longest chip and one row high for each chip, and a row more for "+N more"', () => {
    const one = estimateLabelSize(['order.*'], 0);
    const two = estimateLabelSize(['order.*', 'a'], 0);
    const more = estimateLabelSize(['order.*', 'a'], 3);

    expect(one.width).toBeGreaterThan(40);
    expect(two.width).toBe(one.width);
    expect(two.height).toBeGreaterThan(one.height);
    expect(more.height).toBeGreaterThan(two.height);
    expect(more.width).toBeGreaterThanOrEqual(two.width);
  });

  it('stops growing at the width that the chips are cut at', () => {
    expect(estimateLabelSize(['x'.repeat(200)], 0).width).toBe(estimateLabelSize(['x'.repeat(400)], 0).width);
    expect(estimateLabelSize(['x'.repeat(200)], 0).width).toBeLessThanOrEqual(180);
  });

  it('makes the chip of a headers binding 118 wide at most, and as many lines high as its words need (ADR-0071)', () => {
    // One line: 4.8 for each of the nine characters and 14 for the sides, and a line is 16 high with 4 of room, so it is as high as a row of a key.
    expect(estimateLabelSize(['all · a=1'], 0).width).toBeCloseTo(9 * 4.8 + 14, 5);
    expect(estimateLabelSize(['all · a=1'], 0).height).toBe(20);
    // The room for text is 104. "all ·", "format=pdf ·" and "type=report ·" are 24, 57.6 and 62.4 with a space between, which is 153.6, so the third goes on to a second line.
    expect(estimateLabelSize(['all · format=pdf · type=report · size=10'], 0)).toEqual({
      width: 118,
      height: 2 * 16 + 4,
    });
    // A key is cut where it was, at 160, in one row, and a text that has the separator in it, but does not begin as a mode does, is a key.
    expect(estimateLabelSize(['x'.repeat(100)], 0)).toEqual({ width: 160, height: 20 });
    expect(estimateLabelSize(['not · conditions'], 0).height).toBe(20);
  });

  it('keeps "+N more" and the dots with the words they follow, which is the last line here and not a line of its own', () => {
    // Each of "all-with-x ·", "format=pdf ·" and "type=report ·" is a line, since two of them are more than 104. "size=10 ·" and "+3 more" are 43.2 and 33.6, which are one line.
    expect(estimateLabelSize(['all-with-x · format=pdf · type=report · size=10 · +3 more'], 0)).toEqual({
      width: 118,
      height: 4 * 16 + 4,
    });
  });

  it('breaks a word that is wider than a line where the line ends, after the line that the words before it are on', () => {
    // "all ·" and then one word of a hundred characters, 480, which is four lines of 104 and a part, on lines of its own: six in all.
    expect(estimateLabelSize(['all · ' + 'x'.repeat(100)], 0)).toEqual({ width: 118, height: 6 * 16 + 4 });
    // A word that is wider than a line begins a line of its own after the words before it, and ends in a part of a line that the next word is put after.
    expect(estimateLabelSize(['all · a=' + 'x'.repeat(30) + ' b'], 0).height).toBe(3 * 16 + 4);
  });

  it('puts a word on the line that it fits on, to the last character, and the next word on a line of its own', () => {
    // A line has 104 of room, and a character is 4.8, so 21 characters fit and 22 do not: "all ·" is five, then a space, and a word of fifteen is 21, and a word of sixteen is 22.
    expect(estimateLabelSize(['all · ' + 'x'.repeat(15)], 0).height).toBe(20);
    expect(estimateLabelSize(['all · ' + 'x'.repeat(16)], 0).height).toBe(2 * 16 + 4);
    // A word that follows a line that is full begins the next one.
    expect(estimateLabelSize(['all · ' + 'x'.repeat(15) + ' y'], 0).height).toBe(2 * 16 + 4);
  });

  it('stacks chips of one line and of more with 2 between them, and the chip of "+N more" is a row of a key', () => {
    const long = 'any-with-x · ' + 'x'.repeat(20);

    expect(estimateLabelSize([long, 'all · a=1'], 0).height).toBe(2 * 16 + 4 + 2 + 20);
    expect(estimateLabelSize([long], 3).height).toBe(2 * 16 + 4 + 2 + 20);
  });

  it('is a little for a label with no chip', () => {
    expect(estimateLabelSize([], 0).height).toBeGreaterThan(0);
  });

  it('is worked out from 6.6 for a character, 16 of room round the text, and rows of 20 with 2 between them', () => {
    const sized = (chips: string[], more = 0) => {
      const { width, height } = estimateLabelSize(chips, more);
      return [Number(width.toFixed(1)), height];
    };

    expect(sized(['abc'])).toEqual([35.8, 20]);
    expect(sized(['a'])).toEqual([22.6, 20]);
    expect(sized(['abc', 'de'])).toEqual([35.8, 42]);
    expect(sized(['abc', 'de', 'f'])).toEqual([35.8, 64]);
    expect(sized([])).toEqual([16, 20]);
  });

  it('counts "+N more" as a chip of its own, from the first one that is left out', () => {
    const sized = (chips: string[], more: number) => {
      const { width, height } = estimateLabelSize(chips, more);
      return [Number(width.toFixed(1)), height];
    };

    // "+1 more" is seven characters, "+12 more" is eight.
    expect(sized(['a'], 1)).toEqual([62.2, 42]);
    expect(sized(['a'], 12)).toEqual([68.8, 42]);
    expect(sized(['a'], 0)).toEqual([22.6, 20]);
  });

  it('cuts the width of a chip at 160', () => {
    expect(estimateLabelSize(['x'.repeat(200)], 0)).toEqual({ width: 160, height: 20 });
    expect(estimateLabelSize(['x'.repeat(21)], 0).width).toBeCloseTo(21 * 6.6 + 16, 6);
  });
});
