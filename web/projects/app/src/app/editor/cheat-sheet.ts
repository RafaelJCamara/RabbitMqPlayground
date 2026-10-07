import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { Component, inject, Injectable } from '@angular/core';
import { COMMAND_DOCS } from '@rmq/domain';
import { firstSentence } from '../command-bar/help';
import { FeatureFlags } from '../core/flags/feature-flags';
import type { FlagName } from '../core/flags/flags';
import { available, keysOf, SHORTCUTS } from './keyboard';
import { WAYS_TO_LINK } from './ways-to-link';

/** One key of the table, as the cheat-sheet says it. */
export interface KeyRow {
  readonly id: string;
  readonly keys: string;
  readonly label: string;
  readonly where: string;
}

/** One command of the registry, as the cheat-sheet says it. */
export interface CommandRow {
  readonly name: string;
  readonly syntax: string;
  readonly summary: string;
}

/**
 * Every row of the table of shortcuts, in its order, with where it works. The hint bar says only what is worth saying now, and the sheet says everything (ADR-0047),
 * but for a key that is for a feature flag that is off, which is not the sheet's to say.
 */
export function keyRows(mac?: boolean, enabled: readonly FlagName[] = []): KeyRow[] {
  return SHORTCUTS.filter((row) => available(row, enabled)).map((row) => ({
    id: row.id,
    keys: keysOf(row, mac),
    label: row.label,
    where:
      row.scope === 'canvas'
        ? 'On the canvas'
        : row.inFields === true
          ? 'Anywhere in the editor, even in a field of text'
          : 'Anywhere in the editor',
  }));
}

/** Every command of the registry, and the batch, with how it is written and the first sentence of what it does. */
export function commandRows(): CommandRow[] {
  return COMMAND_DOCS.map(({ name, syntax, summary }) => ({ name, syntax, summary: firstSentence(summary) }));
}

export const CHEAT_SHEET_TITLE_ID = 'rmq-cheat-sheet-title';

/**
 * The cheat-sheet (ADR-0047): the five ways to link, every key and every command, made from the table of shortcuts and the registry so that neither can drift from it. It is
 * a dialog, which the key `?` and the Help button of the top bar open, because it is a sheet to read and close and not a place to edit.
 */
@Component({
  selector: 'rmq-cheat-sheet',
  template: `
    <div
      class="bg-panel text-fg border-border flex max-h-[85dvh] w-[min(52rem,92vw)] flex-col rounded-lg border shadow-xl"
      data-testid="cheat-sheet"
    >
      <div class="border-line flex items-center justify-between gap-4 border-b px-4 py-3">
        <h2 class="text-base font-semibold" [id]="titleId">Keyboard shortcuts and commands</h2>
        <button
          type="button"
          class="border-border hover:bg-canvas rounded-md border px-3 py-1 font-medium"
          (click)="ref.close()"
        >
          Close
        </button>
      </div>
      <div class="flex flex-col gap-5 overflow-y-auto px-4 py-4 text-sm" tabindex="0">
        <section aria-labelledby="rmq-cheat-ways">
          <h3 class="font-semibold" id="rmq-cheat-ways">Five ways to link</h3>
          <ol class="mt-2 list-decimal pl-5" aria-label="Five ways to link">
            @for (way of ways; track way) {
              <li>{{ way }}</li>
            }
          </ol>
          <p class="text-muted mt-2">
            The command bar does the same with a line, for example
            <code class="font-mono">bind orders -> billing</code>.
          </p>
        </section>
        <section aria-labelledby="rmq-cheat-keys">
          <h3 class="font-semibold" id="rmq-cheat-keys">Keys</h3>
          <table class="mt-2 w-full text-left" aria-labelledby="rmq-cheat-keys">
            <thead class="text-muted text-xs tracking-wide uppercase">
              <tr>
                <th scope="col" class="py-1 pr-4">Keys</th>
                <th scope="col" class="py-1 pr-4">What it does</th>
                <th scope="col" class="py-1">Where</th>
              </tr>
            </thead>
            <tbody>
              @for (row of keys; track row.id) {
                <tr class="border-line border-t">
                  <td class="py-1 pr-4">
                    <kbd class="border-border rounded border px-1 font-mono">{{ row.keys }}</kbd>
                  </td>
                  <td class="py-1 pr-4">{{ row.label }}</td>
                  <td class="text-muted py-1">{{ row.where }}</td>
                </tr>
              }
            </tbody>
          </table>
        </section>
        <section aria-labelledby="rmq-cheat-commands">
          <h3 class="font-semibold" id="rmq-cheat-commands">Commands</h3>
          <table class="mt-2 w-full text-left" aria-labelledby="rmq-cheat-commands">
            <thead class="text-muted text-xs tracking-wide uppercase">
              <tr>
                <th scope="col" class="py-1 pr-4">How it is written</th>
                <th scope="col" class="py-1">What it does</th>
              </tr>
            </thead>
            <tbody>
              @for (row of commands; track row.name) {
                <tr class="border-line border-t align-top">
                  <td class="py-1 pr-4">
                    <code class="font-mono whitespace-pre-wrap">{{ row.syntax }}</code>
                  </td>
                  <td class="py-1">{{ row.summary }}</td>
                </tr>
              }
            </tbody>
          </table>
          <p class="text-muted mt-2">
            Type <code class="font-mono">help</code> in the command bar to say more about a command.
          </p>
        </section>
      </div>
    </div>
  `,
})
export class CheatSheet {
  protected readonly ref = inject(DialogRef);
  protected readonly titleId = CHEAT_SHEET_TITLE_ID;
  protected readonly ways = WAYS_TO_LINK.map((way) => way.full);
  protected readonly keys = keyRows(undefined, inject(FeatureFlags).enabled);
  protected readonly commands = commandRows();
}

/** Opens the cheat-sheet, once. */
@Injectable()
export class CheatSheetService {
  private readonly dialog = inject(Dialog);
  private current: DialogRef<unknown, CheatSheet> | undefined;

  open(): void {
    if (this.current !== undefined) {
      return;
    }
    const ref = this.dialog.open(CheatSheet, {
      ariaModal: true,
      ariaLabelledBy: CHEAT_SHEET_TITLE_ID,
      backdropClass: 'cdk-overlay-dark-backdrop',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
    });
    this.current = ref;
    ref.closed.subscribe(() => {
      this.current = undefined;
    });
  }
}
