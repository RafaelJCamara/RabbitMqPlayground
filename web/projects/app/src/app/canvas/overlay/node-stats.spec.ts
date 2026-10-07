import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { SimStats } from '../../core/runtime/sim-stats';
import type { NodeStats } from '../../core/runtime/stats';
import {
  consumerWords,
  exchangeWords,
  NodeStatsView,
  PICTURE_LIMIT,
  producerWords,
  queueWords,
  slotsOf,
  stackOf,
} from './node-stats';

const consumer = (
  over: Partial<Extract<NodeStats, { kind: 'consumer' }>> = {},
): Extract<NodeStats, { kind: 'consumer' }> => ({
  kind: 'consumer',
  holds: 0,
  limit: 3,
  acksItself: false,
  finished: 0,
  waiting: 0,
  working: false,
  ...over,
});

describe('stackOf (ADR-0056)', () => {
  it('has a square for each message, full for what is ready and hollow for what a consumer holds', () => {
    expect(stackOf({ ready: 3, unacked: 1 })).toEqual({ full: 3, hollow: 1, more: 0 });
    expect(stackOf({ ready: 0, unacked: 0 })).toEqual({ full: 0, hollow: 0, more: 0 });
  });

  it('has no more than eight squares, and counts the rest, with what is ready first', () => {
    expect(stackOf({ ready: 3_000, unacked: 2 })).toEqual({ full: PICTURE_LIMIT, hollow: 0, more: 2_994 });
    expect(stackOf({ ready: 5, unacked: 10 })).toEqual({ full: 5, hollow: 3, more: 7 });
    expect(stackOf({ ready: 0, unacked: 12 })).toEqual({ full: 0, hollow: 8, more: 4 });
  });
});

describe('slotsOf (ADR-0056)', () => {
  it('has a place for each message that it may hold, full for each that it holds', () => {
    expect(slotsOf({ holds: 2, limit: 3, acksItself: false })).toEqual({
      places: 3,
      full: 2,
      unlimited: false,
      more: 0,
    });
  });

  it('has no more than eight places, and counts the rest', () => {
    expect(slotsOf({ holds: 20, limit: 20, acksItself: false })).toEqual({
      places: 8,
      full: 8,
      unlimited: false,
      more: 12,
    });
    expect(slotsOf({ holds: 1, limit: 9, acksItself: false })).toEqual({
      places: 8,
      full: 1,
      unlimited: false,
      more: 1,
    });
  });

  it('is infinite for a consumer with no limit, and for one that acknowledges for itself, which holds nothing that it has not finished with', () => {
    expect(slotsOf({ holds: 5, limit: 0, acksItself: false })).toEqual({
      places: 0,
      full: 0,
      unlimited: true,
      more: 0,
    });
    expect(slotsOf({ holds: 0, limit: 3, acksItself: true })).toEqual({ places: 0, full: 0, unlimited: true, more: 0 });
  });
});

describe('the words of a node (ADR-0056)', () => {
  it('say what a producer has sent', () => {
    expect(producerWords({ kind: 'producer', sent: 0, repeating: false })).toBe('sent 0');
    expect(producerWords({ kind: 'producer', sent: 12, repeating: true })).toBe('sent 12');
  });

  it('say what an exchange routed and what found no queue, and what was refused only when something was', () => {
    expect(exchangeWords({ kind: 'exchange', routed: 4, unroutable: 1, refused: 0 })).toBe('routed 4 · unroutable 1');
    expect(exchangeWords({ kind: 'exchange', routed: 0, unroutable: 0, refused: 1 })).toBe(
      'routed 0 · unroutable 0 · refused 1',
    );
    expect(exchangeWords({ kind: 'exchange', routed: 0, unroutable: 0, refused: 2 })).toBe(
      'routed 0 · unroutable 0 · refused 2',
    );
  });

  it('say what a queue holds', () => {
    expect(queueWords({ kind: 'queue', ready: 3, unacked: 1, consumers: 2 })).toBe('3 ready · 1 unacked');
  });

  it('say how many a consumer holds of how many it may, and what it has done, and what waits only when something does', () => {
    expect(consumerWords(consumer({ holds: 2, limit: 3, finished: 5 }))).toBe('holds 2 of 3 · done 5');
    expect(consumerWords(consumer({ holds: 2, limit: 0, waiting: 4 }))).toBe('holds 2 of ∞ · done 0 · 4 waiting');
    expect(consumerWords(consumer({ acksItself: true, finished: 7 }))).toBe('holds none · done 7');
    expect(consumerWords(consumer({ holds: 1, limit: 2, waiting: 1 }))).toBe('holds 1 of 2 · done 0 · 1 waiting');
  });
});

