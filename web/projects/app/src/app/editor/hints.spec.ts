import { describe, expect, it } from 'vitest';
import { hintsFor } from './hints';
import { SHORTCUTS } from './keyboard';

const labels = (selection: Parameters<typeof hintsFor>[0]) => hintsFor(selection, false).map((hint) => hint.label);
const keys = (selection: Parameters<typeof hintsFor>[0]) => hintsFor(selection, false).map((hint) => hint.keys);

describe('hintsFor', () => {
  it('tells what the keys do when nothing is selected', () => {
    expect(hintsFor({ nodes: 0, edges: 0 }, false)).toEqual([
      { id: 'navigate', keys: 'Arrow keys', label: 'Move between nodes' },
      { id: 'fit', keys: 'F', label: 'Fit the canvas' },
      { id: 'zoom', keys: '+ and -', label: 'Zoom' },
      { id: 'undo', keys: 'Ctrl+Z', label: 'Undo' },
      { id: 'redo', keys: 'Ctrl+Shift+Z', label: 'Redo' },
      { id: 'commands', keys: '/', label: 'Commands' },
      { id: 'shortcuts', keys: '?', label: 'Shortcuts' },
    ]);
  });

  it('tells what can be done to one node: edit, rename, move, link, delete', () => {
    expect(keys({ nodes: 1, edges: 0, kind: 'queue' })).toEqual([
      'Arrow keys',
      'M',
      'L',
      'F2',
      'Enter',
      'Delete',
      'F',
      'Ctrl+Z',
      'Ctrl+Shift+Z',
      '/',
      '?',
    ]);
    expect(labels({ nodes: 1, edges: 0, kind: 'queue' })).toContain('Link to another node');
    expect(labels({ nodes: 1, edges: 0, kind: 'queue' })).toContain('Rename');
  });

  it('does not offer to link from a consumer, which is where a message ends', () => {
    expect(labels({ nodes: 1, edges: 0, kind: 'consumer' })).not.toContain('Link to another node');
    expect(labels({ nodes: 1, edges: 0, kind: 'consumer' })).toContain('Rename');
  });

  it('does not offer to rename or link an edge, and offers to edit it and delete it', () => {
    const edge = labels({ nodes: 0, edges: 1 });

    expect(edge).toContain('Edit in the inspector');
    expect(edge).toContain('Delete');
    expect(edge).not.toContain('Rename');
    expect(edge).not.toContain('Link to another node');
    expect(edge).not.toContain('Move with the arrow keys');
  });

  it('offers to move and delete several things, and to neither rename nor link them', () => {
    const several = labels({ nodes: 2, edges: 0 });

    expect(several).toContain('Move with the arrow keys');
    expect(several).toContain('Delete');
    expect(several).not.toContain('Rename');
    expect(several).not.toContain('Link to another node');
  });

  it('is made from the table, in its order, so that a row that is added shows up', () => {
    const everything = hintsFor({ nodes: 1, edges: 0, kind: 'queue' }, false, ['simulation']).map((hint) => hint.id);
    const table = SHORTCUTS.filter((row) => row.shows({ nodes: 1, edges: 0, kind: 'queue' })).map((row) => row.id);

    expect(everything).toEqual(table);
  });

  it('says the keys of the simulation when the flag is on, and not otherwise, and P only for a producer', () => {
    const ids = (selection: Parameters<typeof hintsFor>[0], enabled: Parameters<typeof hintsFor>[2]) =>
      hintsFor(selection, false, enabled).map((hint) => hint.id);

    expect(ids({ nodes: 0, edges: 0 }, [])).not.toEqual(expect.arrayContaining(['play']));
    expect(ids({ nodes: 0, edges: 0 }, ['simulation'])).toEqual(expect.arrayContaining(['play', 'step']));
    expect(ids({ nodes: 0, edges: 0 }, ['simulation'])).not.toContain('publish');
    expect(ids({ nodes: 1, edges: 0, kind: 'queue' }, ['simulation'])).not.toContain('publish');
    expect(ids({ nodes: 1, edges: 0, kind: 'producer' }, ['simulation'])).toContain('publish');
    expect(ids({ nodes: 1, edges: 0, kind: 'producer' }, [])).not.toContain('publish');
    expect(ids({ nodes: 2, edges: 0 }, ['simulation'])).not.toContain('publish');
    expect(ids({ nodes: 1, edges: 1, kind: 'producer' }, ['simulation'])).not.toContain('publish');
  });

  it('says the key of the event log when the simulation is on, and not otherwise, since there is no log without events', () => {
    const ids = (enabled: Parameters<typeof hintsFor>[2]) =>
      hintsFor({ nodes: 0, edges: 0 }, false, enabled).map((hint) => hint.id);

    expect(ids([])).not.toContain('event-log');
    expect(ids(['simulation'])).toContain('event-log');
  });

  it('writes the modifier that the platform has', () => {
    expect(hintsFor({ nodes: 0, edges: 0 }, true).find((hint) => hint.id === 'undo')?.keys).toBe('Cmd+Z');
    expect(hintsFor({ nodes: 0, edges: 0 }, false).find((hint) => hint.id === 'undo')?.keys).toBe('Ctrl+Z');
  });
});
