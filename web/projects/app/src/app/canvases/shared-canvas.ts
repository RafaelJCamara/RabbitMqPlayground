import { computed, inject, Injectable, signal, type Provider } from '@angular/core';
import type { EngineSnapshot } from '@rmq/engine';
import { failure, succeed, type Outcome, type Shared } from '@rmq/persistence';
import { FeatureFlags } from '../core/flags/feature-flags';
import { copiesIn } from '../core/runtime/copies';
import { CANVAS_HOST, type CanvasHost, type OpenEditor } from '../core/session/canvas-host';
import { CanvasStorage, MEMORY_ONLY } from '../core/session/canvas-storage';
import { LinkOpening } from '../core/share/link-opening';
import { SHARED_MESSAGES, type SharedMessages } from '../core/share/shared-messages';
import { sharedName } from './names';

/**
 * Why the canvases of a shared view are kept in memory (ADR-0078). The status strip says "Not kept after you close this tab." and then this, so it is a sentence that goes on from there: what the learner changes
 * stays in the view, and the way to keep it is the copy.
 */
export const SHARED_MEMORY_REASON =
  'This is a shared canvas, and what is changed here stays here unless you save a copy.';

const plural = (count: number, one: string): string => `${count} ${count === 1 ? one : `${one}s`}`;

/**
 * The shared canvas that the view shows (ADR-0078): the canvas of a link, put into a storage that keeps nothing so that the editor, its session and its autosave work on it as they do on any canvas, and what the learner
 * does here never reaches the canvases of the browser. It is also the host that the session asks which canvas to open (ADR-0072), and it gives the simulation the messages of the link. The view provides it, so it lives as long as
 * the view does, over a storage of its own and above the storage of the page, which it writes to only when the learner saves a copy.
 */
@Injectable()
export class SharedCanvas implements CanvasHost {
  /** The storage of this view, which is in memory whatever the browser allows. */
  private readonly memory = inject(CanvasStorage);
  /** The storage of the page, which is the learner's: the one that the view's own storage hides from the editor. */
  private readonly own = inject(CanvasStorage, { skipSelf: true });
  private readonly link = inject(LinkOpening);
  private readonly simulating = inject(FeatureFlags).isEnabled('simulation');

  private readonly shown = signal(false);
  private readonly cause = signal<string | null>(null);
  private readonly called = signal('');
  private readonly keeping = signal(false);
  private readonly trouble = signal<string | null>(null);
  private readonly lostMessages = signal<string | null>(null);
  private readonly carried = signal(0);

  private snapshot: EngineSnapshot | undefined;
  private id: string | undefined;
  private editor: OpenEditor | undefined;

  /** The canvas has been put in memory and the editor can open it. */
  readonly ready = this.shown.asReadonly();
  /** Why it could not be put there, or `null`. */
  readonly failure = this.cause.asReadonly();
  /** The name that the link gave the canvas. */
  readonly name = this.called.asReadonly();
  /** A copy is being made, and the page will be loaded when it is. */
  readonly saving = this.keeping.asReadonly();
  /** Why the last copy could not be made, or `null`. */
  readonly problem = this.trouble.asReadonly();
  /** What the learner is told about the messages of the link when they are not where the sender left them, or `null`. */
  readonly notice = computed<string | null>(() => {
    const reason = this.lostMessages();
    if (reason !== null) {
      return `The messages of this link could not be put back (${reason}), so the canvas is shown without them.`;
    }
    const count = this.carried();
    return count > 0 && !this.simulating
      ? `This link carries ${plural(count, 'message')}, but the simulation is not switched on yet, so they are not shown. It is still being built: add ?ff=simulation to the address to try it.`
      : null;
  });

  /** Puts the canvas of the link in memory, under an id of its own, and takes note of its messages. */
  async open(shared: Shared): Promise<void> {
    this.called.set(shared.name);
    this.snapshot = shared.simulation;
    this.carried.set(shared.simulation === undefined ? 0 : copiesIn(shared.simulation));
    const repository = await this.memory.repository();
    const made = await repository.create({ name: shared.name, document: shared.document });
    if (!made.ok) {
      this.cause.set(`The shared canvas could not be opened. ${made.error.message}`);
      return;
    }
    this.id = made.value.id;
    this.shown.set(true);
  }

  canvasToOpen(): string | undefined {
    return this.id;
  }

  attach(editor: OpenEditor): () => void {
    this.editor = editor;
    return () => {
      if (this.editor === editor) {
        this.editor = undefined;
      }
    };
  }

  /** The messages of the link, for the simulation to put back when the canvas first loads, or `null` when the link has none. */
  messages(): SharedMessages | null {
    const snapshot = this.snapshot;
    return snapshot === undefined ? null : { snapshot, failed: (reason) => this.lostMessages.set(reason) };
  }

  /** Takes the link off the address and loads the page, which is the learner's own. Nothing is asked: nothing was saved, and the view said so from the start. */
  leave(): void {
    this.link.leave();
  }

  /**
   * Keeps the canvas as it is on the screen as a canvas of the learner's own, and then leaves the link with the copy open (ADR-0078). The editor writes first, so that the copy has what the learner changed. A copy that
   * cannot be made is not pretended: the problem is said, and the learner stays where they are with their work.
   */
  async saveCopy(): Promise<void> {
    const id = this.id;
    if (id === undefined || this.keeping()) {
      return;
    }
    this.keeping.set(true);
    this.trouble.set(null);
    const copied = await this.copy(id);
    if (!copied.ok) {
      this.trouble.set(`A copy could not be saved. ${copied.error}`);
      this.keeping.set(false);
      return;
    }
    this.link.leave();
  }

  private async copy(id: string): Promise<Outcome<undefined, string>> {
    await this.editor?.flush();
    const kept = await (await this.memory.repository()).get(id);
    if (!kept.ok) {
      return failure(`The shared canvas could not be read. ${kept.error.message}`);
    }
    const repository = await this.own.repository();
    const reason = this.own.memoryReason();
    if (reason !== undefined) {
      return failure(`${reason} A copy would be gone when this tab is closed, so none was made.`);
    }
    const listed = await repository.list();
    if (!listed.ok) {
      return failure(listed.error.message);
    }
    const made = await repository.create({
      name: sharedName(
        this.called(),
        listed.value.canvases.map(({ name }) => name),
      ),
      document: kept.value.document,
    });
    if (!made.ok) {
      return failure(made.error.message);
    }
    // The page opens the canvas that was open last, if it is in the strip: the copy is put there, after the canvases that the learner had open.
    const strip = await repository.getMeta('openCanvases');
    await repository.setMeta('openCanvases', [...(strip.ok ? (strip.value ?? []) : []), made.value.id]);
    await repository.setMeta('lastOpenCanvas', made.value.id);
    return succeed(undefined);
  }
}

/**
 * What the shared view provides to everything under it, the editor among it (ADR-0078): a storage of its own that keeps nothing, which hides the page's from the editor's session; the shared canvas, which is the host that the session
 * asks which canvas to open (ADR-0072); and the messages of the link, which the simulation puts back when the canvas first loads.
 */
export const SHARED_CANVAS_PROVIDERS: Provider[] = [
  CanvasStorage,
  SharedCanvas,
  { provide: MEMORY_ONLY, useValue: SHARED_MEMORY_REASON },
  { provide: CANVAS_HOST, useExisting: SharedCanvas },
  { provide: SHARED_MESSAGES, useFactory: () => inject(SharedCanvas).messages() },
];
