import { Component, computed, inject } from '@angular/core';
import { APP_NAME } from '../core/app-info';
import { CanvasSession } from '../core/session/canvas-session';
import { ThemeService } from '../core/theme/theme-service';
import { parseTheme, THEME_LABEL, THEME_PREFERENCES } from '../core/theme/theme';
import { Icon } from '../core/ui/icon';
import { saveText } from './save-text';

/**
 * The top bar (ADR-0010): the name of the product, which is the one heading of the page, and what concerns the whole editor.
 * The tabs of S9, the play controls of S6 and Share of S10 go here when they exist.
 */
@Component({
  selector: 'rmq-top-bar',
  imports: [Icon],
  template: `
    <header class="border-line bg-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
      <h1 class="text-base font-semibold tracking-tight">{{ name }}</h1>
      <div class="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <p class="flex items-center gap-1.5" data-testid="save-state" [class]="saveClass()">
          <rmq-icon [name]="saveIcon()" [size]="16" />
          <span>{{ save().text }}</span>
        </p>
        <label class="flex items-center gap-2">
          <span class="text-muted">Theme</span>
          <select
            class="border-border bg-surface rounded-md border px-2 py-1"
            data-testid="theme"
            (change)="chooseTheme($event)"
          >
            @for (choice of choices; track choice) {
              <option [value]="choice" [selected]="choice === theme.preference()">{{ labels[choice] }}</option>
            }
          </select>
        </label>
      </div>
    </header>
  `,
})
export class TopBar {
  protected readonly name = APP_NAME;
  protected readonly theme = inject(ThemeService);
  private readonly session = inject(CanvasSession);

  protected readonly choices = THEME_PREFERENCES;
  protected readonly labels = THEME_LABEL;
  protected readonly save = computed(() => saveText(this.session.save()));
  protected readonly saveIcon = computed(() =>
    this.save().tone === 'ok' ? 'check' : this.save().tone === 'busy' ? 'info' : 'alert',
  );
  protected readonly saveClass = computed(() => {
    switch (this.save().tone) {
      case 'bad':
        return 'text-danger';
      case 'warn':
        return 'text-warning';
      default:
        return 'text-muted';
    }
  });

  protected chooseTheme(event: Event): void {
    this.theme.set(parseTheme((event.target as HTMLSelectElement).value));
  }
}
