import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { TargetOption } from './link-flow';
import { LinkPicker } from './link-picker';

const OPTIONS: readonly TargetOption[] = [
  { id: 'x1', kind: 'exchange', name: 'orders', summary: "Binds exchange 'orders' to exchange 'docs'." },
  { id: 'x2', kind: 'exchange', name: 'docs', summary: "Binds exchange 'orders' to exchange 'docs'." },
  { id: 'q1', kind: 'queue', name: 'billing', summary: "Binds exchange 'orders' to queue 'billing'." },
  { id: 'q2', kind: 'queue', name: 'archive', summary: "Binds exchange 'orders' to queue 'archive'." },
];

async function renderPicker(options: readonly TargetOption[] = OPTIONS, reason: string | null = null) {
  const chosen: string[] = [];
  const cancelled: string[] = [];
  const view = await render(LinkPicker, {
    inputs: { title: 'Link exchange orders to…', options, reason, position: { x: 30, y: 40 } },
    on: { chosen: (id: string) => chosen.push(id), cancelled: (how: string) => cancelled.push(how) },
  });
  return { ...view, chosen, cancelled, user: userEvent.setup() };
}

const optionNames = () => screen.getAllByRole('option').map((option) => option.querySelector('strong')?.textContent);

describe('LinkPicker (ADR-0041)', () => {
  it('is a dialog that says what is being linked, with a field that searches and a list of the targets', async () => {
    await renderPicker();

    expect(screen.getByRole('dialog', { name: 'Link exchange orders to…' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Search the targets' })).toBeInTheDocument();
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('has the cursor in the field when it opens', async () => {
    await renderPicker();

    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  });

  it('is where it is told to be, on the host of the canvas', async () => {
    await renderPicker();

    const picker = screen.getByRole('dialog');
    expect(picker.style.left).toBe('30px');
    expect(picker.style.top).toBe('40px');
  });

  it('groups the targets as exchanges and queues, in the order that they are given, each with its name and what the link does', async () => {
    await renderPicker();

    expect(screen.getByRole('group', { name: 'Exchanges' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Queues' })).toBeInTheDocument();
    expect(optionNames()).toEqual(['orders', 'docs', 'billing', 'archive']);
    expect(
      within(screen.getAllByRole('option')[2]!).getByText("Binds exchange 'orders' to queue 'billing'."),
    ).toBeVisible();
  });

  it('groups the consumers that a queue can be linked to, after the exchanges and the queues', async () => {
    await renderPicker([
      { id: 'c1', kind: 'consumer', name: 'worker', summary: "Subscribes consumer 'worker' to queue 'billing'." },
      OPTIONS[2]!,
    ]);

    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Consumers' })).toBeInTheDocument();
    expect(optionNames()).toEqual(['billing', 'worker']);
  });

  it('points its field at its list, and each group at its own name, by id', async () => {
    await renderPicker();

    const field = screen.getByRole('combobox');
    expect(document.getElementById(field.getAttribute('aria-controls') as string)).toBe(screen.getByRole('listbox'));
    expect(document.getElementById(field.getAttribute('aria-activedescendant') as string)).toBe(
      screen.getAllByRole('option')[0],
    );
    expect(
      document.getElementById(screen.getByRole('dialog').getAttribute('aria-labelledby') as string),
    ).toHaveTextContent('Link exchange orders to…');
  });

  it('stays on the only target when End is pressed, and finds a target by a search that has spaces round it', async () => {
    const { user } = await renderPicker([OPTIONS[2]!]);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{End}');
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id);

    await user.keyboard('  bill  ');
    expect(optionNames()).toEqual(['billing']);
  });

  it('has no group for a kind that has no target', async () => {
    await renderPicker([OPTIONS[2]!]);

    expect(screen.queryByRole('group', { name: 'Exchanges' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Queues' })).toBeInTheDocument();
  });

  it('has the first target as the active one, and says so through the field', async () => {
    await renderPicker();

    const field = screen.getByRole('combobox');
    const [first] = screen.getAllByRole('option');
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(field).toHaveAttribute('aria-activedescendant', first?.id);
    expect(field).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getAllByRole('option').filter((option) => option.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
  });

  it('moves the active one with the arrow keys, round the ends, and with Home and End', async () => {
    const { user } = await renderPicker();
    const active = () => screen.getAllByRole('option').findIndex((o) => o.getAttribute('aria-selected') === 'true');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(1);
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe(0);
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe(3);
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(0);
    await user.keyboard('{End}');
    expect(active()).toBe(3);
    await user.keyboard('{Home}');
    expect(active()).toBe(0);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant', screen.getAllByRole('option')[0]?.id);
  });

  it('chooses the active one with Enter', async () => {
    const { user, chosen } = await renderPicker();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(chosen).toEqual(['q1']);
  });

  it('chooses what is clicked, and does not take the focus from the field, which would give it up', async () => {
    const { user, chosen, cancelled } = await renderPicker();

    const option = screen.getAllByRole('option')[3] as HTMLElement;
    const pressed = fireEvent.mouseDown(option);
    await user.click(option);

    expect(pressed).toBe(false);
    expect(chosen).toEqual(['q2']);
    expect(cancelled).toEqual([]);
  });

  it('narrows the list as the learner types, by name and by kind, whatever the case, and makes the first of what is left the active one', async () => {
    const { user } = await renderPicker();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('ARCH');
    expect(optionNames()).toEqual(['archive']);
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');

    await user.clear(screen.getByRole('combobox'));
    await user.keyboard('queue');
    expect(optionNames()).toEqual(['billing', 'archive']);
  });

  it('chooses the one that is left, with Enter, when the search has narrowed it down', async () => {
    const { user, chosen } = await renderPicker();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('docs{Enter}');

    expect(chosen).toEqual(['x2']);
  });

  it('says that nothing matches when nothing does, and Enter chooses nothing', async () => {
    const { user, chosen } = await renderPicker();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('zzz{Enter}');

    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    expect(screen.getByTestId('picker-nothing')).toHaveTextContent('Nothing matches “zzz”.');
    expect(chosen).toEqual([]);
  });

  it('gives up with Escape, and when the focus leaves it', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const { user, cancelled } = await renderPicker();
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(cancelled).toEqual(['escape']);

    fireEvent.focusOut(screen.getByRole('combobox'), { relatedTarget: outside });
    expect(cancelled).toEqual(['escape', 'blur']);
    outside.remove();
  });

  it('does not give up when the focus stays inside it', async () => {
    const { cancelled } = await renderPicker();

    fireEvent.focusOut(screen.getByRole('combobox'), { relatedTarget: screen.getAllByRole('option')[0] });

    expect(cancelled).toEqual([]);
  });

  it('says why there is nothing to choose, in the words of the rule, and offers no list', async () => {
    const { user, chosen } = await renderPicker(
      [],
      'Add a queue or another exchange first: an exchange is bound to those.',
    );
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());

    expect(screen.getByTestId('picker-reason')).toHaveTextContent(
      'Add a queue or another exchange first: an exchange is bound to those.',
    );
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(chosen).toEqual([]);
  });
});
