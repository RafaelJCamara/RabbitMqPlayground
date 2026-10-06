import { emptyDocument, validateDocument } from '@rmq/domain';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { arbDocument, arbScript, finalDocument, playScript } from './scripts';

describe('finalDocument', () => {
  it('is an empty canvas for a script that does nothing', () => {
    expect(finalDocument([])).toEqual(emptyDocument());
    expect(Object.isFrozen(finalDocument([]))).toBe(true);
  });

  it('is the canvas that the last step of the script left, and the same one every time', () => {
    for (const script of fc.sample(arbScript, { numRuns: 30, seed: 11 })) {
      const steps = [...playScript(script)];

      expect(finalDocument(script)).toEqual(steps.at(-1)?.after);
      expect(finalDocument(script)).toEqual(finalDocument(script));
    }
  });
});

describe('arbDocument', () => {
  const samples = fc.sample(arbDocument, { numRuns: 200, seed: 12 });

  it('makes canvases that are right, because commands made them, and that cannot be changed', () => {
    for (const document of samples) {
      expect(validateDocument(document)).toEqual([]);
      expect(Object.isFrozen(document)).toBe(true);
    }
  });

  it('makes canvases of every kind, from nothing on them to a lot, with every collection filled somewhere', () => {
    const count = (pick: (document: (typeof samples)[number]) => object) =>
      samples.filter((document) => Object.keys(pick(document)).length > 0).length;

    expect(count((document) => document.exchanges)).toBeGreaterThan(50);
    expect(count((document) => document.queues)).toBeGreaterThan(50);
    expect(count((document) => document.bindings)).toBeGreaterThan(20);
    expect(count((document) => document.producers)).toBeGreaterThan(20);
    expect(count((document) => document.consumers)).toBeGreaterThan(20);
    expect(count((document) => document.layout.labels)).toBeGreaterThan(1);
    expect(samples.some((document) => Object.keys(document.exchanges).length === 0)).toBe(true);
  });
});
