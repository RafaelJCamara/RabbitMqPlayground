import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MOTION_QUERY, MotionPreference, type MotionQuery } from './motion';

/** A media query that a spec can change. */
function fakeQuery(matches: boolean) {
  const listeners = new Set<(event: { readonly matches: boolean }) => void>();
  const query: MotionQuery & { matches: boolean } = {
    matches,
    addEventListener: (_type, listener) => void listeners.add(listener),
    removeEventListener: (_type, listener) => void listeners.delete(listener),
  };
  return {
    query,
    listeners,
    change(next: boolean) {
      query.matches = next;
      [...listeners].forEach((listener) => listener({ matches: next }));
    },
  };
}

describe('MotionPreference', () => {
  it('is what the page says when it starts: reduced when the learner asked for less motion, and not when not', () => {
    TestBed.configureTestingModule({ providers: [{ provide: MOTION_QUERY, useValue: fakeQuery(true).query }] });
    expect(TestBed.inject(MotionPreference).reduced()).toBe(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: MOTION_QUERY, useValue: fakeQuery(false).query }] });
    expect(TestBed.inject(MotionPreference).reduced()).toBe(false);
  });

  it('follows the page when the learner changes it, in both directions', () => {
    const page = fakeQuery(false);
    TestBed.configureTestingModule({ providers: [{ provide: MOTION_QUERY, useValue: page.query }] });
    const motion = TestBed.inject(MotionPreference);

    page.change(true);
    expect(motion.reduced()).toBe(true);
    page.change(false);
    expect(motion.reduced()).toBe(false);
  });

  it('stops listening when it is destroyed', () => {
    const page = fakeQuery(false);
    TestBed.configureTestingModule({ providers: [{ provide: MOTION_QUERY, useValue: page.query }] });
    TestBed.inject(MotionPreference);
    expect(page.listeners.size).toBe(1);

    TestBed.resetTestingModule();

    expect(page.listeners.size).toBe(0);
  });

  it('is not reduced where the page cannot say, and never changes', () => {
    TestBed.configureTestingModule({ providers: [{ provide: MOTION_QUERY, useValue: null }] });

    expect(TestBed.inject(MotionPreference).reduced()).toBe(false);
  });

  it('asks the window for the preference to reduce motion, by that name', () => {
    const asked: string[] = [];
    const page = fakeQuery(true);
    const defaultView = {
      matchMedia: (text: string) => {
        asked.push(text);
        return page.query;
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: { defaultView } }] });

    expect(TestBed.inject(MotionPreference).reduced()).toBe(true);
    expect(asked).toEqual(['(prefers-reduced-motion: reduce)']);
  });

  it('asks the window by default, which says nothing where there is no way to ask', () => {
    TestBed.configureTestingModule({});

    expect(TestBed.inject(MotionPreference).reduced()).toBe(false);
  });
});
