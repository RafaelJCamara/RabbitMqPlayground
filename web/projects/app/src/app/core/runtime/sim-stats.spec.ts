import { effect } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SimStats } from './sim-stats';
import type { NodeStats } from './stats';

const queue = (ready: number, unacked = 0): NodeStats => ({ kind: 'queue', ready, unacked, consumers: 1 });

describe('SimStats', () => {
  let stats: SimStats;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [SimStats] });
    stats = TestBed.inject(SimStats);
  });

  it('has no numbers for a node that nobody has said anything about, and the same signal each time that it is asked', () => {
    expect(stats.of('Q')()).toBeNull();
    expect(stats.of('Q')).toBe(stats.of('Q'));
    expect(stats.of('Q')).not.toBe(stats.of('R'));
  });

  it('sets the signal of each node that it is told the numbers of, and answers how many it set', () => {
    expect(
      stats.apply(
        new Map<string, NodeStats>([
          ['Q', queue(1)],
          ['R', queue(2)],
        ]),
      ),
    ).toBe(2);

    expect(stats.of('Q')()).toEqual(queue(1));
    expect(stats.of('R')()).toEqual(queue(2));
  });

  it('sets only the signal of a node whose numbers changed, so that a burst to one queue checks one component', () => {
    stats.apply(
      new Map<string, NodeStats>([
        ['Q', queue(1)],
        ['R', queue(2)],
        ['S', queue(3)],
      ]),
    );

    const set = stats.apply(
      new Map<string, NodeStats>([
        ['Q', queue(1)],
        ['R', queue(5)],
        ['S', queue(3)],
      ]),
    );

    expect(set).toBe(1);
    expect(stats.of('R')()).toEqual(queue(5));
  });

  it('sets none for numbers that are the same as it has, even when they are made again', () => {
    stats.apply(new Map<string, NodeStats>([['Q', queue(1)]]));

    expect(stats.apply(new Map<string, NodeStats>([['Q', queue(1)]]))).toBe(0);
  });

  it('clears the signal of a node that the engine says nothing of any more, once', () => {
    stats.apply(
      new Map<string, NodeStats>([
        ['Q', queue(1)],
        ['R', queue(2)],
      ]),
    );

    expect(stats.apply(new Map<string, NodeStats>([['Q', queue(1)]]))).toBe(1);
    expect(stats.of('R')()).toBeNull();
    expect(stats.apply(new Map<string, NodeStats>([['Q', queue(1)]]))).toBe(0);
  });

  it('tells a reader of a node when its numbers change, and not when the numbers of another do', () => {
    stats.apply(
      new Map<string, NodeStats>([
        ['Q', queue(1)],
        ['R', queue(1)],
      ]),
    );
    const seen: (NodeStats | null)[] = [];
    TestBed.runInInjectionContext(() => {
      effect(() => {
        seen.push(stats.of('Q')());
      });
    });
    TestBed.tick();

    stats.apply(
      new Map<string, NodeStats>([
        ['Q', queue(1)],
        ['R', queue(2)],
      ]),
    );
    TestBed.tick();
    stats.apply(
      new Map<string, NodeStats>([
        ['Q', queue(7)],
        ['R', queue(2)],
      ]),
    );
    TestBed.tick();

    expect(seen).toEqual([queue(1), queue(7)]);
  });
});
