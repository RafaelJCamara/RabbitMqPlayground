import { TestBed } from '@angular/core/testing';
import type { Issue } from '@rmq/domain';
import type { HeaderArguments } from '@rmq/engine';
import {
  bool,
  documentOf,
  entry,
  exchangeRecord,
  exists,
  float,
  headerArguments,
  int,
  queueRecord,
  str,
} from '@rmq/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Announcer } from '../core/announcer';
import { DocumentStore } from '../core/state/document-store';
import { BindingConditions } from './binding-conditions';

/** The canvas that the binding is on: the exchange and the queue it goes to are there, so that the line names them as a learner would. */
const CANVAS = documentOf({ exchanges: { H: exchangeRecord('docs', 'headers') }, queues: { Q: queueRecord('pdf') } });
const TITLE = 'Conditions for the binding from exchange docs to queue pdf';

interface Options {
  readonly purpose?: 'new' | 'edit';
  readonly headers?: HeaderArguments;
  readonly error?: Issue | null;
  readonly popover?: boolean;
  readonly key?: string;
}

async function renderEditor(options: Options = {}) {
  const confirmed: HeaderArguments[] = [];
  const cancelled: string[] = [];
  const popover = options.popover ?? (options.purpose ?? 'new') === 'new';
  const view = await render(BindingConditions, {
    providers: [
      {
        provide: DocumentStore,
        useFactory: () => {
          const store = new DocumentStore();
          store.load(CANVAS);
          return store;
        },
      },
    ],
    inputs: {
      title: TITLE,
      purpose: options.purpose ?? 'new',
      exchange: 'docs',
      destination: { kind: 'queue', name: 'pdf' },
      ...(options.headers === undefined ? {} : { headers: options.headers }),
      ...(options.error === undefined ? {} : { error: options.error }),
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(popover ? { placement: { x: 120, y: 80 } } : {}),
    },
    on: {
      confirm: (found: HeaderArguments) => confirmed.push(found),
      cancelled: (how: string) => cancelled.push(how),
    },
  });
  return {
    ...view,
    confirmed,
    cancelled,
    user: userEvent.setup(),
    announced: () => TestBed.inject(Announcer).last(),
    set: (name: string, value: unknown) => {
      view.fixture.componentRef.setInput(name, value);
      view.fixture.detectChanges();
    },
  };
}

const name = (index: number) => screen.getByRole('textbox', { name: `Name of condition ${index}` });
const value = (index: number) => screen.getByRole('textbox', { name: `Value of condition ${index}` });
const type = (index: number) => screen.getByRole('combobox', { name: `Type of condition ${index}` });
const sentence = () => screen.getByTestId('conditions-sentence');

