import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { transientQueueReply } from '@rmq/engine';
import type { Issue } from '@rmq/domain';
import { describe, expect, it } from 'vitest';
import { BindingKey } from './binding-key';

const topic = {
  title: 'Binding key from exchange orders to queue billing',
  help: 'A topic key is words separated by dots. * matches one word and # matches zero or more words.',
};

async function renderPopover(error: Issue | null = null) {
  const confirmed: string[] = [];
  const cancelled: string[] = [];
  const view = await render(BindingKey, {
    inputs: { title: topic.title, help: topic.help, position: { x: 120, y: 80 }, error },
    on: { confirm: (key: string) => confirmed.push(key), cancelled: (how: string) => cancelled.push(how) },
  });
  return { ...view, confirmed, cancelled, user: userEvent.setup() };
}

describe('BindingKey (ADR-0041)', () => {
  it('is a group that says what it is for, with a labelled field and a sentence for the type of the exchange', async () => {
    await renderPopover();

    expect(screen.getByRole('group', { name: topic.title })).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Binding key' });
    expect(field).toHaveAccessibleDescription(topic.help);
    expect(screen.getByText(topic.help)).toBeVisible();
  });

  it('has the cursor in the field when it opens, which is empty', async () => {
    await renderPopover();

    const field = screen.getByRole('textbox', { name: 'Binding key' });
    await waitFor(() => expect(field).toHaveFocus());
    expect(field).toHaveValue('');
  });

  it('is where it is told to be, on the host of the canvas', async () => {
    await renderPopover();

    const popover = screen.getByRole('group', { name: topic.title });
    expect(popover.style.left).toBe('120px');
    expect(popover.style.top).toBe('80px');
  });

  it('gives the key with Enter, as it was typed', async () => {
    const { user, confirmed } = await renderPopover();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Binding key' })).toHaveFocus());

    await user.keyboard('order.*{Enter}');

    expect(confirmed).toEqual(['order.*']);
  });

  it('gives an empty key with Enter on an empty field, which is a key', async () => {
    const { user, confirmed } = await renderPopover();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Binding key' })).toHaveFocus());

    await user.keyboard('{Enter}');

    expect(confirmed).toEqual(['']);
  });

  it('gives the key with the button as well, for a learner who has no Enter key to press', async () => {
    const { user, confirmed } = await renderPopover();

    await user.type(screen.getByRole('textbox', { name: 'Binding key' }), 'invoice.#');
    await user.click(screen.getByRole('button', { name: 'Bind' }));

    expect(confirmed).toEqual(['invoice.#']);
  });

  it('gives up with Escape, and says so', async () => {
    const { user, cancelled, confirmed } = await renderPopover();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Binding key' })).toHaveFocus());

    await user.keyboard('abc{Escape}');

    expect(cancelled).toEqual(['escape']);
    expect(confirmed).toEqual([]);
  });

  it('gives up with the button', async () => {
    const { user, cancelled } = await renderPopover();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(cancelled).toEqual(['button']);
  });

  it('gives up when the focus leaves it, because to bind when the learner clicks elsewhere would make a binding that was not asked for', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const { cancelled } = await renderPopover();
    const field = screen.getByRole('textbox', { name: 'Binding key' });

    fireEvent.focusOut(field, { relatedTarget: outside });

    expect(cancelled).toEqual(['blur']);
    outside.remove();
  });

  it('gives up when the focus leaves for nowhere, which is what a click on the empty canvas does', async () => {
    const { cancelled } = await renderPopover();

    fireEvent.focusOut(screen.getByRole('textbox', { name: 'Binding key' }), { relatedTarget: null });

    expect(cancelled).toEqual(['blur']);
  });

  it('does not give up when the focus goes from the field to its own buttons', async () => {
    const { cancelled } = await renderPopover();

    fireEvent.focusOut(screen.getByRole('textbox', { name: 'Binding key' }), {
      relatedTarget: screen.getByRole('button', { name: 'Bind' }),
    });

    expect(cancelled).toEqual([]);
  });

  it('shows why a key was refused under the field, the root cause first and what the broker answers after it', async () => {
    const issue: Issue = {
      kind: 'topic-wildcards',
      message: 'A topic key may have at most two # words.',
      refusal: { code: 406, text: transientQueueReply().text },
    };
    await renderPopover(issue);

    const field = screen.getByRole('textbox', { name: 'Binding key' });
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(expect.stringContaining('A topic key may have at most two # words.'));
    const message = screen.getByTestId('refusal-message');
    const reply = screen.getByTestId('refusal-reply');
    expect(message.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is not invalid until a key is refused', async () => {
    await renderPopover();

    expect(screen.getByRole('textbox', { name: 'Binding key' })).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
  });
});
