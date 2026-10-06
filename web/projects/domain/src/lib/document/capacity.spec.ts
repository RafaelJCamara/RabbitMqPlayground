import { describe, expect, it } from 'vitest';
import { canvasFullIssue, payloadIssue, thousands } from './capacity';
import { LIMITS } from './schema';

describe('thousands', () => {
  it('puts a comma between the thousands, the same in every locale', () => {
    expect(thousands(0)).toBe('0');
    expect(thousands(999)).toBe('999');
    expect(thousands(1_000)).toBe('1,000');
    expect(thousands(10_001)).toBe('10,001');
    expect(thousands(5_000_000)).toBe('5,000,000');
  });
});

describe('canvasFullIssue', () => {
  it('says what the canvas holds, why that is the most, how much this one has, and what to do', () => {
    expect(canvasFullIssue('elements', 2_000)).toEqual({
      kind: 'canvas-full',
      message:
        'The canvas is full: a canvas holds at most 2,000 elements (exchanges, queues, producers and consumers), so that it can always be saved and opened again, and this one has 2,000. Delete something you no longer need to make room.',
    });
    expect(canvasFullIssue('edges', 5_001)).toEqual({
      kind: 'canvas-full',
      message:
        'The canvas is full: a canvas holds at most 5,000 connections (bindings, producer links and consumer subscriptions), so that it can always be saved and opened again, and this one has 5,001. Delete something you no longer need to make room.',
    });
  });

  it('does not carry a reply of a broker, because the broker has no such rule: it is the simulator’s', () => {
    expect(canvasFullIssue('elements', LIMITS.elements).refusal).toBeUndefined();
    expect(canvasFullIssue('edges', LIMITS.edges).refusal).toBeUndefined();
  });
});

describe('payloadIssue', () => {
  it('lets a payload be as long as the cap and no longer, counting characters', () => {
    expect(payloadIssue('')).toBeNull();
    expect(payloadIssue('x'.repeat(LIMITS.textLength))).toBeNull();
    expect(payloadIssue('x'.repeat(LIMITS.textLength + 1))).toEqual({
      kind: 'invalid-value',
      message: 'A payload is at most 10,000 characters, and this one has 10,001. Shorten it.',
    });
  });
});
