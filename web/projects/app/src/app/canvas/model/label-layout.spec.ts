import { edgeKey } from '@rmq/domain';
import { describe, expect, it } from 'vitest';
import type { CanvasVm, EdgeVm, NodeVm } from './canvas-vm';
import { labelPlaces, samePlaces } from './label-layout';

const edge = (id: string, extra: Partial<EdgeVm> = {}): EdgeVm => ({
  id,
  source: id.split('>')[0] as string,
  target: id.split('>')[1] as string,
  kind: 'binding',
  label: id,
  chips: ['a.b'],
  more: [],
  cards: ['a.b'],
  cut: false,
  warnings: [],
  ...extra,
});
const node = (id: string, x: number, y: number): NodeVm => ({
  id,
  kind: 'queue',
  name: id,
  shownName: id,
  x,
  y,
  width: 100,
  height: 40,
  shape: '',
  label: id,
  hasInput: true,
  hasOutput: true,
  warnings: [],
});
const horizontal = (length: number, y: number) => `M 0 ${y} L ${length} ${y}`;

describe('labelPlaces (ADR-0044)', () => {
  it('puts the label of an edge in the middle when nothing is in the way, from the path that the library drew', () => {
    const model: CanvasVm = { nodes: [], edges: [edge('a>b')] };

    expect([...labelPlaces(model, () => horizontal(400, 0))]).toEqual([['a>b', 0.5]]);
  });

  it('leaves out an edge that has no chip, even when it has a path, and one that the library has not drawn yet', () => {
    const model: CanvasVm = { nodes: [], edges: [edge('a>b', { chips: [] }), edge('c>d'), edge('e>f')] };

    const places = labelPlaces(model, (key) => (key === 'c>d' ? null : horizontal(400, 0)));

    expect([...places.keys()]).toEqual(['e>f']);
  });

  it('leaves out an edge whose path cannot be read', () => {
    expect(labelPlaces({ nodes: [], edges: [edge('a>b')] }, () => 'nonsense').size).toBe(0);
  });

  it('keeps a label away from a node, and from the label of another edge on the same line', () => {
    const model: CanvasVm = {
      nodes: [node('n', 150, -20)],
      edges: [edge('a>b'), edge('c>d')],
    };

    const places = labelPlaces(model, () => horizontal(400, 0));

    // The node covers 150 to 250 across the middle, so the first label goes to 0.3 and the second is kept off it.
    expect(places.get('a>b')).toBe(0.3);
    expect(places.get('c>d')).not.toBe(0.3);
  });

  it('puts down first a label that the document has put somewhere, and keeps that place', () => {
    const model: CanvasVm = { nodes: [], edges: [edge('a>b'), edge('c>d', { labelAt: 0.5 })] };

    const places = labelPlaces(model, () => horizontal(1000, 0));

    expect(places.get('c>d')).toBe(0.5);
    expect(places.get('a>b')).toBe(0.4);
  });

  it('is made wider by more chips, because the label is bigger', () => {
    const narrow: CanvasVm = { nodes: [], edges: [edge('a>b'), edge('c>d')] };
    const wide: CanvasVm = {
      nodes: [],
      edges: [
        edge('a>b', { chips: ['a'.repeat(30), 'b'.repeat(30)], more: ['x'] }),
        edge('c>d', { chips: ['a'.repeat(30)] }),
      ],
    };

    expect(labelPlaces(narrow, () => horizontal(1000, 0)).get('c>d')).toBe(0.4);
    expect(labelPlaces(wide, () => horizontal(1000, 0)).get('c>d')).not.toBe(0.4);
    expect(edgeKey('a', 'b')).toBe('a>b');
  });
});

describe('samePlaces', () => {
  it('says that two sets of places are the same when they have the same labels in the same places', () => {
    expect(samePlaces(new Map([['a', 0.5]]), new Map([['a', 0.5]]))).toBe(true);
    expect(samePlaces(new Map(), new Map())).toBe(true);
  });

  it('says that they differ for another place, another label, or another number of them', () => {
    expect(samePlaces(new Map([['a', 0.5]]), new Map([['a', 0.4]]))).toBe(false);
    expect(samePlaces(new Map([['a', 0.5]]), new Map([['b', 0.5]]))).toBe(false);
    expect(samePlaces(new Map([['a', 0.5]]), new Map())).toBe(false);
    expect(samePlaces(new Map(), new Map([['a', 0.5]]))).toBe(false);
  });
});
