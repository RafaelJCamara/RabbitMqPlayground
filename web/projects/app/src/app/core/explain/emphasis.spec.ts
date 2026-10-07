import { describe, expect, it } from 'vitest';
import { legendOf, Marks, NO_EMPHASIS, type EdgeMark, type NodeMark } from './emphasis';

/** An emphasis with these marks on edges `e0`, `e1`… and on nodes `n0`, `n1`…, as the card is given it. */
function lit(edges: readonly EdgeMark[], nodes: readonly NodeMark[] = []) {
  const marks = new Marks();
  edges.forEach((mark, index) => marks.edge(`e${index}`, mark));
  nodes.forEach((mark, index) => marks.node(`n${index}`, mark));
  return marks.build();
}

const ids = (emphasis: ReturnType<typeof lit>) => legendOf(emphasis)?.map(({ id }) => id) ?? null;

describe('legendOf (ADR-0062)', () => {
  it('says nothing when nothing is lit', () => {
    expect(legendOf(NO_EMPHASIS)).toBeNull();
    expect(legendOf(lit([]))).toBeNull();
  });

  it('says that something went this way, or got a copy, for each of the marks that say it, on an edge and on a node, and for each alone', () => {
    expect(ids(lit(['path']))).toEqual(['hit']);
    expect(ids(lit(['matched']))).toEqual(['hit']);
    expect(ids(lit([], ['reached']))).toEqual(['hit']);
    expect(ids(lit([], ['visited']))).toEqual(['hit']);
  });

  it('says that something did not match, on an edge or on a node, and nothing else for it', () => {
    expect(ids(lit(['missed']))).toEqual(['miss']);
    expect(ids(lit([], ['missed']))).toEqual(['miss']);
  });

  it('says that something is asked about, on an edge or on a node, and nothing else for it', () => {
    expect(ids(lit(['asked']))).toEqual(['asked']);
    expect(ids(lit([], ['asked']))).toEqual(['asked']);
  });

  it('says each thing once, in the order of the card, however many marks have it and whichever others are lit', () => {
    const legend = legendOf(lit(['missed', 'path', 'asked', 'path'], ['reached', 'visited', 'missed', 'asked']));

    expect(legend).toEqual([
      { id: 'hit', text: 'went this way, or got a copy' },
      { id: 'miss', text: 'did not match, and why' },
      { id: 'asked', text: 'asked about' },
    ]);
    expect(ids(lit(['missed', 'matched']))).toEqual(['hit', 'miss']);
    expect(ids(lit(['missed'], ['reached']))).toEqual(['hit', 'miss']);
    expect(ids(lit(['asked'], ['missed']))).toEqual(['miss', 'asked']);
  });
});
