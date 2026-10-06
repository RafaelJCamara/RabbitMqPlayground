import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { NewNode } from '../canvas/model/new-node';
import { Toolbox, TOOLBOX } from './toolbox';

async function renderToolbox() {
  const added: NewNode[] = [];
  const view = await render(Toolbox, {
    on: { add: (node: NewNode) => added.push(node) },
  });
  const buttons = () => screen.getAllByRole('button');
  return { ...view, added, buttons, user: userEvent.setup() };
}

describe('Toolbox', () => {
  it('is one toolbar, with an item for each node that can be added, in the order that a message travels', async () => {
    const { buttons } = await renderToolbox();

    expect(screen.getByRole('toolbar', { name: 'Add a node' })).toBeInTheDocument();
    expect(buttons().map((button) => button.textContent?.trim())).toEqual([
      'Producer',
      'Direct exchange',
      'Fanout exchange',
      'Topic exchange',
      'Headers exchange',
      'Queue',
      'Consumer',
    ]);
  });

  it('says in a sentence that an item is clicked or dragged, which is the way to do it', async () => {
    await renderToolbox();

    expect(screen.getByText('Click to add, or drag onto the canvas.')).toBeInTheDocument();
  });

  describe('clicking', () => {
    it.each(TOOLBOX.map((entry) => [entry.label, entry.node] as const))('adds a %s', async (label, node) => {
      const { added, user } = await renderToolbox();

      await user.click(screen.getByRole('button', { name: label }));

      expect(added).toEqual([node]);
    });

    it('adds with the keyboard, because an item is a button', async () => {
      const { added, user } = await renderToolbox();

      await user.tab();
      await user.keyboard('{Enter}');
      await user.keyboard('{ArrowDown}{ }');

      expect(added).toEqual([{ kind: 'producer' }, { kind: 'exchange', exchangeType: 'direct' }]);
    });
  });

  describe('the keyboard', () => {
    it('is one tab stop: the first item, and Tab goes on to the next region', async () => {
      const { buttons, user } = await renderToolbox();

      expect(buttons().map((button) => button.getAttribute('tabindex'))).toEqual([
        '0',
        '-1',
        '-1',
        '-1',
        '-1',
        '-1',
        '-1',
      ]);
      await user.tab();
      expect(buttons()[0]).toHaveFocus();
      await user.tab();
      expect(buttons().some((button) => button === document.activeElement)).toBe(false);
    });

    it('moves along the items with the arrow keys, and the stop goes with it', async () => {
      const { buttons, user } = await renderToolbox();
      await user.tab();

      await user.keyboard('{ArrowDown}');
      expect(buttons()[1]).toHaveFocus();
      expect(buttons().map((button) => button.getAttribute('tabindex'))).toEqual([
        '-1',
        '0',
        '-1',
        '-1',
        '-1',
        '-1',
        '-1',
      ]);

      await user.keyboard('{ArrowRight}');
      expect(buttons()[2]).toHaveFocus();
      await user.keyboard('{ArrowUp}');
      expect(buttons()[1]).toHaveFocus();
      await user.keyboard('{ArrowLeft}');
      expect(buttons()[0]).toHaveFocus();
    });

    it('stops at the ends instead of going round', async () => {
      const { buttons, user } = await renderToolbox();
      await user.tab();

      await user.keyboard('{ArrowUp}');
      expect(buttons()[0]).toHaveFocus();
      await user.keyboard('{End}{ArrowDown}');
      expect(buttons()[6]).toHaveFocus();
    });

    it('goes to the first and the last with Home and End', async () => {
      const { buttons, user } = await renderToolbox();
      await user.tab();

      await user.keyboard('{End}');
      expect(buttons()[6]).toHaveFocus();
      await user.keyboard('{Home}');
      expect(buttons()[0]).toHaveFocus();
    });

    it('keeps the page from scrolling for the keys that it uses, and leaves every other key alone', async () => {
      const { buttons, user } = await renderToolbox();
      await user.tab();
      const prevented: Record<string, boolean> = {};
      const record = (event: KeyboardEvent) => (prevented[event.key] = event.defaultPrevented);
      document.addEventListener('keydown', record);

      await user.keyboard('a{Tab}');
      await user.tab({ shift: true });
      await user.keyboard('{ArrowDown}{Home}');
      document.removeEventListener('keydown', record);

      expect(prevented).toMatchObject({ a: false, Tab: false, ArrowDown: true, Home: true });
      expect(buttons()[0]).toHaveFocus();
    });

    it('follows the item that was clicked, so that the next Tab comes back to it', async () => {
      const { buttons, user } = await renderToolbox();

      await user.click(buttons()[3]!);

      expect(buttons().map((button) => button.getAttribute('tabindex'))).toEqual([
        '-1',
        '-1',
        '-1',
        '0',
        '-1',
        '-1',
        '-1',
      ]);
    });
  });

  describe('dragging', () => {
    it('makes each item something that the library can find when it is pressed, which it does by an attribute', async () => {
      const { buttons } = await renderToolbox();

      for (const button of buttons()) {
        expect(button.hasAttribute('fexternalitem'), button.textContent ?? '').toBe(true);
        expect(button.classList.contains('f-external-item')).toBe(true);
      }
    });

    it('gives each item an id of its own, which is what it is called when it is looked up', async () => {
      const { buttons } = await renderToolbox();

      expect(buttons().map((button) => button.id)).toEqual(TOOLBOX.map((entry) => entry.key));
      expect(new Set(buttons().map((button) => button.id)).size).toBe(TOOLBOX.length);
    });
  });

  describe('what each item is', () => {
    it('has a colour on its edge that is the colour of its kind', async () => {
      const { buttons } = await renderToolbox();

      const edge = (button: HTMLElement) =>
        [...button.classList].find((name) => /^border-l-(producer|exchange|queue|consumer)$/.test(name));

      expect(buttons().map(edge)).toEqual([
        'border-l-producer',
        'border-l-exchange',
        'border-l-exchange',
        'border-l-exchange',
        'border-l-exchange',
        'border-l-queue',
        'border-l-consumer',
      ]);
    });

    it('is named by its kind and, for an exchange, its type, so that the keys that follow can be tested by name', async () => {
      const { buttons } = await renderToolbox();

      expect(buttons().map((button) => button.getAttribute('data-testid'))).toEqual(
        TOOLBOX.map((entry) => `add-${entry.key}`),
      );
    });
  });
});
