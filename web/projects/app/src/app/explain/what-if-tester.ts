import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { WhatIf } from '../core/explain/what-if';
import { Icon } from '../core/ui/icon';
import { RefusalNotice } from '../core/ui/refusal-notice';
import { RouteTree } from './route-tree';

let nextTester = 0;

const FIELD = 'border-border bg-surface min-h-8 w-full rounded-md border px-2 py-1.5';

/**
 * The what-if tester (ADR-0064): a part of the inspector region, under what is selected, that is shut until it is asked for. It takes an exchange from a list and a message in the text form of the command, and says where
 * the message would go on the canvas as it is, answer first, with the route under it, folded, and, with the simulation on, the line that would send it for real. The canvas is lit as for a Why? for as long as it is open and
 * the line can be read. It publishes nothing and changes nothing: it asks the canvas, and what it asks is the service's. Escape shuts it.
 */
@Component({
  selector: 'rmq-what-if',
  imports: [Icon, RefusalNotice, RouteTree],
  template: `
    @if (whatIf.enabled) {
      <section
        class="border-border bg-panel mt-4 flex flex-col rounded-md border text-sm"
        data-testid="what-if"
        [attr.aria-labelledby]="titleId"
      >
        <h3 [id]="titleId" class="font-semibold">
          <button
            #toggle
            type="button"
            class="flex min-h-8 w-full items-center gap-2 px-3 py-1.5 text-left"
            data-testid="what-if-toggle"
            [attr.aria-expanded]="whatIf.isOpen()"
            [attr.aria-controls]="whatIf.isOpen() ? bodyId : null"
            (click)="whatIf.toggle()"
          >
            <rmq-icon name="help" [size]="16" />
            What if…?
          </button>
        </h3>
        @if (whatIf.isOpen()) {
          <div [id]="bodyId" class="border-line flex flex-col gap-3 border-t p-3">
            <p class="text-muted text-xs">
              Try a message on this canvas as it is. Nothing is published: it only asks where the message would go.
            </p>
            <div class="flex flex-col gap-1">
              <label class="font-medium" [for]="exchangeId">Exchange</label>
              <select [id]="exchangeId" [class]="field" data-testid="what-if-exchange" (change)="choose($event)">
                @for (option of whatIf.exchanges(); track option.name) {
                  <option [value]="option.name" [selected]="option.name === whatIf.exchange()">
                    {{ option.label }}
                  </option>
                }
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="font-medium" [for]="messageId">Message</label>
              <input
                type="text"
                autocomplete="off"
                spellcheck="false"
                placeholder="key=order.created header:format=pdf"
                [id]="messageId"
                [class]="field + ' font-mono text-xs'"
                data-testid="what-if-message"
                [value]="whatIf.text()"
                [attr.aria-describedby]="whatIf.issue() ? hintId + ' ' + problemId : hintId"
                [attr.aria-invalid]="whatIf.issue() ? 'true' : null"
                (input)="type($event)"
              />
              <p class="text-muted text-xs" [id]="hintId">
                The key and the headers as they follow the exchange in publish, for example
                <code class="font-mono">key=order.created header:format=pdf</code>.
              </p>
              @if (whatIf.issue(); as issue) {
                <div [id]="problemId" data-testid="what-if-problem"><rmq-refusal-notice [issue]="issue" /></div>
              }
            </div>
            @if (whatIf.answer(); as answer) {
              <p class="font-medium" role="status" data-testid="what-if-answer">{{ answer.outlook }}</p>
              <details class="border-line rounded-md border px-2 py-1" data-testid="what-if-route">
                <summary class="min-h-6 cursor-pointer">The route</summary>
                <div class="pt-2"><rmq-route-tree [explanation]="answer.explanation" /></div>
              </details>
              @if (answer.line; as line) {
                <p class="text-muted text-xs">
                  To send it for real:
                  <code class="font-mono break-all" data-testid="what-if-line">{{ line }}</code>
                </p>
              }
            }
          </div>
        }
      </section>
    }
  `,
  // Escape in it shuts it, from whatever of it has the keyboard, and the keyboard goes to the button that opened it.
  host: { '(keydown.escape)': 'shut()' },
})
export class WhatIfTester {
  protected readonly whatIf = inject(WhatIf);

  private readonly uid = `rmq-what-if-${nextTester++}`;
  protected readonly titleId = `${this.uid}-title`;
  protected readonly bodyId = `${this.uid}-body`;
  protected readonly exchangeId = `${this.uid}-exchange`;
  protected readonly messageId = `${this.uid}-message`;
  protected readonly hintId = `${this.uid}-hint`;
  protected readonly problemId = `${this.uid}-problem`;
  protected readonly field = FIELD;
  private readonly toggle = viewChild<ElementRef<HTMLButtonElement>>('toggle');

  protected choose(event: Event): void {
    this.whatIf.choose((event.target as HTMLSelectElement).value);
  }

  protected type(event: Event): void {
    this.whatIf.type((event.target as HTMLInputElement).value);
  }

  protected shut(): void {
    if (this.whatIf.isOpen()) {
      this.whatIf.close();
      this.toggle()?.nativeElement.focus();
    }
  }
}
