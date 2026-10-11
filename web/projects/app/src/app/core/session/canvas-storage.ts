import { DOCUMENT, inject, Injectable, InjectionToken, type OnDestroy, signal } from '@angular/core';
import {
  createIdbRepository,
  createMemoryRepository,
  requestPersistence,
  type CanvasRepository,
  type PersistResult,
  type StorageManagerLike,
} from '@rmq/persistence';

/** The two repositories that a page may use: the browser's, and one in memory for a browser that keeps nothing (ADR-0028). */
export interface RepositoryFactories {
  browser(): CanvasRepository;
  memory(): CanvasRepository;
}

/** The part of `crypto` that an id is made from. */
export type RandomSource = Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID'>>;

/**
 * A random version-4 UUID. `crypto.randomUUID` exists only in a secure context (HTTPS, or localhost), and the page can be opened over plain HTTP, for example before the host has a certificate for its domain;
 * `getRandomValues` is there in every context, and a UUID is made of it the same way.
 */
export function randomId(source: RandomSource = crypto): string {
  if (typeof source.randomUUID === 'function') {
    return source.randomUUID();
  }
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const REPOSITORIES = new InjectionToken<RepositoryFactories>('REPOSITORIES', {
  providedIn: 'root',
  factory: () => {
    const options = { now: () => Date.now(), newId: () => randomId() };
    return { browser: () => createIdbRepository(options), memory: () => createMemoryRepository(options) };
  },
});

/** `navigator.storage`, which asks the browser to keep the canvases and how much room there is. */
export const STORAGE_MANAGER = new InjectionToken<StorageManagerLike | undefined>('STORAGE_MANAGER', {
  providedIn: 'root',
  factory: () => inject(DOCUMENT).defaultView?.navigator.storage,
});

/**
 * Why a storage keeps nothing, when it was made to (ADR-0078): the shared view looks at a canvas and lets the learner change it in memory, and what is changed there never reaches the canvases in the browser. A storage that
 * is given a reason works in memory from the start and says why, as one does that the browser would not let keep anything. Left out, the storage is the page's.
 */
export const MEMORY_ONLY = new InjectionToken<string | null>('MEMORY_ONLY', {
  providedIn: 'root',
  factory: () => null,
});

/**
 * Where the canvases of this page are kept (ADR-0072): one repository for the page, whoever asks, so that the session that saves the canvas
 * that is open and the library that lists, makes and deletes canvases see the same ones. It is the browser's if the browser lets the site
 * keep anything, and a repository in memory if not, and it keeps why. It also holds what the browser said when it was asked to keep the
 * canvases, because that is a fact about the page and not about one canvas, and it is asked once.
 */
@Injectable({ providedIn: 'root' })
export class CanvasStorage implements OnDestroy {
  private readonly factories = inject(REPOSITORIES);
  private readonly manager = inject(STORAGE_MANAGER);
  private readonly memoryOnly = inject(MEMORY_ONLY);

  private current: Promise<CanvasRepository> | undefined;
  private readonly reason = signal<string | undefined>(undefined);
  private readonly said = signal<PersistResult | null>(null);
  private asked = false;

  /** Why the canvases are kept in memory and will be gone when the tab is closed, or `undefined` when the browser keeps them. */
  readonly memoryReason = this.reason.asReadonly();

  /** What the browser said when it was asked to keep the canvases, unless it agreed; `null` until it has said, and when it agreed. */
  readonly persistence = this.said.asReadonly();

  /**
   * The repository of the page. The first call opens the browser's and uses it unless it fails at once, which is what a private window or
   * blocked site data does, and then it works in memory. Every other call gets the same one.
   */
  repository(): Promise<CanvasRepository> {
    this.current ??= this.choose();
    return this.current;
  }

  /**
   * The browser's repository could not do what the app needed (it could not list, or make the first canvas), so the page works in memory from
   * now on, for the `reason` that it gives. If it works in memory already, it answers that one, and the caller has to say what it cannot do.
   */
  async fallBack(reason: string): Promise<CanvasRepository> {
    const failed = await this.repository();
    if (this.reason() !== undefined) {
      return failed;
    }
    this.reason.set(reason);
    const memory = this.factories.memory();
    this.current = Promise.resolve(memory);
    await failed.close();
    return memory;
  }

  /** Asks the browser to keep the canvases, once for the page, whichever screen comes first; it does nothing in memory, where there is nothing to keep. */
  askPersistence(): void {
    if (this.asked || this.reason() !== undefined) {
      return;
    }
    this.asked = true;
    void requestPersistence(this.manager).then((result) => {
      this.said.set(result.status === 'granted' || result.status === 'already' ? null : result);
    });
  }

  ngOnDestroy(): void {
    void this.current?.then((repository) => repository.close());
  }

  private async choose(): Promise<CanvasRepository> {
    if (this.memoryOnly !== null) {
      this.reason.set(this.memoryOnly);
      return this.factories.memory();
    }
    const browser = this.factories.browser();
    const probe = await browser.purgeExpired();
    if (probe.ok) {
      return browser;
    }
    await browser.close();
    this.reason.set(probe.error.message);
    return this.factories.memory();
  }
}
