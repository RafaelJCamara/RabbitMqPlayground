import { computed, inject, Injectable, signal } from '@angular/core';
import { buildTemplate, emptyDocument, templateById, type CanvasDocument, type Template } from '@rmq/domain';
import {
  failure,
  parseBackup,
  parseCanvasFile,
  quotaWarning,
  readUsage,
  restoreBackup,
  succeed,
  writeBackup,
  writeCanvasFile,
  type CanvasRecord,
  type CanvasRepository,
  type Outcome,
  type QuotaWarning,
  type RepositoryError,
  type RestoreReport,
  type StorageUsage,
  type UnreadableCanvas,
} from '@rmq/persistence';
import { Announcer } from '../core/announcer';
import type { CanvasHost, OpenEditor } from '../core/session/canvas-host';
import { NOW } from '../core/session/canvas-session';
import { CanvasStorage, STORAGE_MANAGER } from '../core/session/canvas-storage';
import { Toasts } from '../core/ui/toasts';
import { formatChord } from '../editor/keyboard';
import { backupDone, type BackupDone } from './backup-words';
import { FILE_DOWNLOADER } from '../core/files/downloader';
import { OnboardingDialogs } from '../onboarding/dialogs';
import { BLANK, type Choice } from '../onboarding/template-chooser';
import { TourRequests } from '../onboarding/tour-requests';
import { ShareDialogs } from '../share/dialogs';
import { readText, tooBigToRead } from './file-text';
import { backupFileName, canvasFileName } from '../core/files/file-names';
import { copyName, nameProblem, TOUR_CANVAS, UNTITLED, uniqueName } from './names';
import { backupReminder, SNOOZE_MS } from './reminder';
import { summarise, type CanvasSummary } from './summary';

/** What the workspace shows: the home, or one canvas in the editor (ADR-0072). */
export type View = { readonly kind: 'home' } | { readonly kind: 'canvas'; readonly id: string };

/** One item of the strip of open canvases. */
export interface Tab {
  readonly id: string;
  readonly name: string;
}

const HOME: View = { kind: 'home' };

const sameView = (a: View, b: View): boolean =>
  a.kind === b.kind && (a.kind === 'home' || (b.kind === 'canvas' && a.id === b.id));

/**
 * The canvases of the browser, as the screens see them (ADR-0072, ADR-0073): which exist, which are open in the strip, which is shown, and what is
 * done to them. It lists, makes, renames and duplicates canvases through the repository of the page, and keeps what the home shows of each; it does
 * not touch the document of the canvas that is open, which the session saves. It is the host that the editor's session asks which canvas to open, and
 * it waits for the editor that is open to finish writing before it changes what is shown.
 */
@Injectable()
export class CanvasLibrary implements CanvasHost {
  private readonly storage = inject(CanvasStorage);
  private readonly announcer = inject(Announcer);
  private readonly toasts = inject(Toasts);
  private readonly downloader = inject(FILE_DOWNLOADER);
  private readonly sharing = inject(ShareDialogs);
  private readonly chooser = inject(OnboardingDialogs);
  private readonly tours = inject(TourRequests);
  private readonly now = inject(NOW);
  private readonly manager = inject(STORAGE_MANAGER);

  private readonly summaries = signal<readonly CanvasSummary[]>([]);
  private readonly unreadableCanvases = signal<readonly UnreadableCanvas[]>([]);
  private readonly openIds = signal<readonly string[]>([]);
  private readonly current = signal<View>(HOME);
  private readonly started = signal(false);
  private readonly trouble = signal<string | null>(null);
  private readonly backups = signal<{ readonly last: number | undefined; readonly snoozedUntil: number | undefined }>({
    last: undefined,
    snoozedUntil: undefined,
  });
  private readonly storageUsage = signal<StorageUsage | null>(null);
  /** The time at which the home was last read, which is what the reminder is judged at (the reminder is not a clock). */
  private readonly readAt = signal(0);
  private editor: OpenEditor | undefined;
  /** Counts the changes of what is shown, so that one that waited for an editor to write does not undo a later one. */
  private showing = 0;

