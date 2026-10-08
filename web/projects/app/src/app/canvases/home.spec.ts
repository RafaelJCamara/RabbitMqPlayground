import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { succeed, type UnreadableCanvas } from '@rmq/persistence';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NOW } from '../core/session/canvas-session';
import { Toasts } from '../core/ui/toasts';
import { Home } from './home';
import { CanvasLibrary } from './library';
import { CanvasDialogs } from './dialogs';
import { PAGE, type CanvasSummary } from './summary';
import { EMPTY_THUMBNAIL } from './thumbnail';

const CLOCK = new Date(2026, 9, 8, 15, 30).getTime();
const HOUR = 3_600_000;

const canvas = (id: string, change: Partial<CanvasSummary> = {}): CanvasSummary => ({
  id,
  name: `Canvas ${id}`,
  createdAt: CLOCK - 10 * HOUR,
  updatedAt: CLOCK - HOUR,
  elements: 3,
  edges: 2,
  thumbnail: EMPTY_THUMBNAIL,
  ...change,
});

/** The part of the library that the home reads and calls, with a record of the calls. */
function fakeLibrary(canvases: readonly CanvasSummary[], unreadable: readonly UnreadableCanvas[] = []) {
  const list = signal(canvases);
  const problem = signal<string | null>(null);
  const broken = signal(unreadable);
  return {
    list,
    problem,
    canvases: list.asReadonly(),
    problemText: problem.asReadonly(),
    unreadable: broken.asReadonly(),
    delete: vi.fn(async (id: string) => {
      list.update((all) => all.filter((canvas) => canvas.id !== id));
      broken.update((all) => all.filter((item) => item.id !== id));
      return true;
    }),
    create: vi.fn(async () => undefined),
    openCanvas: vi.fn(async (_id: string) => undefined),
    duplicate: vi.fn(async (_id: string) => undefined),
    rename: vi.fn(async (_id: string, _name: string) => succeed(undefined)),
    dismissProblem: vi.fn(() => problem.set(null)),
  };
}

async function renderHome(canvases: readonly CanvasSummary[], unreadable: readonly UnreadableCanvas[] = []) {
  const library = fakeLibrary(canvases, unreadable);
  const view = await render(Home, {
    providers: [
      { provide: CanvasLibrary, useValue: { ...library, problem: library.problemText } },
      { provide: NOW, useValue: () => CLOCK },
    ],
  });
  return { ...view, library, user: userEvent.setup() };
}

const names = (): string[] =>
  screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent?.trim() ?? '');

