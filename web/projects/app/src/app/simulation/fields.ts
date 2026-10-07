import { Component, inject, input, output, signal } from '@angular/core';
import type { DocumentCommand, Issue } from '@rmq/domain';
import { CommandBus } from '../core/state/command-bus';
import { StatusStore } from '../core/state/status-store';
import { Help } from '../core/ui/help';
import { RefusalNotice } from '../core/ui/refusal-notice';

let nextField = 0;

/**
 * What a part of the inspector that edits with commands needs (ADR-0056): what each field was refused for, kept until something else is selected or changed, and the
 * one way to apply a command for a field. A field that was refused goes back to what the document says, and says why under itself, in the words of the refusal
 * with the broker's reply after them where there is one (ADR-0024), which is how the inspector does it for the fields that it has.
 */
export class Fields {
  private readonly bus = inject(CommandBus);
  private readonly status = inject(StatusStore);
  private readonly prefix = `rmq-fields-${nextField++}`;
  private readonly refused = signal<Readonly<Record<string, Issue>>>({});

  /** What each field was refused for. */
  readonly problems = this.refused.asReadonly();

  /** An id that is this part's and no other's, for a control and what describes it. */
  id(part: string): string {
    return `${this.prefix}-${part}`;
  }

  /** What was refused is forgotten, for another thing is selected. */
  reset(): void {
    this.refused.set({});
    this.status.clearRefusalFrom('inspector');
  }

  /** Applies a command for a field. A refusal is kept for that field, and answers `false`. */
  apply(field: string, command: DocumentCommand): boolean {
    const result = this.bus.apply(command, 'inspector');
    this.refused.set(result.ok ? {} : { [field]: result.error });
    return result.ok;
  }

  /** Says what a field was refused for, when no command was made to be refused. */
  refuse(field: string, message: string): void {
    this.refused.set({ [field]: { kind: 'invalid-value', message } });
  }

  /** Keeps what a command that is not the document's, such as publishing, was refused for. */
  keep(field: string, issue: Issue | undefined): void {
    this.refused.set(issue === undefined ? {} : { [field]: issue });
  }

  /** A number was given: it has to be one, and then the command for it is applied, unless it is the number that the document has. */
  number(
    field: string,
    what: string,
    event: Event,
    current: number,
    command: (value: number) => DocumentCommand,
  ): void {
    const input = event.target as HTMLInputElement;
    const text = input.value.trim();
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) {
      this.refuse(field, `${what} has to be a number. It stays as it was.`);
      input.value = String(current);
      return;
    }
    if (value === current) {
      this.refused.set({});
      return;
    }
    if (!this.apply(field, command(value))) {
      input.value = String(current);
    }
  }
}

/** A field for a whole number, with its label, what it is about if that needs saying, and the reason that it was refused, under it. */
@Component({
  selector: 'rmq-number-field',
  imports: [Help, RefusalNotice],
  template: `
    <div class="flex flex-col gap-1">
      <div class="flex flex-wrap items-center gap-1">
        <label class="text-sm font-medium" [for]="inputId">{{ label() }}</label>
        @if (help(); as sentence) {
          <rmq-help [topic]="label()">{{ sentence }}</rmq-help>
        }
      </div>
      <input
        type="number"
        step="1"
        class="border-border bg-surface rounded-md border px-2 py-1.5 text-sm"
        [id]="inputId"
        [attr.min]="min()"
        [attr.max]="max()"
        [value]="value()"
        [attr.aria-invalid]="problem() ? 'true' : null"
        [attr.aria-describedby]="problem() ? problemId : null"
        (change)="given.emit($event)"
      />
      @if (problem(); as issue) {
        <div [id]="problemId"><rmq-refusal-notice [issue]="issue" /></div>
      }
    </div>
  `,
})
export class NumberField {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly min = input<number>();
  readonly max = input<number>();
  readonly help = input<string>();
  readonly problem = input<Issue | undefined>();
  /** The learner gave a value, and the field has not been told what became of it. */
  readonly given = output<Event>();

  private readonly uid = `rmq-number-${nextField++}`;
  protected readonly inputId = `${this.uid}-input`;
  protected readonly problemId = `${this.uid}-problem`;
}
