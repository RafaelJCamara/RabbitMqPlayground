import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { completeCommand, type CompletionItem, type Issue } from '@rmq/domain';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import type { CommandOrigin } from '../core/state/origin';
import { RefusalNotice } from '../core/ui/refusal-notice';
import { CommandHistory } from './command-history';
import { take } from './completion';
import { applySuggestion } from './fixes';
import { helpOutput, type HelpOutput } from './help';
import { HelpView } from './help-view';
import { CommandRunner } from './runner';
import { nextSteps } from './suggestions';

let nextBar = 0;

/** What the learner used, in the words of the log. */
const ORIGIN: Readonly<Record<CommandOrigin, string>> = {
  gesture: 'gesture',
  key: 'key',
  inspector: 'inspector',
  toolbar: 'toolbar',
  menu: 'menu',
  typed: 'typed',
};

/** The keys that move the cursor in the field, which is why the list that was open for what was being typed is shut. */
const CURSOR_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

interface Refusal {
  readonly kind: 'refusal';
  readonly issue: Issue;
  /** The text that the issue is about, which is the field as it was when the line was run. */
  readonly line: string;
}

/** What the panel shows of the last line: why it was refused, or the help that it asked for. */
type Answer = Refusal | { readonly kind: 'help'; readonly output: HelpOutput };

/** What a screen reader is told when help is shown, because it is shown above the field and the cursor stays in it. */
const helpSpoken = (output: HelpOutput): string =>
  output.kind === 'list'
    ? 'The commands are listed above the field.'
    : `Help for ${output.doc.name} is shown above the field.`;

/**
 * The command bar (ADR-0011, ADR-0045): a panel above the hint bar that types through the same door as a gesture. Closed, it is one line, with the latest equivalent
 * command. Open, it is the log of equivalent commands, what the last line said, and a field like a prompt, which is a combobox: it offers what the parser would accept at
 * the cursor, keeps the lines that were given, suggests what to do next while it is empty, and says where and why a line could not be read. It knows nothing of the editor
 * that hosts it, which opens it with `open()`.
 */
