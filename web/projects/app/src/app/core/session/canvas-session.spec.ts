import { TestBed } from '@angular/core/testing';
import { emptyDocument } from '@rmq/domain';
import {
  createMemoryRepository,
  type CanvasRecord,
  type CanvasRepository,
  type Outcome,
  type RepositoryError,
} from '@rmq/persistence';
import {
  documentOf,
  idSequence,
  manualClock,
  manualTimer,
  queueRecord,
  type ManualClock,
  type ManualTimer,
} from '@rmq/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Announcer } from '../announcer';
import { CommandBus } from '../state/command-bus';
import { DocumentStore } from '../state/document-store';
import { SelectionStore } from '../state/selection-store';
import { StatusStore } from '../state/status-store';
import { AUTOSAVE_TIMER, CanvasSession, NOW, REPOSITORIES, STORAGE_MANAGER, UNTITLED } from './canvas-session';

const quotaError: RepositoryError = {
  kind: 'quota-exceeded',
  message: 'The browser has no room left to keep this canvas.',
};
const unavailable: RepositoryError = {
  kind: 'unavailable',
  message: 'The browser does not let this site keep canvases.',
};

interface Harness {
  readonly session: CanvasSession;
  readonly bus: CommandBus;
  readonly store: DocumentStore;
  readonly repository: CanvasRepository;
  readonly clock: ManualClock;
  readonly timer: ManualTimer;
  readonly storage: {
    readonly persist: Mock<() => Promise<boolean>>;
    readonly persisted: Mock<() => Promise<boolean>>;
    readonly estimate: Mock<() => Promise<{ usage?: number; quota?: number }>>;
  };
  readonly made: { browser: number; memory: number };
}

function setup(options: { readonly browser?: (memory: CanvasRepository) => CanvasRepository } = {}): Harness {
  const clock = manualClock(5_000_000);
  const timer = manualTimer();
  const ids = idSequence('canvas');
  const memory = createMemoryRepository({ now: clock.now, newId: ids });
  const made = { browser: 0, memory: 0 };
  const storage = {
    persist: vi.fn(async () => true),
    persisted: vi.fn(async () => false),
    estimate: vi.fn(async () => ({ usage: 10, quota: 1_000 })),
  };
  TestBed.configureTestingModule({
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CanvasSession,
      {
        provide: REPOSITORIES,
        useValue: {
          browser: () => {
            made.browser += 1;
            return options.browser?.(memory) ?? memory;
          },
          memory: () => {
            made.memory += 1;
            return createMemoryRepository({ now: clock.now, newId: ids });
          },
        },
      },
      { provide: AUTOSAVE_TIMER, useValue: timer },
      { provide: NOW, useValue: clock.now },
      { provide: STORAGE_MANAGER, useValue: storage },
    ],
  });
  vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
  return {
    session: TestBed.inject(CanvasSession),
    bus: TestBed.inject(CommandBus),
    store: TestBed.inject(DocumentStore),
    repository: memory,
    clock,
    timer,
    storage,
    made,
  };
}