  /** Every canvas that can be read, as the home knows them. */
  readonly canvases = this.summaries.asReadonly();
  /** The canvases that are in the browser and cannot be read (ADR-0073). */
  readonly unreadable = this.unreadableCanvases.asReadonly();
  readonly view = this.current.asReadonly();
  /** Whether the library has read the browser's canvases and decided what to show, which is when the workspace can show anything. */
  readonly ready = this.started.asReadonly();
  /** Why the canvases could not be read or what could not be done, in words, or `null`. */
  readonly problem = this.trouble.asReadonly();
  /** How much room the browser allows the canvases and how much they use, as of the last read, or `null` if the browser does not say. */
  readonly usage = this.storageUsage.asReadonly();
  /** A warning that the room is running out, or `null` (ADR-0075). */
  readonly quota = computed<QuotaWarning | null>(() => {
    const usage = this.storageUsage();
    const warning = usage === null ? null : quotaWarning(usage);
    return warning === null || warning.level === 'ok' ? null : warning;
  });
  /** What the browser said when it was asked to keep the canvases, unless it agreed (ADR-0075). */
  readonly persistence = this.storage.persistence;
  /** Why the canvases are kept in memory and will be gone when the tab is closed, or `undefined`. */
  readonly memoryReason = this.storage.memoryReason;
  /** The reminder to make a backup, or that it is not due (ADR-0075). */
  readonly reminder = computed(() =>
    backupReminder({
      now: this.readAt(),
      canvases: this.summaries(),
      lastBackupAt: this.backups().last,
      snoozedUntil: this.backups().snoozedUntil,
    }),
  );
  /** The open canvases, in the order of the strip, with the names they have now. */
  readonly tabs = computed<readonly Tab[]>(() => {
    const names = new Map(this.summaries().map(({ id, name }) => [id, name]));
    return this.openIds().flatMap((id) => {
      const name = names.get(id);
      return name === undefined ? [] : [{ id, name }];
    });
  });

  // The host of the editor's session (ADR-0072).

  canvasToOpen(): string | undefined {
    const view = this.current();
    return view.kind === 'canvas' ? view.id : undefined;
  }

  attach(editor: OpenEditor): () => void {
    this.editor = editor;
    const view = this.current();
    if (view.kind === 'canvas' && view.id !== editor.id) {
      // The canvas that was wanted was not there any more, and the session opened another: the strip follows it.
      this.replace(view.id, editor.id);
    }
    return () => {
      if (this.editor === editor) {
        this.editor = undefined;
      }
    };
  }

  /**
   * Reads the canvases of the browser, and decides what to show: the canvas that was open last if it is in the strip, else the first of the strip, else the
   * most recent canvas, else a canvas that it makes (the first run), which is the one that the learner chooses to start with (ADR-0082). It never shows the home at start, except
   * behind that question: the learner came to build.
   */
  async start(): Promise<void> {
    const loaded = await this.load();
    if (!loaded.ok) {
      this.trouble.set(`The canvases of this browser could not be opened. ${loaded.error.message}`);
      return;
    }
    let repository = await this.storage.repository();
    const { canvases } = loaded.value;
    const [stored, last] = await Promise.all([
      repository.getMeta('openCanvases'),
      repository.getMeta('lastOpenCanvas'),
    ]);
    const readable = new Set(canvases.map(({ id }) => id));
    const open = (stored.ok ? (stored.value ?? []) : []).filter((id) => readable.has(id));
    const lastId = last.ok ? last.value : undefined;

    let shown = lastId !== undefined && open.includes(lastId) ? lastId : open[0];
    shown ??= lastId !== undefined && readable.has(lastId) ? lastId : canvases[0]?.id;
    let opened: string | null = null;
    if (shown === undefined) {
      const choice = await this.firstRun();
      let made = await this.makeFrom(repository, choice);
      if (!made.ok && this.storage.memoryReason() === undefined) {
        repository = await this.storage.fallBack(made.error.message);
        made = await this.makeFrom(repository, choice);
      }
      if (!made.ok) {
        this.trouble.set(`A canvas could not be made. ${made.error.message}`);
        return;
      }
      this.add(made.value);
      shown = made.value.id;
      if (choice.kind === 'tour') {
        this.tours.request();
      }
      opened = this.openedNotice(choice, made.value.name);
    }
    const ids = open.includes(shown) ? open : [shown, ...open];
    this.openIds.set(ids);
    this.current.set({ kind: 'canvas', id: shown });
    if (stored.ok ? !sameList(stored.value, ids) : true) {
      this.saveStrip();
    }
    this.started.set(true);
    if (opened !== null) {
      this.toasts.show({ message: opened });
    }
  }

