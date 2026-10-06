import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ADR-0032: the colours of the editor are defined once, in styles.css, as light-dark(light, dark), and are held to the contrast
 * that WCAG 2.2 AA asks for: 4.5:1 for text, and 3:1 for the graphics and borders that a person needs to see. These read the
 * stylesheet, resolve every token in both themes, and check the pairs that the editor draws. axe checks the rendered page in
 * the end-to-end suite, and this is what fails first when a colour is changed to one that cannot be read.
 */

const css = readFileSync(fileURLToPath(new URL('../../projects/app/src/styles.css', import.meta.url)), 'utf8');

type Theme = 'light' | 'dark';
const tokens: Record<string, Record<Theme, string>> = {};
for (const [, name, light, dark] of css.matchAll(
  /--rmq-([a-z-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/g,
)) {
  tokens[name as string] = { light: light as string, dark: dark as string };
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
  const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r as number) + 0.7152 * channel(g as number) + 0.0722 * channel(b as number);
};

const contrast = (a: string, b: string): number => {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter as number) + 0.05) / ((darker as number) + 0.05);
};

const colour = (name: string, theme: Theme): string => {
  const value = tokens[name]?.[theme];
  if (value === undefined) {
    throw new Error(`There is no token --rmq-${name} in styles.css`);
  }
  return value;
};

const TEXT = 4.5;
const GRAPHIC = 3;
const KINDS = ['producer', 'exchange', 'queue', 'consumer'] as const;

/** [what, foreground, background, the contrast that it needs] */
const PAIRS: readonly (readonly [string, string, string, number])[] = [
  ...(['surface', 'panel', 'canvas'] as const).flatMap((background) => [
    [`text on ${background}`, 'fg', background, TEXT] as const,
    [`muted text on ${background}`, 'muted', background, TEXT] as const,
    [`a link on ${background}`, 'link', background, TEXT] as const,
  ]),
  ['the edge of a control on the page', 'border', 'surface', GRAPHIC],
  ['the edge of a control on a panel', 'border', 'panel', GRAPHIC],
  ['the focus ring on the page', 'focus', 'surface', GRAPHIC],
  ['the focus ring on the canvas', 'focus', 'canvas', GRAPHIC],
  ['an edge of the canvas', 'edge', 'canvas', GRAPHIC],
  ['the border of a chip of a label, on the canvas', 'border', 'canvas', GRAPHIC],
  ['the badge of a warning, on the canvas', 'warning', 'canvas', GRAPHIC],
  ['muted text, the "+N more" of a label, on the chip', 'muted', 'surface', TEXT],
  ['a selected edge', 'accent', 'canvas', GRAPHIC],
  ['text on the accent', 'accent-fg', 'accent', TEXT],
  ['a refusal on a panel', 'danger', 'panel', TEXT],
  ['a refusal on its background', 'danger', 'danger-bg', TEXT],
  ['a warning on its background', 'warning', 'warning-bg', TEXT],
  ['a success on a panel', 'success', 'panel', TEXT],
  ...KINDS.flatMap((kind) => [
    [`the outline of a ${kind} on the canvas`, kind, 'canvas', GRAPHIC] as const,
    [`the outline of a ${kind} on its fill`, kind, `${kind}-fill`, GRAPHIC] as const,
    [`text on the fill of a ${kind}`, 'fg', `${kind}-fill`, TEXT] as const,
    [`muted text on the fill of a ${kind}`, 'muted', `${kind}-fill`, TEXT] as const,
    [`the focus ring on the fill of a ${kind}`, 'focus', `${kind}-fill`, GRAPHIC] as const,
  ]),
];

describe('the colour tokens of styles.css', () => {
  it('are all defined as a pair of colours, one for each theme', () => {
    expect(Object.keys(tokens).length).toBeGreaterThanOrEqual(25);
    for (const [name, values] of Object.entries(tokens)) {
      expect(values.light, name).toMatch(/^#[0-9a-f]{6}$/);
      expect(values.dark, name).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('are the ones that Tailwind is told about, so that a template can only use a colour that is defined', () => {
    const mapped = [...css.matchAll(/--color-([a-z-]+):\s*var\(--rmq-([a-z-]+)\)/g)];

    expect(mapped.length).toBeGreaterThanOrEqual(15);
    for (const [, utility, token] of mapped) {
      expect(tokens[token as string], `--color-${utility} points at --rmq-${token}`).toBeDefined();
    }
  });

  it('give each kind of node a stroke and a fill, so that none is drawn in the colour of another', () => {
    for (const theme of ['light', 'dark'] as const) {
      const strokes = KINDS.map((kind) => colour(kind, theme));
      expect(new Set(strokes).size, `${theme} strokes`).toBe(KINDS.length);
      for (const kind of KINDS) {
        expect(colour(`${kind}-fill`, theme)).not.toBe(colour(kind, theme));
      }
    }
  });

  describe.each(['light', 'dark'] as const)('in the %s theme', (theme) => {
    it.each(PAIRS)('make %s readable', (what, foreground, background, needed) => {
      const ratio = contrast(colour(foreground, theme), colour(background, theme));

      expect(
        ratio,
        `${what}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1, and needs ${needed}:1`,
      ).toBeGreaterThanOrEqual(needed);
    });
  });

  it('keep the page itself in the colours that the smoke test of the end-to-end suite expects', () => {
    expect(colour('surface', 'light')).toBe('#ffffff');
    expect(colour('surface', 'dark')).toBe('#0b1020');
  });
});

describe('contrast', () => {
  it('is 21:1 for black on white, and 1:1 for a colour on itself', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#336699', '#336699')).toBeCloseTo(1, 5);
  });
});