/** A repository that answers like the one given, except that some calls are made to fail. */
function failing(
  repository: CanvasRepository,
  fail: Partial<Record<'list' | 'create' | 'save' | 'purgeExpired', RepositoryError>>,
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

const declare = (bus: CommandBus, name: string) => bus.apply({ type: 'declare-queue', name, durable: true }, 'gesture');
const stored = async (repository: CanvasRepository, id: string): Promise<CanvasRecord> => {
  const result = await repository.get(id);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.value;
};

describe('CanvasSession', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('opening', () => {
    it('makes the one implicit canvas when there is none, and opens it empty, and remembers it', async () => {
      const { session, store, repository } = setup();
      expect(session.save()).toEqual({ kind: 'opening' });

      await session.open();

      const listed = await repository.list();
      expect(listed.ok && listed.value.canvases).toHaveLength(1);
      const [canvas] = listed.ok ? listed.value.canvases : [];
      expect(canvas?.name).toBe(UNTITLED);
      expect(store.document()).toEqual(emptyDocument());
      expect(await repository.getMeta('lastOpenCanvas')).toEqual({ ok: true, value: canvas?.id });
      expect(session.save()).toMatchObject({ kind: 'saved' });
      expect(session.name()).toBe(UNTITLED);
    });

    it('opens the canvas that was open last, and not the one that was edited last, when it is still there', async () => {
      const { session, store, repository } = setup();
      const first = await repository.create({
        name: 'First',
        document: documentOf({ queues: { q1: queueRecord('one') } }),
      });
      await repository.create({ name: 'Second', document: documentOf({ queues: { q1: queueRecord('two') } }) });
      await repository.setMeta('lastOpenCanvas', first.ok ? first.value.id : '');

      await session.open();

      expect(store.document().queues['q1']?.name).toBe('one');
      expect(session.name()).toBe('First');
    });

    it('opens the canvas that was edited last when the one that was open is gone, or was never remembered', async () => {
      const { session, store, repository } = setup();
      await repository.create({ name: 'Older', document: documentOf({ queues: { q1: queueRecord('older') } }) });
      await repository.create({ name: 'Newer', document: documentOf({ queues: { q1: queueRecord('newer') } }) });
      await repository.setMeta('lastOpenCanvas', 'gone');

      await session.open();

      expect(session.name()).toBe('Older');
      expect(store.document().queues['q1']?.name).toBe('older');
    });

    it('opens a canvas without a past, whatever was done before it was opened', async () => {
      const { session, store } = setup();
      await session.open();

      expect(store.canUndo()).toBe(false);
    });

    it('purges the tombstones that have expired, when it starts', async () => {
      const { session, repository, clock } = setup();
      const made = await repository.create({ name: 'Old', document: emptyDocument() });
      await repository.softDelete(made.ok ? made.value.id : '');
      clock.advance(61_000);
      const purge = vi.spyOn(repository, 'purgeExpired');

      await session.open();

      expect(purge).toHaveBeenCalledTimes(1);
      expect(await repository.restore(made.ok ? made.value.id : '')).toMatchObject({ ok: false });
    });

    it('leaves a canvas that cannot be read as it is, opens one that can, and says how many there are', async () => {
      const { session, repository } = setup({
        browser: (memory) => ({
          ...memory,
          list: async () => {
            const listed = await memory.list();
            return listed.ok
              ? {
                  ok: true,
                  value: {
                    ...listed.value,
                    unreadable: [
                      {
                        id: 'newer',
                        name: 'From a newer version',
                        error: { kind: 'newer-version', of: 'schema', found: 9, understood: 1, message: 'Newer.' },
                      },
                    ],
                  },
                }
              : listed;
          },
        }),
      });

      await session.open();

      expect(session.unreadable()).toBe(1);
      const listed = await repository.list();
      expect(listed.ok && listed.value.canvases).toHaveLength(1);
    });
  });

  describe('when the browser does not let the site keep canvases', () => {
    it('works on a repository in memory, and says in words that nothing is kept', async () => {
      const { session, bus, made } = setup({ browser: (memory) => failing(memory, { list: unavailable }) });

      await session.open();

      expect(made.memory).toBe(1);
      expect(session.save()).toEqual({ kind: 'memory', reason: unavailable.message });
      declare(bus, 'billing');
      await session.flush();
      expect(session.save()).toEqual({ kind: 'memory', reason: unavailable.message });
    });

    it('also falls back when the canvas cannot be made, for a full disk, say', async () => {
      const { session, made } = setup({ browser: (memory) => failing(memory, { create: quotaError }) });

      await session.open();

      expect(made.memory).toBe(1);
      expect(session.save()).toMatchObject({ kind: 'memory', reason: quotaError.message });
    });
  });

  describe('saving', () => {
    it('writes the document once the changes stop, 500 ms after the last, and says what it came to', async () => {
      const { session, bus, repository, timer } = setup();
      await session.open();
      const id = await currentId(repository);

      declare(bus, 'billing');
      expect(session.save()).toEqual({ kind: 'saving' });
      timer.advance(499);
      expect((await stored(repository, id)).document.queues).toEqual({});
      timer.advance(1);
      await session.flush();

      expect(Object.values((await stored(repository, id)).document.queues).map((queue) => queue.name)).toEqual([
        'billing',
      ]);
      expect(session.save()).toEqual({ kind: 'saved', at: 5_000_000 });
    });

    it('writes one document for a run of changes, the last', async () => {
      const { session, bus, repository, timer } = setup();
      await session.open();
      const id = await currentId(repository);
      const save = vi.spyOn(repository, 'save');

      declare(bus, 'a');
      timer.advance(300);
      declare(bus, 'b');
      timer.advance(300);
      declare(bus, 'c');
      timer.advance(500);
      await session.flush();

      expect(save).toHaveBeenCalledTimes(1);
      expect((await stored(repository, id)).document.queues).toHaveProperty('q3');
    });

    it('does not write the canvas that it opened, so that opening is not an edit', async () => {
      const { session, repository, timer } = setup();
      await session.open();
      const save = vi.spyOn(repository, 'save');

      timer.advance(10_000);
      await session.flush();

      expect(save).not.toHaveBeenCalled();
    });

    it('saves undo and redo as it saves any other change', async () => {
      const { session, bus, repository, timer } = setup();
      await session.open();
      const id = await currentId(repository);
      declare(bus, 'billing');
      timer.advance(500);
      await session.flush();

      bus.undo();
      timer.advance(500);
      await session.flush();
      expect((await stored(repository, id)).document.queues).toEqual({});

      bus.redo();
      timer.advance(500);
      await session.flush();
      expect(Object.keys((await stored(repository, id)).document.queues)).toHaveLength(1);
    });

    it('writes nothing, and says it is saved, when the changes were taken back before anything was written', async () => {
      const { session, bus, repository, timer } = setup();
      await session.open();
      const save = vi.spyOn(repository, 'save');

      declare(bus, 'billing');
      expect(session.save()).toEqual({ kind: 'saving' });
      bus.undo();

      expect(session.save().kind).toBe('saved');
      timer.advance(10_000);
      await session.flush();
      expect(save).not.toHaveBeenCalled();
    });

    it('writes again when a change comes while a write is under way, so that the last document is the one that is kept', async () => {
      const { session, bus, repository, timer } = setup();
      await session.open();
      const id = await currentId(repository);
      declare(bus, 'a');
      timer.advance(500);
      declare(bus, 'b'); // while the first write is under way
      timer.advance(500);
      await session.flush();

      expect(Object.keys((await stored(repository, id)).document.queues)).toHaveLength(2);
      expect(session.save().kind).toBe('saved');
    });

    it('says what is wrong when a write fails, keeps the document, and writes it with the next change', async () => {
      let broken = true;
      const { session, bus, repository, timer } = setup({
        browser: (memory) => ({
          ...memory,
          save: async (id, change) => (broken ? { ok: false, error: quotaError } : memory.save(id, change)),
        }),
      });
      await session.open();
      const id = await currentId(repository);

      declare(bus, 'a');
      timer.advance(500);
      await session.flush();
      expect(session.save()).toEqual({ kind: 'failed', error: quotaError });

      broken = false;
      declare(bus, 'b');
      timer.advance(500);
      await session.flush();
      expect(session.save().kind).toBe('saved');
      expect(Object.keys((await stored(repository, id)).document.queues)).toHaveLength(2);
    });

    it('flushes at once, without waiting for the delay, when the page is hidden', async () => {
      const { session, bus, repository } = setup();
      await session.open();
      const id = await currentId(repository);
      declare(bus, 'billing');

      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      await session.flush();

      expect(Object.keys((await stored(repository, id)).document.queues)).toHaveLength(1);
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('does not flush when the page becomes visible again, because there is nothing to hurry', async () => {
      const { session, bus, repository } = setup();
      await session.open();
      declare(bus, 'billing');
      const save = vi.spyOn(repository, 'save');

      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();

      expect(save).not.toHaveBeenCalled();
    });

    it('flushes at once when the page is left', async () => {
      const { session, bus, repository } = setup();
      await session.open();
      const id = await currentId(repository);
      declare(bus, 'billing');

      window.dispatchEvent(new Event('pagehide'));
      await session.flush();

      expect(Object.keys((await stored(repository, id)).document.queues)).toHaveLength(1);
    });

    it('stops listening to the page, and saving, once it is closed', async () => {
      const { session, bus, repository, timer } = setup();
      await session.open();
      declare(bus, 'billing');
      session.close();
      const save = vi.spyOn(repository, 'save');

      window.dispatchEvent(new Event('pagehide'));
      timer.advance(10_000);
      declare(bus, 'another');
      await Promise.resolve();

      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('asking the browser to keep the canvas', () => {
    it('asks once, after the first save that worked, and not when the app starts', async () => {
      const { session, bus, timer, storage } = setup();
      await session.open();
      expect(storage.persist).not.toHaveBeenCalled();

      declare(bus, 'a');
      timer.advance(500);
      await session.flush();
      await vi.waitFor(() => expect(storage.persist).toHaveBeenCalledTimes(1));

      declare(bus, 'b');
      timer.advance(500);
      await session.flush();
      expect(storage.persist).toHaveBeenCalledTimes(1);
    });

    it('says nothing when the browser agrees, and tells the learner to make a backup when it does not', async () => {
      const agreed = setup();
      await agreed.session.open();
      declare(agreed.bus, 'a');
      agreed.timer.advance(500);
      await agreed.session.flush();
      await vi.waitFor(() => expect(agreed.storage.persist).toHaveBeenCalled());
      expect(agreed.session.persistence()).toBeNull();

      TestBed.resetTestingModule();
      const refused = setup();
      refused.storage.persist.mockResolvedValue(false);
      await refused.session.open();
      declare(refused.bus, 'a');
      refused.timer.advance(500);
      await refused.session.flush();
      await vi.waitFor(() => expect(refused.session.persistence()?.status).toBe('denied'));
      expect(refused.session.persistence()?.message).toContain('backup');
    });

    it('does not ask when the canvas is kept in memory, because there is nothing to keep', async () => {
      const { session, bus, timer, storage } = setup({ browser: (memory) => failing(memory, { list: unavailable }) });
      await session.open();

      declare(bus, 'a');
      timer.advance(500);
      await session.flush();
      await Promise.resolve();

      expect(storage.persist).not.toHaveBeenCalled();
    });
  });

  describe('the room that the browser allows', () => {
    it('warns when a save fails for lack of room, with the sentence of the repository and the browser estimate', async () => {
      const { session, bus, timer, storage } = setup({
        browser: (memory) => ({ ...memory, save: async () => ({ ok: false, error: quotaError }) }),
      });
      storage.estimate.mockResolvedValue({ usage: 960, quota: 1_000 });
      await session.open();

      declare(bus, 'a');
      timer.advance(500);
      await session.flush();
      await vi.waitFor(() => expect(session.quota()?.level).toBe('critical'));

      expect(session.save()).toEqual({ kind: 'failed', error: quotaError });
      expect(session.quota()?.message).toContain('almost no room');
    });

    it('reads the estimate after saves, at most once in half a minute, and warns when it is low', async () => {
      const { session, bus, timer, storage, clock } = setup();
      storage.estimate.mockResolvedValue({ usage: 850, quota: 1_000 });
      await session.open();

      declare(bus, 'a');
      timer.advance(500);
      await session.flush();
      await vi.waitFor(() => expect(session.quota()?.level).toBe('low'));
      expect(storage.estimate).toHaveBeenCalledTimes(1);

      clock.advance(10_000);
      declare(bus, 'b');
      timer.advance(500);
      await session.flush();
      expect(storage.estimate).toHaveBeenCalledTimes(1);

      clock.advance(30_000);
      declare(bus, 'c');
      timer.advance(500);
      await session.flush();
      await vi.waitFor(() => expect(storage.estimate).toHaveBeenCalledTimes(2));
    });

    it('says nothing while there is plenty of room, and clears a warning when there is again', async () => {
      const { session, bus, timer, storage, clock } = setup();
      storage.estimate
        .mockResolvedValueOnce({ usage: 900, quota: 1_000 })
        .mockResolvedValue({ usage: 10, quota: 1_000 });
      await session.open();
      declare(bus, 'a');
      timer.advance(500);
      await session.flush();
      await vi.waitFor(() => expect(session.quota()?.level).toBe('low'));

      clock.advance(60_000);
      declare(bus, 'b');
      timer.advance(500);
      await session.flush();
      await vi.waitFor(() => expect(session.quota()).toBeNull());
    });

    it('does not mind a browser that does not say', async () => {
      const { session, bus, timer, storage } = setup();
      storage.estimate.mockRejectedValue(new Error('no'));
      await session.open();

      declare(bus, 'a');
      timer.advance(500);
      await session.flush();
      await Promise.resolve();

      expect(session.quota()).toBeNull();
      expect(session.save().kind).toBe('saved');
    });
  });
});

/** The id of the one canvas in a repository. */
async function currentId(repository: CanvasRepository): Promise<string> {
  const listed = await repository.list();
  const id = listed.ok ? listed.value.canvases[0]?.id : undefined;
  if (id === undefined) {
    throw new Error('there is no canvas');
  }
  return id;
}