  /** What to start with at the first run: the learner is asked, over the empty home, and leaving the question means a blank canvas (ADR-0082, ADR-0084). */
  private async firstRun(): Promise<Choice> {
    this.openIds.set([]);
    this.current.set(HOME);
    this.started.set(true);
    return (await this.chooser.choose({ first: true })) ?? BLANK;
  }

  /** Asks what to start with, from the home, and makes it. Never mind makes nothing. */
  async newFromTemplate(): Promise<void> {
    const choice = await this.chooser.choose({ first: false });
    if (choice !== undefined) {
      await this.begin(choice);
    }
  }

  /** Makes the canvas that was chosen and opens it: a template's, a blank one, or the blank one that the tour is taken on (ADR-0082, ADR-0083). */
  async begin(choice: Choice): Promise<void> {
    const template = choice.kind === 'template' ? templateById(choice.id) : undefined;
    if (choice.kind === 'tour') {
      this.tours.request();
    }
    const options =
      template !== undefined
        ? { name: uniqueName(template.name, this.names()), document: buildTemplate(template) }
        : choice.kind === 'tour'
          ? { name: uniqueName(TOUR_CANVAS, this.names()) }
          : {};
    const made = await this.create(options);
    if (!made.ok) {
      this.tours.take();
    } else if (template !== undefined) {
      this.toasts.show({ message: this.openedText(made.value.name, template) });
    }
  }

  /** The notice that says what to try, for a template that was chosen. */
  private openedNotice(choice: Choice, name: string): string | null {
    const template = choice.kind === 'template' ? templateById(choice.id) : undefined;
    return template === undefined ? null : this.openedText(name, template);
  }

  private openedText(name: string, template: Template): string {
    return `Opened “${name}”. ${template.tryThis}`;
  }

  /**
   * Shows the home or a canvas, after the editor that is open has finished writing. Showing what is shown changes nothing. The canvas that is open last is written by the
   * session of the editor that opens it, which is the one that knows that it did.
   */
  async show(view: View): Promise<void> {
    if (sameView(view, this.current())) {
      return;
    }
    const turn = (this.showing += 1);
    await this.editor?.flush();
    if (view.kind === 'home') {
      await this.refresh();
    }
    if (turn !== this.showing) {
      return;
    }
    this.current.set(view);
    this.announcer.announce(view.kind === 'home' ? 'Showing My canvases.' : `Showing “${this.nameOf(view.id)}”.`);
  }

  /**
   * Opens a canvas in the strip, if it is not there, and shows it. A canvas that is opened is the newest tab and is put first (ADR-0096); one that is open already keeps
   * its place, so that a tab does not jump when it is shown again.
   */
  async openCanvas(id: string): Promise<void> {
    if (!this.summaries().some((canvas) => canvas.id === id)) {
      return;
    }
    if (!this.openIds().includes(id)) {
      this.openIds.update((ids) => [id, ...ids]);
      this.saveStrip();
    }
    await this.show({ kind: 'canvas', id });
  }

  /**
   * Takes a canvas out of the strip, which does not delete it. Closing the one that is shown shows the one on its left, or on its right if it was the first, or
   * the home if it was the only one.
   */
  async closeTab(id: string): Promise<void> {
    const ids = this.openIds();
    const index = ids.indexOf(id);
    if (index < 0) {
      return;
    }
    const view = this.current();
    const remaining = ids.filter((open) => open !== id);
    const next = remaining[index - 1] ?? remaining[index];
    if (view.kind === 'canvas' && view.id === id) {
      await this.show(next === undefined ? HOME : { kind: 'canvas', id: next });
    }
    this.openIds.set(remaining);
    this.saveStrip();
  }

