import { Component, computed, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { reportDraft, reportMessageRows, type DraftRow, type RowReport } from '@rmq/domain';
import type { XMatch } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import { Announcer } from '../announcer';
import { HeaderRows } from './header-rows';

const row = (key: string, text: string, rest: Partial<DraftRow> = {}): DraftRow => ({
  key,
  text,
  exists: false,
  ...rest,
});

/** What owns the rows in the editor: it holds them, reads them with the domain, and hands both back. */
@Component({
  selector: 'rmq-rows-host',
  imports: [HeaderRows],
  template: `
    <rmq-header-rows
      [rows]="rows()"
      [reports]="reports()"
      [allowExists]="conditions"
      [noun]="conditions ? 'condition' : 'header'"
      [label]="conditions ? 'Conditions' : 'Headers'"
      (rowsChange)="rows.set($event)"
      (commit)="commits.push(rows())"
    />
  `,
})
class Host {
  conditions = true;
  xMatch: XMatch | null = 'all';
  readonly rows = signal<readonly DraftRow[]>([]);
  readonly commits: (readonly DraftRow[])[] = [];
  readonly view = viewChild.required(HeaderRows);
  readonly reports = computed<readonly RowReport[]>(() =>
    this.conditions
      ? reportDraft({ xMatch: this.xMatch, rows: this.rows() }).rows
      : reportMessageRows(this.rows()).rows,
  );
}

async function renderRows(rows: readonly DraftRow[], options: { conditions?: boolean; xMatch?: XMatch | null } = {}) {
  const view = await render(Host, {
    componentProperties: {
      conditions: options.conditions ?? true,
      xMatch: options.xMatch === undefined ? 'all' : options.xMatch,
    },
  });
  view.fixture.componentInstance.rows.set(rows);
  view.fixture.detectChanges();
  await view.fixture.whenStable();
  return {
    ...view,
    host: view.fixture.componentInstance,
    user: userEvent.setup(),
    announced: () => TestBed.inject(Announcer).last(),
  };
}

const rowGroup = (index: number) => screen.getAllByTestId('header-row')[index] as HTMLElement;

describe('HeaderRows (ADR-0066, ADR-0067, ADR-0068)', () => {
  describe('what it draws', () => {
    it('is a list under a name, and a group for each row that says which row it is', async () => {
      await renderRows([row('format', 'pdf'), row('n', '1')]);

      expect(screen.getByRole('list', { name: 'Conditions' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'condition 1 of 2' })).toBeInTheDocument();
      expect(screen.getByRole('group', { name: 'condition 2 of 2' })).toBeInTheDocument();
    });

    it('has a name, a type and a value for a row, each with a label that says whose it is', async () => {
      await renderRows([row('format', 'pdf'), row('n', '1')]);

      expect(screen.getByRole('textbox', { name: 'Name of condition 1' })).toHaveValue('format');
      expect(screen.getByRole('textbox', { name: 'Value of condition 1' })).toHaveValue('pdf');
      expect(screen.getByRole('combobox', { name: 'Type of condition 1' })).toHaveValue('string');
      expect(screen.getByRole('textbox', { name: 'Name of condition 2' })).toHaveValue('n');
      expect(screen.getByRole('textbox', { name: 'Value of condition 2' })).toHaveValue('1');
      expect(screen.getByRole('combobox', { name: 'Type of condition 2' })).toHaveValue('integer');
    });

    it('shows the type of what is typed, and tells 1, 1.0, "1" and true apart', async () => {
      await renderRows([row('a', '1'), row('b', '1.0'), row('c', '"1"'), row('d', 'true'), row('e', 'pdf')]);

      const types = screen.getAllByRole('combobox').map((select) => (select as HTMLSelectElement).value);
      expect(types).toEqual(['integer', 'float', 'string', 'boolean', 'string']);
    });

    it('offers exists as a fifth type for the conditions of a binding, and not for the headers of a message', async () => {
      await renderRows([row('a', '1')]);
      const withExists = within(screen.getByRole('combobox', { name: 'Type of condition 1' }))
        .getAllByRole('option')
        .map((option) => option.textContent?.trim());

      expect(withExists).toEqual(['string', 'integer', 'float', 'boolean', 'exists']);
    });

    it('offers the four types of a value for a message', async () => {
      await renderRows([row('a', '1')], { conditions: false });
      const options = within(screen.getByRole('combobox', { name: 'Type of header 1' }))
        .getAllByRole('option')
        .map((option) => option.textContent?.trim());

      expect(options).toEqual(['string', 'integer', 'float', 'boolean']);
      expect(screen.getByRole('list', { name: 'Headers' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add header' })).toBeInTheDocument();
    });

    it('shows an exists row with no value field, and says that the header only has to be there', async () => {
      await renderRows([row('seen', '', { exists: true })]);

      expect(screen.queryByRole('textbox', { name: 'Value of condition 1' })).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Type of condition 1' })).toHaveValue('exists');
      expect(screen.getByTestId('header-exists')).toHaveTextContent('Only has to be there, with any value.');
    });

    it('gives an empty value an example of the type that was chosen for it', async () => {
      await renderRows([
        row('a', '', { type: 'integer' }),
        row('b', '', { type: 'float' }),
        row('c', '', { type: 'boolean' }),
        row('d', ''),
      ]);

      expect(screen.getAllByTestId('header-value').map((field) => field.getAttribute('placeholder'))).toEqual([
        '7',
        '1.5',
        'true',
        'pdf',
      ]);
      expect(screen.getAllByRole('combobox').map((select) => (select as HTMLSelectElement).value)).toEqual([
        'integer',
        'float',
        'boolean',
        'string',
      ]);
    });

    it('shows nothing but the button to add one for no rows', async () => {
      await renderRows([]);

      expect(screen.queryAllByTestId('header-row')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Add condition' })).toBeInTheDocument();
    });
  });

  describe('what is wrong with a row', () => {
    it('marks the name that has a problem and says it under the row, with the control described by it', async () => {
      await renderRows([row('', '1')]);

      const name = screen.getByRole('textbox', { name: 'Name of condition 1' });
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(name).toHaveAccessibleDescription('A header needs a name.');
      expect(screen.getByTestId('header-key-problem')).toHaveTextContent('A header needs a name.');
      expect(screen.getByRole('textbox', { name: 'Value of condition 1' })).not.toHaveAttribute('aria-invalid');
    });

    it('marks the value that has a problem and says it under the row', async () => {
      await renderRows([row('n', '9007199254740993')]);

      const value = screen.getByRole('textbox', { name: 'Value of condition 1' });
      expect(value).toHaveAttribute('aria-invalid', 'true');
      expect(value).toHaveAccessibleDescription(/^The header 'n': An integer header must be a whole number/u);
      expect(screen.getByRole('textbox', { name: 'Name of condition 1' })).not.toHaveAttribute('aria-invalid');
    });

    it('marks both rows that have a name twice', async () => {
      await renderRows([row('format', 'pdf'), row('n', '1'), row('format', 'doc')]);

      const marked = screen
        .getAllByRole('textbox', { name: /^Name of/u })
        .map((field) => field.getAttribute('aria-invalid'));
      expect(marked).toEqual(['true', null, 'true']);
      expect(screen.getAllByTestId('header-key-problem')).toHaveLength(2);
    });

    it('has no mark and no sentence for a row that is fine, and none for an empty row', async () => {
      await renderRows([row('format', 'pdf'), row('', '')]);

      expect(screen.queryByTestId('header-key-problem')).not.toBeInTheDocument();
      expect(screen.queryByTestId('header-value-problem')).not.toBeInTheDocument();
      for (const field of screen.getAllByRole('textbox')) {
        expect(field).not.toHaveAttribute('aria-invalid');
      }
    });

    it('says a note about the name, which does not mark it, and describes the name by it', async () => {
      await renderRows([row('x-trace', '1')], { xMatch: 'all' });

      const name = screen.getByRole('textbox', { name: 'Name of condition 1' });
      expect(name).not.toHaveAttribute('aria-invalid');
      expect(name).toHaveAccessibleDescription(/The header x-trace is not counted/u);
      expect(screen.getByTestId('header-notes')).toHaveTextContent(
        'is ignored unless x-match is all-with-x or any-with-x',
      );
    });

    it('describes the name by its problem and its note, both', async () => {
      await renderRows([row('x-a', '1'), row('x-a', '2')]);

      const name = screen.getAllByRole('textbox', { name: /^Name of/u })[0] as HTMLElement;
      expect(name).toHaveAccessibleDescription(/is there twice.*is not counted/u);
    });
  });

  describe('what the learner types', () => {
    it('gives the rows back with the name that was typed', async () => {
      const { user, host } = await renderRows([row('', '')]);

      await user.type(screen.getByRole('textbox', { name: 'Name of condition 1' }), 'format');

      expect(host.rows()).toEqual([row('format', '')]);
    });

    it('gives the rows back with the value that was typed, and without the preference of a type', async () => {
      const { user, host } = await renderRows([row('n', '', { type: 'integer' })]);

      await user.type(screen.getByRole('textbox', { name: 'Value of condition 1' }), '7');

      expect(host.rows()).toStrictEqual([row('n', '7')]);
      expect(screen.getByRole('combobox', { name: 'Type of condition 1' })).toHaveValue('integer');
    });

    it('changes only the row that was typed in', async () => {
      const { user, host } = await renderRows([row('a', '1'), row('b', '2'), row('c', '3')]);

      await user.type(screen.getByRole('textbox', { name: 'Value of condition 2' }), '0');

      expect(host.rows().map(({ text }) => text)).toEqual(['1', '20', '3']);
    });

    it('says that a control was left, for an owner that commits as it goes, and not for each key', async () => {
      const { user, host } = await renderRows([row('a', '1')]);
      const value = screen.getByRole('textbox', { name: 'Value of condition 1' });

      await user.type(value, '2');
      expect(host.commits).toHaveLength(0);
      await user.tab();

      expect(host.commits).toHaveLength(1);
      expect(host.commits[0]).toEqual([row('a', '12')]);
    });

    it('says it of the name too', async () => {
      const { user, host } = await renderRows([row('a', '1')]);

      await user.type(screen.getByRole('textbox', { name: 'Name of condition 1' }), 'b');
      await user.tab();

      expect(host.commits).toHaveLength(1);
    });
  });

  describe('choosing a type (ADR-0067)', () => {
    it('rewrites the text so that it says the type, and says so aloud', async () => {
      const { user, host, announced } = await renderRows([row('n', '1')]);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Type of condition 1' }), 'string');

      expect(host.rows()).toStrictEqual([row('n', '"1"')]);
      expect(screen.getByRole('textbox', { name: 'Value of condition 1' })).toHaveValue('"1"');
      expect(announced()).toBe('Condition 1 is now a string: "1".');
      expect(host.commits).toHaveLength(1);
    });

    it('turns a string into an integer and a float, and names the type with its article', async () => {
      const { user, announced } = await renderRows([row('n', '"7"')]);
      const select = screen.getByRole('combobox', { name: 'Type of condition 1' });

      await user.selectOptions(select, 'integer');
      expect(screen.getByRole('textbox', { name: 'Value of condition 1' })).toHaveValue('7');
      expect(announced()).toBe('Condition 1 is now an integer: 7.');

      await user.selectOptions(select, 'float');
      expect(screen.getByRole('textbox', { name: 'Value of condition 1' })).toHaveValue('7.0');
      expect(announced()).toBe('Condition 1 is now a float: 7.0.');
    });

    it('refuses a change that has no meaning, with the cause under the row, and the select goes back', async () => {
      const { user, host, announced } = await renderRows([row('n', 'pdf')]);
      const select = screen.getByRole('combobox', { name: 'Type of condition 1' });

      await user.selectOptions(select, 'integer');

      expect(select).toHaveValue('string');
      expect(host.rows()).toStrictEqual([row('n', 'pdf')]);
      expect(screen.getByTestId('header-type-problem')).toHaveTextContent(
        '"pdf" is not a whole number, so it cannot be an integer',
      );
      expect(select).toHaveAttribute('aria-invalid', 'true');
      expect(select).toHaveAccessibleDescription(/is not a whole number/u);
      expect(announced()).toMatch(/is not a whole number/u);
      expect(host.commits).toHaveLength(0);
    });

    it('forgets the refusal when the row is changed', async () => {
      const { user } = await renderRows([row('n', 'pdf')]);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Type of condition 1' }), 'integer');
      expect(screen.getByTestId('header-type-problem')).toBeInTheDocument();
      await user.type(screen.getByRole('textbox', { name: 'Value of condition 1' }), 'x');

      expect(screen.queryByTestId('header-type-problem')).not.toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Type of condition 1' })).not.toHaveAttribute('aria-invalid');
    });

    it('keeps a preference for an empty value and says that it has no value yet', async () => {
      const { user, host, announced } = await renderRows([row('n', '')]);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Type of condition 1' }), 'boolean');

      expect(host.rows()).toStrictEqual([row('n', '', { type: 'boolean' })]);
      expect(screen.getByRole('combobox', { name: 'Type of condition 1' })).toHaveValue('boolean');
      expect(announced()).toBe('Condition 1 is now a boolean, and has no value yet.');
      expect(screen.getByTestId('header-value-problem')).toHaveTextContent('A header needs a value: true or false.');
    });

    it('takes the value away for exists, and gives it back when a type is chosen again', async () => {
      const { user, host, announced } = await renderRows([row('seen', '"1"')]);
      const select = screen.getByRole('combobox', { name: 'Type of condition 1' });

      await user.selectOptions(select, 'exists');
      expect(host.rows()).toStrictEqual([row('seen', '"1"', { exists: true })]);
      expect(screen.queryByRole('textbox', { name: 'Value of condition 1' })).not.toBeInTheDocument();
      expect(announced()).toBe('Condition 1 now only has to be there.');

      await user.selectOptions(select, 'string');
      expect(screen.getByRole('textbox', { name: 'Value of condition 1' })).toHaveValue('"1"');
    });

    it('says the name of the row in what it announces, counting from one', async () => {
      const { user, announced } = await renderRows([row('a', '1'), row('b', '2')], { conditions: false });

      await user.selectOptions(screen.getByRole('combobox', { name: 'Type of header 2' }), 'string');

      expect(announced()).toBe('Header 2 is now a string: "2".');
    });
  });

  describe('adding and removing', () => {
    it('adds an empty row at the end, puts the cursor in its name, and says so', async () => {
      const { user, host, announced } = await renderRows([row('a', '1')]);

      await user.click(screen.getByRole('button', { name: 'Add condition' }));

      expect(host.rows()).toEqual([row('a', '1'), row('', '')]);
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name of condition 2' })).toHaveFocus());
      expect(announced()).toBe('Condition 2 added.');
    });

    it('takes a row off, says which, and puts the cursor in the name of the row that took its place', async () => {
      const { user, host, announced } = await renderRows([row('a', '1'), row('b', '2'), row('c', '3')]);

      await user.click(screen.getByRole('button', { name: 'Remove condition 2, b' }));

      expect(host.rows().map(({ key }) => key)).toEqual(['a', 'c']);
      expect(announced()).toBe('Removed condition 2, b.');
      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name of condition 2' })).toHaveFocus());
      expect(host.commits).toHaveLength(1);
    });

    it('puts the cursor in the row before when the last one is taken off', async () => {
      await renderRows([row('a', '1'), row('b', '2')]);
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Remove condition 2, b' }));

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name of condition 1' })).toHaveFocus());
    });

    it('puts the cursor on the button to add one when the only row is taken off, and names a row that has no name by its number', async () => {
      const { user, announced } = await renderRows([row('', '1')]);

      await user.click(screen.getByRole('button', { name: 'Remove condition 1' }));

      expect(screen.queryAllByTestId('header-row')).toHaveLength(0);
      expect(screen.getByRole('button', { name: 'Add condition' })).toHaveFocus();
      expect(announced()).toBe('Removed condition 1.');
    });
  });

  describe('the cursor, for the owner', () => {
    it('puts it in the name or in the value of a row', async () => {
      const { host } = await renderRows([row('a', '1'), row('b', '2')]);

      host.view().focus(1, 'value');
      expect(screen.getByRole('textbox', { name: 'Value of condition 2' })).toHaveFocus();

      host.view().focus(0, 'key');
      expect(screen.getByRole('textbox', { name: 'Name of condition 1' })).toHaveFocus();
    });

    it('puts it in the name of a row that has no value field', async () => {
      const { host } = await renderRows([row('seen', '', { exists: true })]);

      host.view().focus(0, 'value');

      expect(screen.getByRole('textbox', { name: 'Name of condition 1' })).toHaveFocus();
    });

    it('waits for a row that is not drawn yet', async () => {
      const { host, fixture } = await renderRows([row('a', '1')]);

      host.view().focus(1, 'key');
      host.rows.set([row('a', '1'), row('', '')]);
      fixture.detectChanges();

      await waitFor(() => expect(screen.getByRole('textbox', { name: 'Name of condition 2' })).toHaveFocus());
    });
  });

  it('keeps the select where the owner says when it refuses, even if the browser changed it', async () => {
    await renderRows([row('n', 'pdf')]);
    const select = screen.getByRole('combobox', { name: 'Type of condition 1' }) as HTMLSelectElement;

    select.value = 'float';
    fireEvent.change(select);

    expect(select.value).toBe('string');
  });

  it('is described by an id of its own for each row, so that two lists on a page are not tied to one another', async () => {
    await render(
      `<rmq-header-rows [rows]="rows" [reports]="reports" label="One" /><rmq-header-rows [rows]="rows" [reports]="reports" label="Two" />`,
      {
        imports: [HeaderRows],
        componentProperties: {
          rows: [row('', '1')],
          reports: reportDraft({ xMatch: 'all', rows: [row('', '1')] }).rows,
        },
      },
    );

    const ids = screen.getAllByTestId('header-key').map((field) => field.getAttribute('id'));
    expect(new Set(ids).size).toBe(2);
    const described = screen.getAllByTestId('header-key').map((field) => field.getAttribute('aria-describedby'));
    expect(new Set(described).size).toBe(2);
    expect(rowGroup(0)).toBeInTheDocument();
  });
});