describe('BindingConditions, for a binding that is being made (ADR-0066)', () => {
  describe('as a popover', () => {
    it('is a group that says what it is for, with a heading, and takes the focus itself so that a click on its text is not a click elsewhere', async () => {
      await renderEditor();

      const popover = screen.getByRole('group', { name: TITLE });
      expect(popover).toHaveAttribute('tabindex', '-1');
      expect(screen.getByRole('heading', { name: TITLE })).toBeInTheDocument();
      expect(popover.style.left).toBe('120px');
      expect(popover.style.top).toBe('80px');
      expect(popover.className).toContain('absolute');
    });

    it('has the mode all, written out, chosen, and one empty row with the cursor in its name', async () => {
      await renderEditor();

      expect(screen.getByRole('radio', { name: 'all' })).toBeChecked();
      expect(screen.getAllByTestId('header-row')).toHaveLength(1);
      await waitFor(() => expect(name(1)).toHaveFocus());
      expect(name(1)).toHaveValue('');
      expect(sentence()).toHaveTextContent('x-match=all and no condition counts, so it matches every message.');
    });

    it('says what the mode that is chosen does, under the control, and the control is described by it', async () => {
      const { user } = await renderEditor();
      const group = screen.getByRole('group', { name: 'x-match' });

      expect(screen.getByTestId('conditions-mode')).toHaveTextContent(
        'Every condition has to hold. Arguments that start with x- are not counted.',
      );
      expect(group).toHaveAccessibleDescription(/Every condition has to hold/u);

      await user.click(screen.getByRole('radio', { name: 'any-with-x' }));
      expect(screen.getByTestId('conditions-mode')).toHaveTextContent(
        'At least one condition has to hold, and the arguments that start with x- count too.',
      );
    });

    it('gives the arguments that were typed, with the mode, when Bind is pressed', async () => {
      const { user, confirmed } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());

      await user.type(name(1), 'format');
      await user.type(value(1), 'pdf');
      await user.click(screen.getByRole('button', { name: 'Add condition' }));
      await user.type(name(2), 'n');
      await user.type(value(2), '1');
      await user.click(screen.getByRole('button', { name: 'Bind' }));

      expect(confirmed).toEqual([headerArguments('all', entry('format', str('pdf')), entry('n', int(1)))]);
    });

    it('gives them with Enter in a field', async () => {
      const { user, confirmed } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());

      await user.type(name(1), 'format');
      await user.type(value(1), 'pdf{Enter}');

      expect(confirmed).toEqual([headerArguments('all', entry('format', str('pdf')))]);
    });

    it('tells 1 from "1" from 1.0 from true by how they are typed, and by the type that is chosen', async () => {
      const { user, confirmed } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());
      await user.type(name(1), 'n');
      await user.type(value(1), '1');
      expect(type(1)).toHaveValue('integer');

      await user.selectOptions(type(1), 'string');
      expect(value(1)).toHaveValue('"1"');
      await user.click(screen.getByRole('button', { name: 'Bind' }));
      await user.selectOptions(type(1), 'integer');
      await user.selectOptions(type(1), 'float');
      expect(value(1)).toHaveValue('1.0');
      await user.click(screen.getByRole('button', { name: 'Bind' }));
      await user.clear(value(1));
      await user.type(value(1), 'true');
      expect(type(1)).toHaveValue('boolean');
      await user.click(screen.getByRole('button', { name: 'Bind' }));

      expect(confirmed).toEqual([
        headerArguments('all', entry('n', str('1'))),
        headerArguments('all', entry('n', float(1))),
        headerArguments('all', entry('n', bool(true))),
      ]);
    });

    it('makes an exists condition of a row that is exists, and has no value to type', async () => {
      const { user, confirmed } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());

      await user.type(name(1), 'seen');
      await user.selectOptions(type(1), 'exists');
      await user.click(screen.getByRole('button', { name: 'Bind' }));

      expect(confirmed).toEqual([headerArguments('all', entry('seen', exists))]);
    });

    it('leaves out a row that is empty, and gives a binding with no conditions, which the sentence has said matches every message', async () => {
      const { user, confirmed } = await renderEditor();

      await user.click(screen.getByRole('button', { name: 'Bind' }));

      expect(confirmed).toEqual([headerArguments('all')]);
    });

    it('gives the mode that was chosen', async () => {
      const { user, confirmed } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());

      await user.click(screen.getByRole('radio', { name: 'any' }));
      await user.type(name(1), 'a');
      await user.type(value(1), '1');
      await user.click(screen.getByRole('button', { name: 'Bind' }));

      expect(confirmed).toEqual([headerArguments('any', entry('a', int(1)))]);
    });
  });

  describe('giving up', () => {
    it('gives up with Escape, and nothing is given', async () => {
      const { user, cancelled, confirmed } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());

      await user.keyboard('abc{Escape}');

      expect(cancelled).toEqual(['escape']);
      expect(confirmed).toEqual([]);
    });

    it('gives up with the button', async () => {
      const { user, cancelled } = await renderEditor();

      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(cancelled).toEqual(['button']);
    });

    it('gives up when the focus leaves for another place, or for nowhere', async () => {
      const outside = document.createElement('button');
      document.body.append(outside);
      const { cancelled } = await renderEditor();

      fireEvent.focusOut(name(1), { relatedTarget: outside });
      fireEvent.focusOut(name(1), { relatedTarget: null });

      expect(cancelled).toEqual(['blur', 'blur']);
    });

    it('does not give up when the focus goes from one of its controls to another, or to the popover itself, which is what a click on its text does', async () => {
      const { cancelled } = await renderEditor();
      const popover = screen.getByRole('group', { name: TITLE });

      fireEvent.focusOut(name(1), { relatedTarget: value(1) });
      fireEvent.focusOut(name(1), { relatedTarget: popover });
      fireEvent.focusOut(name(1), { relatedTarget: screen.getByRole('button', { name: 'Bind' }) });

      expect(cancelled).toEqual([]);
    });
  });

  describe('what is wrong', () => {
    it('does not give a draft that has a problem: it says the first one, aloud, and puts the cursor in it', async () => {
      const { user, confirmed, announced } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());
      await user.type(name(1), 'format');
      await user.type(value(1), 'pdf');
      await user.click(screen.getByRole('button', { name: 'Add condition' }));
      await user.type(name(2), 'format');
      await user.type(value(2), 'doc');

      await user.click(screen.getByRole('button', { name: 'Bind' }));

      expect(confirmed).toEqual([]);
      expect(announced()).toBe(
        "The header 'format' is there twice. A table of headers has each name once, so give it one value.",
      );
      expect(name(1)).toHaveFocus();
      expect(name(1)).toHaveAttribute('aria-invalid', 'true');
      expect(name(2)).toHaveAttribute('aria-invalid', 'true');
    });

    it('puts the cursor in the value that cannot be read', async () => {
      const { user, confirmed } = await renderEditor();
      await waitFor(() => expect(name(1)).toHaveFocus());
      await user.type(name(1), 'n');
      await user.type(value(1), '9007199254740993');

      await user.click(screen.getByRole('button', { name: 'Bind' }));

      expect(confirmed).toEqual([]);
      expect(value(1)).toHaveFocus();
      expect(screen.getByTestId('header-value-problem')).toHaveTextContent('An integer header must be a whole number');
    });

    it('does not switch Bind off while there is a problem, because a button that is off says nothing', async () => {
      const { user } = await renderEditor();
      await user.type(value(1), 'x');

      expect(screen.getByRole('button', { name: 'Bind' })).toBeEnabled();
    });

    it('says x-match as a condition is the mode, and sends the learner to the control', async () => {
      const { user } = await renderEditor();
      await user.type(name(1), 'x-match');
      await user.type(value(1), 'any');

      expect(screen.getByTestId('header-key-problem')).toHaveTextContent(
        "'x-match' is the mode of a headers binding (all, any, all-with-x or any-with-x), and not a condition. Choose it with the x-match control.",
      );
    });

    it('says that there are too many conditions, once, under the rows, when no row has the problem', async () => {
      const many = headerArguments('all', ...Array.from({ length: 101 }, (_, index) => entry(`h${index}`, int(index))));
      const { user, confirmed, announced } = await renderEditor({ purpose: 'edit', headers: many });

      expect(screen.getByTestId('conditions-problem')).toHaveTextContent(
        'The arguments of one binding are at most 100, and there are 101. Take some off.',
      );
      await user.click(screen.getByRole('button', { name: 'Apply' }));

      expect(confirmed).toEqual([]);
      expect(announced()).toMatch(/at most 100/u);
    });

    it('shows the refusal of the owner under the rows, until something is changed', async () => {
      const { user, set } = await renderEditor();
      await user.type(name(1), 'a');
      await user.type(value(1), '1');

      set('error', {
        kind: 'canvas-full',
        message: 'This canvas has all the edges it can hold.',
      } satisfies Issue);
      expect(screen.getByTestId('conditions-refusal')).toHaveTextContent('This canvas has all the edges it can hold.');

      await user.type(value(1), '2');
      expect(screen.queryByTestId('conditions-refusal')).not.toBeInTheDocument();
    });

    it('shows a refusal that is given again after one that was changed away', async () => {
      const { user, set } = await renderEditor();
      await user.type(name(1), 'a');
      await user.type(value(1), '1');
      set('error', { kind: 'canvas-full', message: 'First.' } satisfies Issue);
      await user.type(value(1), '2');
      expect(screen.queryByTestId('conditions-refusal')).not.toBeInTheDocument();

      set('error', { kind: 'canvas-full', message: 'Second.' } satisfies Issue);

      expect(screen.getByTestId('conditions-refusal')).toHaveTextContent('Second.');
    });
  });

  describe('what it says about the conditions', () => {
    it('says what the binding asks, as the rows are typed', async () => {
      const { user } = await renderEditor();
      await user.type(name(1), 'format');
      await user.type(value(1), 'pdf');
      await user.click(screen.getByRole('button', { name: 'Add condition' }));
      await user.type(name(2), 'type');
      await user.type(value(2), 'report');

      expect(sentence()).toHaveTextContent(
        'x-match=all: a message matches when all 2 conditions hold (format and type).',
      );
    });

    it('says an x- name is not counted by all, and is by all-with-x, as the control is changed', async () => {
      const { user } = await renderEditor();
      await user.type(name(1), 'x-trace');
      await user.type(value(1), '1');
      expect(screen.getByTestId('header-notes')).toHaveTextContent(
        'The header x-trace is not counted: an argument that starts with "x-" is ignored unless x-match is all-with-x or any-with-x.',
      );

      await user.click(screen.getByRole('radio', { name: 'all-with-x' }));

      expect(screen.getByTestId('header-notes')).toHaveTextContent(
        'The header x-trace is counted, because x-match is all-with-x.',
      );
      expect(sentence()).toHaveTextContent(
        'x-match=all-with-x: a message matches when its one condition holds (x-trace).',
      );
    });

    it('warns, before the binding exists, that any with nothing that counts matches no message, and does not stop it', async () => {
      const { user, confirmed } = await renderEditor();

      await user.click(screen.getByRole('radio', { name: 'any' }));

      const lint = screen.getByTestId('conditions-lint');
      expect(lint).toHaveTextContent('Worth a look');
      expect(lint).toHaveTextContent(
        "The binding from 'docs' to 'pdf' has x-match=any and no condition that counts, so it matches no message",
      );
      await user.click(screen.getByRole('button', { name: 'Bind' }));
      expect(confirmed).toEqual([headerArguments('any')]);
    });

    it('has no warning when a condition counts, or the mode is all', async () => {
      const { user } = await renderEditor();
      await user.click(screen.getByRole('radio', { name: 'any' }));
      await user.type(name(1), 'format');
      await user.type(value(1), 'pdf');

      expect(screen.queryByTestId('conditions-lint')).not.toBeInTheDocument();
    });

    it('says once that an exists condition cannot be exported, when there is one', async () => {
      const { user } = await renderEditor();
      expect(screen.queryByTestId('conditions-export')).not.toBeInTheDocument();
      await user.type(name(1), 'seen');

      await user.selectOptions(type(1), 'exists');

      expect(screen.getByTestId('conditions-export')).toHaveTextContent(
        'A condition that only asks for the header to be there cannot be written to definitions.json, because RabbitMQ rejects a JSON null as an argument value.',
      );
    });

    it('shows the line that a learner would type, and writes each type as the grammar does', async () => {
      const { user } = await renderEditor();
      await user.type(name(1), 'format');
      await user.type(value(1), 'pdf');
      await user.click(screen.getByRole('button', { name: 'Add condition' }));
      await user.type(name(2), 'n');
      await user.type(value(2), '"1"');
      await user.click(screen.getByRole('button', { name: 'Add condition' }));
      await user.type(name(3), 'seen');
      await user.selectOptions(type(3), 'exists');

      expect(screen.getByTestId('conditions-line')).toHaveTextContent(
        'bind docs -> pdf x-match=all format=pdf n="1" exists(seen)',
      );
    });

    it('shows no line while a row has a problem, and the line again when it is put right', async () => {
      const { user } = await renderEditor();
      await user.type(name(1), 'n');
      await user.type(value(1), '"abc');
      expect(screen.queryByTestId('conditions-line')).not.toBeInTheDocument();

      await user.type(value(1), '"');

      expect(screen.getByTestId('conditions-line')).toHaveTextContent('bind docs -> pdf x-match=all n=abc');
    });

    it('keeps the key of a binding in the line, and says that a headers exchange does not read it', async () => {
      await renderEditor({ key: 'order.*' });

      expect(screen.getByTestId('conditions-key')).toHaveTextContent(
        'Its key, order.*, is not read by a headers exchange.',
      );
      expect(screen.getByTestId('conditions-line')).toHaveTextContent('bind docs -> pdf key=order.* x-match=all');
    });

    it('says nothing of a key that there is none of', async () => {
      await renderEditor();

      expect(screen.queryByTestId('conditions-key')).not.toBeInTheDocument();
    });

    it('has no table of recent messages without the log, which needs the flags', async () => {
      await renderEditor();

      expect(screen.queryByTestId('headers-live')).not.toBeInTheDocument();
    });
  });
});

