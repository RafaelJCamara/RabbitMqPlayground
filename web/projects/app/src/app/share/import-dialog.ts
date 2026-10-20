import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, computed, inject, signal } from '@angular/core';
import { edgeCount, elementCount, type Batch, type CanvasDocument } from '@rmq/domain';
import {
  defaultVhost,
  importBatch,
  importSummaryText,
  planImport,
  type DefinitionsFile,
  type ImportNote,
  type Outcome,
} from '@rmq/persistence';
import { Announcer } from '../core/announcer';
import { BUTTON, BUTTON_PRIMARY } from '../core/ui/buttons';

export const IMPORT_TITLE_ID = 'rmq-import-title';

/** How many notes the dialog lists; the rest are counted. */
export const MAX_NOTES_SHOWN = 50;

/** What the dialog that imports a definitions file needs (ADR-0111). */
export interface ImportDialogData {
  /** The name of the canvas that the import replaces. */
  readonly name: string;
  /** The name of the file that was chosen. */
  readonly fileName: string;
  /** The canvas as it is on the screen. */
  readonly document: CanvasDocument;
  /** The file as it was read, or why it could not be: then the dialog says so, and imports nothing. */
  readonly file: Outcome<DefinitionsFile, string>;
  /** Makes the change: the one batch of the import, through the editor's bus. It answers whether the canvas took it. */
  readonly run: (batch: Batch) => boolean;
}

const KIND_WORDS: Readonly<Record<ImportNote['kind'], string>> = {
  'left-out': 'Left out',
  changed: 'Changed',
  refused: 'Refused',
};

/**
 * The dialog that imports a RabbitMQ definitions file into the canvas that is open (ADR-0111, ADR-0014): the vhost to import when the file has several, what the
 * import makes, that it replaces what is on the canvas, and what it leaves out or changes and why. A file that cannot be imported says why, and the button that
 * imports is never switched off: pressing it then says the reason again. The import is one change of the canvas, and Undo takes it back.
 */
@Component({
  selector: 'rmq-import-dialog',
  template: `
    <form
      class="bg-panel text-fg border-border flex max-h-[90dvh] w-[min(40rem,94vw)] flex-col gap-3 overflow-y-auto rounded-lg border p-4 shadow-xl"
      novalidate
      data-testid="import-dialog"
      (submit)="onSubmit($event)"
    >
      <h2 class="text-base font-semibold" [id]="titleId">Import definitions into “{{ data.name }}”</h2>
      <p class="text-muted">
        From “<span class="font-mono" data-testid="import-file">{{ data.fileName }}</span
        >”. A definitions file is what RabbitMQ gives with Export definitions in its management UI, or with
        <code class="font-mono">rabbitmqctl export_definitions</code>.
      </p>
      @if (vhosts().length > 1) {
        <div class="flex flex-col gap-1">
          <label class="font-medium" for="rmq-import-vhost">Virtual host</label>
          <select
            id="rmq-import-vhost"
            class="border-border bg-surface rounded-md border px-2 py-1.5 font-mono"
            aria-describedby="rmq-import-vhost-help"
            data-testid="import-vhost"
            (change)="onVhost($event)"
          >
            @for (vhost of vhosts(); track vhost) {
              <option [value]="vhost" [selected]="vhost === chosen()">{{ vhost }}</option>
            }
          </select>
          <p id="rmq-import-vhost-help" class="text-muted text-sm">
            The file has {{ vhosts().length }} vhosts, and a canvas is one of them.
          </p>
        </div>
      } @else if (vhosts().length === 1) {
        <p data-testid="import-vhost-only">
          Virtual host: <span class="font-mono">{{ chosen() }}</span>
        </p>
      }
      @if (problem(); as message) {
        <p
          class="border-danger bg-danger-bg text-danger rounded-md border px-3 py-2"
          role="alert"
          data-testid="import-error"
        >
          {{ message }}
        </p>
      } @else if (summary(); as text) {
        <p data-testid="import-summary">{{ text }}</p>
        @if (replaced(); as text) {
          <p
            class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2"
            data-testid="import-replaces"
          >
            {{ text }}
          </p>
        }
      }
      @if (notes().length > 0) {
        <section aria-labelledby="rmq-import-notes" class="flex flex-col gap-1.5">
          <h3 id="rmq-import-notes" class="font-medium">What is not imported as it is in the file</h3>
          <ul class="flex list-disc flex-col gap-1 pl-5" data-testid="import-notes">
            @for (note of shownNotes(); track $index) {
              <li>
                <span class="font-medium">{{ kindWords[note.kind] }}:</span> {{ note.message }}
              </li>
            }
          </ul>
          @if (notes().length > shownNotes().length) {
            <p class="text-muted" data-testid="import-more-notes">
              And {{ notes().length - shownNotes().length }} more, which the list does not show.
            </p>
          }
        </section>
      }
      <div class="flex justify-end gap-2">
        <button type="button" [class]="button" data-testid="import-cancel" (click)="ref.close()">
          {{ data.file.ok ? 'Cancel' : 'Close' }}
        </button>
        @if (data.file.ok) {
          <button type="submit" [class]="primary" data-testid="import-confirm">{{ confirmText() }}</button>
        }
      </div>
    </form>
  `,
})
export class ImportDialog {
  protected readonly data = inject<ImportDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  private readonly announcer = inject(Announcer);