describe('NodeStatsView (ADR-0056)', () => {
  async function renderNode(id: string) {
    const view = await render(NodeStatsView, { inputs: { id }, providers: [SimStats] });
    const stats = TestBed.inject(SimStats);
    const give = (numbers: NodeStats) => {
      stats.apply(new Map([[id, numbers]]));
      view.fixture.detectChanges();
    };
    return { ...view, give, stats };
  }

  it('says nothing for a node that the simulation says nothing of', async () => {
    const { container } = await renderNode('Q');

    expect(container.querySelector('[data-testid="node-stats"]')).toBeNull();
  });

  it('says what a producer has sent, and that it sends again, with a picture that is hidden from a screen reader', async () => {
    const { give, container } = await renderNode('P');
    give({ kind: 'producer', sent: 3, repeating: true });

    expect(screen.getByTestId('stats-text')).toHaveTextContent('sent 3');
    expect(container.querySelector('rmq-icon')).not.toBeNull();
    give({ kind: 'producer', sent: 3, repeating: false });
    expect(container.querySelector('rmq-icon')).toBeNull();
  });

  it('says what an exchange routed, and what no queue got', async () => {
    const { give } = await renderNode('E');
    give({ kind: 'exchange', routed: 4, unroutable: 1, refused: 0 });

    expect(screen.getByTestId('stats-text')).toHaveTextContent('routed 4 · unroutable 1');
  });

  it('draws a stack of squares for a queue, full for what is ready and hollow for what is held, hidden from a screen reader, and says it in words', async () => {
    const { give } = await renderNode('Q');
    give({ kind: 'queue', ready: 2, unacked: 1, consumers: 1 });

    const stack = screen.getByTestId('stack');
    expect(stack).toHaveAttribute('aria-hidden', 'true');
    expect([...stack.querySelectorAll('span.border-fg')].map((square) => square.classList.contains('bg-fg'))).toEqual([
      true,
      true,
      false,
    ]);
    expect(screen.queryByTestId('stack-more')).toBeNull();
    expect(screen.getByTestId('stats-text')).toHaveTextContent('2 ready · 1 unacked');
  });

  it('says how many more there are than the squares that fit', async () => {
    const { give } = await renderNode('Q');
    give({ kind: 'queue', ready: 3_000, unacked: 0, consumers: 0 });

    expect(screen.getByTestId('stack').querySelectorAll('span.border-fg')).toHaveLength(PICTURE_LIMIT);
    expect(screen.getByTestId('stack-more')).toHaveTextContent('+2992');
  });

  it('draws the slots of a consumer, full for what it holds, and says how many it holds of how many it may', async () => {
    const { give } = await renderNode('C');
    give(consumer({ holds: 2, limit: 3 }));

    const slots = screen.getByTestId('slots');
    expect(slots).toHaveAttribute('aria-hidden', 'true');
    expect([...slots.querySelectorAll('span.border-fg')].map((slot) => slot.classList.contains('bg-fg'))).toEqual([
      true,
      true,
      false,
    ]);
    expect(screen.getByTestId('stats-text')).toHaveTextContent('holds 2 of 3 · done 0');
    expect(screen.queryByTestId('slots-more')).toBeNull();
  });

  it('draws the sign of no limit for a consumer that has none, and for one that acknowledges for itself, and says how many more places than it draws', async () => {
    const { give } = await renderNode('C');

    give(consumer({ limit: 0 }));
    expect(screen.getByTestId('slots')).toHaveTextContent('∞');
    give(consumer({ acksItself: true }));
    expect(screen.getByTestId('slots')).toHaveTextContent('∞');
    give(consumer({ holds: 1, limit: 20 }));
    expect(screen.getByTestId('slots').querySelectorAll('span.border-fg')).toHaveLength(PICTURE_LIMIT);
    expect(screen.getByTestId('slots-more')).toHaveTextContent('+12');
  });

  it('takes no pointer, and is under the box of the node and not in it', async () => {
    const { give } = await renderNode('Q');
    give({ kind: 'queue', ready: 0, unacked: 0, consumers: 0 });

    const box = screen.getByTestId('node-stats');
    expect(box).toHaveClass('pointer-events-none');
    expect(box).toHaveClass('top-full');
    expect(box).toHaveClass('absolute');
  });

  it('is the numbers of its own node, and none of another', async () => {
    const view = await render(NodeStatsView, { inputs: { id: 'Q1' }, providers: [SimStats] });
    TestBed.inject(SimStats).apply(
      new Map<string, NodeStats>([
        ['Q1', { kind: 'queue', ready: 1, unacked: 0, consumers: 0 }],
        ['Q2', { kind: 'queue', ready: 9, unacked: 0, consumers: 0 }],
      ]),
    );
    view.fixture.detectChanges();

    expect(screen.getByTestId('stats-text')).toHaveTextContent('1 ready');
  });
});