@Component({
  selector: 'rmq-command-bar',
  imports: [RefusalNotice, HelpView],
  providers: [CommandRunner],
  template: `
    <section class="border-line bg-panel border-t text-sm" aria-label="Command bar" data-testid="command-bar">
      <div class="flex items-center gap-3 px-4 py-1.5">
        <button
          type="button"
          class="border-border hover:bg-canvas shrink-0 rounded-md border px-2 py-0.5 font-medium"
          [attr.aria-expanded]="isOpen()"
          [attr.aria-controls]="isOpen() ? panelId : null"
          (click)="toggle()"
        >
          Commands
        </button>
        @if (isOpen()) {
          <span class="flex-1"></span>
        } @else if (log.latest(); as last) {
          <p class="min-w-0 flex-1 truncate" data-testid="latest-command">
            <span class="sr-only">Latest equivalent command: </span><span class="text-muted" aria-hidden="true">↳ </span
            ><code class="font-mono">{{ last.text }}</code>
          </p>
        } @else {
          <p class="text-muted min-w-0 flex-1 truncate">{{ EMPTY_LOG }}</p>
        }
        <p class="text-muted shrink-0 text-xs">
          <kbd class="border-border text-fg rounded border px-1 font-mono">{{ keys() }}</kbd> to type a command
        </p>
      </div>
      @if (isOpen()) {
        <div class="border-line flex flex-col gap-2 border-t px-4 py-2" [id]="panelId">
          <section aria-label="Equivalent commands">
            @if (log.entries().length === 0) {
              <p class="text-muted">Nothing yet. {{ EMPTY_LOG }}</p>
            } @else {
              <ol #logList class="max-h-36 overflow-y-auto font-mono text-xs" data-testid="command-log">
                @for (entry of log.entries(); track entry.id) {
                  <li class="flex items-baseline gap-2 py-0.5">
                    <span class="text-muted w-16 shrink-0 font-sans" data-testid="origin">{{
                      ORIGIN[entry.origin]
                    }}</span>
                    <code class="min-w-0 flex-1 break-words">{{ entry.text }}</code>
                    <button
                      type="button"
                      class="border-border hover:bg-canvas min-h-6 min-w-6 shrink-0 rounded border px-1.5 font-sans"
                      [attr.aria-label]="'Use again: ' + entry.text"
                      (click)="reuse(entry.text)"
                    >
                      Use again
                    </button>
                  </li>
                }
              </ol>
            }
          </section>
          @if (answer(); as shown) {
            @if (shown.kind === 'refusal') {
              <div class="flex flex-col gap-2" [id]="answerId" data-testid="command-answer">
                <rmq-refusal-notice [issue]="shown.issue" />
                @if (fixes().length > 0) {
                  <div role="group" aria-label="Did you mean" class="flex flex-wrap items-center gap-2">
                    <span class="text-muted" aria-hidden="true">Did you mean</span>
                    @for (fix of fixes(); track fix.name) {
                      <button
                        type="button"
                        class="border-border hover:bg-canvas rounded border px-2 py-0.5 font-mono"
                        (click)="reuse(fix.line)"
                      >
                        {{ fix.name }}
                      </button>
                    }
                  </div>
                }
              </div>
            } @else {
              <div class="max-h-56 overflow-y-auto">
                <rmq-help-view [output]="shown.output" (use)="reuse($event)" (lookup)="lookup($event)" />
              </div>
            }
          }
          @if (text() === '' && steps().length > 0) {
            <div role="group" aria-label="Try one of these" class="flex flex-wrap items-center gap-2">
              <span class="text-muted" aria-hidden="true">Try</span>
              @for (line of steps(); track line) {
                <button
                  type="button"
                  class="border-border hover:bg-canvas rounded border px-2 py-0.5 font-mono"
                  [attr.aria-label]="'Put ' + line + ' in the field'"
                  (click)="reuse(line)"
                >
                  {{ line }}
                </button>
              }
            </div>
          }
          <div class="flex items-center gap-2">
            <span class="text-muted font-mono" aria-hidden="true">›</span>
            <div class="relative min-w-0 flex-1">
              <input
                #field
                type="text"
                role="combobox"
                aria-label="Command"
                aria-autocomplete="list"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="Type a command, or help"
                class="border-border bg-surface placeholder:text-muted w-full rounded-md border px-2 py-1.5 font-mono"
                [value]="text()"
                [attr.aria-expanded]="items().length > 0"
                [attr.aria-controls]="items().length > 0 ? listId : null"
                [attr.aria-activedescendant]="chosen() >= 0 ? optionId(chosen()) : null"
                [attr.aria-invalid]="answer()?.kind === 'refusal' ? true : null"
                [attr.aria-describedby]="answer()?.kind === 'refusal' ? answerId : null"
                (input)="onInput($event)"
                (keydown)="onKey($event)"
                (keyup)="onKeyUp($event)"
                (click)="onCursorMoved()"
              />
              @if (items().length > 0) {
                <!-- A press in the list must not take the focus from the field, which would give the line up before the click. -->
                <ul
                  class="border-border bg-panel absolute right-0 bottom-full left-0 z-20 mb-1 max-h-48 overflow-y-auto rounded-md border p-1 shadow-lg"
                  role="listbox"
                  aria-label="Completions"
                  [id]="listId"
                  (mousedown)="$event.preventDefault()"
                >
                  @for (item of items(); track $index) {
                    <li
                      role="option"
                      class="flex cursor-pointer items-baseline gap-3 rounded px-2 py-1"
                      [class]="chosen() === $index ? 'bg-accent text-accent-fg' : 'hover:bg-canvas'"
                      [id]="optionId($index)"
                      [attr.aria-selected]="chosen() === $index"
                      tabindex="-1"
                      (click)="accept(item)"
                      (keydown.enter)="accept(item)"
                    >
                      <span class="font-mono" data-testid="item-label">{{ item.label }}</span>
                      @if (item.detail) {
                        <span class="text-xs opacity-80">{{ item.detail }}</span>
                      }
                    </li>
                  }
                </ul>
              }
            </div>
            <button
              type="button"
              class="border-border hover:bg-canvas shrink-0 rounded-md border px-3 py-1.5 font-medium"
              (click)="runLine()"
            >
              Run
            </button>
          </div>
        </div>
      }
    </section>
  `,
  host: { class: 'block', '(keydown.escape)': 'onEscape()' },
})
export class CommandBar {
  /** The keys that open the bar, as they are written for a person, which the editor makes from its table of shortcuts. */
  readonly keys = input('/');

  private readonly store = inject(DocumentStore);
  protected readonly log = inject(CommandLog);
  private readonly runner = inject(CommandRunner);
  private readonly history = inject(CommandHistory);
  private readonly announcer = inject(Announcer);
  private readonly viewport = inject(FlowViewport);
  private readonly injector = inject(Injector);