  /**
   * Takes every canvas out of the strip, and shows the home (ADR-0096). It deletes no canvas, and a canvas that was shown is written first, as when it is left for another
   * view. There is nothing to confirm and nothing to undo: every canvas is on the home, and opens again from its card.
   */
  async closeAllTabs(): Promise<void> {
    if (this.openIds().length === 0) {
      return;
    }
    await this.show(HOME);
    this.openIds.set([]);
    this.saveStrip();
    this.announcer.announce('Closed all tabs.');
  }

  /**
   * Makes a canvas and opens it. It is blank and called "Untitled canvas", or the first of "Untitled canvas 2" and so on that nobody has, unless it is given a document, such as
   * a template's, or a name (ADR-0072).
   */
  async create(
    options: { readonly name?: string; readonly document?: CanvasDocument } = {},
  ): Promise<Outcome<CanvasSummary, RepositoryError>> {
    const repository = await this.storage.repository();
    const made = await repository.create({
      name: options.name ?? uniqueName(UNTITLED, this.names()),
      document: options.document ?? emptyDocument(),
    });
    if (!made.ok) {
      this.report(`A canvas could not be made. ${made.error.message}`);
      return made;
    }
    const summary = this.add(made.value);
    await this.openCanvas(summary.id);
    this.announcer.announce(`Made “${summary.name}”.`);
    return succeed(summary);
  }

  /**
   * Gives a canvas a name. A name that is blank or too long is refused with the reason and nothing changes; white space around a name is not part of it.
   * Two canvases may have the same name.
   */
  async rename(id: string, name: string): Promise<Outcome<void, string>> {
    const trimmed = name.trim();
    const wrong = nameProblem(trimmed);
    if (wrong !== null) {
      return failure(wrong);
    }
    const repository = await this.storage.repository();
    const saved = await repository.save(id, { name: trimmed });
    if (!saved.ok) {
      return failure(saved.error.message);
    }
    this.summaries.update((canvases) =>
      canvases.map((canvas) => (canvas.id === id ? { ...canvas, name: trimmed } : canvas)),
    );
    this.announcer.announce(`Renamed to “${trimmed}”.`);
    return succeed(undefined);
  }

  /** Makes a copy of a canvas as it is saved, called "<name> (copy)" or the first "(copy 2)" and so on that nobody has, and opens it. */
  async duplicate(id: string): Promise<Outcome<CanvasSummary, RepositoryError>> {
    await this.editor?.flush();
    const repository = await this.storage.repository();
    const original = await repository.get(id);
    if (!original.ok) {
      this.report(`The canvas could not be copied. ${original.error.message}`);
      return original;
    }
    const name = copyName(original.value.name, this.names());
    const made = await repository.create({ name, document: original.value.document });
    if (!made.ok) {
      this.report(`The canvas could not be copied. ${made.error.message}`);
      return made;
    }
    const summary = this.add(made.value);
    await this.openCanvas(summary.id);
    this.announcer.announce(`Made “${summary.name}”, a copy of “${original.value.name}”.`);
    return succeed(summary);
  }

  /**
   * Deletes a canvas, one that can be read or one that cannot (ADR-0074): it leaves the strip and the home at once, and the repository keeps it for a minute as a tombstone
   * (ADR-0028), which a notice offers to bring back. If the browser refuses, nothing has changed except that the tab is closed, and it says why. It answers whether it was deleted.
   */
  async delete(id: string): Promise<boolean> {
    const name =
      this.summaries().find((canvas) => canvas.id === id)?.name ??
      this.unreadableCanvases().find((canvas) => canvas.id === id)?.name ??
      id;
    const place = this.openIds().indexOf(id);
    // Out of the strip first, which makes the editor write and shows another view, so that nothing saves a canvas that has gone. A canvas that is not in it is not closed.
    await this.closeTab(id);
    const repository = await this.storage.repository();
    const done = await repository.softDelete(id);
    if (!done.ok) {
      this.report(`“${name}” could not be deleted. ${done.error.message}`);
      return false;
    }
    this.summaries.update((canvases) => canvases.filter((canvas) => canvas.id !== id));
    this.unreadableCanvases.update((canvases) => canvases.filter((canvas) => canvas.id !== id));
    this.toasts.show({
      message: `Deleted “${name}”.`,
      undo: { label: 'Undo', keys: formatChord({ key: 'z', mod: true }), run: () => this.restore(id, name, place) },
    });
    return true;
  }