  protected readonly titleId = IMPORT_TITLE_ID;
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;
  protected readonly kindWords = KIND_WORDS;

  protected readonly vhosts = computed(() => (this.data.file.ok ? this.data.file.value.vhosts : []));
  /** The vhost to import: the only one, `/` when the file has it among several, or else the first; `null` when the file names none. */
  protected readonly chosen = signal<string | null>(this.firstChoice());

  private readonly plan = computed(() => {
    const file = this.data.file;
    return file.ok ? planImport(file.value, this.chosen()) : null;
  });

  protected readonly problem = computed(() => {
    if (!this.data.file.ok) {
      return this.data.file.error;
    }
    const plan = this.plan();
    return plan === null || plan.ok ? null : plan.error.message;
  });

  protected readonly summary = computed(() => {
    const plan = this.plan();
    return plan?.ok === true ? `${capitalised(importSummaryText(plan.value.summary))} will be on the canvas.` : null;
  });

  /** What is on the canvas now, which the import replaces, or `null` for an empty canvas. */
  protected readonly replaced = computed(() => {
    const elements = elementCount(this.data.document);
    if (elements === 0) {
      return null;
    }
    const edges = edgeCount(this.data.document);
    const what = `${elements} ${elements === 1 ? 'element' : 'elements'}${edges === 0 ? '' : ` and ${edges} ${edges === 1 ? 'link' : 'links'}`}`;
    return `This replaces everything that is on the canvas now (${what}), producers and consumers too. Undo takes the import back.`;
  });

  protected readonly notes = computed<readonly ImportNote[]>(() => {
    const plan = this.plan();
    if (plan === null) {
      return [];
    }
    return plan.ok ? plan.value.notes : plan.error.kind === 'empty' ? plan.error.notes : [];
  });

  /** The first notes, which is as many as a person reads: a file of thousands of items that the canvas refuses would otherwise be a list of thousands. */
  protected readonly shownNotes = computed(() => this.notes().slice(0, MAX_NOTES_SHOWN));

  protected readonly confirmText = computed(() => (this.replaced() === null ? 'Import' : 'Replace and import'));

  protected onVhost(event: Event): void {
    this.chosen.set((event.target as HTMLSelectElement).value);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const plan = this.plan();
    if (plan === null) {
      return;
    }
    if (!plan.ok) {
      this.announcer.announce(plan.error.message, 'assertive');
      return;
    }
    if (this.data.run(importBatch(plan.value))) {
      this.ref.close();
    }
  }

  private firstChoice(): string | null {
    if (!this.data.file.ok) {
      return null;
    }
    const file = this.data.file.value;
    return defaultVhost(file) ?? (file.vhosts.includes('/') ? '/' : (file.vhosts[0] ?? null));
  }
}

const capitalised = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
