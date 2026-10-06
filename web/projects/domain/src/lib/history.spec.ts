import { deepFreeze, documentOf, queueRecord } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from './document/schema';
import { History, HISTORY_LIMIT } from './history';

/** A document that is its own: no two of them are the same object, and each can be told apart by its queue. */
const doc = (n: number): CanvasDocument => deepFreeze(documentOf({ queues: { Q: queueRecord(`q${n}`) } }));

describe('History', () => {
  it('keeps the last 200 steps (ADR-0019)', () => {
    expect(HISTORY_LIMIT).toBe(200);
    expect(new History().limit).toBe(200);
  });

  it('has nothing to undo or redo when it is new', () => {
    const history = new History();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undoDepth).toBe(0);
    expect(history.redoDepth).toBe(0);
    expect(history.undo(doc(1))).toBeUndefined();
    expect(history.redo(doc(1))).toBeUndefined();
  });

  it('gives back the very document that was pushed, not a copy of it', () => {
    const history = new History();
    const first = doc(1);
    const second = doc(2);
    history.push(first);

    expect(history.undo(second)).toBe(first);
  });

  it('undoes in the reverse of the order that the changes were made, and redoes in the order they were undone', () => {
    const history = new History();
    const [a, b, c, d] = [doc(1), doc(2), doc(3), doc(4)];
    history.push(a);
    history.push(b);
    history.push(c);

    expect(history.undo(d)).toBe(c);
    expect(history.undo(c)).toBe(b);
    expect(history.undo(b)).toBe(a);
    expect(history.undo(a)).toBeUndefined();
    expect(history.redo(a)).toBe(b);
    expect(history.redo(b)).toBe(c);
    expect(history.redo(c)).toBe(d);
    expect(history.redo(d)).toBeUndefined();
  });

  it('counts the steps that can be undone and redone', () => {
    const history = new History();
    history.push(doc(1));
    history.push(doc(2));
    history.undo(doc(3));

    expect(history.undoDepth).toBe(1);
    expect(history.redoDepth).toBe(1);
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(true);
    history.undo(doc(2));

    expect(history.canUndo).toBe(false);
    expect(history.redoDepth).toBe(2);
  });

  it('forgets what could have been redone when a new change is made', () => {
    const history = new History();
    const [a, b, c] = [doc(1), doc(2), doc(3)];
    history.push(a);
    history.undo(b);

    expect(history.canRedo).toBe(true);
    history.push(c);

    expect(history.canRedo).toBe(false);
    expect(history.redo(c)).toBeUndefined();
    expect(history.undo(doc(4))).toBe(c);
  });

  it('does not take away a redo when there was nothing to undo, or an undo when there was nothing to redo', () => {
    const history = new History();
    history.push(doc(1));
    history.undo(doc(2));
    history.undo(doc(1));

    expect(history.redoDepth).toBe(1);
    history.redo(doc(1));
    history.redo(doc(2));

    expect(history.undoDepth).toBe(1);
  });

  it('drops the oldest step first when there are more than it keeps', () => {
    const history = new History(3);
    const docs = [doc(1), doc(2), doc(3), doc(4), doc(5)];
    for (const d of docs.slice(0, 4)) {
      history.push(d);
    }

    expect(history.undoDepth).toBe(3);
    expect(history.undo(docs[4] as CanvasDocument)).toBe(docs[3]);
    expect(history.undo(docs[3] as CanvasDocument)).toBe(docs[2]);
    expect(history.undo(docs[2] as CanvasDocument)).toBe(docs[1]);
    expect(history.undo(docs[1] as CanvasDocument)).toBeUndefined();
  });

  it('keeps 200 steps by default, and drops the 201st', () => {
    const history = new History();
    const docs = Array.from({ length: 201 }, (_, index) => doc(index));
    for (const d of docs.slice(0, 201)) {
      history.push(d);
    }

    expect(history.undoDepth).toBe(200);
    let undone = 0;
    let current = doc(999);
    for (let step = history.undo(current); step !== undefined; step = history.undo(current)) {
      current = step;
      undone += 1;
    }

    expect(undone).toBe(200);
    expect(current).toBe(docs[1]);
  });

  it('keeps one step at the least, and refuses a limit that is none, fractional or not a number', () => {
    expect(new History(1).limit).toBe(1);
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new History(bad), String(bad)).toThrow(RangeError);
    }
    expect(() => new History(0)).toThrow('A history keeps at least one step, not 0.');
  });

  it('forgets everything when it is cleared, for a canvas that was loaded and has no past', () => {
    const history = new History();
    history.push(doc(1));
    history.push(doc(2));
    history.undo(doc(3));
    history.clear();

    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
    expect(history.undo(doc(4))).toBeUndefined();
  });

  it('is the same as a model that keeps two lists, however undo, redo and change are mixed, within its limit', () => {
    const arbStep = fc.constantFrom('push', 'undo', 'redo');

    fc.assert(
      fc.property(fc.array(arbStep, { maxLength: 60 }), fc.integer({ min: 1, max: 8 }), (steps, limit) => {
        const history = new History(limit);
        let undoList: number[] = [];
        let redoList: number[] = [];
        const documents = new Map<number, CanvasDocument>();
        const get = (n: number): CanvasDocument =>
          documents.get(n) ?? (documents.set(n, doc(n)), documents.get(n) as CanvasDocument);
        let current = 0;
        let next = 1;

        for (const step of steps) {
          if (step === 'push') {
            history.push(get(current));
            undoList = [...undoList, current].slice(-limit);
            redoList = [];
            current = next++;
          } else if (step === 'undo') {
            const got = history.undo(get(current));
            const expected = undoList.at(-1);

            expect(got).toBe(expected === undefined ? undefined : get(expected));
            if (expected !== undefined) {
              undoList = undoList.slice(0, -1);
              redoList = [...redoList, current];
              current = expected;
            }
          } else {
            const got = history.redo(get(current));
            const expected = redoList.at(-1);

            expect(got).toBe(expected === undefined ? undefined : get(expected));
            if (expected !== undefined) {
              redoList = redoList.slice(0, -1);
              undoList = [...undoList, current];
              current = expected;
            }
          }
          expect(history.undoDepth).toBe(undoList.length);
          expect(history.redoDepth).toBe(redoList.length);
        }
      }),
    );
  });
});