  protected readonly ORIGIN = ORIGIN;
  protected readonly EMPTY_LOG = 'Each change you make appears here as the command that does the same.';

  private readonly uid = `rmq-command-bar-${nextBar++}`;
  protected readonly panelId = `${this.uid}-panel`;
  protected readonly listId = `${this.uid}-list`;
  protected readonly answerId = `${this.uid}-answer`;

  protected readonly isOpen = signal(false);
  protected readonly text = signal('');
  private readonly cursor = signal(0);
  /** Whether the list is for what is being typed: it opens when the learner types, and shuts when they run a line, move the cursor, or press Escape. */
  private readonly typing = signal(false);
  /** The option that the arrow keys are on, or -1. */
  protected readonly chosen = signal(-1);
  protected readonly answer = signal<Answer | null>(null);
  /** Where the walk through the history is, and what was typed before it began. Nothing in the template reads it. */
  private walk: { readonly index: number; readonly draft: string } | null = null;

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly logList = viewChild<ElementRef<HTMLElement>>('logList');

  private readonly completion = computed(() => completeCommand(this.text(), this.cursor(), this.store.document()));
  /** What the completer offers at the cursor, while the learner is typing something. */
  protected readonly items = computed(() =>
    this.typing() && this.text().trim() !== '' ? this.completion().items : [],
  );
  /** What to do next, for the empty field. */
  protected readonly steps = computed(() => nextSteps(this.store.document()));
  /** The names that were probably meant, each with the line that it makes when it is put in place of the words at fault. */
  protected readonly fixes = computed(() => {
    const shown = this.answer();
    return shown?.kind !== 'refusal'
      ? []
      : (shown.issue.suggestions ?? []).flatMap((name) => {
          const line = applySuggestion(shown.line, shown.issue, name);
          return line === undefined ? [] : [{ name, line }];
        });
  });

  constructor() {
    // The log shows its latest line, which the learner has just made, so it is scrolled to the end when it grows and when it opens.
    effect(() => {
      this.log.entries();
      this.isOpen();
      afterNextRender(
        () => {
          const list = this.logList()?.nativeElement;
          if (list !== undefined) {
            list.scrollTop = list.scrollHeight;
          }
        },
        { injector: this.injector },
      );
    });
    // The option that the arrow keys are on stays in view, in a list that scrolls.
    effect(() => {
      const index = this.chosen();
      if (index >= 0) {
        afterNextRender(
          () => {
            const option = this.field()?.nativeElement.parentElement?.querySelector(`#${this.optionId(index)}`);
            // jsdom does not scroll, and has no way to say so.
            option?.scrollIntoView?.({ block: 'nearest' });
          },
          { injector: this.injector },
        );
      }
    });
  }

  /** Opens the bar with the cursor in the field. It is what the key that is for it asks for. */
  open(): void {
    this.isOpen.set(true);
    this.focusField();
  }

  protected toggle(): void {
    if (this.isOpen()) {
      this.close(false);
    } else {
      this.open();
    }
  }

  /** Closes the bar, and gives the focus to the canvas when the learner asked with a key, because the key came from where they were working. What was typed stays. */
  protected close(toCanvas: boolean): void {
    this.isOpen.set(false);
    this.answer.set(null);
    this.typing.set(false);
    this.chosen.set(-1);
    if (toCanvas) {
      this.viewport.focus();
    }
  }

  /** Escape anywhere in the bar closes it, when it is open. The field keeps its own Escape for the list, and does not let it get here. */
  protected onEscape(): void {
    if (this.isOpen()) {
      this.close(true);
    }
  }

  protected optionId(index: number): string {
    return `${this.uid}-option-${index}`;
  }

  protected onInput(event: Event): void {
    const field = event.target as HTMLInputElement;
    this.text.set(field.value);
    this.cursor.set(field.selectionStart ?? field.value.length);
    this.typing.set(true);
    this.edited();
  }

  /** The cursor was moved without typing: the list is for what is being typed, so it goes. */
  protected onCursorMoved(): void {
    const field = this.field()?.nativeElement;
    this.cursor.set(field?.selectionStart ?? this.text().length);
    this.typing.set(false);
    this.chosen.set(-1);
  }

  protected onKeyUp(event: KeyboardEvent): void {
    if (CURSOR_KEYS.has(event.key)) {
      this.onCursorMoved();
    }
  }

