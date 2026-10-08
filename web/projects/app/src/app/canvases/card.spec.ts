import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { NOW } from '../core/session/canvas-session';
import { CanvasCard, elementsText } from './card';
import type { CanvasSummary } from './summary';
import { EMPTY_THUMBNAIL } from './thumbnail';

const CLOCK = new Date(2026, 9, 8, 15, 30).getTime();
const HOUR = 3_600_000;

const canvas = (change: Partial<CanvasSummary> = {}): CanvasSummary => ({
  id: 'a',
  name: 'Orders flow',
  createdAt: CLOCK - 5 * 24 * HOUR,
  updatedAt: CLOCK - 3 * HOUR,
  elements: 12,
  edges: 9,
  thumbnail: EMPTY_THUMBNAIL,
  ...change,
});

async function renderCard(summary: CanvasSummary = canvas()) {
  const events: string[] = [];
  const view = await render(CanvasCard, {
    inputs: { canvas: summary },
    on: {
      open: () => events.push('open'),
      rename: () => events.push('rename'),
      duplicate: () => events.push('duplicate'),
      save: () => events.push('save'),
      delete: () => events.push('delete'),
    },
    providers: [{ provide: NOW, useValue: () => CLOCK }],
  });
  return { ...view, events, user: userEvent.setup() };
}

describe('elementsText', () => {
  it('counts the elements, and says one in the singular', () => {
    expect(elementsText(0)).toBe('0 elements');
    expect(elementsText(1)).toBe('1 element');
    expect(elementsText(12)).toBe('12 elements');
  });
});

describe('CanvasCard (ADR-0073)', () => {
  it('has the name of the canvas as a heading of the third level, in the card', async () => {
    await renderCard();

    expect(screen.getByRole('heading', { level: 3, name: 'Orders flow' })).toBeInTheDocument();
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('says when it was edited, as a time with the exact time to rest the pointer on, and how many elements it has', async () => {
    await renderCard();

    const edited = screen.getByText('Edited 3 hours ago');
    expect(edited.tagName).toBe('TIME');
    expect(edited).toHaveAttribute('datetime', new Date(CLOCK - 3 * HOUR).toISOString());
    expect(edited).toHaveAttribute('title', new Date(CLOCK - 3 * HOUR).toLocaleString());
    expect(screen.getByText('12 elements')).toBeInTheDocument();
  });

  it('says "1 element" for a canvas with one', async () => {
    await renderCard(canvas({ elements: 1 }));

    expect(screen.getByText('1 element')).toBeInTheDocument();
  });

  it('has the buttons that act on the canvas, each named with it, with the words on them that a name is made of', async () => {
    await renderCard();

    const open = screen.getByRole('button', { name: 'Open Orders flow' });
    expect(open).toHaveTextContent('Open');
    expect(screen.getByRole('button', { name: 'Rename Orders flow' })).toHaveTextContent('Rename');
    expect(screen.getByRole('button', { name: 'Duplicate Orders flow' })).toHaveTextContent('Duplicate');
    expect(screen.getByRole('button', { name: 'Save as file Orders flow' })).toHaveTextContent('Save as file');
    expect(screen.getByRole('button', { name: 'Delete Orders flow' })).toHaveTextContent('Delete');
  });

  it('says Delete in words, and not only in a colour', async () => {
    await renderCard();

    const remove = screen.getByRole('button', { name: 'Delete Orders flow' });
    expect(remove.className).toContain('text-danger');
    expect(remove).toHaveTextContent('Delete');
  });

  it('tells what was pressed, and nothing else', async () => {
    const { events, user } = await renderCard();

    await user.click(screen.getByRole('button', { name: 'Open Orders flow' }));
    await user.click(screen.getByRole('button', { name: 'Rename Orders flow' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate Orders flow' }));
    await user.click(screen.getByRole('button', { name: 'Save as file Orders flow' }));
    await user.click(screen.getByRole('button', { name: 'Delete Orders flow' }));

    expect(events).toEqual(['open', 'rename', 'duplicate', 'save', 'delete']);
  });

  it('opens nothing when the name or the drawing is pressed, so that reading a card does not open it', async () => {
    const { events, user } = await renderCard();

    await user.click(screen.getByRole('heading', { name: 'Orders flow' }));
    await user.click(screen.getByTestId('thumbnail-empty'));

    expect(events).toEqual([]);
  });

  it('hides the drawing from a screen reader, which has everything it says in words', async () => {
    await renderCard();

    expect(screen.getByTestId('thumbnail-empty').closest('[aria-hidden="true"]')).not.toBeNull();
    expect(within(screen.getByRole('article')).queryByRole('img')).toBeNull();
  });

  it('shows the whole name when the pointer rests on one that is cut', async () => {
    const long = 'A canvas with a very long name that does not fit on one line of a card';
    await renderCard(canvas({ name: long }));

    expect(screen.getByRole('heading', { name: long })).toHaveAttribute('title', long);
  });

  it('marks the card with the id of its canvas, for the home to find the card', async () => {
    await renderCard(canvas({ id: 'xyz' }));

    expect(screen.getByRole('article')).toHaveAttribute('data-canvas', 'xyz');
  });
});
