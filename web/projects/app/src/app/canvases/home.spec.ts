import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { succeed } from '@rmq/persistence';
import { render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NOW } from '../core/session/canvas-session';
import { Home } from './home';
import { CanvasLibrary } from './library';
import { CanvasDialogs } from './name-dialog';
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
function fakeLibrary(canvases: readonly CanvasSummary[]) {
  const list = signal(canvases);
  const problem = signal<string | null>(null);
  return {
    list,
    problem,
    canvases: list.asReadonly(),
    problemText: problem.asReadonly(),
    create: vi.fn(async () => undefined),
    openCanvas: vi.fn(async (_id: string) => undefined),
    duplicate: vi.fn(async (_id: string) => undefined),
    rename: vi.fn(async (_id: string, _name: string) => succeed(undefined)),
    dismissProblem: vi.fn(() => problem.set(null)),
  };
}

async function renderHome(canvases: readonly CanvasSummary[]) {
  const library = fakeLibrary(canvases);
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
