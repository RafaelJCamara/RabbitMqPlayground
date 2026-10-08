import { TestBed } from '@angular/core/testing';
import { failure, succeed, type Outcome } from '@rmq/persistence';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackupDone } from './backup-words';
import { CanvasDialogs } from './dialogs';

afterEach(() => {
  document.body.replaceChildren();
});

const done = (change: Partial<BackupDone> = {}): BackupDone => ({
  file: 'rmq-playground-backup-2026-10-08.json',
  count: 5,
  left: 0,
  ...change,
});

/** Asks from a button that has the cursor, as the button of the home does. */
async function ask(
  options: { readable?: number; unreadable?: number; backup?: () => Promise<Outcome<BackupDone, string>> } = {},
) {
  const from = document.createElement('button');
  from.textContent = 'Delete all…';
  document.body.append(from);
  from.focus();
  const backup = vi.fn(options.backup ?? (async () => succeed(done())));
  const readable = options.readable ?? 5;
  const unreadable = options.unreadable ?? 0;
  const answer = TestBed.inject(CanvasDialogs).deleteAll({ readable, unreadable, backup });
  const title = readable + unreadable === 1 ? 'Delete 1 canvas?' : `Delete all ${readable + unreadable} canvases?`;
  const dialog = await screen.findByRole('alertdialog', { name: title });
  return { answer, backup, dialog, from, user: userEvent.setup() };
}

describe('the dialog that asks before every canvas is deleted (ADR-0074)', () => {
  it('is a modal alert dialog named by the question, with how many canvases there are in it', async () => {
    const { dialog } = await ask({ readable: 5, unreadable: 2 });

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Delete all 7 canvases?' })).toBeVisible();
  });

  it('says what it does, with the canvases that cannot be opened, which a backup cannot hold, and what can be done about it', async () => {
    const { dialog } = await ask({ readable: 5, unreadable: 2 });

    expect(dialog).toHaveAccessibleDescription(
      'This deletes every canvas in this browser: 5 that can be opened, and 2 that this version of the app cannot open, which a backup cannot hold. Export a backup first, or take it back with Undo for a short while after.',
    );
  });

  it('says only what it can say when every canvas can be opened', async () => {
    const { dialog } = await ask({ readable: 3, unreadable: 0 });

    expect(dialog).toHaveAccessibleDescription(
      'This deletes every canvas in this browser: 3 that can be opened. Export a backup first, or take it back with Undo for a short while after.',
    );
  });

  it('says "1 canvas" for one, in the question and on the button', async () => {
    const { dialog } = await ask({ readable: 1, unreadable: 0 });

    expect(within(dialog).getByRole('button', { name: 'Delete 1 canvas' })).toBeVisible();
  });

  it('has three buttons, named for what they do, and the danger one says how many', async () => {
    const { dialog } = await ask({ readable: 5, unreadable: 2 });

    expect(within(dialog).getByRole('button', { name: 'Export a backup first' })).toBeEnabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled();
    const danger = within(dialog).getByRole('button', { name: 'Delete all 7 canvases' });
    expect(danger).toBeEnabled();
    expect(danger.className).toContain('bg-danger');
  });

  it('starts with the cursor on Cancel, the safe act', async () => {
    const { dialog } = await ask();

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveAttribute('cdkFocusInitial');
  });

  describe('exporting a backup first', () => {
    it('saves the backup and says what it saved, in a status, and does not close the dialog or delete anything', async () => {
      const { answer, backup, dialog, user } = await ask();

      await user.click(within(dialog).getByRole('button', { name: 'Export a backup first' }));

      expect(backup).toHaveBeenCalledOnce();
      expect(await within(dialog).findByRole('status')).toHaveTextContent(
        'Backed up 5 canvases to rmq-playground-backup-2026-10-08.json. Keep the file somewhere other than this device too: a backup beside the canvases is lost with them.',
      );
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
      let settled = false;
      void answer.then(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(settled).toBe(false);
    });

    it('has the status there from the start, empty, so that what is put in it is said', async () => {
      const { dialog } = await ask();

      expect(within(dialog).getByRole('status')).toHaveTextContent('');
    });

    it('says why it did not work, as an alert, and says nothing of a backup', async () => {
      const { dialog, user } = await ask({
        backup: async () => failure('There is nothing to back up: no canvas here can be opened.'),
      });

      await user.click(within(dialog).getByRole('button', { name: 'Export a backup first' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(
        'There is nothing to back up: no canvas here can be opened.',
      );
      expect(within(dialog).getByRole('status')).toHaveTextContent('');
    });

    it('can be used again, and says what it did each time, and a failure after a success takes the success away', async () => {
      const backup = vi
        .fn<() => Promise<Outcome<BackupDone, string>>>()
        .mockResolvedValueOnce(succeed(done({ file: 'first.json', count: 1 })))
        .mockResolvedValueOnce(failure('It failed.'))
        .mockResolvedValueOnce(succeed(done({ file: 'third.json', count: 2 })));
      const { dialog, user } = await ask({ backup });
      const press = () => user.click(within(dialog).getByRole('button', { name: 'Export a backup first' }));

      await press();
      expect(await within(dialog).findByText(/Backed up 1 canvas to first\.json/)).toBeVisible();
      await press();
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('It failed.');
      expect(within(dialog).getByRole('status')).toHaveTextContent('');
      await press();
      expect(await within(dialog).findByText(/Backed up 2 canvases to third\.json/)).toBeVisible();
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('answering', () => {
    it('answers yes only to the button that deletes, and closes', async () => {
      const { answer, dialog, user } = await ask();

      await user.click(within(dialog).getByRole('button', { name: 'Delete all 5 canvases' }));

      await expect(answer).resolves.toBe(true);
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    it('answers no to Cancel, and gives the cursor back to what had it', async () => {
      const { answer, dialog, from, user } = await ask();

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await expect(answer).resolves.toBe(false);
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(from).toHaveFocus();
    });

    it('answers no to Escape, and after a backup has been saved, which deletes nothing either', async () => {
      const { answer, dialog, user } = await ask();
      await user.click(within(dialog).getByRole('button', { name: 'Export a backup first' }));
      await within(dialog).findByText(/Backed up/);

      fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

      await expect(answer).resolves.toBe(false);
    });
  });
});
