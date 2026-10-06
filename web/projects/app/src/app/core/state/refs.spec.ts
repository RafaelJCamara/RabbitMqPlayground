import { documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { edgeEnds, refOf } from './refs';

describe('refOf', () => {
  const document = documentOf({
    exchanges: { x1: exchangeRecord('orders') },
    queues: { q1: queueRecord('orders') },
  });

  it('says which element an id is, by kind and name, which is how a command names it (ADR-0026)', () => {
    expect(refOf(document, 'x1')).toEqual({ kind: 'exchange', name: 'orders' });
    expect(refOf(document, 'q1')).toEqual({ kind: 'queue', name: 'orders' });
  });

  it('tells an exchange from a queue that has the same name, because it goes by the id', () => {
    expect(refOf(document, 'x1')?.kind).not.toBe(refOf(document, 'q1')?.kind);
  });

  it('is nothing for an id that is not on the canvas', () => {
    expect(refOf(document, 'gone')).toBeUndefined();
    expect(refOf(document, 'constructor')).toBeUndefined();
  });
});

describe('edgeEnds', () => {
  it('splits the key of an edge into the id it starts from and the id it ends at', () => {
    expect(edgeEnds('x1>q1')).toEqual({ from: 'x1', to: 'q1' });
    expect(edgeEnds('a.b:c-d>e_f')).toEqual({ from: 'a.b:c-d', to: 'e_f' });
  });

  it('is nothing for a key that is not of that shape', () => {
    expect(edgeEnds('')).toBeUndefined();
    expect(edgeEnds('x1')).toBeUndefined();
    expect(edgeEnds('>q1')).toBeUndefined();
    expect(edgeEnds('x1>')).toBeUndefined();
    expect(edgeEnds('a>b>c')).toBeUndefined();
  });
});