  /** Brings a deleted canvas back, to the home and, if it was open, to its place in the strip. A canvas whose minute is over is gone, and that is said. */
  private async restore(id: string, name: string, place: number): Promise<Outcome<void, string>> {
    const repository = await this.storage.repository();
    const done = await repository.restore(id);
    if (!done.ok) {
      return failure(
        done.error.kind === 'not-found'
          ? `“${name}” is gone for good: it was deleted more than a minute ago.`
          : done.error.message,
      );
    }
    await this.refresh();
    if (place >= 0 && this.summaries().some((canvas) => canvas.id === id)) {
      this.openIds.update((ids) => [...ids.slice(0, place), id, ...ids.slice(place)]);
      this.saveStrip();
    }
    this.announcer.announce(`“${name}” is back.`);
    return succeed(undefined);
  }

  /** Reads the canvases again, for the home to show them as they are now. A canvas that is open has been written before this is asked. */
  async refresh(): Promise<Outcome<void, RepositoryError>> {
    const repository = await this.storage.repository();
    const listed = await repository.list();
    if (!listed.ok) {
      this.report(`The canvases could not be read. ${listed.error.message}`);
      return listed;
    }
    this.summaries.set(listed.value.canvases.map(summarise));
    this.unreadableCanvases.set(listed.value.unreadable);
    await this.readHomeFacts(repository);
    return succeed(undefined);
  }

  /** The times of the last backup and of the reminder, and the room that the browser has left. A browser that does not say is an answer: nothing is shown of it. */
  private async readHomeFacts(repository: CanvasRepository): Promise<void> {
    const [last, snoozedUntil, usage] = await Promise.all([
      repository.getMeta('lastBackupAt'),
      repository.getMeta('backupReminderSnoozedUntil'),
      readUsage(this.manager),
    ]);
    this.backups.set({
      last: last.ok ? last.value : undefined,
      snoozedUntil: snoozedUntil.ok ? snoozedUntil.value : undefined,
    });
    this.storageUsage.set(usage.ok ? usage.value : null);
    this.readAt.set(this.now());
    this.storage.askPersistence();
  }

  /** Saves a canvas as a file (ADR-0075), as it is saved: the editor that has it open writes first. It answers the name of the file. */
  async saveAsFile(id: string): Promise<Outcome<string, string>> {
    await this.editor?.flush();
    const repository = await this.storage.repository();
    const record = await repository.get(id);
    if (!record.ok) {
      return this.fail(`The canvas could not be saved as a file. ${record.error.message}`);
    }
    const written = writeCanvasFile({ name: record.value.name, document: record.value.document });
    if (!written.ok) {
      return this.fail(`“${record.value.name}” could not be saved as a file. ${written.error.message}`);
    }
    const file = canvasFileName(record.value.name);
    this.downloader.save(file, written.value);
    this.toasts.show({ message: `Saved “${record.value.name}” as ${file}.` });
    return succeed(file);
  }

  /**
   * Opens the panel that makes a link to a canvas of the home (ADR-0078), as it is saved: the editor that has it open writes first, so that what is shared is what the learner sees. A canvas that cannot be read is not
   * shared, and the problem is said. It answers whether the panel was opened.
   */
  async share(id: string): Promise<boolean> {
    await this.editor?.flush();
    const repository = await this.storage.repository();
    const record = await repository.get(id);
    if (!record.ok) {
      this.report(`The canvas could not be shared. ${record.error.message}`);
      return false;
    }
    this.sharing.share({
      name: record.value.name,
      document: record.value.document,
      saveAsFile: () => void this.saveAsFile(id),
    });
    return true;
  }

  /** Opens a canvas file as a new canvas, always (ADR-0075). A file that cannot be opened changes nothing, and the answer says why, root cause first. */
  async openFile(file: File): Promise<Outcome<CanvasSummary, string>> {
    const text = await this.textOf(file);
    if (!text.ok) {
      return text;
    }
    const parsed = parseCanvasFile(text.value);
    if (!parsed.ok) {
      return failure(parsed.error.message);
    }
    const repository = await this.storage.repository();
    const made = await repository.create({ name: parsed.value.name, document: parsed.value.document });
    if (!made.ok) {
      return failure(made.error.message);
    }
    const summary = this.add(made.value);
    await this.openCanvas(summary.id);
    this.announcer.announce(`Opened “${summary.name}” from ${file.name}.`);
    return succeed(summary);
  }

