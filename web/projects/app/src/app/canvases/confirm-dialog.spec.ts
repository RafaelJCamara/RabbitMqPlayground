import { TestBed } from '@angular/core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasDialogs } from './dialogs';

afterEach(() => {
  document.body.replaceChildren();
});

/** Asks from a button that has the cursor, as the Delete of a card does, and gives the answer once there is one. */
async function ask() {
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  const answer = TestBed.inject(CanvasDialogs).confirm({
    title: 'Delete “Orders”?',
    body: ['It has 12 elements.', 'You can take this back for a short while after.'],
    confirm: 'Delete canvas',
  });
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Orders”?' });
  return { answer, dialog, opener, user: userEvent.setup() };
}

describe('the dialog that asks before a canvas is deleted (ADR-0074)', () => {
  it('is a modal alert dialog named by the question, and described by what it will do', async () => {
    const { dialog } = await ask();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(document.querySelector('.cdk-overlay-backdrop')).toHaveClass('cdk-overlay-dark-backdrop');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Delete “Orders”?' })).toBeVisible();
    expect(dialog).toHaveAccessibleDescription('It has 12 elements. You can take this back for a short while after.');
  });

  it('says what it will do, a paragraph at a time', async () => {
    const { dialog } = await ask();

    expect(within(dialog).getByText('It has 12 elements.')).toBeVisible();
    expect(within(dialog).getByText('You can take this back for a short while after.')).toBeVisible();
  });

  it('has Cancel, and a button named for what it does, which is a danger and is never switched off', async () => {
    const { dialog } = await ask();

    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    const confirm = within(dialog).getByRole('button', { name: 'Delete canvas' });
    expect(confirm).toBeEnabled();
    expect(confirm.className).toContain('bg-danger');
  });

  it('has the cursor in the dialog when it opens, and the initial focus on Cancel, the safe act', async () => {
    const { dialog } = await ask();

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveAttribute('cdkFocusInitial');
  });

  it('answers yes only to the button that does it, and closes', async () => {
    const { answer, dialog, user } = await ask();

    await user.click(within(dialog).getByRole('button', { name: 'Delete canvas' }));

    await expect(answer).resolves.toBe(true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('answers no to Cancel, and gives the cursor back to what had it', async () => {
    const { answer, dialog, opener, user } = await ask();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('answers no to Escape', async () => {
    const { answer, opener } = await ask();

    // The CDK reads the key code of the event, which a browser sets and user-event leaves empty for Escape.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

    await expect(answer).resolves.toBe(false);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('answers no to a press on the backdrop', async () => {
    const { answer, user } = await ask();

    await user.click(document.querySelector('.cdk-overlay-backdrop') as Element);

    await expect(answer).resolves.toBe(false);
  });
});
