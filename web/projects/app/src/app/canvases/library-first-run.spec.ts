import { TestBed } from '@angular/core/testing';
import { buildTemplate, templateById } from '@rmq/domain';
import { createMemoryRepository, type CanvasRepository, type Outcome, type RepositoryError } from '@rmq/persistence';
import { idSequence, manualClock, manualTimer } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../core/announcer';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { NOW } from '../core/session/canvas-session';
import { REPOSITORIES, STORAGE_MANAGER } from '../core/session/canvas-storage';
import { TOAST_TIMER, Toasts } from '../core/ui/toasts';
import { FILE_DOWNLOADER } from '../core/files/downloader';
import { OnboardingDialogs } from '../onboarding/dialogs';
import type { Choice } from '../onboarding/template-chooser';
import { TourRequests } from '../onboarding/tour-requests';
import { CanvasLibrary } from './library';

/** What the library does about the first run and about a template (ADR-0082, ADR-0081): it asks, it makes the canvas that was chosen, and it says what to try. */

type Ask = (options: { readonly first: boolean }) => Promise<Choice | undefined>;

function setup(
  options: {
    readonly flags?: string;
    readonly ask?: Ask;
    readonly browser?: (r: CanvasRepository) => CanvasRepository;
  } = {},
) {
  const clock = manualClock(5_000_000);
  const ids = idSequence('c');
  const browser = createMemoryRepository({ now: clock.now, newId: ids });
  const choose = vi.fn<Ask>(options.ask ?? (async () => ({ kind: 'blank' })));
  TestBed.configureTestingModule({
    providers: [
      CanvasLibrary,
      {
        provide: REPOSITORIES,
        useValue: {
          browser: () => options.browser?.(browser) ?? browser,
          memory: () => createMemoryRepository({ now: clock.now, newId: ids }),
        },
      },
      { provide: STORAGE_MANAGER, useValue: undefined },
      { provide: TOAST_TIMER, useValue: manualTimer() },
      { provide: NOW, useValue: clock.now },
      { provide: FILE_DOWNLOADER, useValue: { save: () => undefined } },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: options.flags ?? 'editor,canvases,onboarding' } },
      { provide: OnboardingDialogs, useValue: { choose } },
    ],
  });
  vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
  return {
    library: TestBed.inject(CanvasLibrary),
    repository: browser,
    choose,
    toasts: TestBed.inject(Toasts),
    tours: TestBed.inject(TourRequests),
  };
}

const said = (toasts: Toasts): string[] => toasts.visible().map(({ message }) => message);

const refusing =
  (error: RepositoryError) =>
  (repository: CanvasRepository): CanvasRepository => {
    const wrapped = { ...repository } as CanvasRepository;
    wrapped.create = async () => ({ ok: false, error }) as Outcome<never, RepositoryError>;
    return wrapped;
  };

/** A repository that makes the first canvases it is asked for and refuses the rest. */
const failsAfter =
  (allowed: number, error: RepositoryError) =>
  (repository: CanvasRepository): CanvasRepository => {
    const wrapped = { ...repository } as CanvasRepository;
    let made = 0;
    const create = repository.create.bind(repository);
    wrapped.create = async (canvas) =>
      made++ < allowed ? create(canvas) : ({ ok: false, error } as Outcome<never, RepositoryError>);
    return wrapped;
  };

