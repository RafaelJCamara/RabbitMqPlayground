import { TestBed } from '@angular/core/testing';
import { emptyDocument } from '@rmq/domain';
import { createMemoryRepository, type CanvasRepository, type Outcome, type RepositoryError } from '@rmq/persistence';
import { documentOf, idSequence, manualClock, manualTimer, queueRecord, type ManualClock } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Announcer, type Politeness } from '../core/announcer';
import type { OpenEditor } from '../core/session/canvas-host';
import { REPOSITORIES, STORAGE_MANAGER } from '../core/session/canvas-storage';
import { TOAST_TIMER, Toasts } from '../core/ui/toasts';
import { CanvasLibrary, type View } from './library';

const unavailable: RepositoryError = {
  kind: 'unavailable',
  message: 'The browser does not let this site keep canvases.',
};
const broken: RepositoryError = {
  kind: 'failed',
  message: 'The browser failed to read or save canvases (boom).',
  detail: 'boom',
};

interface Harness {
  readonly library: CanvasLibrary;
  /** The repository the browser gives, which a spec fills and reads. */
  readonly repository: CanvasRepository;
  readonly clock: ManualClock;
  readonly announce: Mock<(message: string, politeness?: Politeness) => void>;
  readonly made: { browser: number; memory: number };
  readonly toasts: Toasts;
}

type Wrap = (repository: CanvasRepository) => CanvasRepository;

function setup(options: { readonly browser?: Wrap; readonly memory?: Wrap } = {}): Harness {
  const clock = manualClock(5_000_000);
  const ids = idSequence('c');
  const browser = createMemoryRepository({ now: clock.now, newId: ids });
  const made = { browser: 0, memory: 0 };
  TestBed.configureTestingModule({
    providers: [
      CanvasLibrary,
      {
        provide: REPOSITORIES,
        useValue: {
          browser: () => {
            made.browser += 1;
            return options.browser?.(browser) ?? browser;
          },
          memory: () => {
            made.memory += 1;
            const memory = createMemoryRepository({ now: clock.now, newId: ids });
            return options.memory?.(memory) ?? memory;
          },
        },
      },
      { provide: STORAGE_MANAGER, useValue: undefined },
      { provide: TOAST_TIMER, useValue: manualTimer() },
    ],
  });
  const announce = vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
  return {
    library: TestBed.inject(CanvasLibrary),
    repository: browser,
    clock,
    announce,
    made,
    toasts: TestBed.inject(Toasts),
  };
}

/** A repository that answers like the one given, except that some calls fail. */
function failing(
  repository: CanvasRepository,
  fail: Partial<Record<'list' | 'create' | 'save' | 'get' | 'purgeExpired', RepositoryError>>,
): CanvasRepository {
  const wrapped = { ...repository } as CanvasRepository;
  for (const [name, error] of Object.entries(fail)) {
    (wrapped as unknown as Record<string, () => Promise<Outcome<never, RepositoryError>>>)[name] = async () => ({
      ok: false,
      error,
    });
  }
  return wrapped;
}

/** Fills the repository with canvases, one after the other, so that the later one was edited later. */
async function seed(harness: Harness, ...names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const made = await harness.repository.create({ id: name.toLowerCase(), name, document: emptyDocument() });
    if (!made.ok) {
      throw new Error(made.error.message);
    }
    ids.push(made.value.id);
    harness.clock.advance(1_000);
  }
  return ids;
}

const strip = async (repository: CanvasRepository): Promise<readonly string[] | undefined> => {
  const stored = await repository.getMeta('openCanvases');
  return stored.ok ? stored.value : undefined;
};

const canvasView = (id: string): View => ({ kind: 'canvas', id });
const HOME: View = { kind: 'home' };

