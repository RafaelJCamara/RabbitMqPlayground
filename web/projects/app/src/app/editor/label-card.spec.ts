import { fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { LabelCard } from './label-card';

async function renderCard(items: readonly string[] = ['order.*', 'invoice.#', 'a', 'b', 'c']) {
  const holds: boolean[] = [];
  const view = await render(LabelCard, {
    inputs: { title: 'Bindings from exchange orders to queue billing', items, position: { x: 10, y: 20 } },
    on: { held: (held: boolean) => holds.push(held) },
  });
  return { ...view, holds };
}

describe('LabelCard (ADR-0044)', () => {
  it('lists every key of the edge, one to a line, under a heading that says whose they are', async () => {
    await renderCard();

    expect(screen.getByRole('group', { name: 'Bindings from exchange orders to queue billing' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'order.*',
      'invoice.#',
      'a',
      'b',
      'c',
    ]);
    expect(screen.getByText('Bindings from exchange orders to queue billing')).toBeVisible();
  });

  it('is where it is told to be, on the host of the canvas', async () => {
    await renderCard();

    const card = screen.getByTestId('label-card');
    expect(card.style.left).toBe('10px');
    expect(card.style.top).toBe('20px');
  });

  it('says that it is held when the pointer is over it, and that it is let go when the pointer leaves, so that it stays while it is read', async () => {
    const { holds } = await renderCard();
    const card = screen.getByTestId('label-card');

    fireEvent.pointerEnter(card);
    fireEvent.pointerLeave(card);

    expect(holds).toEqual([true, false]);
  });

  it('keeps a key that is long whole, so that the list says what the chip cut', async () => {
    await renderCard(['a'.repeat(120)]);

    expect(screen.getByRole('listitem').textContent).toBe('a'.repeat(120));
  });
});
