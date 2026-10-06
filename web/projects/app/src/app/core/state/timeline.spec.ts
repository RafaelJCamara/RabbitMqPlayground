import { documentOf, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { Timeline } from './timeline';

const doc = (name: string) => documentOf({ queues: { q: queueRecord(name) } });

describe('Timeline', () => {
  it('starts with nothing to undo or redo', () => {
    const timeline = new Timeline();

    expect(timeline.canUndo).toBe(false);
    expect(timeline.canRedo).toBe(false);
    expect(timeline.undoLabel).toBeUndefined();
    expect(timeline.redoLabel).toBeUndefined();
    expect(timeline.undo(doc('now'))).toBeUndefined();
    expect(timeline.redo(doc('now'))).toBeUndefined();
  });

  it('gives back the very document from before, with what the step did, and keeps the one it left for redo', () => {
    const [before, after] = [doc('before'), doc('after')];
    const timeline = new Timeline();
    timeline.push(before, 'renamed queue before to after');

    expect(timeline.undoLabel).toBe('renamed queue before to after');
    const undone = timeline.undo(after);
    expect(undone?.document).toBe(before);
    expect(undone?.label).toBe('renamed queue before to after');
    expect(timeline.canUndo).toBe(false);
    expect(timeline.redoLabel).toBe('renamed queue before to after');

    const redone = timeline.redo(before);
    expect(redone?.document).toBe(after);
    expect(redone?.label).toBe('renamed queue before to after');
    expect(timeline.canUndo).toBe(true);
    expect(timeline.canRedo).toBe(false);
  });

  it('undoes the steps one at a time, newest first, and says what each did', () => {
    const [a, b, c] = [doc('a'), doc('b'), doc('c')];
    const timeline = new Timeline();
    timeline.push(a, 'first');
    timeline.push(b, 'second');

    expect(timeline.undoLabel).toBe('second');
    expect(timeline.undo(c)).toEqual({ document: b, label: 'second' });
    expect(timeline.undoLabel).toBe('first');
    expect(timeline.undo(b)).toEqual({ document: a, label: 'first' });
    expect(timeline.redoLabel).toBe('first');
    expect(timeline.redo(a)).toEqual({ document: b, label: 'first' });
    expect(timeline.redoLabel).toBe('second');
  });

  it('forgets what could have been redone when there is a new change', () => {
    const timeline = new Timeline();
    timeline.push(doc('a'), 'first');
    timeline.undo(doc('b'));
    expect(timeline.canRedo).toBe(true);

    timeline.push(doc('a'), 'another');

    expect(timeline.canRedo).toBe(false);
    expect(timeline.redoLabel).toBeUndefined();
  });

  it('keeps the labels with their steps when the oldest step is dropped at the limit', () => {
    const timeline = new Timeline(2);
    timeline.push(doc('a'), 'one');
    timeline.push(doc('b'), 'two');
    timeline.push(doc('c'), 'three');

    expect(timeline.undoDepth).toBe(2);
    expect(timeline.undo(doc('d'))?.label).toBe('three');
    expect(timeline.undo(doc('c'))?.label).toBe('two');
    // The first step is gone, and so is its label: nothing is left to undo, and nothing says what it would be.
    expect(timeline.canUndo).toBe(false);
    expect(timeline.undoLabel).toBeUndefined();
    expect(timeline.undo(doc('b'))).toBeUndefined();
  });

  it('forgets everything on clear, for a canvas that has just been opened', () => {
    const timeline = new Timeline();
    timeline.push(doc('a'), 'one');
    timeline.undo(doc('b'));
    timeline.push(doc('a'), 'two');
    timeline.clear();

    expect(timeline.canUndo).toBe(false);
    expect(timeline.canRedo).toBe(false);
    expect(timeline.undoLabel).toBeUndefined();
    expect(timeline.redoLabel).toBeUndefined();
  });
});
