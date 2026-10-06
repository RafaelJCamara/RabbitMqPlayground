import { Component, computed, input, output } from '@angular/core';
import type { HelpOutput } from './help';

/**
 * What `help` shows in the panel of the command bar (ADR-0045): every command with a sentence, or one command with how it is written, what it does and its
 * examples. A name in the list asks for that command's help, and an example puts its line in the field, to be run or changed. It decides nothing.
 */
@Component({
  selector: 'rmq-help-view',
  template: `
    <section class="border-line bg-surface rounded-md border p-3" [attr.aria-label]="label()" data-testid="help">
      @if (list(); as shown) {
        <h3 class="font-medium">Commands</h3>
        <ul class="mt-1 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
          @for (command of shown.commands; track command.name) {
            <li class="contents">
              <button type="button" class="text-left font-mono underline" (click)="lookup.emit(command.name)">
                {{ command.name }}
              </button>
              <span class="text-muted">{{ command.summary }}</span>
            </li>
          }
        </ul>
        <p class="text-muted mt-2">{{ shown.several }} Write <code class="font-mono">;</code> between them.</p>
      } @else if (one(); as doc) {
        <h3 class="font-mono font-medium">{{ doc.name }}</h3>
        <p class="mt-1">
          <code class="font-mono">{{ doc.syntax }}</code>
        </p>
        <p class="mt-1">{{ doc.summary }}</p>
        <h4 class="text-muted mt-2 text-xs font-semibold tracking-wide uppercase">Examples</h4>
        <ul class="mt-1 flex flex-col gap-0.5">
          @for (example of doc.examples; track example) {
            <li>
              <button
                type="button"
                class="text-left font-mono underline"
                [attr.aria-label]="'Put ' + example + ' in the field'"
                (click)="use.emit(example)"
              >
                {{ example }}
              </button>
            </li>
          }
        </ul>
        <button type="button" class="mt-2 underline" (click)="lookup.emit(null)">All the commands</button>
      }
    </section>
  `,
})
export class HelpView {
  readonly output = input.required<HelpOutput>();

  /** A line to put in the field: an example. */
  readonly use = output<string>();
  /** The command whose help is wanted, or `null` for the list of them all. */
  readonly lookup = output<string | null>();

  protected readonly list = computed(() => {
    const shown = this.output();
    return shown.kind === 'list' ? shown : null;
  });
  protected readonly one = computed(() => {
    const shown = this.output();
    return shown.kind === 'one' ? shown.doc : null;
  });
  protected readonly label = computed(() => {
    const shown = this.output();
    return shown.kind === 'list' ? 'Help: the commands' : `Help: ${shown.doc.name}`;
  });
}
