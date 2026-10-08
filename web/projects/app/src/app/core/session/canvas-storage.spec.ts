import { TestBed } from '@angular/core/testing';
import { emptyDocument } from '@rmq/domain';
import { createMemoryRepository, type CanvasRepository, type RepositoryError } from '@rmq/persistence';
import { idSequence, manualClock } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CanvasStorage, REPOSITORIES, STORAGE_MANAGER } from './canvas-storage';

const unavailable: RepositoryError = {
  kind: 'unavailable',
  message: 'The browser does not let this site keep canvases.',
};

interface Harness {
  readonly storage: CanvasStorage;
  /** The repositories that were made, in the order that they were made, with which factory made each. */
  readonly made: { readonly kind: 'browser' | 'memory'; readonly repository: CanvasRepository }[];
  readonly manager: {
    readonly persist: Mock<() => Promise<boolean>>;
    readonly persisted: Mock<() => Promise<boolean>>;
  };
}

function setup(
  options: {
    readonly browser?: (memory: CanvasRepository) => CanvasRepository;
    readonly persisted?: boolean;
    readonly persist?: boolean | Error;
  } = {},
): Harness {
  const clock = manualClock(1_000);
  const ids = idSequence('c');
  const made: Harness['made'] = [];
  const make = (kind: 'browser' | 'memory') => {
    const memory = createMemoryRepository({ now: clock.now, newId: ids });
    const repository = kind === 'browser' ? (options.browser?.(memory) ?? memory) : memory;
    made.push({ kind, repository });
    return repository;
  };
  const manager = {
    persist: vi.fn(async () => {
      if (options.persist instanceof Error) {
        throw options.persist;
      }
      return options.persist ?? true;
    }),
    persisted: vi.fn(async () => options.persisted ?? false),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: REPOSITORIES, useValue: { browser: () => make('browser'), memory: () => make('memory') } },
      { provide: STORAGE_MANAGER, useValue: manager },
    ],
  });
  return { storage: TestBed.inject(CanvasStorage), made, manager };
}

