import { TestBed } from '@angular/core/testing';
import { emptyDocument } from '@rmq/domain';
import {
  createMemoryRepository,
  parseBackup,
  parseCanvasFile,
  SIZE_CAPS,
  writeBackup,
  writeCanvasFile,
  type CanvasRepository,
  type Outcome,
  type RepositoryError,
  type StorageManagerLike,
} from '@rmq/persistence';
import { documentOf, idSequence, manualClock, manualTimer, queueRecord, type ManualClock } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from 'vitest';
import { Announcer, type Politeness } from '../core/announcer';
import type { OpenEditor } from '../core/session/canvas-host';
import { NOW } from '../core/session/canvas-session';
import { REPOSITORIES, STORAGE_MANAGER } from '../core/session/canvas-storage';
import { TOAST_TIMER, Toasts } from '../core/ui/toasts';
import { FILE_DOWNLOADER } from '../core/files/downloader';
import { OnboardingDialogs } from '../onboarding/dialogs';
import { BLANK } from '../onboarding/template-chooser';
import { ShareDialogs } from '../share/dialogs';
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
  /** The files that the library gave to the learner, in order. */
  readonly saved: { readonly name: string; readonly text: string }[];
}

type Wrap = (repository: CanvasRepository) => CanvasRepository;

function setup(
  options: { readonly browser?: Wrap; readonly memory?: Wrap; readonly manager?: StorageManagerLike } = {},
): Harness {
  const clock = manualClock(5_000_000);
  const ids = idSequence('c');
  const browser = createMemoryRepository({ now: clock.now, newId: ids });
  const made = { browser: 0, memory: 0 };
  const saved: { name: string; text: string }[] = [];
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
      { provide: STORAGE_MANAGER, useValue: options.manager },
      { provide: TOAST_TIMER, useValue: manualTimer() },
      { provide: NOW, useValue: clock.now },
      { provide: FILE_DOWNLOADER, useValue: { save: (name: string, text: string) => saved.push({ name, text }) } },
      // The first run asks what to start with (ADR-0082, ADR-0084); here it is answered the way a learner who leaves the question does.
      { provide: OnboardingDialogs, useValue: { choose: async () => BLANK } },
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
    saved,
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

/** For a branch of a test that cannot be reached: the canvas was just made. */
function impossible(): never {
  throw new Error('the canvas was just made');
}

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

    it('writes the strip when it could not be read, because it cannot tell whether the strip has changed', async () => {
      const unreadableStrip = (repository: CanvasRepository): CanvasRepository => ({
        ...repository,
        getMeta: (async (key: string) =>
          key === 'openCanvases'
            ? { ok: false, error: broken }
            : repository.getMeta(key as 'lastOpenCanvas')) as CanvasRepository['getMeta'],
      });
      const harness = setup({ browser: unreadableStrip });
      await seed(harness, 'Alpha');

      await harness.library.start();

      await vi.waitFor(async () => expect(await strip(harness.repository)).toEqual(['alpha']));
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

    it('says why, over the home with nothing on it, when not even memory can make the first canvas (the question was asked over the home, ADR-0082)', async () => {
      const harness = setup({
        browser: (memory) => failing(memory, { create: unavailable }),
        memory: (memory) => failing(memory, { create: broken }),
      });

      await harness.library.start();

      expect(harness.library.ready()).toBe(true);
      expect(harness.library.view()).toEqual({ kind: 'home' });
      expect(harness.library.tabs()).toEqual([]);
      expect(harness.library.canvases()).toEqual([]);
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

    it('says aloud what is shown now: the home, or a canvas by its name', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      harness.announce.mockClear();

      await harness.library.show(HOME);
      await harness.library.show(canvasView('alpha'));

      expect(harness.announce.mock.calls).toEqual([['Showing My canvases.'], ['Showing “Alpha”.']]);
    });

    it('says nothing when it shows what is shown', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      harness.announce.mockClear();

      await harness.library.show(canvasView('alpha'));

      expect(harness.announce).not.toHaveBeenCalled();
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

    it('reads the canvases again for the home and not for a canvas, which the library has already', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();
      const list = vi.spyOn(harness.repository, 'list');

      await harness.library.show(canvasView('alpha'));
      expect(list).not.toHaveBeenCalled();

      await harness.library.show(HOME);
      expect(list).toHaveBeenCalledTimes(1);
    });

    it('lets the last request win even when the write that an earlier one waited for is the last to be done', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');
      await harness.library.start();
      const writes: (() => void)[] = [];
      harness.library.attach({ id: 'alpha', flush: () => new Promise<void>((resolve) => writes.push(resolve)) });

      const first = harness.library.show(canvasView('beta'));
      const second = harness.library.show(canvasView('gamma'));
      await settle();
      writes[1]?.();
      await second;
      writes[0]?.();
      await first;

      expect(harness.library.view()).toEqual(canvasView('gamma'));
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

    it('adds a canvas to the start of the strip, the newest first, shows it, and keeps the strip (ADR-0096)', async () => {
      const { library, repository } = await started('Alpha', 'Beta', 'Gamma');

      await library.openCanvas('gamma');
      await library.openCanvas('beta');
      await settle();

      expect(library.tabs().map(({ id }) => id)).toEqual(['beta', 'gamma', 'alpha']);
      expect(library.view()).toEqual(canvasView('beta'));
      expect(await strip(repository)).toEqual(['beta', 'gamma', 'alpha']);
    });

    it('shows a canvas that is in the strip already without moving it, so that a tab does not jump (ADR-0096)', async () => {
      const { library, repository } = await started('Alpha', 'Beta', 'Gamma');
      await library.openCanvas('beta');
      await library.openCanvas('gamma');
      await settle();
      expect(library.tabs().map(({ id }) => id)).toEqual(['gamma', 'beta', 'alpha']);

      await library.openCanvas('alpha');
      await library.openCanvas('beta');
      await settle();

      expect(library.tabs().map(({ id }) => id)).toEqual(['gamma', 'beta', 'alpha']);
      expect(library.view()).toEqual(canvasView('beta'));
      expect(await strip(repository)).toEqual(['gamma', 'beta', 'alpha']);
    });

    it('reads the strip that was saved as the order that it is shown in, so that no saved strip changes (ADR-0096)', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', ['alpha', 'gamma', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'gamma');

      await harness.library.start();

      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha', 'gamma', 'beta']);
      expect(harness.library.view()).toEqual(canvasView('gamma'));
    });

    it('opens the canvas that was open last as the only tab when every tab was closed (ADR-0096)', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', []);
      await harness.repository.setMeta('lastOpenCanvas', 'gamma');

      await harness.library.start();

      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['gamma']);
      expect(harness.library.view()).toEqual(canvasView('gamma'));
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

    it('shows the canvas on the left, the newer one, when the one that is shown is closed', async () => {
      const { library } = await started('Alpha', 'Beta', 'Gamma');
      await library.openCanvas('beta');
      await library.openCanvas('gamma');
      await library.show(canvasView('beta'));

      await library.closeTab('beta');

      expect(library.view()).toEqual(canvasView('gamma'));
      expect(library.tabs().map(({ id }) => id)).toEqual(['gamma', 'alpha']);
    });

    it('shows the canvas on the right, the older one, when the first one is closed', async () => {
      const { library } = await started('Alpha', 'Beta');
      await library.openCanvas('beta');
      await library.show(canvasView('beta'));

      await library.closeTab('beta');

      expect(library.view()).toEqual(canvasView('alpha'));
      expect(library.tabs().map(({ id }) => id)).toEqual(['alpha']);
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

    it('closes every tab, shows the home, keeps every canvas and the strip that is saved, and says so (ADR-0096)', async () => {
      const { library, repository, announce } = await started('Alpha', 'Beta', 'Gamma');
      await library.openCanvas('beta');
      await library.openCanvas('gamma');
      await settle();
      expect(library.tabs()).toHaveLength(3);

      await library.closeAllTabs();
      await settle();

      expect(library.tabs()).toEqual([]);
      expect(library.view()).toEqual(HOME);
      expect(await strip(repository)).toEqual([]);
      expect(library.canvases()).toHaveLength(3);
      expect((await repository.get('beta')).ok).toBe(true);
      expect(announce).toHaveBeenLastCalledWith('Closed all tabs.');
    });

    it('makes the editor write before it closes every tab, as it does for one', async () => {
      const { library } = await started('Alpha', 'Beta');
      await library.openCanvas('beta');
      const { editor, finish } = editorOf('beta');
      library.attach(editor);

      const closing = library.closeAllTabs();
      await settle();
      expect(library.view()).toEqual(canvasView('beta'));
      expect(library.tabs()).toHaveLength(2);
      finish();
      await closing;

      expect(editor.flush).toHaveBeenCalledOnce();
      expect(library.view()).toEqual(HOME);
      expect(library.tabs()).toEqual([]);
    });

    it('does nothing when no tab is open, and says nothing', async () => {
      const { library, repository, announce } = await started('Alpha');
      await library.closeAllTabs();
      await settle();
      announce.mockClear();
      const set = vi.spyOn(repository, 'setMeta');

      await library.closeAllTabs();

      expect(set).not.toHaveBeenCalled();
      expect(announce).not.toHaveBeenCalled();
      expect(library.view()).toEqual(HOME);
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
        { id: 'beta', name: 'Renamed' },
        { id: 'alpha', name: 'Alpha' },
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
        'Untitled canvas 3',
        'Untitled canvas 2',
        'Untitled canvas',
      ]);
      expect(harness.library.view()).toEqual(canvasView(second.ok ? second.value.id : ''));
      expect(harness.announce).toHaveBeenCalledWith('Made “Untitled canvas 3”.');
    });

    it('makes a canvas from the document and the name it is given, which is how a template is made, and opens it', async () => {
      const harness = setup();
      await harness.library.start();

      const made = await harness.library.create({
        name: 'Hello World',
        document: documentOf({ queues: { q1: queueRecord('hello') } }),
      });

      expect(made.ok && made.value).toMatchObject({ name: 'Hello World', elements: 1 });
      const stored = await harness.repository.get(made.ok ? made.value.id : '');
      expect(stored.ok && Object.keys(stored.value.document.queues)).toEqual(['q1']);
      expect(harness.library.view()).toEqual(canvasView(made.ok ? made.value.id : ''));
    });

    it('names a canvas that is only given a document "Untitled canvas", and the first number that is free', async () => {
      const harness = setup();
      await harness.library.start();

      const made = await harness.library.create({ document: documentOf({ queues: { q1: queueRecord('hello') } }) });

      expect(made.ok && made.value.name).toBe('Untitled canvas 2');
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
      expect(harness.library.tabs().map(({ name }) => name)).toEqual(['Alpha (copy)', 'Alpha']);
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

    it('brings back the first tab to the first place, and the only tab to the strip', async () => {
      const first = setup();
      await seed(first, 'Alpha', 'Beta');
      await first.repository.setMeta('openCanvases', ['alpha', 'beta']);
      await first.repository.setMeta('lastOpenCanvas', 'beta');
      await first.library.start();
      await first.library.show(HOME);
      await first.library.delete('alpha');
      expect(first.library.tabs().map(({ id }) => id)).toEqual(['beta']);

      await first.toasts.undo(notice(first)?.id ?? 0);

      expect(first.library.tabs().map(({ id }) => id)).toEqual(['alpha', 'beta']);
      expect(await strip(first.repository)).toEqual(['alpha', 'beta']);
    });

    it('brings back the tab of the only canvas there is', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      await harness.library.delete('alpha');
      expect(harness.library.tabs()).toEqual([]);

      await harness.toasts.undo(notice(harness)?.id ?? 0);

      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha']);
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
      expect(harness.library.unreadable().map(({ id }) => id)).toEqual(['nameless']);
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

  describe('sharing a canvas (ADR-0078)', () => {
    const opened = (): MockInstance<ShareDialogs['share']> =>
      vi.spyOn(TestBed.inject(ShareDialogs), 'share').mockImplementation(() => undefined);

    it('opens the panel for the canvas as it is saved, with its name, and no messages, which the home has none of', async () => {
      const harness = setup();
      await seed(harness, 'Orders');
      await harness.repository.save('orders', {
        name: 'Orders flow',
        document: documentOf({ queues: { q1: queueRecord('billing') } }),
      });
      await harness.library.start();
      const share = opened();

      const done = await harness.library.share('orders');

      expect(done).toBe(true);
      expect(share).toHaveBeenCalledTimes(1);
      const data = share.mock.calls[0]?.[0];
      expect(data?.name).toBe('Orders flow');
      expect(Object.values(data?.document.queues ?? {}).map(({ name }) => name)).toEqual(['billing']);
      expect(data).not.toHaveProperty('messages');
    });

    it('makes the open editor write first, so that what is shared is what the learner sees', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const share = opened();
      const { editor, finish } = editorOf('alpha');
      harness.library.attach(editor);

      const sharing = harness.library.share('alpha');
      await settle();
      expect(share).not.toHaveBeenCalled();
      finish();
      await sharing;

      expect(share).toHaveBeenCalledTimes(1);
    });

    it('gives the canvas file, named after the canvas, when the panel asks for it', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const share = opened();
      await harness.library.share('alpha');

      share.mock.calls[0]?.[0].saveAsFile();
      await settle();

      expect(harness.saved.map(({ name }) => name)).toEqual(['alpha.rmq.json']);
    });

    it('says why, on the screen and aloud, and opens nothing, when the canvas cannot be read', async () => {
      const harness = setup();
      await harness.library.start();
      const share = opened();

      const done = await harness.library.share('nowhere');

      expect(done).toBe(false);
      expect(share).not.toHaveBeenCalled();
      expect(harness.library.problem()).toMatch(
        /^The canvas could not be shared\. There is no canvas with the id "nowhere"/,
      );
    });
  });

  describe('saving a canvas as a file (ADR-0075)', () => {
    it('gives the learner the file of the canvas as it is saved, named after it, and says so in a notice', async () => {
      const harness = setup();
      await seed(harness, 'Orders');
      await harness.repository.save('orders', {
        name: 'Orders flow',
        document: documentOf({ queues: { q1: queueRecord('billing') } }),
      });
      await harness.library.start();

      const saved = await harness.library.saveAsFile('orders');

      expect(saved).toEqual({ ok: true, value: 'orders-flow.rmq.json' });
      expect(harness.saved).toHaveLength(1);
      expect(harness.saved[0]?.name).toBe('orders-flow.rmq.json');
      const read = parseCanvasFile(harness.saved[0]?.text ?? '');
      expect(read.ok && read.value.name).toBe('Orders flow');
      expect(read.ok && Object.keys(read.value.document.queues)).toEqual(['q1']);
      expect(harness.toasts.visible().map(({ message }) => message)).toEqual([
        'Saved “Orders flow” as orders-flow.rmq.json.',
      ]);
    });

    it('makes the open editor write first, so that the file is what the learner sees', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const { editor, finish } = editorOf('alpha');
      harness.library.attach(editor);

      const saving = harness.library.saveAsFile('alpha');
      await settle();
      expect(harness.saved).toEqual([]);
      finish();
      await saving;

      expect(harness.saved).toHaveLength(1);
    });

    it('calls a canvas whose name has no letters or digits "canvas"', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      await harness.library.rename('alpha', '***');

      const saved = await harness.library.saveAsFile('alpha');

      expect(saved).toEqual({ ok: true, value: 'canvas.rmq.json' });
    });

    it('says why, and gives no file, when the file would not open again, which is when its name is too long', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const got = await harness.repository.get('alpha');
      const name = 'x'.repeat(SIZE_CAPS.name + 1);
      vi.spyOn(harness.repository, 'get').mockResolvedValue({
        ok: true,
        value: { ...(got.ok ? got.value : impossible()), name },
      });

      const saved = await harness.library.saveAsFile('alpha');

      const lead = `“${name}” could not be saved as a file. `;
      expect(!saved.ok && saved.error.startsWith(lead)).toBe(true);
      expect(!saved.ok && saved.error.length > lead.length).toBe(true);
      expect(harness.library.problem()).toBe(!saved.ok ? saved.error : null);
      expect(harness.saved).toEqual([]);
    });

    it('says why, on the screen and aloud, and gives no file, when the canvas cannot be read', async () => {
      const harness = setup();
      await harness.library.start();

      const saved = await harness.library.saveAsFile('nowhere');

      expect(!saved.ok && saved.error).toMatch(
        /^The canvas could not be saved as a file\. There is no canvas with the id "nowhere"/,
      );
      expect(harness.library.problem()).toBe(!saved.ok ? saved.error : null);
      expect(harness.saved).toEqual([]);
    });
  });

  describe('opening a file (ADR-0075)', () => {
    const fileOf = (text: string, name = 'orders.rmq.json') => new File([text], name);
    const canvasFile = (name = 'From a file') => {
      const written = writeCanvasFile({ name, document: documentOf({ queues: { q1: queueRecord('billing') } }) });
      if (!written.ok) {
        throw new Error(written.error.message);
      }
      return written.value;
    };

    it('opens it as a new canvas, with the name and the document of the file, in a tab of its own, and says so', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      const opened = await harness.library.openFile(fileOf(canvasFile()));

      expect(opened.ok && opened.value.name).toBe('From a file');
      expect(harness.library.tabs().map(({ name }) => name)).toEqual(['From a file', 'Alpha']);
      expect(harness.library.view()).toEqual(canvasView(opened.ok ? opened.value.id : ''));
      const stored = await harness.repository.get(opened.ok ? opened.value.id : '');
      expect(stored.ok && Object.keys(stored.value.document.queues)).toEqual(['q1']);
      expect(harness.announce).toHaveBeenCalledWith('Opened “From a file” from orders.rmq.json.');
    });

    it('opens it as a new canvas even when a canvas has the same name, and never replaces one', async () => {
      const harness = setup();
      await harness.repository.create({ id: 'same', name: 'From a file', document: emptyDocument() });
      await harness.library.start();

      await harness.library.openFile(fileOf(canvasFile('From a file')));

      expect(harness.library.canvases().map(({ name }) => name)).toEqual(['From a file', 'From a file']);
    });

    it('refuses a file that is not JSON, in the words of the loader, and changes nothing', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      const opened = await harness.library.openFile(fileOf('this is not JSON'));

      expect(!opened.ok && opened.error).toMatch(/^This is not JSON, so it cannot be a canvas/);
      expect(harness.library.canvases()).toHaveLength(1);
      expect(harness.library.problem()).toBeNull();
    });

    it('says that a backup is a backup, and to open it as one', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const backup = writeBackup([], { exportedAt: 1 });

      const opened = await harness.library.openFile(fileOf(backup.ok ? backup.value : ''));

      expect(!opened.ok && opened.error).toBe(
        'This is a backup of several canvases, and not the file of one canvas. Open it as a backup.',
      );
    });

    it('refuses a file from a newer version, and says to reload the page for the newest', async () => {
      const harness = setup();
      await harness.library.start();
      const newer = JSON.stringify({ ...JSON.parse(canvasFile()), version: 99 });

      const opened = await harness.library.openFile(fileOf(newer));

      expect(!opened.ok && opened.error).toMatch(
        /saved by a newer version of this app.*Reload the page.*Nothing was loaded and nothing was changed\./,
      );
    });

    it('does not read a file that is too big to be one of ours, and says its size', async () => {
      const harness = setup();
      await harness.library.start();
      const big = { name: 'huge.json', size: 300_000_000, text: vi.fn(async () => '') } as unknown as File;

      const opened = await harness.library.openFile(big);

      expect(!opened.ok && opened.error).toMatch(
        /^This file is 286\.1 MB, which is more than a canvas file or a backup/,
      );
      expect(big.text).not.toHaveBeenCalled();
    });

    it('says that the file could not be read when the browser fails to read it', async () => {
      const harness = setup();
      await harness.library.start();
      const broken = {
        name: 'x.json',
        size: 10,
        text: async () => Promise.reject(new Error('The file is gone.')),
      } as unknown as File;
      const nothing = { name: 'y.json', size: 10, text: async () => Promise.reject('no') } as unknown as File;

      const first = await harness.library.openFile(broken);
      const second = await harness.library.openFile(nothing);

      expect(!first.ok && first.error).toBe('The file could not be read. The file is gone.');
      expect(!second.ok && second.error).toBe('The file could not be read. The browser did not say why.');
    });

    it('says why, in the words of the browser, when the canvas cannot be kept', async () => {
      const harness = setup();
      await harness.library.start();
      vi.spyOn(harness.repository, 'create').mockResolvedValue({ ok: false, error: broken });

      const opened = await harness.library.openFile(fileOf(canvasFile()));

      expect(!opened.ok && opened.error).toBe(broken.message);
    });
  });

  describe('backing up (ADR-0075)', () => {
    it('gives the learner one file of every canvas that can be read, named by the day, and says what it came to', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();

      const done = await harness.library.exportBackup();

      const day = new Date(harness.clock.now());
      const two = (n: number) => String(n).padStart(2, '0');
      const file = `rmq-playground-backup-${day.getFullYear()}-${two(day.getMonth() + 1)}-${two(day.getDate())}.json`;
      expect(done).toEqual({ ok: true, value: { file, count: 2, left: 0 } });
      expect(harness.saved.map(({ name }) => name)).toEqual([file]);
      const read = parseBackup(harness.saved[0]?.text ?? '');
      expect(read.ok && read.value.entries.map((entry) => entry.ok && entry.canvas.name).sort()).toEqual([
        'Alpha',
        'Beta',
      ]);
      expect(read.ok && read.value.exportedAt).toBe(harness.clock.now());
      expect(harness.toasts.visible().map(({ message }) => message)).toEqual([
        `Backed up 2 canvases to ${file}. Keep the file somewhere other than this device too: a backup beside the canvases is lost with them.`,
      ]);
    });

    it('remembers when it was made, for the reminder', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      await harness.library.exportBackup();

      expect(await harness.repository.getMeta('lastBackupAt')).toEqual({ ok: true, value: harness.clock.now() });
    });

    it('leaves out the canvases that cannot be read, and says how many', async () => {
      const harness = setup({
        browser: (memory) => ({
          ...memory,
          list: async () => {
            const listed = await memory.list();
            return listed.ok
              ? {
                  ok: true,
                  value: {
                    canvases: listed.value.canvases.filter(({ id }) => id !== 'beta'),
                    unreadable: [
                      {
                        id: 'beta',
                        error: { kind: 'newer-version', of: 'schema', found: 9, understood: 1, message: 'Newer.' },
                      },
                    ],
                  },
                }
              : listed;
          },
        }),
      });
      await seed(harness, 'Alpha', 'Beta');
      await harness.library.start();

      const done = await harness.library.exportBackup();

      expect(done.ok && done.value).toMatchObject({ count: 1, left: 1 });
      expect(harness.toasts.visible()[0]?.message).toContain('1 canvas could not be opened and is not in the file.');
    });

    it('makes the open editor write first', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const { editor, finish } = editorOf('alpha');
      harness.library.attach(editor);

      const backing = harness.library.exportBackup();
      await settle();
      expect(harness.saved).toEqual([]);
      finish();
      await backing;

      expect(harness.saved).toHaveLength(1);
    });

    it('makes no file and says why when no canvas can be read', async () => {
      const harness = setup({
        browser: (memory) => ({ ...memory, list: async () => ({ ok: true, value: { canvases: [], unreadable: [] } }) }),
      });
      await harness.library.start();

      const done = await harness.library.exportBackup();

      expect(!done.ok && done.error).toBe('There is nothing to back up: no canvas here can be opened.');
      expect(harness.library.problem()).toBe('There is nothing to back up: no canvas here can be opened.');
      expect(harness.saved).toEqual([]);
      expect(await harness.repository.getMeta('lastBackupAt')).toEqual({ ok: true, value: undefined });
    });

    it('says why, and gives no file, when the browser cannot be read', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      vi.spyOn(harness.repository, 'list').mockResolvedValue({ ok: false, error: broken });

      const done = await harness.library.exportBackup();

      expect(!done.ok && done.error).toBe(`The backup could not be made. ${broken.message}`);
      expect(harness.saved).toEqual([]);
    });

    it('says why, and gives no file, when the backup would not open again, which is when a name is too long', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      const got = await harness.repository.get('alpha');
      const long = { ...(got.ok ? got.value : impossible()), name: 'x'.repeat(SIZE_CAPS.name + 1) };
      vi.spyOn(harness.repository, 'list').mockResolvedValue({ ok: true, value: { canvases: [long], unreadable: [] } });

      const done = await harness.library.exportBackup();

      const lead = 'The backup could not be made. ';
      expect(!done.ok && done.error.startsWith(lead)).toBe(true);
      expect(!done.ok && done.error.length > lead.length).toBe(true);
      expect(harness.saved).toEqual([]);
      expect(await harness.repository.getMeta('lastBackupAt')).toEqual({ ok: true, value: undefined });
    });

    it('leaves the telling to the caller when it is asked to be quiet: no notice', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      const done = await harness.library.exportBackup({ say: false });

      expect(done.ok).toBe(true);
      expect(harness.toasts.visible()).toEqual([]);
      expect(harness.saved).toHaveLength(1);
    });

    it('leaves the telling to the caller when it is asked to be quiet: no problem on the screen either', async () => {
      const harness = setup({
        browser: (memory) => ({ ...memory, list: async () => ({ ok: true, value: { canvases: [], unreadable: [] } }) }),
      });
      await harness.library.start();

      const failed = await harness.library.exportBackup({ say: false });

      expect(failed.ok).toBe(false);
      expect(harness.library.problem()).toBeNull();
    });
  });

  describe('the reminder to back up (ADR-0075)', () => {
    const DAY = 24 * 60 * 60 * 1000;

    async function oldLibrary() {
      const harness = setup();
      await harness.repository.create({
        id: 'alpha',
        name: 'Alpha',
        document: documentOf({ queues: { q1: queueRecord('billing') } }),
      });
      await harness.library.start();
      harness.clock.advance(15 * DAY);
      await harness.library.show(HOME);
      return harness;
    }

    it('is due when the canvases are two weeks old and there has never been a backup', async () => {
      const harness = await oldLibrary();

      expect(harness.library.reminder().due).toBe(true);
    });

    it('is not due on a fresh library, or before the home has been read', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      expect(harness.library.reminder().due).toBe(false);
      await harness.library.show(HOME);
      expect(harness.library.reminder().due).toBe(false);
    });

    it('goes when a backup is made', async () => {
      const harness = await oldLibrary();

      await harness.library.exportBackup();

      expect(harness.library.reminder().due).toBe(false);
    });

    it('goes for a week when the learner says later, and the time is kept', async () => {
      const harness = await oldLibrary();

      await harness.library.snoozeReminder();

      expect(harness.library.reminder().due).toBe(false);
      expect(await harness.repository.getMeta('backupReminderSnoozedUntil')).toEqual({
        ok: true,
        value: harness.clock.now() + 7 * DAY,
      });
    });

    it('reads what an earlier visit kept: a backup made a week ago, or a reminder put off', async () => {
      const harness = setup();
      await harness.repository.create({
        id: 'alpha',
        name: 'Alpha',
        document: documentOf({ queues: { q1: queueRecord('billing') } }),
      });
      await harness.repository.setMeta('backupReminderSnoozedUntil', harness.clock.now() + 20 * DAY);
      await harness.library.start();
      harness.clock.advance(15 * DAY);

      await harness.library.show(HOME);

      expect(harness.library.reminder().due).toBe(false);
    });
  });

  describe('the room that the browser has left (ADR-0075)', () => {
    const manager = (usage: number, quota: number): StorageManagerLike => ({
      persist: async () => true,
      persisted: async () => false,
      estimate: async () => ({ usage, quota }),
    });

    it('is said as of the last time the home was read, and a warning is only for a browser that is running out', async () => {
      const harness = setup({ manager: manager(10, 1_000) });
      await seed(harness, 'Alpha');
      await harness.library.start();

      await harness.library.show(HOME);

      expect(harness.library.usage()).toEqual({ usage: 10, quota: 1_000, fraction: 0.01 });
      expect(harness.library.quota()).toBeNull();
    });

    it('warns at 80% and at 95%, in the words of the persistence library', async () => {
      const low = setup({ manager: manager(850, 1_000) });
      await seed(low, 'Alpha');
      await low.library.start();
      await low.library.show(HOME);
      expect(low.library.quota()).toMatchObject({ level: 'low' });

      TestBed.resetTestingModule();
      const critical = setup({ manager: manager(960, 1_000) });
      await seed(critical, 'Alpha');
      await critical.library.start();
      await critical.library.show(HOME);
      expect(critical.library.quota()).toMatchObject({ level: 'critical' });
    });

    it('says nothing of the room when the browser does not say', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      await harness.library.show(HOME);

      expect(harness.library.usage()).toBeNull();
      expect(harness.library.quota()).toBeNull();
    });

    it('asks the browser to keep the canvases when the home is read, and keeps what it said when it did not agree', async () => {
      const harness = setup({
        manager: {
          persist: async () => false,
          persisted: async () => false,
          estimate: async () => ({ usage: 1, quota: 100 }),
        },
      });
      await seed(harness, 'Alpha');
      await harness.library.start();

      await harness.library.show(HOME);
      await settle();

      expect(harness.library.persistence()).toMatchObject({ status: 'denied' });
    });
  });

  describe('putting a backup back (ADR-0075)', () => {
    const backupFile = (...names: string[]) => {
      const records = names.map((name, index) => ({
        id: name.toLowerCase(),
        name,
        createdAt: 1_000 + index,
        updatedAt: 2_000 + index,
        document: documentOf({ queues: { q1: queueRecord(name) } }),
      }));
      const written = writeBackup(records, { exportedAt: 5 });
      return new File([written.ok ? written.value : ''], 'backup.json');
    };

    it('puts back what is not here, shows it on the home, and leaves the strip as it is', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      const report = await harness.library.restoreFile(backupFile('Beta', 'Gamma'));

      expect(report.ok && report.value.restored.map(({ name }) => name)).toEqual(['Beta', 'Gamma']);
      expect(
        harness.library
          .canvases()
          .map(({ name }) => name)
          .sort(),
      ).toEqual(['Alpha', 'Beta', 'Gamma']);
      expect(harness.library.tabs().map(({ name }) => name)).toEqual(['Alpha']);
    });

    it('adds a canvas as a copy when its id is taken by another, and leaves the one that is here', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      const report = await harness.library.restoreFile(backupFile('Alpha'));

      expect(report.ok && report.value.copies.map(({ name }) => name)).toEqual(['Alpha (restored)']);
      expect(
        harness.library
          .canvases()
          .map(({ name }) => name)
          .sort(),
      ).toEqual(['Alpha', 'Alpha (restored)']);
    });

    it('makes nothing new the second time', async () => {
      const harness = setup();
      await harness.library.start();
      await harness.library.restoreFile(backupFile('Beta'));

      const again = await harness.library.restoreFile(backupFile('Beta'));

      expect(again.ok && again.value.alreadyHere).toHaveLength(1);
      expect(harness.library.canvases().filter(({ name }) => name === 'Beta')).toHaveLength(1);
    });

    it('says that the file of one canvas is not a backup, and to open it as a canvas', async () => {
      const harness = setup();
      await harness.library.start();
      const one = writeCanvasFile({ name: 'One', document: documentOf() });

      const report = await harness.library.restoreFile(new File([one.ok ? one.value : ''], 'one.json'));

      expect(!report.ok && report.error).toBe(
        'This is the file of one canvas, and not a backup of several. Open it as a canvas.',
      );
    });

    it('refuses a text that is not JSON, and a file that is too big to be read', async () => {
      const harness = setup();
      await harness.library.start();
      const big = { name: 'huge.json', size: 300_000_000, text: vi.fn(async () => '') } as unknown as File;

      const text = await harness.library.restoreFile(new File(['nope'], 'x.json'));
      const huge = await harness.library.restoreFile(big);

      expect(!text.ok && text.error).toMatch(/^This is not JSON/);
      expect(!huge.ok && huge.error).toMatch(/^This file is 286\.1 MB/);
      expect(big.text).not.toHaveBeenCalled();
    });

    it('says why when the browser cannot be read', async () => {
      const harness = setup();
      await harness.library.start();
      vi.spyOn(harness.repository, 'list').mockResolvedValue({ ok: false, error: broken });

      const report = await harness.library.restoreFile(backupFile('Beta'));

      expect(!report.ok && report.error).toBe(broken.message);
    });
  });

  describe('deleting every canvas (ADR-0074)', () => {
    async function three() {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', ['alpha', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'alpha');
      await harness.library.start();
      return harness;
    }

    it('deletes them all, closes the strip, shows the home, keeps the strip empty, and says how many', async () => {
      const harness = await three();

      const deleted = await harness.library.deleteAll();
      await settle();

      expect(deleted).toBe(true);
      expect(harness.library.canvases()).toEqual([]);
      expect(harness.library.tabs()).toEqual([]);
      expect(harness.library.view()).toEqual(HOME);
      expect(await strip(harness.repository)).toEqual([]);
      const listed = await harness.repository.list();
      expect(listed.ok && listed.value.canvases).toEqual([]);
      expect(harness.toasts.visible().map(({ message }) => message)).toEqual(['Deleted all 3 canvases.']);
      expect(harness.toasts.visible()[0]?.undo).toMatchObject({ label: 'Undo', keys: 'Ctrl+Z' });
    });

    it('says "1 canvas" when there is one', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();

      await harness.library.deleteAll();

      expect(harness.toasts.visible().map(({ message }) => message)).toEqual(['Deleted 1 canvas.']);
    });

    it('makes the open editor write first, and then shows the home', async () => {
      const harness = await three();
      const { editor, finish } = editorOf('alpha');
      harness.library.attach(editor);

      const deleting = harness.library.deleteAll();
      await settle();
      expect(editor.flush).toHaveBeenCalled();
      const listed = await harness.repository.list();
      expect(listed.ok && listed.value.canvases).toHaveLength(3);
      finish();
      await deleting;

      expect(harness.library.view()).toEqual(HOME);
    });

    it('brings every canvas back with the Undo of the notice, and the strip as it was, and says how many', async () => {
      const harness = await three();
      await harness.library.deleteAll();

      await harness.toasts.undo(harness.toasts.visible()[0]?.id ?? 0);
      await settle();

      expect(
        harness.library
          .canvases()
          .map(({ id }) => id)
          .sort(),
      ).toEqual(['alpha', 'beta', 'gamma']);
      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['alpha', 'beta']);
      expect(await strip(harness.repository)).toEqual(['alpha', 'beta']);
      expect(harness.announce).toHaveBeenCalledWith('3 canvases are back.');
      expect(harness.toasts.visible()).toEqual([]);
      expect(harness.library.view()).toEqual(HOME);
    });

    it('says that one canvas is back, in the singular', async () => {
      const harness = setup();
      await seed(harness, 'Alpha');
      await harness.library.start();
      await harness.library.deleteAll();

      await harness.toasts.undo(harness.toasts.visible()[0]?.id ?? 0);

      expect(harness.announce).toHaveBeenCalledWith('1 canvas is back.');
    });

    it('says how many are back when some were deleted for good meanwhile', async () => {
      const harness = await three();
      await harness.library.deleteAll();
      const restoreAll = harness.repository.restoreAll.bind(harness.repository);
      vi.spyOn(harness.repository, 'restoreAll').mockImplementation(async (ids) => restoreAll(ids.slice(0, 2)));

      await harness.toasts.undo(harness.toasts.visible()[0]?.id ?? 0);

      expect(harness.announce).toHaveBeenCalledWith('2 of 3 are back: 1 was deleted for good.');
      expect(harness.library.canvases()).toHaveLength(2);
    });

    it('says how many were deleted for good, in the plural', async () => {
      const harness = await three();
      await harness.library.deleteAll();
      const restoreAll = harness.repository.restoreAll.bind(harness.repository);
      vi.spyOn(harness.repository, 'restoreAll').mockImplementation(async (ids) => restoreAll(ids.slice(0, 1)));

      await harness.toasts.undo(harness.toasts.visible()[0]?.id ?? 0);

      expect(harness.announce).toHaveBeenCalledWith('1 of 3 are back: 2 were deleted for good.');
    });

    it('says that nothing could be brought back when every canvas has been deleted for good, and keeps the notice', async () => {
      const harness = await three();
      await harness.library.deleteAll();
      harness.clock.advance(61_000);
      await harness.repository.purgeExpired();

      await harness.toasts.undo(harness.toasts.visible()[0]?.id ?? 0);

      expect(harness.toasts.visible()[0]?.problem).toBe(
        'Nothing could be brought back: every canvas was deleted more than a minute ago.',
      );
    });

    it('says why, in the words of the browser, when it cannot bring them back for another reason', async () => {
      const harness = await three();
      await harness.library.deleteAll();
      vi.spyOn(harness.repository, 'restoreAll').mockResolvedValue({ ok: false, error: broken });

      await harness.toasts.undo(harness.toasts.visible()[0]?.id ?? 0);

      expect(harness.toasts.visible()[0]?.problem).toBe(broken.message);
    });

    it('says why, and changes nothing, when the browser refuses', async () => {
      const harness = await three();
      vi.spyOn(harness.repository, 'softDeleteAll').mockResolvedValue({ ok: false, error: broken });

      const deleted = await harness.library.deleteAll();

      expect(deleted).toBe(false);
      expect(harness.library.problem()).toBe(`The canvases could not be deleted. ${broken.message}`);
      expect(harness.library.canvases()).toHaveLength(3);
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

    it('keeps the other tabs, in their places, when it follows the editor to another canvas', async () => {
      const harness = setup();
      await seed(harness, 'Alpha', 'Beta', 'Gamma');
      await harness.repository.setMeta('openCanvases', ['gamma', 'beta']);
      await harness.repository.setMeta('lastOpenCanvas', 'beta');
      await harness.library.start();

      harness.library.attach({ id: 'alpha', flush: async () => undefined });
      await settle();

      expect(harness.library.tabs().map(({ id }) => id)).toEqual(['gamma', 'alpha']);
      expect(await strip(harness.repository)).toEqual(['gamma', 'alpha']);
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