describe('CanvasLibrary, the first run (ADR-0082)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('makes “Untitled canvas” and asks nothing without the flag onboarding', async () => {
    const { library, choose } = setup({ flags: 'editor,canvases' });

    await library.start();

    expect(choose).not.toHaveBeenCalled();
    expect(library.canvases().map(({ name }) => name)).toEqual(['Untitled canvas']);
    expect(library.view()).toEqual({ kind: 'canvas', id: library.canvases()[0]?.id });
  });

  it('asks what to start with while the home is shown, empty, and makes no canvas until it is answered', async () => {
    let answer: (choice: Choice) => void = () => undefined;
    const { library, choose, repository } = setup({ ask: () => new Promise<Choice>((resolve) => (answer = resolve)) });

    const starting = library.start();
    await vi.waitFor(() => expect(choose).toHaveBeenCalledTimes(1));

    expect(choose).toHaveBeenCalledWith({ first: true });
    expect(library.ready()).toBe(true);
    expect(library.view()).toEqual({ kind: 'home' });
    expect(library.tabs()).toEqual([]);
    const listed = await repository.list();
    expect(listed.ok && listed.value.canvases).toEqual([]);

    answer({ kind: 'blank' });
    await starting;

    expect(library.canvases().map(({ name }) => name)).toEqual(['Untitled canvas']);
  });

  it('makes a template as the first canvas, named after it, shown, and says what to try', async () => {
    const { library, toasts } = setup({ ask: async () => ({ kind: 'template', id: 'routing' }) });

    await library.start();

    const [only, ...others] = library.canvases();
    expect(others).toEqual([]);
    expect(only?.name).toBe('Routing');
    expect(library.tabs()).toEqual([{ id: only?.id, name: 'Routing' }]);
    expect(library.view()).toEqual({ kind: 'canvas', id: only?.id });
    expect(said(toasts)).toEqual([`Opened “Routing”. ${templateById('routing')?.tryThis}`]);
    const record = await library.saveAsFile(only?.id ?? '');
    expect(record.ok).toBe(true);
  });

  it('keeps the document that the commands of the template make', async () => {
    const { library, repository } = setup({ ask: async () => ({ kind: 'template', id: 'topics' }) });

    await library.start();

    const stored = await repository.get(library.canvases()[0]?.id ?? '');
    const template = templateById('topics');
    expect(stored.ok && stored.value.document).toEqual(template && buildTemplate(template));
  });

  it('makes the canvas that the tour is taken on, called “My first topology”, and asks for the tour before the canvas is shown', async () => {
    const { library, tours } = setup({ ask: async () => ({ kind: 'tour' }) });
    let viewWhenAsked: unknown;
    const request = tours.request.bind(tours);
    vi.spyOn(tours, 'request').mockImplementation(() => {
      viewWhenAsked = library.view();
      request();
    });

    await library.start();

    expect(library.canvases().map(({ name }) => name)).toEqual(['My first topology']);
    expect(library.view()).toEqual({ kind: 'canvas', id: library.canvases()[0]?.id });
    // The editor that begins the tour is made when the canvas is shown, so the request has to be there before.
    expect(viewWhenAsked).toEqual({ kind: 'home' });
  });

  it('asks for the tour once, to be taken by the editor that opens next', async () => {
    const { library, tours } = setup({ ask: async () => ({ kind: 'tour' }) });

    await library.start();

    expect(tours.take()).toBe(true);
    expect(tours.take()).toBe(false);
  });

  it.each([[{ kind: 'blank' }], [{ kind: 'template', id: 'topics' }]] as const)(
    'does not ask for the tour when the learner chose %j',
    async (choice) => {
      const { library, tours } = setup({ ask: async () => choice });

      await library.start();

      expect(tours.take()).toBe(false);
    },
  );

  it('does not ask a learner who has a canvas, nor ask for a tour', async () => {
    const { library, choose, repository, tours } = setup();
    await repository.create({ id: 'mine', name: 'Mine', document: buildTemplate(templateById('hello-world')!) });

    await library.start();

    expect(choose).not.toHaveBeenCalled();
    expect(library.view()).toEqual({ kind: 'canvas', id: 'mine' });
    expect(tours.take()).toBe(false);
  });

  it('falls back to memory, as it does for a blank canvas, when the browser refuses the template', async () => {
    const unavailable: RepositoryError = {
      kind: 'unavailable',
      message: 'The browser does not let this site keep canvases.',
    };
    const { library } = setup({
      ask: async () => ({ kind: 'template', id: 'hello-world' }),
      browser: refusing(unavailable),
    });

    await library.start();

    expect(library.canvases().map(({ name }) => name)).toEqual(['Hello World']);
    expect(library.memoryReason()).toBe(unavailable.message);
  });
});

describe('CanvasLibrary, the canvas that was chosen (ADR-0082, ADR-0083)', () => {
  beforeEach(() => TestBed.resetTestingModule());

  async function started() {
    const harness = setup({ ask: async () => ({ kind: 'blank' }) });
    await harness.library.start();
    return harness;
  }

  it('begins a template as a new canvas named after it, opens it in the strip, and says what to try', async () => {
    const { library, toasts } = await started();

    await library.begin({ kind: 'template', id: 'pub-sub' });

    const names = library.tabs().map(({ name }) => name);
    expect(names).toEqual(['Untitled canvas', 'Pub/Sub']);
    expect(library.view()).toEqual({ kind: 'canvas', id: library.tabs()[1]?.id });
    expect(said(toasts)).toEqual([`Opened “Pub/Sub”. ${templateById('pub-sub')?.tryThis}`]);
  });

  it('gives a template that is made again a name that nobody has', async () => {
    const { library } = await started();

    await library.begin({ kind: 'template', id: 'topics' });
    await library.begin({ kind: 'template', id: 'topics' });

    expect(library.tabs().map(({ name }) => name)).toEqual(['Untitled canvas', 'Topics', 'Topics 2']);
  });

  it('begins from scratch as the “New canvas” button does', async () => {
    const { library } = await started();

    await library.begin({ kind: 'blank' });

    expect(library.tabs().map(({ name }) => name)).toEqual(['Untitled canvas', 'Untitled canvas 2']);
  });

  it('begins the tour on a canvas of its own, and asks for it', async () => {
    const { library, tours } = await started();

    await library.begin({ kind: 'tour' });

    expect(library.tabs().map(({ name }) => name)).toEqual(['Untitled canvas', 'My first topology']);
    expect(tours.take()).toBe(true);
  });

  it('asks for the tour only when the learner began the tour', async () => {
    const { library, tours } = await started();

    await library.begin({ kind: 'blank' });
    await library.begin({ kind: 'template', id: 'routing' });

    expect(tours.take()).toBe(false);
  });

  it('takes the request for the tour back when the canvas cannot be made', async () => {
    const broken: RepositoryError = { kind: 'failed', message: 'The browser failed to read or save canvases (boom).' };
    const { library, tours } = setup({ ask: async () => ({ kind: 'blank' }), browser: failsAfter(1, broken) });
    await library.start();

    await library.begin({ kind: 'tour' });

    expect(tours.take()).toBe(false);
    expect(library.problem()).toContain('A canvas could not be made.');
    expect(library.tabs().map(({ name }) => name)).toEqual(['Untitled canvas']);
  });

  it('asks with the home’s question, and makes what was chosen', async () => {
    const { library, choose } = await started();
    choose.mockResolvedValueOnce({ kind: 'template', id: 'headers' });

    await library.newFromTemplate();

    expect(choose).toHaveBeenLastCalledWith({ first: false });
    expect(library.tabs().map(({ name }) => name)).toEqual(['Untitled canvas', 'Headers routing']);
  });

  it('makes nothing when the question is left', async () => {
    const { library, choose } = await started();
    choose.mockResolvedValueOnce(undefined);

    await library.newFromTemplate();

    expect(library.tabs().map(({ name }) => name)).toEqual(['Untitled canvas']);
  });
});