const failing = (repository: CanvasRepository, name: 'purgeExpired' | 'list'): CanvasRepository => ({
  ...repository,
  [name]: async () => ({ ok: false, error: unavailable }),
});

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('CanvasStorage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('the repository of the page', () => {
    it('is the browser’s, and is the same one for whoever asks, however many times', async () => {
      const { storage, made } = setup();

      const [first, second] = await Promise.all([storage.repository(), storage.repository()]);
      const third = await storage.repository();

      expect(second).toBe(first);
      expect(third).toBe(first);
      expect(made.map(({ kind }) => kind)).toEqual(['browser']);
      expect(storage.memoryReason()).toBeUndefined();
    });

    it('removes the tombstones that have expired when it is first asked for, and not again', async () => {
      const purge = vi.fn();
      const { storage } = setup({
        browser: (memory) => ({
          ...memory,
          purgeExpired: async () => {
            purge();
            return memory.purgeExpired();
          },
        }),
      });

      await storage.repository();
      await storage.repository();

      expect(purge).toHaveBeenCalledTimes(1);
    });

    it('works in memory, and says why, when the browser does not let the site keep anything', async () => {
      const { storage, made } = setup({ browser: (memory) => failing(memory, 'purgeExpired') });

      const repository = await storage.repository();

      expect(made.map(({ kind }) => kind)).toEqual(['browser', 'memory']);
      expect(repository).toBe(made[1]?.repository);
      expect(storage.memoryReason()).toBe(unavailable.message);
      expect(await storage.repository()).toBe(repository);
    });

    it('lets go of the browser’s repository when it works in memory instead', async () => {
      const closed: string[] = [];
      const { storage } = setup({
        browser: (memory) => ({ ...failing(memory, 'purgeExpired'), close: async () => void closed.push('browser') }),
      });

      await storage.repository();

      expect(closed).toEqual(['browser']);
    });
  });

  describe('falling back', () => {
    it('moves the page to memory, with the reason, and closes the browser’s repository', async () => {
      const { storage, made } = setup();
      const browser = await storage.repository();
      const close = vi.spyOn(browser, 'close');

      const memory = await storage.fallBack('The browser has no room left.');

      expect(memory).toBe(made[1]?.repository);
      expect(made.map(({ kind }) => kind)).toEqual(['browser', 'memory']);
      expect(storage.memoryReason()).toBe('The browser has no room left.');
      expect(close).toHaveBeenCalledTimes(1);
      expect(await storage.repository()).toBe(memory);
    });

    it('does nothing the second time, because there is nowhere further to go, and keeps the first reason', async () => {
      const { storage, made } = setup();
      await storage.repository();
      const memory = await storage.fallBack('First.');

      const again = await storage.fallBack('Second.');

      expect(again).toBe(memory);
      expect(made.map(({ kind }) => kind)).toEqual(['browser', 'memory']);
      expect(storage.memoryReason()).toBe('First.');
    });

    it('does nothing more when it was already in memory from the start', async () => {
      const { storage, made } = setup({ browser: (memory) => failing(memory, 'purgeExpired') });
      const memory = await storage.repository();

      const again = await storage.fallBack('Later.');

      expect(again).toBe(memory);
      expect(made).toHaveLength(2);
      expect(storage.memoryReason()).toBe(unavailable.message);
    });
  });

  describe('asking the browser to keep the canvases', () => {
    it('asks once for the page, however often it is asked to ask, and keeps what the browser said when it did not agree', async () => {
      const { storage, manager } = setup({ persist: false });
      expect(storage.persistence()).toBeNull();

      storage.askPersistence();
      storage.askPersistence();
      await settle();
      storage.askPersistence();
      await settle();

      expect(manager.persist).toHaveBeenCalledTimes(1);
      expect(storage.persistence()).toMatchObject({ status: 'denied' });
    });

    it('keeps nothing when the browser agrees, or has already promised', async () => {
      const agreed = setup({ persist: true });
      agreed.storage.askPersistence();
      await settle();
      expect(agreed.storage.persistence()).toBeNull();

      TestBed.resetTestingModule();
      const promised = setup({ persisted: true });
      promised.storage.askPersistence();
      await settle();
      expect(promised.manager.persist).not.toHaveBeenCalled();
      expect(promised.storage.persistence()).toBeNull();
    });

    it('keeps what the browser said when asking failed', async () => {
      const { storage } = setup({ persist: new Error('no') });

      storage.askPersistence();
      await settle();

      expect(storage.persistence()).toMatchObject({ status: 'failed' });
    });

    it('does not ask when the canvases are in memory, because there is nothing to keep', async () => {
      const { storage, manager } = setup({ browser: (memory) => failing(memory, 'purgeExpired') });
      await storage.repository();

      storage.askPersistence();
      await settle();

      expect(manager.persist).not.toHaveBeenCalled();
      expect(storage.persistence()).toBeNull();
    });
  });

  it('lets go of the repository when the page is destroyed', async () => {
    const { storage } = setup();
    const repository = await storage.repository();
    const close = vi.spyOn(repository, 'close');

    storage.ngOnDestroy();
    await settle();

    expect(close).toHaveBeenCalledTimes(1);
  });

  it('lets go of nothing when no repository was ever asked for', () => {
    const { storage, made } = setup();

    expect(() => storage.ngOnDestroy()).not.toThrow();
    expect(made).toEqual([]);
  });

  it('makes a canvas that the next screen can read, whichever repository it is', async () => {
    const { storage } = setup({ browser: (memory) => failing(memory, 'purgeExpired') });

    const repository = await storage.repository();
    await repository.create({ name: 'Orders', document: emptyDocument() });

    const listed = await (await storage.repository()).list();
    expect(listed.ok && listed.value.canvases.map(({ name }) => name)).toEqual(['Orders']);
  });
});
