import { TestBed } from '@angular/core/testing';
import { COMMAND_DOCS, SPECS } from '@rmq/domain';
import { fireEvent, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { firstSentence } from '../command-bar/help';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { CheatSheetService, commandRows, keyRows } from './cheat-sheet';
import { SHORTCUTS } from './keyboard';
import { WAYS_TO_LINK } from '../core/ui/ways-to-link';

afterEach(() => {
  document.body.replaceChildren();
});

/** Opens the sheet from a button that has the cursor, as the key or the Help button does. */
async function openSheet(flags: string | null = null) {
  const opener = document.createElement('button');
  opener.textContent = 'Opener';
  document.body.append(opener);
  opener.focus();
  TestBed.configureTestingModule({
    providers: [CheatSheetService, { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } }],
  });
  const service = TestBed.inject(CheatSheetService);
  service.open();
  const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts and commands' });
  return { opener, service, dialog, user: userEvent.setup() };
}

describe('keyRows (ADR-0047)', () => {
  it('has a row for every row of the table of shortcuts, in its order, whether or not the hint bar shows it', () => {
    expect(keyRows(false, ['simulation', 'explain']).map((row) => row.id)).toEqual(SHORTCUTS.map((row) => row.id));
  });

  it('leaves out the keys that are for a feature flag that is off, which are the page\u2019s, and says them when it is on', () => {
    const without = keyRows(false).map((row) => row.id);
    const withFlag = keyRows(false, ['simulation']).map((row) => row.id);

    expect(without).not.toContain('play');
    expect(without).not.toContain('step');
    expect(without).not.toContain('publish');
    expect(withFlag).toEqual(expect.arrayContaining(['play', 'step', 'publish']));
    expect(without).not.toContain('event-log');
  });

  it('says the key of the event log only when both of its flags are on, since the explanation alone has no events to log', () => {
    const rows = (enabled: Parameters<typeof keyRows>[1]) => keyRows(false, enabled).map((row) => row.id);

    expect(rows(['explain'])).not.toContain('event-log');
    expect(rows(['simulation'])).not.toContain('event-log');
    expect(rows(['simulation', 'explain'])).toContain('event-log');
    // Nothing else of the table is for the explanation alone, so it adds no row to what a page without flags says.
    expect(rows(['explain'])).toEqual(rows([]));
  });

  it('writes Space as a word, and the other keys of the simulation as they are', () => {
    const rows = Object.fromEntries(keyRows(false, ['simulation']).map((row) => [row.id, row.keys]));

    expect(rows['play']).toBe('Space');
    expect(rows['step']).toBe('.');
    expect(rows['publish']).toBe('P');
  });

  it('writes the key of the event log as the letter that it is', () => {
    const rows = Object.fromEntries(keyRows(false, ['simulation', 'explain']).map((row) => [row.id, row.keys]));

    expect(rows['event-log']).toBe('E');
  });

  it('writes the keys of a row as the table does: the words that it has, or its chords with "or" between them', () => {
    const rows = Object.fromEntries(keyRows(false).map((row) => [row.id, row.keys]));

    expect(rows['navigate']).toBe('Arrow keys');
    expect(rows['redo']).toBe('Ctrl+Shift+Z or Ctrl+Y');
    expect(rows['fit']).toBe('F');
    expect(rows['commands']).toBe('/');
    expect(rows['commands-anywhere']).toBe('Ctrl+K');
    expect(rows['shortcuts']).toBe('?');
  });

  it('writes the modifier that the platform has', () => {
    expect(keyRows(true).find((row) => row.id === 'undo')?.keys).toBe('Cmd+Z');
    expect(keyRows(false).find((row) => row.id === 'undo')?.keys).toBe('Ctrl+Z');
  });

  it('says where each works: on the canvas, or anywhere in the editor, and in a field of text when it does', () => {
    const where = Object.fromEntries(keyRows(false).map((row) => [row.id, row.where]));

    expect(where['fit']).toBe('On the canvas');
    expect(where['undo']).toBe('Anywhere in the editor');
    expect(where['commands-anywhere']).toBe('Anywhere in the editor, even in a field of text');
  });

  it('says what each does, in the words of the table', () => {
    expect(keyRows(false, ['simulation', 'explain']).map((row) => row.label)).toEqual(
      SHORTCUTS.map((row) => row.label),
    );
  });
});

describe('commandRows (ADR-0047)', () => {
  it('has a row for every command of the registry and for the batch, with how it is written and its first sentence', () => {
    const rows = commandRows();

    expect(rows.map((row) => row.syntax)).toEqual(COMMAND_DOCS.map((doc) => doc.syntax));
    expect(rows.map((row) => row.summary)).toEqual(COMMAND_DOCS.map((doc) => firstSentence(doc.summary)));
    for (const { name } of SPECS) {
      expect(
        rows.some((row) => row.name === name),
        name,
      ).toBe(true);
    }
  });
});

