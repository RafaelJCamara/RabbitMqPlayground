import { Component, computed, inject } from '@angular/core';
import { Icon } from '../ui/icon';
import { parseTheme, THEME_LABEL, THEME_PREFERENCES } from './theme';
import { ThemeService } from './theme-service';

const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

/**
 * The choice of the theme (ADR-0103): an icon that stands for the choice and a `Theme` select with System, Light and Dark. The theme is the page's and not a canvas's (ADR-0032), so it is in the banner of the
 * page, at the right end, outside the navigation, where it is on the home, in every editor and on the page of a shared canvas, and it is not in the top bar of an editor. It reads and writes `ThemeService`, which
 * applies the choice to the page and keeps it in the browser.
 */
@Component({
  selector: 'rmq-theme-picker',
  imports: [Icon],
  template: `
    <span class="flex shrink-0 items-center gap-1.5 text-sm">
      <span class="text-muted" aria-hidden="true"><rmq-icon [name]="icon()" [size]="18" /></span>
      <select
        class="border-border bg-surface rounded-md border px-2 py-1"
        aria-label="Theme"
        title="Theme"
        data-testid="theme"
        (change)="choose($event)"
      >
        @for (choice of choices; track choice) {
          <option [value]="choice" [selected]="choice === theme.preference()">{{ labels[choice] }}</option>
        }
      </select>
    </span>
  `,
  host: { class: 'shrink-0' },
})
export class ThemePicker {
  protected readonly theme = inject(ThemeService);
  protected readonly choices = THEME_PREFERENCES;
  protected readonly labels = THEME_LABEL;
  /** The icon that stands for the choice, in place of a word, so that the strip has room for what it says. */
  protected readonly icon = computed(() => THEME_ICON[this.theme.preference()]);

  protected choose(event: Event): void {
    this.theme.set(parseTheme((event.target as HTMLSelectElement).value));
  }
}
