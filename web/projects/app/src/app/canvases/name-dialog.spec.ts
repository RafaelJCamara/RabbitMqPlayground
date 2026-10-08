import { TestBed } from '@angular/core/testing';
import { failure, succeed, type Outcome } from '@rmq/persistence';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasDialogs, type NameDialogData } from './name-dialog';

afterEach(() => {
  document.body.replaceChildren();
});

async function openDialog(submit: NameDialogData['submit'] = async () => succeed(undefined), name = 'Orders') {
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  TestBed.inject(CanvasDialogs).rename({ title: 'Rename canvas', name, confirm: 'Rename', submit });
  const dialog = await screen.findByRole('dialog', { name: 'Rename canvas' });
  return {
    dialog,
    opener,
    user: userEvent.setup(),
    field: within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement,
  };
}

describe('the dialog that asks for a name (ADR-0072)', () => {
  it('is a modal dialog named by its title, with a field called Name that has the name, and the name is selected', async () => {
    const { dialog, field } = await openDialog();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Rename canvas' })).toBeVisible();
    expect(field).toHaveValue('Orders');
    // Where the cursor starts is a matter of layout, which jsdom has none of: a browser test checks that it is in the field.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await waitFor(() => expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Orders'.length]));
  });

  it('has a Cancel and a button that is named for what it does, and that is never switched off', async () => {
    const { dialog, user, field } = await openDialog();
    await user.clear(field);

    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Rename' })).toBeEnabled();
  });

  it('gives the new name, without the white space around it, and closes', async () => {
    const submit = vi.fn(async (): Promise<Outcome<void, string>> => succeed(undefined));
    const { user, field } = await openDialog(submit);

    await user.clear(field);
    await user.type(field, '  Billing  ');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(submit).toHaveBeenCalledExactlyOnceWith('Billing');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('is done by Enter in the field', async () => {
    const submit = vi.fn(async (): Promise<Outcome<void, string>> => succeed(undefined));
    const { user, field } = await openDialog(submit);

    await user.clear(field);
    await user.type(field, 'Billing{Enter}');

    expect(submit).toHaveBeenCalledExactlyOnceWith('Billing');
  });

  it('says why a name that is blank cannot be used, under the field, and puts the cursor back in it, and gives nothing', async () => {
    const submit = vi.fn(async (): Promise<Outcome<void, string>> => succeed(undefined));
    const { dialog, user, field } = await openDialog(submit);

    await user.clear(field);
    await user.type(field, '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    const alert = within(dialog).getByRole('alert');
    expect(alert).toHaveTextContent('A canvas needs a name, and this one is blank. Type a name.');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription('A canvas needs a name, and this one is blank. Type a name.');
    expect(field).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('says why a name that is too long cannot be used', async () => {
    const { dialog, user, field } = await openDialog();

    await user.clear(field);
    await user.click(field);
    await user.paste('x'.repeat(201));
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'The name has 201 characters, and a name can have at most 200. Shorten the name.',
    );
  });

  it('says why when the name is refused by whoever does it, keeps the dialog open, and closes when a name is taken', async () => {
    const submit = vi
      .fn<NameDialogData['submit']>()
      .mockResolvedValueOnce(failure('The browser failed to save the name.'))
      .mockResolvedValueOnce(succeed(undefined));
    const { dialog, user, field } = await openDialog(submit);

    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The browser failed to save the name.');
    expect(field).toHaveFocus();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('clears nothing of what was typed when a name is refused', async () => {
    const { dialog, user, field } = await openDialog();

    await user.clear(field);
    await user.type(field, '   ');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    expect(field).toHaveValue('   ');
  });

  it('closes without giving anything on Cancel, and gives the focus back to what had it', async () => {
    const submit = vi.fn(async (): Promise<Outcome<void, string>> => succeed(undefined));
    const { dialog, opener, user } = await openDialog(submit);

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });

  it('closes without giving anything on Escape, and gives the focus back to what had it', async () => {
    const submit = vi.fn(async (): Promise<Outcome<void, string>> => succeed(undefined));
    const { opener } = await openDialog(submit);

    // The CDK reads the key code of the event, which a browser sets and user-event leaves empty for Escape.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
    expect(submit).not.toHaveBeenCalled();
  });
});