describe('WAYS_TO_LINK (ADR-0041, ADR-0047)', () => {
  it('has five ways, each a sentence for the cheat-sheet and a few words for the card, which says the same in less', () => {
    expect(WAYS_TO_LINK).toHaveLength(5);
    for (const { short, full } of WAYS_TO_LINK) {
      expect(full.endsWith('.'), full).toBe(true);
      expect(short.length, short).toBeLessThan(full.length);
    }
  });

  it('says the same ways, in the same order, in both lengths', () => {
    expect(WAYS_TO_LINK.map((way) => way.short.split(' ')[0])).toEqual([
      'Drag',
      'Click',
      'Press',
      'Right-click',
      'Select',
    ]);
    expect(new Set(WAYS_TO_LINK.map((way) => way.short)).size).toBe(5);
  });
});

describe('the cheat-sheet (ADR-0047)', () => {
  it('is a modal dialog with a name, which is its heading', async () => {
    const { dialog } = await openSheet();

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Keyboard shortcuts and commands' })).toBeVisible();
  });

  it('has a region for each of its three parts, which its heading names, and a scroll that a keyboard can reach', async () => {
    const { dialog } = await openSheet();

    for (const name of ['Five ways to link', 'Keys', 'Commands']) {
      expect(within(dialog).getByRole('region', { name })).toBeInTheDocument();
    }
    expect(dialog.querySelector('.overflow-y-auto')).toHaveAttribute('tabindex', '0');
  });

  it('lists the five ways to link, as one ordered list, and says what the command bar does', async () => {
    const { dialog } = await openSheet();

    const ways = within(within(dialog).getByRole('list', { name: 'Five ways to link' })).getAllByRole('listitem');

    expect(ways.map((way) => way.textContent?.trim())).toEqual(WAYS_TO_LINK.map((way) => way.full));
    expect(within(dialog).getByText(/The command bar does the same with a line, for example/)).toBeVisible();
  });

  it('has every key of the table, with what it does and where it works, as a table that has a name', async () => {
    const { dialog } = await openSheet();

    const table = within(dialog).getByRole('table', { name: 'Keys' });
    const rows = within(table).getAllByRole('row');

    // The keys that are for a feature flag that is off are not the sheet's to say.
    expect(rows).toHaveLength(keyRows().length + 1);
    expect(keyRows().length).toBeLessThan(SHORTCUTS.length);
    expect(
      within(rows[0]!)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent?.trim()),
    ).toEqual(['Keys', 'What it does', 'Where']);
    const expected = keyRows();
    for (const [index, row] of expected.entries()) {
      const cells = within(rows[index + 1]!).getAllByRole('cell');
      expect(cells.map((cell) => cell.textContent?.trim().replace(/\s+/g, ' '))).toEqual([
        row.keys,
        row.label,
        row.where,
      ]);
    }
  });

  it('says the keys of the simulation and of the explanation when their flags are on', async () => {
    const { dialog } = await openSheet('simulation,explain');

    const table = within(dialog).getByRole('table', { name: 'Keys' });

    expect(within(table).getAllByRole('row')).toHaveLength(SHORTCUTS.length + 1);
    expect(within(table).getByText('Play or pause the simulation')).toBeVisible();
    expect(within(table).getByText('Space')).toBeVisible();
    expect(within(table).getByText('Show or hide the event log')).toBeVisible();
  });

  it('has every command of the registry with how it is written and its first sentence, and says that help says more', async () => {
    const { dialog } = await openSheet();

    const table = within(dialog).getByRole('table', { name: 'Commands' });
    const rows = within(table).getAllByRole('row');

    expect(rows).toHaveLength(COMMAND_DOCS.length + 1);
    const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();
    for (const doc of COMMAND_DOCS) {
      expect(
        within(table).getByText(
          (_, element) => element?.tagName === 'CODE' && squash(element.textContent) === squash(doc.syntax),
        ),
        doc.name,
      ).toBeVisible();
    }
    expect(
      within(dialog).getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          squash(element.textContent) === 'Type help in the command bar to say more about a command.',
      ),
    ).toBeVisible();
  });

  it('closes with its button, and gives the cursor back to what had it', async () => {
    const { dialog, opener, user } = await openSheet();

    await user.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('closes with Escape, and gives the cursor back to what had it', async () => {
    const { opener } = await openSheet();

    // The CDK reads the key code of the event, which a browser sets and user-event leaves empty for Escape.
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape', code: 'Escape', keyCode: 27 });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it('has the cursor in it when it opens, so that a keyboard works at once', async () => {
    const { dialog } = await openSheet();

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('is not opened a second time while it is open', async () => {
    const { service } = await openSheet();

    service.open();
    service.open();
    await new Promise((resolve) => setTimeout(resolve, 50));

    // The CDK takes a dialog that a modal one covers out of the accessibility tree, so the dialogs are counted as the page has them.
    expect(document.querySelectorAll('.cdk-dialog-container')).toHaveLength(1);
  });

  it('can be opened again once it was closed', async () => {
    const { dialog, service, user } = await openSheet();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    service.open();

    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts and commands' })).toBeVisible();
  });
});
