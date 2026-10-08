import { computed, DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { emptyDocument, type CanvasDocument } from '@rmq/domain';
import {
  createAutosave,
  failure,
  quotaWarning,
  readUsage,
  succeed,
  systemTimer,
  type Autosave,
  type AutosaveTimer,
  type CanvasRecord,
  type CanvasRepository,
  type Outcome,
  type QuotaWarning,
  type RepositoryError,
} from '@rmq/persistence';
import { CommandBus } from '../state/command-bus';
import { DocumentStore, type ChangeCause } from '../state/document-store';
import { CANVAS_HOST } from './canvas-host';
import { CanvasStorage, STORAGE_MANAGER } from './canvas-storage';

// The two repositories and the storage manager are the page's (ADR-0072); a spec that decides which the page gets still says so from here.
export { REPOSITORIES, STORAGE_MANAGER, type RepositoryFactories } from './canvas-storage';

/** The name of the one canvas that the editor makes for a learner who has none. S9 lets them name it. */
export const UNTITLED = 'Untitled canvas';

/** The estimate of the browser is read after a save, but not more often than this. */
const QUOTA_READ_EVERY_MS = 30_000;

/** The timer that the autosave waits with. A spec moves its own by hand. */
export const AUTOSAVE_TIMER = new InjectionToken<AutosaveTimer>('AUTOSAVE_TIMER', {
  providedIn: 'root',
  factory: () => systemTimer,
});

export const NOW = new InjectionToken<() => number>('NOW', { providedIn: 'root', factory: () => () => Date.now() });

/** What each write came to, for the top bar to show. */
export type SaveState =
  | { readonly kind: 'opening' }
  | { readonly kind: 'saved'; readonly at?: number }
  | { readonly kind: 'saving' }
  | { readonly kind: 'failed'; readonly error: RepositoryError }
  /** The browser does not let the site keep canvases, so this one is kept until the tab is closed. */
  | { readonly kind: 'memory'; readonly reason: string };

interface Opened {
  readonly record: CanvasRecord;
  readonly unreadable: number;
}

/**
 * The canvas that is open, and keeping it (ADR-0031, ADR-0028, ADR-0072). It opens the canvas that the workspace asks for, or, without a workspace, the
 * canvas that was open last, or the most recent, or makes one if there is none. It saves every document that the editor makes, 500 ms after the last
 * change, and at once when the page is hidden or left, and when the editor goes. It says what each write came to, asks the browser to keep the canvases
 * once for the page, after the first save that worked, and warns when the room is running out. If the browser does not let the site keep anything, the
 * page works in memory and the session says so. The repository is the page's, and the session does not close it.
 */
@Injectable()
export class CanvasSession {
  private readonly pageStorage = inject(CanvasStorage);
  private readonly host = inject(CANVAS_HOST);
  private readonly timer = inject(AUTOSAVE_TIMER);
  private readonly now = inject(NOW);
  private readonly manager = inject(STORAGE_MANAGER);
  private readonly page = inject(DOCUMENT);
  private readonly store = inject(DocumentStore);
  private readonly bus = inject(CommandBus);

  private readonly saveState = signal<SaveState>({ kind: 'opening' });
  private readonly canvasName = signal(UNTITLED);
  private readonly unreadableCount = signal(0);
  private readonly persistRead = signal(false);
  private readonly quotaResult = signal<QuotaWarning | null>(null);

  readonly save = this.saveState.asReadonly();
  readonly name = this.canvasName.asReadonly();
  /** How many canvases in the browser could not be opened (a newer version saved them, or they are damaged). Nothing was changed. */
  readonly unreadable = this.unreadableCount.asReadonly();
  /** What the browser said when it was asked to keep the canvases, unless it agreed, and until the learner has read it. */
  readonly persistence = computed(() => (this.persistRead() ? null : this.pageStorage.persistence()));
  /** A warning that the room is running out, or `null`. */
  readonly quota = this.quotaResult.asReadonly();

  /** The learner has read what the browser said about keeping the canvases, and it goes away from the status strip for as long as the page is open. */
  dismissPersistence(): void {
    this.persistRead.set(true);
  }

  private autosave: Autosave<CanvasDocument> | undefined;
  /** The document that is kept, as far as the session knows: the one it opened, or the last one that was written. */
  private persisted: CanvasDocument | undefined;
  /** Why the canvas is kept in memory, when it is. */
  private memoryReason: string | undefined;
  private lastQuotaRead: number | undefined;
  private cleanups: (() => void)[] = [];

  /** Opens the canvas with this id; without one, the canvas that the workspace wants, and without a workspace the one that was open last (ADR-0072). */
  async open(canvas?: string): Promise<void> {
    const wanted = canvas ?? this.host?.canvasToOpen();
    let repository = await this.pageStorage.repository();
    let opened = await this.pick(repository, wanted);
    if (!opened.ok && this.pageStorage.memoryReason() === undefined) {
      repository = await this.pageStorage.fallBack(opened.error.message);
      opened = await this.pick(repository, wanted);
    }
    if (!opened.ok) {
      // A repository in memory keeps its records in a map, and does not fail.
      throw new Error(`A canvas could not be opened in memory: ${opened.error.message}`);
    }

    const { record, unreadable } = opened.value;
    this.memoryReason = this.pageStorage.memoryReason();
    this.persisted = record.document;
    this.canvasName.set(record.name);
    this.unreadableCount.set(unreadable);
    this.bus.load(record.document);

    const autosave = createAutosave<CanvasDocument>({
      write: (document) => repository.save(record.id, { document }),
      timer: this.timer,
      onResult: (result) => this.written(result),
    });
    this.autosave = autosave;
    this.cleanups.push(this.store.subscribe((document, cause) => this.changed(document, cause)));
    if (this.host !== null) {
      this.cleanups.push(this.host.attach({ id: record.id, flush: () => this.flush() }));
    }
    this.saveState.set(
      this.memoryReason === undefined ? { kind: 'saved' } : { kind: 'memory', reason: this.memoryReason },
    );

    const view = this.page.defaultView;
    const hide = () => {
      if (this.page.visibilityState === 'hidden') {
        void this.flush();
      }
    };
    const leave = () => void this.flush();
    this.page.addEventListener('visibilitychange', hide);
    view?.addEventListener('pagehide', leave);
    this.cleanups.push(() => {
      this.page.removeEventListener('visibilitychange', hide);
      view?.removeEventListener('pagehide', leave);
    });
  }

  /** Writes what is waiting now, and waits for a write that is under way. */
  async flush(): Promise<void> {
    await this.autosave?.flush();
  }

  /**
   * Stops listening to the page and the document, and writes what is waiting, so that a canvas that the learner leaves keeps its last change
   * (ADR-0072). The repository is the page's, and stays open.
   */
  close(): void {
    for (const cleanup of this.cleanups) {
      cleanup();
    }
    this.cleanups = [];
    void this.autosave?.flush();
  }

  /** The canvas to open, and how many could not be read. A failure of the browser is the answer, not an exception. */
  private async pick(repository: CanvasRepository, asked?: string): Promise<Outcome<Opened, RepositoryError>> {
    const listed = await repository.list();
    if (!listed.ok) {
      return listed;
    }
    const { canvases, unreadable } = listed.value;
    const remembered = await repository.getMeta('lastOpenCanvas');
    const wanted = [asked, remembered.ok ? remembered.value : undefined];
    const chosen =
      wanted.map((id) => canvases.find((canvas) => canvas.id === id)).find((found) => found !== undefined) ??
      canvases[0];
    const record =
      chosen === undefined ? await repository.create({ name: UNTITLED, document: emptyDocument() }) : succeed(chosen);
    if (!record.ok) {
      return failure(record.error);
    }
    await repository.setMeta('lastOpenCanvas', record.value.id);
    return succeed({ record: record.value, unreadable: unreadable.length });
  }

  private changed(document: CanvasDocument, cause: ChangeCause): void {
    if (cause === 'load' || this.autosave === undefined) {
      return;
    }
    if (document === this.persisted) {
      // Back to what is kept: what was waiting is not wanted, and nothing needs writing.
      this.autosave.cancel();
      this.markSaved();
      return;
    }
    this.autosave.schedule(document);
    this.markSaving();
  }

  private written(result: Outcome<CanvasDocument>): void {
    if (!result.ok) {
      if (this.memoryReason === undefined) {
        this.saveState.set({ kind: 'failed', error: result.error });
      }
      if (result.error.kind === 'quota-exceeded') {
        void this.readQuota(true);
      }
      return;
    }
    this.persisted = result.value;
    const current = this.store.document();
    if (current !== result.value && this.autosave?.pending !== true) {
      // The canvas changed while this was being written, and the change that was waiting has been taken back.
      this.autosave?.schedule(current);
      this.markSaving();
    } else if (current === result.value) {
      this.markSaved();
    }
    if (this.memoryReason === undefined) {
      this.afterSave();
    }
  }

  private markSaving(): void {
    if (this.memoryReason === undefined) {
      this.saveState.set({ kind: 'saving' });
    }
  }

  private markSaved(): void {
    if (this.memoryReason === undefined) {
      this.saveState.set({ kind: 'saved', at: this.now() });
    }
  }

  /** What is done after a write that worked: ask to keep the canvases, once, and look at the room. */
  private afterSave(): void {
    this.pageStorage.askPersistence();
    void this.readQuota(false);
  }

  private async readQuota(force: boolean): Promise<void> {
    const now = this.now();
    if (!force && this.lastQuotaRead !== undefined && now - this.lastQuotaRead < QUOTA_READ_EVERY_MS) {
      return;
    }
    this.lastQuotaRead = now;
    const usage = await readUsage(this.manager);
    if (usage.ok) {
      const warning = quotaWarning(usage.value);
      this.quotaResult.set(warning.level === 'ok' ? null : warning);
    }
  }
}