  /**
   * Saves every canvas that can be read as one backup (ADR-0075), says what it came to, and remembers the time. The canvases that cannot be read are not in it, and the
   * answer says how many. `say: false` leaves the telling to the caller, such as the dialog that offers a backup before it deletes everything.
   */
  async exportBackup(options: { readonly say?: boolean } = {}): Promise<Outcome<BackupDone, string>> {
    const done = await this.makeBackup();
    if (options.say !== false) {
      if (done.ok) {
        this.toasts.show({ message: backupDone(done.value) });
      } else {
        this.report(done.error);
      }
    }
    return done;
  }

  /** Writes the file of the backup and remembers when. It tells no one: that is for whoever asked. */
  private async makeBackup(): Promise<Outcome<BackupDone, string>> {
    await this.editor?.flush();
    const repository = await this.storage.repository();
    const listed = await repository.list();
    if (!listed.ok) {
      return failure(`The backup could not be made. ${listed.error.message}`);
    }
    const { canvases, unreadable } = listed.value;
    if (canvases.length === 0) {
      return failure('There is nothing to back up: no canvas here can be opened.');
    }
    const time = this.now();
    const written = writeBackup(canvases, { exportedAt: time });
    if (!written.ok) {
      return failure(`The backup could not be made. ${written.error.message}`);
    }
    const file = backupFileName(time);
    this.downloader.save(file, written.value);
    await repository.setMeta('lastBackupAt', time);
    this.backups.update((times) => ({ ...times, last: time }));
    return succeed({ file, count: canvases.length, left: unreadable.length });
  }

  /** "Remind me in a week" (ADR-0075). */
  async snoozeReminder(): Promise<void> {
    const until = this.now() + SNOOZE_MS;
    this.backups.update((times) => ({ ...times, snoozedUntil: until }));
    const repository = await this.storage.repository();
    await repository.setMeta('backupReminderSnoozedUntil', until);
  }

  /** Puts a backup back without writing over anything (ADR-0075). A file that is not a backup changes nothing, and the answer says why; otherwise it answers the report. */
  async restoreFile(file: File): Promise<Outcome<RestoreReport, string>> {
    const text = await this.textOf(file);
    if (!text.ok) {
      return text;
    }
    const parsed = parseBackup(text.value);
    if (!parsed.ok) {
      return failure(parsed.error.message);
    }
    const repository = await this.storage.repository();
    const report = await restoreBackup(repository, parsed.value);
    if (!report.ok) {
      return failure(report.error.message);
    }
    await this.refresh();
    return succeed(report.value);
  }

  /**
   * Deletes every canvas, readable or not (ADR-0074), and shows the home. Each is a tombstone for a minute, and a notice offers to bring them all back, with the strip
   * as it was. If the browser refuses nothing has changed, and it says why. It answers whether they were deleted.
   */
  async deleteAll(): Promise<boolean> {
    await this.show(HOME);
    const open = this.openIds();
    const repository = await this.storage.repository();
    const done = await repository.softDeleteAll();
    if (!done.ok) {
      this.report(`The canvases could not be deleted. ${done.error.message}`);
      return false;
    }
    const ids = done.value;
    this.summaries.set([]);
    this.unreadableCanvases.set([]);
    this.openIds.set([]);
    this.saveStrip();
    this.toasts.show({
      message: ids.length === 1 ? 'Deleted 1 canvas.' : `Deleted all ${ids.length} canvases.`,
      undo: { label: 'Undo', keys: formatChord({ key: 'z', mod: true }), run: () => this.restoreAll(ids, open) },
    });
    return true;
  }