describe('BindingConditions, for a binding that is there (ADR-0066)', () => {
  const BOUND = headerArguments('any', entry('format', str('pdf')), entry('n', int(1)), entry('seen', exists));

  it('is a part of the page: no popover, no heading, no Cancel, and Apply and Revert instead of Bind', async () => {
    await renderEditor({ purpose: 'edit', headers: BOUND });

    expect(screen.queryByRole('group', { name: TITLE })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: TITLE })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Bind' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revert' })).toBeInTheDocument();
  });

  it('starts from the binding: its mode and a row for each condition, with the type each has', async () => {
    await renderEditor({ purpose: 'edit', headers: BOUND });

    expect(screen.getByRole('radio', { name: 'any' })).toBeChecked();
    expect(screen.getAllByTestId('header-row')).toHaveLength(3);
    expect([1, 2, 3].map((index) => (type(index) as HTMLSelectElement).value)).toEqual(['string', 'integer', 'exists']);
    expect(name(1)).toHaveValue('format');
    expect(value(2)).toHaveValue('1');
    expect(screen.getByTestId('conditions-line')).toHaveTextContent(
      'bind docs -> pdf x-match=any format=pdf n=1 exists(seen)',
    );
  });

  it('does not put the cursor anywhere when it is drawn, because it is part of a page that the learner is reading', async () => {
    await renderEditor({ purpose: 'edit', headers: BOUND });

    expect(name(1)).not.toHaveFocus();
  });

  it('gives the arguments that were changed with Apply', async () => {
    const { user, confirmed } = await renderEditor({ purpose: 'edit', headers: BOUND });

    await user.clear(value(2));
    await user.type(value(2), '2');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(confirmed).toEqual([
      headerArguments('any', entry('format', str('pdf')), entry('n', int(2)), entry('seen', exists)),
    ]);
  });

  it('says that nothing was changed, and gives nothing, when the draft is what the binding is', async () => {
    const { user, confirmed, announced } = await renderEditor({ purpose: 'edit', headers: BOUND });

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(confirmed).toEqual([]);
    expect(announced()).toBe('No changes.');
  });

  it('gives the arguments when only the mode was changed, and when only the way that a mode is written was', async () => {
    const { user, confirmed } = await renderEditor({
      purpose: 'edit',
      headers: headerArguments(null, entry('a', int(1))),
    });
    expect(screen.getByRole('radio', { name: 'all' })).toBeChecked();
    expect(screen.getByTestId('conditions-mode')).toHaveTextContent(
      'This binding leaves x-match out, which a broker reads as all.',
    );

    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(confirmed).toEqual([]);

    await user.click(screen.getByRole('radio', { name: 'any' }));
    await user.click(screen.getByRole('radio', { name: 'all' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(confirmed).toEqual([headerArguments('all', entry('a', int(1)))]);
    expect(screen.getByTestId('conditions-mode')).not.toHaveTextContent('leaves x-match out');
  });

  it('starts a binding that has no arguments with no rows, and says what that binding does', async () => {
    await renderEditor({ purpose: 'edit' });

    expect(screen.queryAllByTestId('header-row')).toHaveLength(0);
    expect(sentence()).toHaveTextContent(
      'x-match=all (left out, so all) and no condition counts, so it matches every message.',
    );
  });

  it('gives back what the binding has when Revert is pressed, and says so', async () => {
    const { user, announced } = await renderEditor({ purpose: 'edit', headers: BOUND });
    await user.click(screen.getByRole('radio', { name: 'all' }));
    await user.click(screen.getByRole('button', { name: 'Remove condition 1, format' }));
    expect(screen.getAllByTestId('header-row')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Revert' }));

    expect(screen.getByRole('radio', { name: 'any' })).toBeChecked();
    expect(screen.getAllByTestId('header-row')).toHaveLength(3);
    expect(announced()).toBe('Reverted to the binding as it is.');
  });

  it('starts again when the binding it was made from is another one', async () => {
    const { user, set } = await renderEditor({ purpose: 'edit', headers: BOUND });
    await user.type(value(1), 'x');

    set('headers', headerArguments('all', entry('other', str('yes'))));

    expect(name(1)).toHaveValue('other');
    expect(screen.getByRole('radio', { name: 'all' })).toBeChecked();
    expect(screen.getAllByTestId('header-row')).toHaveLength(1);
  });

  it('does not give up on Escape, or when the focus leaves, because the inspector owns them', async () => {
    const { user, cancelled } = await renderEditor({ purpose: 'edit', headers: BOUND });

    await user.click(name(1));
    await user.keyboard('{Escape}');
    fireEvent.focusOut(name(1), { relatedTarget: null });

    expect(cancelled).toEqual([]);
  });

  it('shows the refusal of the owner', async () => {
    const { set } = await renderEditor({ purpose: 'edit', headers: BOUND });

    set('error', { kind: 'canvas-full', message: 'Full.' } satisfies Issue);

    expect(within(screen.getByTestId('conditions-refusal')).getByText('Full.')).toBeInTheDocument();
  });
});