/** An editor that is open: it writes when it is told to, and a spec decides when that is done. Once it is, a write is done at once. */
function editorOf(id: string) {
  const flushes: (() => void)[] = [];
  let finished = false;
  const editor: OpenEditor & { readonly flush: Mock<() => Promise<void>> } = {
    id,
    flush: vi.fn(() => (finished ? Promise.resolve() : new Promise<void>((resolve) => flushes.push(resolve)))),
  };
  return {
    editor,
    finish: () => {
      finished = true;
      flushes.forEach((done) => done());
    },
  };
}

/** Lets everything that is waiting on a promise go on. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('CanvasLibrary', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('starting (ADR-0072)', () => {
    it('makes "Untitled canvas" on the first run, shows it, puts it in the strip and keeps the strip', async () => {
      const { library, repository } = setup();
      expect(library.ready()).toBe(false);

      await library.start();

      expect(library.ready()).toBe(true);
      const [only] = library.canvases();
      expect(only?.name).toBe('Untitled canvas');
      expect(library.view()).toEqual(canvasView(only?.id ?? ''));
      expect(library.tabs()).toEqual([{ id: only?.id, name: 'Untitled canvas' }]);
      await settle();
      expect(await strip(repository)).toEqual([only?.id]);
    });

    it('brings back the strip in its order, and shows the canvas that was open last', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', ['gamma', 'alpha', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');

      await harness.library.start();

      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['gamma', 'alpha', 'beta']);
      expect(harness.library.view()).toEqual(canvasView('alpha'));
    });

    it('shows the first of the strip when the canvas that was open last is not in it', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', ['beta', 'gamma']);
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');

      await harness.library.start();

      expect(harness.library.view()).toEqual(canvasView('beta'));
      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['beta', 'gamma']);
    });

    it('drops from the strip a canvas that is gone, and one that cannot be read, and keeps the rest in order', async () => {
      const harness = setup({
        browser: (memory) => ({
          ...memory,
          list: async () => {
            const listed = await memory.list();
            return listed.ok
              ? {
                  ok: true,
                  value: {
                    canvases: listed.value.canvases.filter(({ id }) => id !== 'beta' && id !== 'nameless'),
                    unreadable: [
                      {
                        id: 'beta',
                        name: 'Newer',
                        error: { kind: 'newer-version', of: 'schema', found: 9, understood: 1, message: 'Newer.' },
                      },
                    ],
                  },
                }
              : listed;
          },
        }),
      });
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', ['alpha', 'beta', 'gone', 'gamma']);

      await harness.library.start();
      await settle();

      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha', 'gamma']);
      expect(await strip(harness.repository)).toEqual(['alpha', 'gamma']);
      expect(harness.library.unreadable().map(({ id }) => id)).toEqual(['beta']);
    });

    it('shows the canvas that was open last, and opens it in the strip, when the strip was never kept', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');

      await harness.library.start();
      await settle();

      expect(harness.library.view()).toEqual(canvasView('alpha'));
      expect(await strip(harness.repository)).toEqual(['alpha']);
    });

    it('shows the most recent canvas when there is no strip and the one open last is gone', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('lastOpenCanvas', 'gone');

      await harness.library.start();

      expect(harness.library.view()).toEqual(canvasView('beta'));
    });

    it('does not write the strip again when it is as it was kept', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('openCanvases', ['alpha', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'beta');
      const set = vi.spyOn(harness.repository, 'setMeta');

      await harness.library.start();
      await settle();

      expect(set).not.toHaveBeenCalled();
    });

    it('never shows the home at start, and lists every canvas for the home', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');

      await harness.library.start();

      expect(harness.library.view().kind).toBe('canvas');
      expect(
        harness.library
          .canvases()
          .map(({ name }) => name)
          .sort(),
      ).toEqual(['Alpha', 'Beta', 'Gamma']);
    });

    it('works in memory, and goes on, when the browser cannot list canvases', async () => {
      const harness = setup({ browser: (memory) => failing(memory, { list: unavailable }) });

      await harness.library.start();

      expect(harness.made).toEqual({ browser: 1, memory: 1 });
      expect(harness.library.ready()).toBe(true);
      expect(harness.library.canvases().map(({ name }) => name)).toEqual(['Untitled canvas']);
    });

    it('works in memory when the first canvas cannot be made, for a full disk, say', async () => {
      const harness = setup({
        browser: (memory) => failing(memory, { create: { kind: 'quota-exceeded', message: 'No room left.' } }),
      });

      await harness.library.start();

      expect(harness.made.memory).toBe(1);
      expect(harness.library.ready()).toBe(true);
      expect(harness.library.canvases()).toHaveLength(1);
    });

    it('says why, and shows nothing, when not even memory can list the canvases', async () => {
      const harness = setup({
        browser: (memory) => failing(memory, { list: unavailable }),
        memory: (memory) => failing(memory, { list: broken }),
      });

      await harness.library.start();

      expect(harness.library.ready()).toBe(false);
      expect(harness.library.problem()).toBe(`The canvases of this browser could not be opened. ${broken.message}`);
    });

    it('says why, and shows nothing, when not even memory can make the first canvas', async () => {
      const harness = setup({
        browser: (memory) => failing(memory, { create: unavailable }),
        memory: (memory) => failing(memory, { create: broken }),
      });

      await harness.library.start();

      expect(harness.library.ready()).toBe(false);
      expect(harness.library.problem()).toBe(`A canvas could not be made. ${broken.message}`);
    });
  });

  describe('showing a view', () => {
    it('writes what the open editor holds before it shows anything else, and then shows it', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');
      await harness.library.start();
      const { editor, finish } = editorOf('alpha');
      harness.library.attach(editor);

      const shown = harness.library.show(HOME);
      await settle();

      expect(editor.flush).toHaveBeenCalledTimes(1);
      expect(harness.library.view()).toEqual(canvasView('alpha'));
      finish();
      await shown;
      expect(harness.library.view()).toEqual(HOME);
    });

    it('reads the canvases again when it shows the home, so that the cards are as they are saved', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      await harness.repository.save('alpha', { document: documentOf({ queues: { q1: queueRecord('billing') } }) });
      expect(harness.library.canvases()[0]?.elements).toBe(0);

      await harness.library.show(HOME);

      expect(harness.library.canvases()[0]?.elements).toBe(1);
    });

    it('does not read the canvases again when it shows a canvas', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      const list = vi.spyOn(harness.repository, 'list');

      await harness.library.show(canvasView('beta'));

      expect(list).not.toHaveBeenCalled();
    });

    it('remembers the canvas that is shown, for the next start', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      expect(harness.library.view()).toEqual(canvasView('beta'));

      await harness.library.show(canvasView('alpha'));
      await settle();

      expect(await harness.repository.getMeta('lastOpenCanvas')).toEqual({ ok: true, value: 'alpha' });
    });

    it('does nothing to show what is shown: it does not make the editor write', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const { editor } = editorOf('alpha');
      harness.library.attach(editor);

      await harness.library.show(canvasView('alpha'));

      expect(editor.flush).not.toHaveBeenCalled();
    });

    it('lets the last request win when an earlier one was still waiting for the editor to write', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');
      await harness.library.start();
      const { editor, finish } = editorOf('alpha');
      harness.library.attach(editor);

      const first = harness.library.show(canvasView('beta'));
      const second = harness.library.show(canvasView('gamma'));
      await settle();
      finish();
      await Promise.all([first, second]);

      expect(harness.library.view()).toEqual(canvasView('gamma'));
    });

    it('does not wait for an editor that is gone', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      const { editor } = editorOf('alpha');
      const detach = harness.library.attach(editor);
      detach();

      await harness.library.show(canvasView('beta'));

      expect(editor.flush).not.toHaveBeenCalled();
      expect(harness.library.view()).toEqual(canvasView('beta'));
    });

    it('does not forget the editor that is open when an older one says that it is gone', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      const older = editorOf('alpha');
      const newer = editorOf('beta');
      const detachOlder = harness.library.attach(older.editor);
      harness.library.attach(newer.editor);
      detachOlder();

      const shown = harness.library.show(HOME);
      await settle();

      expect(newer.editor.flush).toHaveBeenCalledTimes(1);
      newer.finish();
      await shown;
    });
  });

  describe('opening and closing canvases in the strip', () => {
    async function started(...names: string[]) {
      const harness = setup();
      await seed(harness, ...names);
      await harness.repository.setMeta('openCanvases', [names[0]?.toLowerCase() ?? '']);
      await harness.repository.setMeta('lastOpenCanvas', names[0]?.toLowerCase() ?? '');
      await harness.library.start();
      return harness;
    }

    it('adds a canvas to the end of the strip, shows it, and keeps the strip', async () => {
      const { library, repository } = await started('Alpha', 'Beta', 'Gamma');

      await library.openCanvas('gamma');
      await library.openCanvas('beta');
      await settle();

      expect(library.tabs().map(({ id }) => id)).toEqual(['alpha', 'gamma', 'beta']);
      expect(library.view()).toEqual(canvasView('beta'));
      expect(await strip(repository)).toEqual(['alpha', 'gamma', 'beta']);
    });

    it('shows a canvas that is in the strip already, and puts it there only once', async () => {
      const { library } = await started('Alpha', 'Beta');
      await library.openCanvas('beta');

      await library.openCanvas('alpha');
      await library.openCanvas('beta');

      expect(library.tabs().map(({ id }) => id)).toEqual(['alpha', 'beta']);
      expect(library.view()).toEqual(canvasView('beta'));
    });

    it('ignores a canvas that is not there', async () => {
      const { library } = await started('Alpha');

      await library.openCanvas('nowhere');

      expect(library.tabs().map(({ id }) => id)).toEqual(['alpha']);
      expect(library.view()).toEqual(canvasView('alpha'));
    });

    it('takes a canvas out of the strip without deleting it, and keeps the strip', async () => {
      const { library, repository } = await started('Alpha', 'Beta');
      await library.openCanvas('beta');
      await library.show(canvasView('alpha'));

      await library.closeTab('beta');
      await settle();

      expect(library.tabs().map(({ id }) => id)).toEqual(['alpha']);
      expect(library.view()).toEqual(canvasView('alpha'));
      expect(
        library
          .canvases()
          .map(({ id }) => id)
          .sort(),
      ).toEqual(['alpha', 'beta']);
      expect(await strip(repository)).toEqual(['alpha']);
      expect((await repository.get('beta')).ok).toBe(true);
    });

    it('shows the canvas on the left when the one that is shown is closed', async () => {
      const { library } = await started('Alpha', 'Beta', 'Gamma');
      await library.openCanvas('beta');
      await library.openCanvas('gamma');
      await library.show(canvasView('beta'));

      await library.closeTab('beta');

      expect(library.view()).toEqual(canvasView('alpha'));
      expect(library.tabs().map(({ id }) => id)).toEqual(['alpha', 'gamma']);
    });

    it('shows the canvas on the right when the first one is closed', async () => {
      const { library } = await started('Alpha', 'Beta');
      await library.openCanvas('beta');
      await library.show(canvasView('alpha'));

      await library.closeTab('alpha');

      expect(library.view()).toEqual(canvasView('beta'));
      expect(library.tabs().map(({ id }) => id)).toEqual(['beta']);
    });

    it('shows the home when the only canvas is closed', async () => {
      const { library } = await started('Alpha');

      await library.closeTab('alpha');

      expect(library.view()).toEqual(HOME);
      expect(library.tabs()).toEqual([]);
    });

    it('makes the editor write before it shows what is next to a canvas that it closes', async () => {
      const { library } = await started('Alpha', 'Beta');
      await library.openCanvas('beta');
      const { editor, finish } = editorOf('beta');
      library.attach(editor);

      const closing = library.closeTab('beta');
      await settle();
      expect(library.view()).toEqual(canvasView('beta'));
      finish();
      await closing;

      expect(library.view()).toEqual(canvasView('alpha'));
    });

    it('ignores a tab that is not there', async () => {
      const { library, repository } = await started('Alpha');
      const set = vi.spyOn(repository, 'setMeta');

      await library.closeTab('nowhere');

      expect(set).not.toHaveBeenCalled();
      expect(library.tabs()).toHaveLength(1);
    });

    it('names each tab as its canvas is named now, and leaves out one whose canvas is not there', async () => {
      const { library, repository } = await started('Alpha', 'Beta');
      await library.openCanvas('beta');
      await repository.setMeta('openCanvases', ['alpha', 'beta']);

      await library.rename('beta', 'Renamed');

      expect(library.tabs()).toEqual([
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Renamed' },
      ]);
    });
  });

  describe('making, renaming and copying canvases', () => {
    it('makes "Untitled canvas", then "Untitled canvas 2", opens each in the strip, and says so', async () => {
      const harness = setup();
      await harness.library.start();

      const first = await harness.library.create();
      const second = await harness.library.create();

      expect(first.ok && first.value.name).toBe('Untitled canvas 2');
      expect(second.ok && second.value.name).toBe('Untitled canvas 3');
      expect(harness.library.tabs().map(({ name }) => name)).toEqual([
        'Untitled canvas',
        'Untitled canvas 2',
        'Untitled canvas 3',
      ]);
      expect(harness.library.view()).toEqual(canvasView(second.ok ? second.value.id : ''));
      expect(harness.announce).toHaveBeenCalledWith('Made “Untitled canvas 3”.');
    });

    it('says what went wrong, aloud and on the screen, and opens nothing, when the canvas cannot be made', async () => {
      const harness = setup();
      await harness.library.start();
      const before = harness.library.tabs();
      vi.spyOn(harness.repository, 'create').mockResolvedValue({ ok: false, error: broken });

      const made = await harness.library.create();

      expect(made.ok).toBe(false);
      expect(harness.library.problem()).toBe(`A canvas could not be made. ${broken.message}`);
      expect(harness.announce).toHaveBeenCalledWith(`A canvas could not be made. ${broken.message}`, 'assertive');
      expect(harness.library.tabs()).toEqual(before);
    });

    it('renames a canvas, trims the name, and the tab and the home follow', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      const done = await harness.library.rename('alpha', '  Orders flow  ');

      expect(done.ok).toBe(true);
      expect(harness.library.canvases()[0]?.name).toBe('Orders flow');
      expect(harness.library.tabs()[0]?.name).toBe('Orders flow');
      const stored = await harness.repository.get('alpha');
      expect(stored.ok && stored.value.name).toBe('Orders flow');
      expect(harness.announce).toHaveBeenCalledWith('Renamed to “Orders flow”.');
    });

    it('refuses a name that is blank, with the reason, and changes nothing', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const save = vi.spyOn(harness.repository, 'save');

      const done = await harness.library.rename('alpha', '   ');

      expect(!done.ok && done.error).toBe('A canvas needs a name, and this one is blank. Type a name.');
      expect(save).not.toHaveBeenCalled();
      expect(harness.library.canvases()[0]?.name).toBe('Alpha');
    });

    it('refuses a name that is too long, with the reason, and changes nothing', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      const done = await harness.library.rename('alpha', 'x'.repeat(201));

      expect(!done.ok && done.error).toBe(
        'The name has 201 characters, and a name can have at most 200. Shorten the name.',
      );
      expect(harness.library.canvases()[0]?.name).toBe('Alpha');
    });

    it('accepts a name of exactly the longest length, and a name that another canvas has', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();

      expect((await harness.library.rename('alpha', 'x'.repeat(200))).ok).toBe(true);
      expect((await harness.library.rename('beta', 'x'.repeat(200))).ok).toBe(true);
    });

    it('says why, in words, when the browser refuses to rename, and changes nothing', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      vi.spyOn(harness.repository, 'save').mockResolvedValue({ ok: false, error: broken });

      const done = await harness.library.rename('alpha', 'Orders');

      expect(!done.ok && done.error).toBe(broken.message);
      expect(harness.library.canvases()[0]?.name).toBe('Alpha');
    });

    it('copies a canvas as it is saved, names the copy, opens it, and says so', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.repository.save('alpha', { document: documentOf({ queues: { q1: queueRecord('billing') } }) });
      await harness.library.start();

      const copy = await harness.library.duplicate('alpha');

      expect(copy.ok && copy.value.name).toBe('Alpha (copy)');
      expect(harness.library.view()).toEqual(canvasView(copy.ok ? copy.value.id : ''));
      const stored = await harness.repository.get(copy.ok ? copy.value.id : '');
      expect(stored.ok && Object.keys(stored.value.document.queues)).toEqual(['q1']);
      expect(harness.library.tabs().map(({ name }) => name)).toEqual(['Alpha', 'Alpha (copy)']);
      expect(harness.announce).toHaveBeenCalledWith('Made “Alpha (copy)”, a copy of “Alpha”.');
    });

    it('numbers the copies of a canvas', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      await harness.library.duplicate('alpha');
      const second = await harness.library.duplicate('alpha');

      expect(second.ok && second.value.name).toBe('Alpha (copy 2)');
    });

    it('makes the open editor write before it copies, so that the copy is what the learner sees', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const { editor, finish } = editorOf('alpha');
      harness.library.attach(editor);
      const get = vi.spyOn(harness.repository, 'get');

      const copying = harness.library.duplicate('alpha');
      await settle();
      expect(get).not.toHaveBeenCalled();
      finish();
      await copying;

      expect(get).toHaveBeenCalled();
    });

    it('says what went wrong when the canvas to copy cannot be read, and makes nothing', async () => {
      const harness = setup();
      await harness.library.start();

      const copy = await harness.library.duplicate('nowhere');

      expect(copy.ok).toBe(false);
      expect(harness.library.problem()).toMatch(
        /^The canvas could not be copied\. There is no canvas with the id "nowhere"/,
      );
      expect(harness.library.canvases()).toHaveLength(1);
    });

    it('says what went wrong when the copy cannot be made, and opens nothing', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      vi.spyOn(harness.repository, 'create').mockResolvedValue({ ok: false, error: broken });

      const copy = await harness.library.duplicate('alpha');

      expect(copy.ok).toBe(false);
      expect(harness.library.problem()).toBe(`The canvas could not be copied. ${broken.message}`);
      expect(harness.library.canvases()).toHaveLength(1);
    });
  });

  describe('deleting a canvas (ADR-0074)', () => {
    /** The notice that the last delete made, which is the only one on the screen. */
    const notice = (harness: Harness) => {
      const [toast] = harness.toasts.visible();
      return toast;
    };

    it('takes a canvas out of the home, the strip and the browser, and keeps it for a minute as a tombstone', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('openCanvases', ['alpha', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');
      await harness.library.start();
      await harness.library.show(HOME);

      const deleted = await harness.library.delete('beta');
      await settle();

      expect(deleted).toBe(true);
      expect(harness.library.canvases().map(({ id }) => id)).toEqual(['alpha']);
      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha']);
      expect(await strip(harness.repository)).toEqual(['alpha']);
      expect((await harness.repository.get('beta')).ok).toBe(false);
      expect((await harness.repository.restore('beta')).ok).toBe(true);
    });

    it('offers to take it back, with the name of the canvas, an Undo, and the keys, and says so aloud', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      await harness.library.show(HOME);

      await harness.library.delete('beta');

      expect(notice(harness)).toMatchObject({
        message: 'Deleted “Beta”.',
        undo: { label: 'Undo', keys: 'Ctrl+Z' },
      });
      expect(harness.announce).toHaveBeenCalledWith('Deleted “Beta”. Press Ctrl+Z to undo.');
    });

    it('brings it back with the Undo of the notice, to the home and to the place it had in the strip, and says so', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', ['alpha', 'beta', 'gamma']);
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');
      await harness.library.start();
      await harness.library.show(HOME);
      await harness.library.delete('beta');
      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha', 'gamma']);

      await harness.toasts.undo(notice(harness)?.id ?? 0);
      await settle();

      expect(
        harness.library
          .canvases()
          .map(({ id }) => id)
          .sort(),
      ).toEqual(['alpha', 'beta', 'gamma']);
      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha', 'beta', 'gamma']);
      expect(await strip(harness.repository)).toEqual(['alpha', 'beta', 'gamma']);
      expect(harness.toasts.visible()).toEqual([]);
      expect(harness.announce).toHaveBeenCalledWith('“Beta” is back.');
      expect(harness.library.view()).toEqual(HOME);
    });

    it('does not put a canvas back in the strip that was not in it, and does not open it', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('openCanvases', ['alpha']);
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');
      await harness.library.start();
      await harness.library.show(HOME);
      await harness.library.delete('beta');

      await harness.toasts.undo(notice(harness)?.id ?? 0);

      expect(
        harness.library
          .canvases()
          .map(({ id }) => id)
          .sort(),
      ).toEqual(['alpha', 'beta']);
      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha']);
      expect(harness.library.view()).toEqual(HOME);
    });

    it('says that a canvas is gone for good when its minute is over, and keeps the notice', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      await harness.library.show(HOME);
      await harness.library.delete('beta');
      harness.clock.advance(61_000);
      await harness.repository.purgeExpired();

      await harness.toasts.undo(notice(harness)?.id ?? 0);

      expect(notice(harness)?.problem).toBe('“Beta” is gone for good: it was deleted more than a minute ago.');
      expect(harness.library.canvases().map(({ id }) => id)).toEqual(['alpha']);
    });

    it('says why, in the words of the browser, when it cannot bring the canvas back for another reason', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      await harness.library.show(HOME);
      await harness.library.delete('beta');
      vi.spyOn(harness.repository, 'restore').mockResolvedValue({ ok: false, error: broken });

      await harness.toasts.undo(notice(harness)?.id ?? 0);

      expect(notice(harness)?.problem).toBe(broken.message);
    });

    it('closes the tab of a canvas that is shown, and shows the one next to it, before it is deleted', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('openCanvases', ['alpha', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'beta');
      await harness.library.start();
      const { editor, finish } = editorOf('beta');
      harness.library.attach(editor);

      const deleting = harness.library.delete('beta');
      await settle();
      expect(editor.flush).toHaveBeenCalled();
      expect((await harness.repository.get('beta')).ok).toBe(true);
      finish();
      await deleting;

      expect(harness.library.view()).toEqual(canvasView('alpha'));
      expect((await harness.repository.get('beta')).ok).toBe(false);
    });

    it('shows the home when the only canvas in the strip is deleted', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      await harness.library.delete('alpha');

      expect(harness.library.view()).toEqual(HOME);
      expect(harness.library.canvases()).toEqual([]);
    });

    it('deletes a canvas that cannot be read, by its name or its id, and offers to bring it back', async () => {
      const harness = setup({
        browser: (memory) => ({
          ...memory,
          list: async () => {
            const listed = await memory.list();
            return listed.ok
              ? {
                  ok: true,
                  value: {
                    canvases: listed.value.canvases.filter(({ id }) => id !== 'beta' && id !== 'nameless'),
                    unreadable: [
                      {
                        id: 'beta',
                        name: 'From a newer app',
                        error: { kind: 'newer-version', of: 'schema', found: 9, understood: 1, message: 'Newer.' },
                      },
                      { id: 'nameless', error: { kind: 'not-json', message: 'Not JSON.' } },
                    ],
                  },
                }
              : listed;
          },
        }),
      });
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.create({ id: 'nameless', name: 'x', document: emptyDocument() });
      await harness.library.start();
      expect(harness.library.unreadable().map(({ id }) => id)).toEqual(['beta', 'nameless']);

      await harness.library.delete('beta');
      expect(notice(harness)?.message).toBe('Deleted “From a newer app”.');
      await harness.library.delete('nameless');

      expect(harness.toasts.visible().map(({ message }) => message)).toEqual([
        'Deleted “From a newer app”.',
        'Deleted “nameless”.',
      ]);
      expect(harness.library.unreadable()).toEqual([]);
      expect((await harness.repository.get('beta')).ok).toBe(false);
    });

    it('says why, and changes nothing, when the browser refuses to delete', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      await harness.library.show(HOME);
      vi.spyOn(harness.repository, 'softDelete').mockResolvedValue({ ok: false, error: broken });

      const deleted = await harness.library.delete('beta');

      expect(deleted).toBe(false);
      expect(harness.library.problem()).toBe(`“Beta” could not be deleted. ${broken.message}`);
      expect(harness.announce).toHaveBeenCalledWith(`“Beta” could not be deleted. ${broken.message}`, 'assertive');
      expect(
        harness.library
          .canvases()
          .map(({ id }) => id)
          .sort(),
      ).toEqual(['alpha', 'beta']);
      expect(harness.toasts.visible()).toEqual([]);
    });
  });

  describe('reading the canvases again', () => {
    it('keeps the canvases and the ones that cannot be read as the browser has them', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      await seed(harness, 'Beta');

      const done = await harness.library.refresh();

      expect(done.ok).toBe(true);
      expect(harness.library.canvases().map(({ name }) => name)).toEqual(['Beta', 'Alpha']);
    });

    it('says what went wrong, and keeps what it knew, when the browser cannot be read', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      vi.spyOn(harness.repository, 'list').mockResolvedValue({ ok: false, error: broken });

      const done = await harness.library.refresh();

      expect(done.ok).toBe(false);
      expect(harness.library.problem()).toBe(`The canvases could not be read. ${broken.message}`);
      expect(harness.library.canvases()).toHaveLength(1);
    });

    it('forgets a problem once it has been read', async () => {
      const harness = setup();
      await harness.library.start();
      vi.spyOn(harness.repository, 'list').mockResolvedValue({ ok: false, error: broken });
      await harness.library.refresh();
      expect(harness.library.problem()).not.toBeNull();

      harness.library.dismissProblem();

      expect(harness.library.problem()).toBeNull();
    });
  });

  describe('as the host of the editor (ADR-0072)', () => {
    it('wants no canvas on the home, and the canvas that is shown otherwise', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      await harness.library.show(canvasView('beta'));
      expect(harness.library.canvasToOpen()).toBe('beta');

      await harness.library.show(HOME);

      expect(harness.library.canvasToOpen()).toBeUndefined();
    });

    it('follows the editor to another canvas when the one that was wanted could not be opened', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.repository.setMeta('openCanvases', ['alpha', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'beta');
      await harness.library.start();

      harness.library.attach({ id: 'alpha', flush: async () => undefined });
      await settle();

      expect(harness.library.view()).toEqual(canvasView('alpha'));
      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha']);
      expect(await strip(harness.repository)).toEqual(['alpha']);
    });

    it('changes nothing when the editor opened the canvas that was wanted', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      const before = harness.library.view();
      const set = vi.spyOn(harness.repository, 'setMeta');

      harness.library.attach({ id: harness.library.canvasToOpen() ?? '', flush: async () => undefined });
      await settle();

      expect(harness.library.view()).toEqual(before);
      expect(set).not.toHaveBeenCalled();
    });
  });
});
