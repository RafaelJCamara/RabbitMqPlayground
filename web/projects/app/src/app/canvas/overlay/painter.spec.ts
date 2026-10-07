import { describe, expect, it } from 'vitest';
import { PAINT_TOKENS, tokenFor } from './colors';
import {
  labelOf,
  LABELLED_LIMIT,
  paint,
  paletteFrom,
  RADIUS,
  RING_GAP,
  wordFor,
  type Paintable,
  type Palette,
  type PlacedSprite,
} from './painter';

/** A context that writes down what it was asked, in the order, with the colour and the line that each stroke had. */
function recorder() {
  const calls: string[] = [];
  const sweeps: number[][] = [];
  const context = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    font: '',
    textBaseline: 'alphabetic',
    setTransform: (...n: number[]) => calls.push(`transform ${n.join(',')}`),
    clearRect: (...n: number[]) => calls.push(`clear ${n.join(',')}`),
    beginPath: () => calls.push('begin'),
    arc: (x: number, y: number, r: number, from: number, to: number) => {
      sweeps.push([from, to]);
      calls.push(`arc ${x},${y},${r}`);
    },
    fill() {
      calls.push(`fill ${context.fillStyle}`);
    },
    stroke() {
      calls.push(`stroke ${context.strokeStyle} ${context.lineWidth}`);
    },
    fillText: (text: string, x: number, y: number) => calls.push(`text ${text} ${x},${y} ${context.fillStyle}`),
    strokeText: (text: string, x: number, y: number) =>
      calls.push(`halo ${text} ${x},${y} ${context.strokeStyle} ${context.lineWidth}`),
  };
  return { context: context as unknown as Paintable, calls, sweeps };
}

/** A palette in which every token is its own name, so that a call says which token it drew with. */
const palette: Palette = paletteFrom((token) => `<${token}>`);

const sprite = (over: Partial<PlacedSprite> = {}): PlacedSprite => ({
  edge: 'P>E',
  at: 0.5,
  count: 1,
  key: 'order.created',
  redelivered: false,
  x: 100,
  y: 50,
  ...over,
});

const options = { width: 800, height: 600, scale: 2, still: false };

describe('paletteFrom', () => {
  it('has a colour for every token that the painter reads, as the page says it', () => {
    expect(Object.keys(palette)).toEqual([...PAINT_TOKENS]);
    expect(palette['--rmq-fg']).toBe('<--rmq-fg>');
  });
});

describe('labelOf and wordFor', () => {
  it('writes a key as it is, or cut short with an ellipsis', () => {
    expect(labelOf('order.created')).toBe('order.created');
    expect(labelOf('a'.repeat(14))).toBe('a'.repeat(14));
    expect(labelOf('a'.repeat(15))).toBe(`${'a'.repeat(13)}…`);
  });

  it('says how many a shape stands for when it stands for several, and else its key when there are few shapes, and nothing for no key', () => {
    expect(wordFor(sprite({ count: 2 }), false)).toBe('×2');
    expect(wordFor(sprite({ count: 20 }), true)).toBe('×20');
    expect(wordFor(sprite({ count: 20 }), false)).toBe('×20');
    expect(wordFor(sprite(), true)).toBe('order.created');
    expect(wordFor(sprite(), false)).toBe('');
    expect(wordFor(sprite({ key: '' }), true)).toBe('');
    expect(wordFor(sprite({ key: null }), true)).toBe('');
  });
});