  /** Brings back the canvases that a delete-all took, as many as are still there, and the strip as it was. A canvas whose minute is over is gone, and that is said. */
  private async restoreAll(ids: readonly string[], open: readonly string[]): Promise<Outcome<void, string>> {
    const repository = await this.storage.repository();
    const done = await repository.restoreAll(ids);
    if (!done.ok) {
      return failure(done.error.message);
    }
    const back = done.value.length;
    if (back === 0) {
      return failure('Nothing could be brought back: every canvas was deleted more than a minute ago.');
    }
    await this.refresh();
    const readable = new Set(this.summaries().map((canvas) => canvas.id));
    this.openIds.set(open.filter((id) => readable.has(id)));
    this.saveStrip();
    this.announcer.announce(
      back === ids.length
        ? `${ids.length === 1 ? '1 canvas is' : `${ids.length} canvases are`} back.`
        : `${back} of ${ids.length} are back: ${ids.length - back === 1 ? '1 was' : `${ids.length - back} were`} deleted for good.`,
    );
    return succeed(undefined);
  }

  /** The text of a file that the learner chose, or why it cannot be read. */
  private async textOf(file: File): Promise<Outcome<string, string>> {
    const big = tooBigToRead(file);
    if (big !== null) {
      return failure(big);
    }
    try {
      return succeed(await readText(file));
    } catch (error) {
      return failure(
        `The file could not be read. ${error instanceof Error ? error.message : 'The browser did not say why.'}`,
      );
    }
  }

  /** A problem that is said on the screen and aloud, and the answer that carries it. */
  private fail(text: string): Outcome<never, string> {
    this.report(text);
    return failure(text);
  }

  /** The problem has been read. */
  dismissProblem(): void {
    this.trouble.set(null);
  }

  /** Says what went wrong, on the screen and aloud, assertively. */
  protected report(text: string): void {
    this.trouble.set(text);
    this.announcer.announce(text, 'assertive');
  }

  /** The name a canvas has now, or its id if the library does not know it. */
  private nameOf(id: string): string {
    return this.summaries().find((canvas) => canvas.id === id)?.name ?? id;
  }

  protected names(): string[] {
    return this.summaries().map(({ name }) => name);
  }

  /** Puts a canvas that was just made among the ones the home knows, and answers its summary. */
  protected add(record: CanvasRecord): CanvasSummary {
    const summary = summarise(record);
    this.summaries.update((canvases) => [summary, ...canvases.filter(({ id }) => id !== summary.id)]);
    return summary;
  }

  /** The first canvas, as the learner chose it (a blank one when there was no choice). */
  private makeFrom(repository: CanvasRepository, choice: Choice): Promise<Outcome<CanvasRecord, RepositoryError>> {
    const template = choice.kind === 'template' ? templateById(choice.id) : undefined;
    if (template !== undefined) {
      return repository.create({ name: uniqueName(template.name, this.names()), document: buildTemplate(template) });
    }
    const name = uniqueName(choice.kind === 'tour' ? TOUR_CANVAS : UNTITLED, this.names());
    return repository.create({ name, document: emptyDocument() });
  }

  /** The canvases of the browser, on the browser's repository or, if that cannot list, in memory, as the session does (ADR-0072). */
  private async load(): Promise<Outcome<{ readonly canvases: readonly CanvasRecord[] }, RepositoryError>> {
    let repository = await this.storage.repository();
    let listed = await repository.list();
    if (!listed.ok && this.storage.memoryReason() === undefined) {
      repository = await this.storage.fallBack(listed.error.message);
      listed = await repository.list();
    }
    if (!listed.ok) {
      return listed;
    }
    this.summaries.set(listed.value.canvases.map(summarise));
    this.unreadableCanvases.set(listed.value.unreadable);
    return succeed({ canvases: listed.value.canvases });
  }

  /** The strip has a canvas in the place of another one that was not there. */
  private replace(gone: string, actual: string): void {
    this.openIds.update((ids) => [...new Set(ids.map((id) => (id === gone ? actual : id)))]);
    this.current.set({ kind: 'canvas', id: actual });
    this.saveStrip();
  }

  /** Keeps the strip in the browser, so that a reload brings it back. If that fails the strip is what it is, and the next start shows the canvas that was open last. */
  private saveStrip(): void {
    const ids = this.openIds();
    void this.storage.repository().then((repository) => repository.setMeta('openCanvases', ids));
  }
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]): boolean =>
  a !== undefined && a.length === b.length && a.every((id, index) => id === b[index]);