  protected onKey(event: KeyboardEvent): void {
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const items = this.items();
    switch (event.key) {
      case 'Enter': {
        event.preventDefault();
        const item = items[this.chosen()];
        if (item === undefined) {
          this.runLine();
        } else {
          this.accept(item);
        }
        break;
      }
      case 'Tab': {
        // Tab takes the item that is chosen, or the first; with nothing to take it is the page's, so that the keyboard is never trapped here.
        const item = items[Math.max(0, this.chosen())];
        if (item !== undefined && !event.shiftKey) {
          event.preventDefault();
          this.accept(item);
        }
        break;
      }
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        if (items.length > 0) {
          this.choose(step, items.length);
        } else {
          this.walkHistory(step);
        }
        break;
      }
      case 'Escape':
        // Escape shuts the list first. With none open it goes on to the panel, which closes the bar.
        if (items.length > 0) {
          event.preventDefault();
          event.stopPropagation();
          this.typing.set(false);
          this.chosen.set(-1);
        }
        break;
    }
  }

  private choose(step: 1 | -1, count: number): void {
    const current = this.chosen();
    this.chosen.set(current === -1 ? (step === 1 ? 0 : count - 1) : (current + step + count) % count);
  }

  /** Up goes to an older line and down to a newer one, and past the newest is what was being typed before the walk. A line from the history leaves the list shut, so the arrows go on walking. */
  private walkHistory(step: 1 | -1): void {
    const lines = this.history.lines();
    const walk = this.walk ?? { index: lines.length, draft: this.text() };
    const index = Math.max(0, walk.index + step);
    this.typing.set(false);
    if (index >= lines.length) {
      this.walk = null;
      this.setField(walk.draft);
    } else {
      this.walk = { index, draft: walk.draft };
      this.setField(lines[index] as string);
    }
  }

  /** Takes an item of the list into the field, and goes on to what comes next, so that Tab again takes that. */
  protected accept(item: CompletionItem): void {
    const taken = take(this.text(), this.completion(), item);
    this.setField(taken.text, { start: taken.cursor, end: taken.cursor });
    this.typing.set(true);
    this.edited();
    this.focusField();
  }

  /** Puts a line in the field, to be run or changed. */
  protected reuse(line: string): void {
    this.setField(line);
    this.typing.set(false);
    this.edited();
    this.focusField();
  }

  /** The help of a command, or the list of them all, which does not touch what is being typed. */
  protected lookup(topic: string | null): void {
    this.showHelp(helpOutput(topic ?? undefined));
  }

  private showHelp(output: HelpOutput): void {
    this.answer.set({ kind: 'help', output });
    this.announcer.announce(helpSpoken(output));
  }

  protected runLine(): void {
    const line = this.text();
    if (line.trim() === '') {
      return;
    }
    this.history.add(line);
    this.walk = null;
    this.typing.set(false);
    this.chosen.set(-1);
    const outcome = this.runner.run(line);
    if (outcome.kind === 'refused') {
      // The text stays, with the words at fault selected, so that the learner can mend it. The bus has said why, aloud.
      this.answer.set({ kind: 'refusal', issue: outcome.issue, line });
      const at = outcome.issue.at;
      this.setField(line, at === undefined ? undefined : { start: at.start, end: at.end });
      return;
    }
    if (outcome.kind === 'help') {
      this.showHelp(outcome.output);
    } else {
      this.answer.set(null);
    }
    this.setField('');
  }

  /** What was typed or put in the field is not what a refusal was about. Help stays, because it is about the command that is being typed. */
  private edited(): void {
    this.chosen.set(-1);
    this.walk = null;
    if (this.answer()?.kind === 'refusal') {
      this.answer.set(null);
    }
  }

  /** Writes the field, and where the cursor or the selection is, at once: the binding that follows writes what is already there. */
  private setField(text: string, selection?: { readonly start: number; readonly end: number }): void {
    const field = this.field()?.nativeElement;
    this.text.set(text);
    const start = selection?.start ?? text.length;
    const end = selection?.end ?? text.length;
    if (field !== undefined) {
      field.value = text;
      field.setSelectionRange(start, end);
    }
    this.cursor.set(end);
  }

  private focusField(): void {
    const field = this.field();
    if (field === undefined) {
      afterNextRender(() => this.field()?.nativeElement.focus(), { injector: this.injector });
    } else {
      field.nativeElement.focus();
    }
  }
}