describe('paint (ADR-0055)', () => {
  it('clears the canvas in the pixels of the screen, and draws in the pixels of the page, which is how a canvas is sharp', () => {
    const { context, calls } = recorder();

    paint(context, [], palette, options);

    expect(calls).toEqual(['transform 2,0,0,2,0,0', 'clear 0,0,800,600']);
  });

  it('draws a message as a dot of the colour of its key, with an outline that sets it apart from the edge, and writes its key beside it', () => {
    const { context, calls } = recorder();

    paint(context, [sprite()], palette, options);

    expect(calls.slice(2)).toEqual([
      'begin',
      `arc 100,50,${RADIUS}`,
      `fill <${tokenFor('order.created')}>`,
      'stroke <--rmq-message-outline> 2',
      `halo order.created ${100 + RADIUS + RING_GAP + 4},50 <--rmq-canvas> 3`,
      `text order.created ${100 + RADIUS + RING_GAP + 4},50 <--rmq-fg>`,
    ]);
  });

  it('is as big as the plan draws it: a dot of 7 pixels, a ring 3 pixels outside it, and a key for 12 shapes at most', () => {
    expect([RADIUS, RING_GAP, LABELLED_LIMIT]).toEqual([7, 3, 12]);
  });

  it('draws every dot and ring as a whole circle, from the start of the angle to a full turn', () => {
    const { context, sweeps } = recorder();

    paint(context, [sprite({ redelivered: true })], palette, options);

    expect(sweeps).toEqual([
      [0, Math.PI * 2],
      [0, Math.PI * 2],
    ]);
  });

  it('draws a ring round a message that is redelivered, in the colour of a warning', () => {
    const { context, calls } = recorder();

    paint(context, [sprite({ key: '', redelivered: true })], palette, options);

    expect(calls).toContain(`arc 100,50,${RADIUS + RING_GAP}`);
    expect(calls).toContain('stroke <--rmq-warning> 2');
  });

  it('draws no ring for a message that is not', () => {
    const { context, calls } = recorder();

    paint(context, [sprite()], palette, options);

    expect(calls.filter((call) => call.startsWith('arc'))).toEqual([`arc 100,50,${RADIUS}`]);
  });

  it('draws a crowd as one dot with its count, in the colour of the key that it shares', () => {
    const { context, calls } = recorder();

    paint(context, [sprite({ count: 20 })], palette, options);

    expect(calls).toContain(`fill <${tokenFor('order.created')}>`);
    expect(calls.some((call) => call.startsWith('text ×20'))).toBe(true);
  });

  it('draws a crowd that has no key in common in the colour of a mixed crowd', () => {
    const { context, calls } = recorder();

    paint(context, [sprite({ count: 3, key: null })], palette, options);

    expect(calls).toContain('fill <--rmq-message-mixed>');
  });

  it('draws a message that is still with the heavy outline of the text, so that it reads as a place and not as a message on its way', () => {
    const { context, calls } = recorder();

    paint(context, [sprite()], palette, { ...options, still: true });

    expect(calls).toContain('stroke <--rmq-fg> 3');
    expect(calls).not.toContain('stroke <--rmq-message-outline> 2');
  });

  it('writes the key beside each of a few shapes, and beside none of a crowd of them, which would be a wall of words', () => {
    const few = Array.from({ length: LABELLED_LIMIT }, (_, index) => sprite({ x: index }));
    const many = Array.from({ length: LABELLED_LIMIT + 1 }, (_, index) => sprite({ x: index }));

    const [fewCalls, manyCalls] = [few, many].map((sprites) => {
      const { context, calls } = recorder();
      paint(context, sprites, palette, options);
      return calls.filter((call) => call.startsWith('text'));
    });

    expect(fewCalls).toHaveLength(LABELLED_LIMIT);
    expect(manyCalls).toHaveLength(0);
  });

  it('draws what it is given in the order that it is given, so that the last is on top', () => {
    const { context, calls } = recorder();

    paint(context, [sprite({ x: 10, key: 'a' }), sprite({ x: 20, key: 'b' })], palette, options);

    expect(calls.filter((call) => call.startsWith('arc'))).toEqual([`arc 10,50,${RADIUS}`, `arc 20,50,${RADIUS}`]);
  });

  it('sets the font, the baseline and the join of the lines once, and never leaves a halo without its word', () => {
    const { context, calls } = recorder();

    paint(context, [sprite(), sprite({ key: 'b' })], palette, options);
    const halos = calls.filter((call) => call.startsWith('halo'));
    const words = calls.filter((call) => call.startsWith('text'));

    expect(halos).toHaveLength(words.length);
    expect((context as unknown as { font: string }).font).toContain('system-ui');
    expect((context as unknown as { textBaseline: string }).textBaseline).toBe('middle');
    expect((context as unknown as { lineJoin: string }).lineJoin).toBe('round');
  });
});
