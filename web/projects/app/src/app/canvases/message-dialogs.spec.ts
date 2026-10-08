import { TestBed } from '@angular/core/testing';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { PROBLEMS_SHOWN } from './backup-words';
import { CanvasDialogs } from './dialogs';

afterEach(() => {
  document.body.replaceChildren();
});

function opener() {
  const button = document.createElement('button');
  button.textContent = 'Opener';
  document.body.append(button);
  button.focus();
  return button;
}

describe('the dialog that says why a file could not be opened (ADR-0075)', () => {
  async function say() {
    const from = opener();
    const done = TestBed.inject(CanvasDialogs).problem({
      title: '“orders.json” could not be opened',
      body: [
        'This is not JSON, so it cannot be a canvas: Unexpected token.',
        'Nothing was loaded and nothing was changed.',
      ],
    });
    const dialog = await screen.findByRole('alertdialog', { name: '“orders.json” could not be opened' });
    return { dialog, done, from, user: userEvent.setup() };
  }

  it('is a modal alert dialog named by what happened, described by why', async () => {
    const { dialog } = await say();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: '“orders.json” could not be opened' })).toBeVisible();
    expect(dialog).toHaveAccessibleDescription(
      'This is not JSON, so it cannot be a canvas: Unexpected token. Nothing was loaded and nothing was changed.',
    );
  });

  it('has one button, OK, where the cursor starts', async () => {
    const { dialog } = await say();

    expect(within(dialog).getAllByRole('button')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'OK' })).toHaveAttribute('cdkFocusInitial');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('closes on OK, gives the cursor back, and the promise is kept', async () => {
    const { dialog, done, from, user } = await say();

    await user.click(within(dialog).getByRole('button', { name: 'OK' }));

    await expect(done).resolves.toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(from).toHaveFocus();
  });

  it('closes on Escape too', async () => {
    const { done } = await say();

    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

    await expect(done).resolves.toBeUndefined();
  });
});

describe('the report of a backup that was put back (ADR-0075)', () => {
  const view = (change: Partial<{ summary: string[]; problems: string[]; more: number }> = {}) => ({
    summary: ['Put back 2 canvases.', '1 canvas was already here, and was left as it is.'],
    problems: [],
    more: 0,
    ...change,
  });

  async function report(data: ReturnType<typeof view>, title = 'Backup restored') {
    const from = opener();
    const done = TestBed.inject(CanvasDialogs).restored({ title, view: data });
    const dialog = await screen.findByRole('dialog', { name: title });
    return { dialog, done, from, user: userEvent.setup() };
  }

  it('is a modal dialog named by what came of it, with a paragraph for each thing that was done', async () => {
    const { dialog } = await report(view());

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Backup restored' })).toBeVisible();
    expect(
      within(dialog)
        .getAllByTestId('restore-summary')
        .map((line) => line.textContent),
    ).toEqual(['Put back 2 canvases.', '1 canvas was already here, and was left as it is.']);
  });

  it('has no list of problems when there were none', async () => {
    const { dialog } = await report(view());

    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
  });

  it('lists what could not be put back under a heading, and counts the rest', async () => {
    const problems = ['Canvas 3 “Broken” could not be read. Newer.', '“Orders” could not be put back. Failed.'];
    const { dialog } = await report(view({ problems, more: 3 }));

    expect(within(dialog).getByRole('heading', { level: 3, name: 'What could not be put back' })).toBeVisible();
    expect(within(dialog).getByRole('region', { name: 'What could not be put back' })).toBeVisible();
    const list = within(dialog).getByRole('list');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(problems);
    expect(within(dialog).getByTestId('restore-more')).toHaveTextContent('and 3 more.');
  });

  it('says nothing of more when there are no more', async () => {
    const { dialog } = await report(view({ problems: ['One.'], more: 0 }));

    expect(within(dialog).queryByTestId('restore-more')).not.toBeInTheDocument();
  });

  it('draws at most as many problems as it is given, which is 20', async () => {
    const problems = Array.from({ length: PROBLEMS_SHOWN }, (_, index) => `Problem ${index + 1}.`);
    const { dialog } = await report(view({ problems, more: 4 }));

    expect(within(dialog).getAllByRole('listitem')).toHaveLength(PROBLEMS_SHOWN);
  });

  it('scrolls inside itself when it is taller than the window, and closes on OK', async () => {
    const { dialog, done, from, user } = await report(view());
    expect(dialog.querySelector('[data-testid="restore-dialog"]')?.className).toContain('overflow-y-auto');

    await user.click(within(dialog).getByRole('button', { name: 'OK' }));

    await expect(done).resolves.toBeUndefined();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(from).toHaveFocus();
  });
});