describe('Home (ADR-0073)', () => {
  describe('the page', () => {
    it('is a main landmark named by its heading, My canvases', async () => {
      await renderHome([canvas('a')]);

      const main = screen.getByRole('main', { name: 'My canvases' });
      expect(within(main).getByRole('heading', { level: 2, name: 'My canvases' })).toBeInTheDocument();
    });

    it('lists the canvases as a list with a name, a card for each, newest edit first', async () => {
      await renderHome([
        canvas('a', { name: 'Old', updatedAt: CLOCK - 5 * HOUR }),
        canvas('b', { name: 'New', updatedAt: CLOCK - HOUR }),
        canvas('c', { name: 'Middle', updatedAt: CLOCK - 3 * HOUR }),
      ]);

      const list = screen.getByRole('list', { name: 'Canvases' });
      expect(within(list).getAllByRole('listitem')).toHaveLength(3);
      expect(names()).toEqual(['New', 'Middle', 'Old']);
    });

    it('has a button that makes a canvas', async () => {
      const { library, user } = await renderHome([canvas('a')]);

      await user.click(screen.getByRole('button', { name: 'New canvas' }));

      expect(library.create).toHaveBeenCalledOnce();
    });

    it('says that there are no canvases, with no search and no sort, and still offers a new one', async () => {
      await renderHome([]);

      expect(screen.getByText(/You have no canvases yet/)).toBeInTheDocument();
      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: 'Sort by' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New canvas' })).toBeInTheDocument();
    });

    it('says what went wrong, as an alert, and can be dismissed', async () => {
      const { library, user } = await renderHome([canvas('a')]);

      library.problem.set('The canvas could not be copied. It failed.');
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent('The canvas could not be copied. It failed.');
      await user.click(within(alert).getByRole('button', { name: 'Dismiss' }));

      expect(library.dismissProblem).toHaveBeenCalledOnce();
      await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    });
  });

  describe('acting on a card', () => {
    it('opens, copies and renames the canvas of the card, and no other', async () => {
      const { library, user } = await renderHome([canvas('a', { name: 'Alpha' }), canvas('b', { name: 'Beta' })]);

      await user.click(screen.getByRole('button', { name: 'Open Beta' }));
      await user.click(screen.getByRole('button', { name: 'Duplicate Alpha' }));

      expect(library.openCanvas).toHaveBeenCalledExactlyOnceWith('b');
      expect(library.duplicate).toHaveBeenCalledExactlyOnceWith('a');
    });

    it('asks for the new name in a dialog that has the name, and gives it to the library with the id', async () => {
      const { library, user } = await renderHome([canvas('a', { name: 'Alpha' })]);
      const rename = vi.spyOn(TestBed.inject(CanvasDialogs), 'rename').mockImplementation(() => undefined);

      await user.click(screen.getByRole('button', { name: 'Rename Alpha' }));

      expect(rename).toHaveBeenCalledOnce();
      const data = rename.mock.calls[0]?.[0];
      expect(data).toMatchObject({ title: 'Rename canvas', name: 'Alpha', confirm: 'Rename' });
      await data?.submit('Beta');
      expect(library.rename).toHaveBeenCalledExactlyOnceWith('a', 'Beta');
    });
  });

  describe('searching', () => {
    const many = () => [
      canvas('a', { name: 'Orders flow' }),
      canvas('b', { name: 'Café société' }),
      canvas('c', { name: 'Fan-out' }),
      canvas('d', { name: 'orders' }),
    ];

    it('is a search field with a label, and says how many canvases there are in a live region', async () => {
      await renderHome(many());

      expect(screen.getByRole('searchbox', { name: 'Search canvases' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('4 canvases');
    });

    it('says "1 canvas" for one', async () => {
      await renderHome([canvas('a')]);

      expect(screen.getByRole('status')).toHaveTextContent('1 canvas');
    });

    it('keeps the canvases that have the text in their names, as it is typed, and says how many of how many', async () => {
      const { user } = await renderHome(many());

      await user.type(screen.getByRole('searchbox', { name: 'Search canvases' }), 'ORD');

      expect(names()).toEqual(expect.arrayContaining(['Orders flow', 'orders']));
      expect(names()).toHaveLength(2);
      expect(screen.getByRole('status')).toHaveTextContent('2 of 4 canvases');
    });

    it('does not mind accents', async () => {
      const { user } = await renderHome(many());

      await user.type(screen.getByRole('searchbox', { name: 'Search canvases' }), 'societe');

      expect(names()).toEqual(['Café société']);
    });

    it('says that no canvas matches, with the text that was typed, and shows them all again on a button', async () => {
      const { user } = await renderHome(many());

      await user.type(screen.getByRole('searchbox', { name: 'Search canvases' }), '  xyz ');

      expect(screen.getByText(/No canvas has “xyz” in its name\./)).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('No canvases match.');
      expect(screen.queryByRole('list', { name: 'Canvases' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Show all canvases' }));

      expect(screen.getByRole('searchbox', { name: 'Search canvases' })).toHaveValue('');
      expect(names()).toHaveLength(4);
    });
  });

  describe('sorting', () => {
    const some = () => [
      canvas('a', { name: 'banana', createdAt: CLOCK - 30 * HOUR, updatedAt: CLOCK - HOUR, elements: 5 }),
      canvas('b', { name: 'Apple', createdAt: CLOCK - 10 * HOUR, updatedAt: CLOCK - 3 * HOUR, elements: 9 }),
      canvas('c', { name: 'cherry', createdAt: CLOCK - 20 * HOUR, updatedAt: CLOCK - 2 * HOUR, elements: 1 }),
    ];

    it('is a select named Sort by, with the four ways, and Last edited first', async () => {
      await renderHome(some());

      const select = screen.getByRole('combobox', { name: 'Sort by' });
      expect(
        within(select)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Last edited', 'Created', 'Name', 'Size']);
      expect(select).toHaveValue('edited');
      expect(names()).toEqual(['banana', 'cherry', 'Apple']);
    });

    it.each([
      ['created', ['Apple', 'cherry', 'banana']],
      ['name', ['Apple', 'banana', 'cherry']],
      ['size', ['Apple', 'banana', 'cherry']],
    ] as const)('puts the canvases in the order of %s', async (key, expected) => {
      const { user } = await renderHome(some());

      await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), key);

      expect(names()).toEqual(expected);
    });
  });

  describe('paging', () => {
    const lots = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        canvas(`c${String(index).padStart(3, '0')}`, {
          name: `Canvas ${String(index).padStart(3, '0')}`,
          updatedAt: CLOCK - index * 1000,
        }),
      );

    it('draws 48 cards, and a button that shows 48 more', async () => {
      const { user } = await renderHome(lots(100));

      expect(names()).toHaveLength(PAGE);
      expect(screen.getByRole('status')).toHaveTextContent('100 canvases');
      await user.click(screen.getByRole('button', { name: 'Show more' }));

      expect(names()).toHaveLength(2 * PAGE);
      expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument();
    });

    it('draws no button when every canvas is drawn', async () => {
      await renderHome(lots(PAGE));

      expect(names()).toHaveLength(PAGE);
      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('leaves the focus on the first new card when the last ones are shown, because the button is gone', async () => {
      const { user } = await renderHome(lots(PAGE + 2));

      await user.click(screen.getByRole('button', { name: 'Show more' }));

      expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole('button', { name: `Open Canvas ${String(PAGE).padStart(3, '0')}` })).toHaveFocus(),
      );
    });

    it('leaves the focus on the button while there are more to show', async () => {
      const { user } = await renderHome(lots(3 * PAGE));
      const more = screen.getByRole('button', { name: 'Show more' });

      await user.click(more);

      expect(more).toHaveFocus();
    });

    it('goes back to the first page when the search or the sort changes', async () => {
      const { user } = await renderHome(lots(100));
      await user.click(screen.getByRole('button', { name: 'Show more' }));
      expect(names()).toHaveLength(2 * PAGE);

      await user.selectOptions(screen.getByRole('combobox', { name: 'Sort by' }), 'name');
      expect(names()).toHaveLength(PAGE);

      await user.click(screen.getByRole('button', { name: 'Show more' }));
      await user.type(screen.getByRole('searchbox', { name: 'Search canvases' }), 'Canvas 0');
      expect(names()).toHaveLength(PAGE);
    });

    it('searches all the canvases and not the ones that are drawn', async () => {
      const { user } = await renderHome(lots(100));

      await user.type(screen.getByRole('searchbox', { name: 'Search canvases' }), 'Canvas 099');

      expect(names()).toEqual(['Canvas 099']);
      expect(screen.getByRole('status')).toHaveTextContent('1 of 100 canvases');
    });
  });
});

describe('Home, deleting (ADR-0074)', () => {
  const some = () => [
    canvas('a', { name: 'Alpha', updatedAt: CLOCK - HOUR }),
    canvas('b', { name: 'Beta', updatedAt: CLOCK - 2 * HOUR }),
    canvas('c', { name: 'Gamma', updatedAt: CLOCK - 3 * HOUR }),
  ];

  /** Answers the question that the home asks, and records what was asked. */
  const answering = (sure: boolean) =>
    vi.spyOn(TestBed.inject(CanvasDialogs), 'confirm').mockImplementation(async () => sure);

  it('asks first, with the name and how much is on the canvas, and what can be done about it', async () => {
    const { user } = await renderHome(some());
    const confirm = answering(false);

    await user.click(screen.getByRole('button', { name: 'Delete Beta' }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      title: 'Delete “Beta”?',
      body: ['It has 3 elements.', 'You can take this back for a short while after.'],
      confirm: 'Delete canvas',
    });
  });

  it('deletes nothing when the learner says no', async () => {
    const { library, user } = await renderHome(some());
    answering(false);

    await user.click(screen.getByRole('button', { name: 'Delete Beta' }));

    expect(library.delete).not.toHaveBeenCalled();
    expect(names()).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('deletes the canvas of the card when the learner says yes, and no other', async () => {
    const { library, user } = await renderHome(some());
    answering(true);

    await user.click(screen.getByRole('button', { name: 'Delete Beta' }));

    expect(library.delete).toHaveBeenCalledExactlyOnceWith('b');
    await waitFor(() => expect(names()).toEqual(['Alpha', 'Gamma']));
  });

  it('puts the focus on the card that takes its place, which is the next one', async () => {
    const { user } = await renderHome(some());
    answering(true);

    await user.click(screen.getByRole('button', { name: 'Delete Beta' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Gamma' })).toHaveFocus());
  });

  it('puts the focus on the card before it when the one that was deleted was the last', async () => {
    const { user } = await renderHome(some());
    answering(true);

    await user.click(screen.getByRole('button', { name: 'Delete Gamma' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Beta' })).toHaveFocus());
  });

  it('puts the focus on the search when it was the card that was drawn alone with others hidden by a search', async () => {
    const { user } = await renderHome(some());
    answering(true);
    await user.type(screen.getByRole('searchbox', { name: 'Search canvases' }), 'Beta');

    await user.click(screen.getByRole('button', { name: 'Delete Beta' }));

    await waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search canvases' })).toHaveFocus());
  });

  it('puts the focus on the button that makes a canvas when no canvas is left', async () => {
    const { user } = await renderHome([canvas('a', { name: 'Alpha' })]);
    answering(true);

    await user.click(screen.getByRole('button', { name: 'Delete Alpha' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'New canvas' })).toHaveFocus());
    expect(screen.getByText(/You have no canvases yet/)).toBeInTheDocument();
  });

  describe('taking it back with the keys', () => {
    const undoable = () => {
      const run = vi.fn(async () => succeed(undefined));
      TestBed.inject(Toasts).show({ message: 'Deleted “Beta”.', undo: { label: 'Undo', keys: 'Ctrl+Z', run } });
      return run;
    };

    it('takes back the newest notice that has an Undo with Control and Z, and the key is the home’s', async () => {
      await renderHome(some());
      const run = undoable();

      const left = fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });

      expect(left).toBe(false);
      expect(run).toHaveBeenCalledOnce();
    });

    it('does the same with Command and Z, in either case of the letter', async () => {
      await renderHome(some());
      const run = undoable();

      fireEvent.keyDown(document.body, { key: 'Z', metaKey: true });

      expect(run).toHaveBeenCalledOnce();
    });

    it('leaves the key to a field of text, which has an Undo of its own', async () => {
      const { user } = await renderHome(some());
      const run = undoable();
      await user.click(screen.getByRole('searchbox', { name: 'Search canvases' }));

      const left = fireEvent.keyDown(screen.getByRole('searchbox', { name: 'Search canvases' }), {
        key: 'z',
        ctrlKey: true,
      });

      expect(left).toBe(true);
      expect(run).not.toHaveBeenCalled();
    });

    it('leaves the key alone when there is no notice, or when Shift or Alt is held, or the letter is another', async () => {
      await renderHome(some());
      expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true })).toBe(true);
      const run = undoable();

      expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, shiftKey: true })).toBe(true);
      expect(fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true, altKey: true })).toBe(true);
      expect(fireEvent.keyDown(document.body, { key: 'y', ctrlKey: true })).toBe(true);
      expect(fireEvent.keyDown(document.body, { key: 'z' })).toBe(true);

      expect(run).not.toHaveBeenCalled();
    });
  });
});

describe('Home, canvases that could not be opened (ADR-0073)', () => {
  const newer = (id: string, name?: string): UnreadableCanvas => ({
    id,
    ...(name === undefined ? {} : { name }),
    error: {
      kind: 'newer-version',
      of: 'schema',
      found: 9,
      understood: 1,
      message: 'This canvas was saved by a newer version of this app.',
    },
  });

  it('has no such section when every canvas can be opened', async () => {
    await renderHome([canvas('a')]);

    expect(screen.queryByTestId('home-unreadable')).not.toBeInTheDocument();
  });

  it('lists them apart, by name or by id, with the reason, a section with a heading and a list that have a name', async () => {
    await renderHome([canvas('a')], [newer('x1', 'From a newer app'), newer('x2')]);

    const section = screen.getByTestId('home-unreadable');
    expect(
      within(section).getByRole('heading', { level: 2, name: 'Canvases that could not be opened' }),
    ).toBeInTheDocument();
    const list = within(section).getByRole('list', { name: 'Canvases that could not be opened' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('heading', { level: 3, name: 'From a newer app' })).toBeInTheDocument();
    expect(within(list).getByRole('heading', { level: 3, name: 'x2' })).toBeInTheDocument();
    expect(within(list).getAllByText('This canvas was saved by a newer version of this app.')).toHaveLength(2);
    expect(within(section).getByText(/A backup cannot hold them either/)).toBeInTheDocument();
  });

  it('shows them even when there is no canvas that can be opened, and says that there is none beside them', async () => {
    await renderHome([], [newer('x1', 'From a newer app')]);

    expect(screen.getByText(/You have no canvases yet/)).toBeInTheDocument();
    expect(screen.getByTestId('home-unreadable')).toBeInTheDocument();
  });

  it('has no Open and no Rename for them, and a Delete that names them', async () => {
    await renderHome([canvas('a')], [newer('x1', 'From a newer app')]);

    const section = screen.getByTestId('home-unreadable');
    expect(within(section).getAllByRole('button')).toHaveLength(1);
    expect(within(section).getByRole('button', { name: 'Delete From a newer app' })).toBeInTheDocument();
  });

  it('asks before it deletes one, and says that a backup could not have kept it', async () => {
    const { library, user } = await renderHome([canvas('a')], [newer('x1', 'From a newer app')]);
    const confirm = vi.spyOn(TestBed.inject(CanvasDialogs), 'confirm').mockImplementation(async () => true);

    await user.click(screen.getByRole('button', { name: 'Delete From a newer app' }));

    expect(confirm).toHaveBeenCalledExactlyOnceWith({
      title: 'Delete “From a newer app”?',
      body: [
        'This version of the app cannot open it, so a backup could not have kept it.',
        'You can take this back for a short while after.',
      ],
      confirm: 'Delete canvas',
    });
    expect(library.delete).toHaveBeenCalledExactlyOnceWith('x1');
    await waitFor(() => expect(screen.queryByTestId('home-unreadable')).not.toBeInTheDocument());
  });

  it('deletes nothing when the learner says no', async () => {
    const { library, user } = await renderHome([canvas('a')], [newer('x1')]);
    vi.spyOn(TestBed.inject(CanvasDialogs), 'confirm').mockImplementation(async () => false);

    await user.click(screen.getByRole('button', { name: 'Delete x1' }));

    expect(library.delete).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-unreadable')).toBeInTheDocument();
  });
});
