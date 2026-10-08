import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { Component, computed, ElementRef, inject, signal, viewChild } from '@angular/core';
import type { CanvasDocument } from '@rmq/domain';
import { exportDefinitions, NOT_IN_THE_FILE, planDefinitions, type DefinitionsSummary } from '@rmq/persistence';
import { Announcer } from '../core/announcer';
import { FILE_DOWNLOADER } from '../core/files/downloader';
import { definitionsFileName } from '../core/files/file-names';
import { BUTTON, BUTTON_PRIMARY } from '../core/ui/buttons';

export const EXPORT_TITLE_ID = 'rmq-export-title';

/** What the dialog that exports a canvas for a broker needs (ADR-0079). */
export interface ExportDialogData {
  /** The name of the canvas, which names the file. */
  readonly name: string;
  /** The canvas as it is on the screen. */
  readonly document: CanvasDocument;
}

const plural = (count: number, thing: string): string => `${count} ${thing}${count === 1 ? '' : 's'}`;

/** “3 exchanges, 2 queues and 4 bindings”. */
export const summaryText = ({ exchanges, queues, bindings }: DefinitionsSummary): string =>
  `${plural(exchanges, 'exchange')}, ${plural(queues, 'queue')} and ${plural(bindings, 'binding')}`;

/**
 * The dialog that exports a canvas for a broker (ADR-0079, ADR-0014): the virtual host to export to, what is in the file, what is not and why, and a button that gives the file. The warnings are shown before the file is
 * given, and a warning is not an error: the file is made with them beside it. A virtual host that cannot be one is said under its field, and the button is never switched off.
 */
@Component({
  selector: 'rmq-export-dialog',
  template: `
    <form
      class="bg-panel text-fg border-border flex max-h-[90dvh] w-[min(38rem,94vw)] flex-col gap-3 overflow-y-auto rounded-lg border p-4 shadow-xl"
      novalidate
      data-testid="export-dialog"
      (submit)="onSubmit($event)"
    >
      <h2 class="text-base font-semibold" [id]="titleId">Export “{{ data.name }}” for a broker</h2>
      <p class="text-muted">
        A definitions file loads into RabbitMQ through the management UI (Overview, then Import definitions) or with
        <code class="font-mono">rabbitmqctl import_definitions</code>. It has the exchanges, the queues and the bindings
        of the canvas.
      </p>
      <label class="flex flex-col gap-1">
        <span class="font-medium">Virtual host</span>
        <input
          #field
          type="text"
          class="border-border bg-surface rounded-md border px-2 py-1.5 font-mono"
          autocomplete="off"
          spellcheck="false"
          [value]="vhost()"
          [attr.aria-invalid]="error() === null ? null : 'true'"
          [attr.aria-describedby]="error() === null ? null : errorId"
          data-testid="export-vhost"
          (input)="onInput($event)"
        />
      </label>
      @if (error(); as message) {
        <p [id]="errorId" class="text-danger" role="alert" data-testid="export-error">{{ message }}</p>
      }
      @if (emptyText !== null) {
        <p class="border-warning bg-warning-bg text-warning rounded-md border px-3 py-2" data-testid="export-empty">
          {{ emptyText }}
        </p>
      } @else {
        <p data-testid="export-summary">{{ summary() }} are in the file.</p>
      }
      <section aria-labelledby="rmq-export-left-out" class="flex flex-col gap-1.5">
        <h3 id="rmq-export-left-out" class="font-medium">What is not in the file</h3>
        @if (plan.warnings.length === 0) {
          <p class="text-muted" data-testid="export-all">Everything on the canvas is in the file.</p>
        } @else {
          <ul class="flex list-disc flex-col gap-1 pl-5" data-testid="export-warnings">
            @for (warning of plan.warnings; track warning.message) {
              <li>{{ warning.message }}</li>
            }
          </ul>
        }
        <p class="text-muted" data-testid="export-never">{{ never }}</p>
      </section>
      <div class="flex justify-end gap-2">
        <button type="button" [class]="button" data-testid="export-close" (click)="ref.close()">Close</button>
        <button type="submit" [class]="primary" data-testid="export-download">Download definitions</button>
      </div>
    </form>
  `,
})
export class ExportDialog {
  protected readonly data = inject<ExportDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<void>>(DialogRef);
  private readonly downloader = inject(FILE_DOWNLOADER);
  private readonly announcer = inject(Announcer);

  protected readonly titleId = EXPORT_TITLE_ID;
  protected readonly errorId = 'rmq-export-error';
  protected readonly button = BUTTON;
  protected readonly primary = BUTTON_PRIMARY;
  protected readonly never = NOT_IN_THE_FILE;

  /** What the canvas puts in the file and leaves out, which does not depend on the virtual host. */
  protected readonly plan = planDefinitions(this.data.document);
  protected readonly summary = computed(() => summaryText(this.plan.summary));
  protected readonly vhost = signal(this.data.document.vhost);
  protected readonly error = signal<string | null>(null);
  /** The sentence that says there is nothing to put in a file, from the export itself, when that is so. */
  protected readonly emptyText = this.nothing();
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  protected onInput(event: Event): void {
    this.vhost.set((event.target as HTMLInputElement).value);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    const exported = exportDefinitions(this.data.document, this.vhost());
    if (!exported.ok) {
      this.error.set(exported.error.message);
      if (exported.error.kind === 'vhost') {
        this.field().nativeElement.focus();
      }
      return;
    }
    const file = definitionsFileName(this.data.name);
    this.downloader.save(file, exported.value.text);
    this.announcer.announce(`Downloaded ${file}.`);
    this.ref.close();
  }

  /** The sentence of the export when a canvas has nothing that a broker holds, or `null`. */
  private nothing(): string | null {
    const probe = exportDefinitions(this.data.document, '/');
    return !probe.ok && probe.error.kind === 'empty' ? probe.error.message : null;
  }
}
