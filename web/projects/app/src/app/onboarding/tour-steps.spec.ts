import { canvasFromText } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { TOUR_STEPS, type TourStep } from './tour-steps';

/** What each step of the tour asks of the canvas (ADR-0083), as a question about the canvas and not about the control that was used. */

const step = (id: TourStep['id']): TourStep => {
  const found = TOUR_STEPS.find((each) => each.id === id);
  if (found === undefined) {
    throw new Error(`There is no step ${id}`);
  }
  return found;
};

const canvas = (...lines: string[]) => canvasFromText(lines.join('\n'));
const done = (id: TourStep['id'], document = canvas(), sent = 0): boolean =>
  step(id).done?.({ document, sent }) ?? false;

describe('the steps of the tour (ADR-0083)', () => {
  it('are six, in the order of a message, with a title of their own', () => {
    expect(TOUR_STEPS.map(({ id }) => id)).toEqual(['add', 'link', 'bind', 'consume', 'send', 'finish']);
    expect(new Set(TOUR_STEPS.map(({ title }) => title)).size).toBe(6);
    for (const each of TOUR_STEPS) {
      expect(each.text, each.id).toMatch(/^[A-Z].*[.:]$/);
    }
  });

  it('list the five ways of linking under the step that links, and under no other', () => {
    expect(TOUR_STEPS.filter(({ ways }) => ways).map(({ id }) => id)).toEqual(['link']);
  });

  it('ask nothing in the last one, which is the end', () => {
    expect(step('finish').done).toBeNull();
    expect(TOUR_STEPS.filter(({ done: question }) => question === null)).toHaveLength(1);
  });

  describe('add a producer, an exchange and a queue', () => {
    it('is done when the canvas has one of each, and not before', () => {
      expect(done('add')).toBe(false);
      expect(done('add', canvas('add producer sender'))).toBe(false);
      expect(done('add', canvas('add producer sender', 'declare exchange orders type=direct'))).toBe(false);
      expect(done('add', canvas('add producer sender', 'declare queue billing'))).toBe(false);
      expect(done('add', canvas('declare exchange orders type=direct', 'declare queue billing'))).toBe(false);
      expect(
        done('add', canvas('add producer sender', 'declare exchange orders type=direct', 'declare queue billing')),
      ).toBe(true);
    });

    it('is done by any kind of exchange, and by more than one of each', () => {
      expect(
        done('add', canvas('add producer a', 'add producer b', 'declare exchange logs type=fanout', 'declare queue q')),
      ).toBe(true);
    });
  });

  describe('link the producer to the exchange', () => {
    const base = ['add producer sender', 'declare exchange orders type=direct', 'declare queue billing'];

    it('is done when a producer has an exchange as its target', () => {
      expect(done('link', canvas(...base))).toBe(false);
      expect(done('link', canvas(...base, 'link sender -> orders'))).toBe(true);
    });

    it('is not done by a producer that publishes to a queue, which is another way of reaching it', () => {
      expect(done('link', canvas(...base, 'link sender -> billing'))).toBe(false);
    });

    it('is not done again once the link is taken off', () => {
      expect(done('link', canvas(...base, 'link sender -> orders', 'unlink sender'))).toBe(false);
    });
  });

  describe('bind the exchange to the queue', () => {
    const base = ['declare exchange orders type=direct', 'declare queue billing', 'declare exchange audit type=fanout'];

    it('is done when a binding has a queue as its end', () => {
      expect(done('bind', canvas(...base))).toBe(false);
      expect(done('bind', canvas(...base, 'bind orders -> billing key=new'))).toBe(true);
    });

    it('is not done by a binding between two exchanges', () => {
      expect(done('bind', canvas(...base, 'bind orders -> audit'))).toBe(false);
    });
  });

  describe('add a consumer and give it the queue', () => {
    const base = ['declare queue billing', 'add consumer worker'];

    it('is done when a consumer consumes from a queue', () => {
      expect(done('consume', canvas(...base))).toBe(false);
      expect(done('consume', canvas(...base, 'subscribe worker billing'))).toBe(true);
    });

    it('is not done again once the consumer stops consuming', () => {
      expect(done('consume', canvas(...base, 'subscribe worker billing', 'unsubscribe worker billing'))).toBe(false);
    });
  });

  describe('send a message', () => {
    it('is done when a message has been sent since the tour began, whatever the canvas', () => {
      expect(done('send', canvas(), 0)).toBe(false);
      expect(done('send', canvas(), 1)).toBe(true);
      expect(done('send', canvas(), 7)).toBe(true);
    });
  });
});
