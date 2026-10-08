import { Component, computed, inject } from '@angular/core';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { APP_NAME } from '../core/app-info';
import { CANVAS_HOST } from '../core/session/canvas-host';
import { CanvasSession } from '../core/session/canvas-session';
import { DocumentStore } from '../core/state/document-store';
import { ThemeService } from '../core/theme/theme-service';
import { parseTheme, THEME_LABEL, THEME_PREFERENCES } from '../core/theme/theme';
import { Icon } from '../core/ui/icon';
import { Switch } from '../core/ui/switch';
import { EditorActions } from './actions';
import { formatChord } from './keyboard';
import { saveText } from './save-text';

const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

const BUTTON =
  'border-border bg-surface hover:bg-canvas disabled:text-muted flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 disabled:cursor-not-allowed disabled:opacity-60';

/**
 * The top bar (ADR-0010): the name of the product, which is the one heading of the page, what can be done to the whole canvas (undo and
 * redo, auto-layout, the view), and what concerns keeping it. The tabs of S9, the play controls of S6 and Share of S10 go here when
 * they exist. A button that has a key says which, so that nothing is hidden (ADR-0002), and each is a button with a name in words.
 */
@Component({
  selector: 'rmq-top-bar',
  imports: [Icon, Switch],
  template: `
    <header class="border-line bg-panel flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2">
      @if (!inWorkspace) {
        <h1 class="text-base font-semibold tracking-tight">{{ name }}</h1>
      }
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div class="flex items-center gap-1.5" role="group" aria-label="Edit">
          <button
            type="button"
            [class]="button"
            [disabled]="!store.canUndo()"
            [attr.aria-label]="undoName()"
            [attr.title]="'Undo (' + undoKeys + ')'"
            aria-keyshortcuts="Control+Z Meta+Z"
            data-testid="undo"
            (click)="actions.undo('toolbar')"
          >
            <rmq-icon name="undo" [size]="18" />
            <span>Undo</span>
          </button>
          <button
            type="button"
            [class]="button"
            [disabled]="!store.canRedo()"
            [attr.aria-label]="redoName()"
            [attr.title]="'Redo (' + redoKeys + ')'"
            aria-keyshortcuts="Control+Shift+Z Control+Y Meta+Shift+Z"
            data-testid="redo"
            (click)="actions.redo('toolbar')"
          >
            <rmq-icon name="redo" [size]="18" />
            <span>Redo</span>
          </button>
          <button type="button" [class]="button" data-testid="layout" (click)="actions.layout()">
            <rmq-icon name="layout" [size]="18" />
            <span>Auto-layout</span>
          </button>
          @if (inWorkspace) {
            <button
              type="button"
              [class]="button"
              aria-label="Clear canvas"
              data-testid="clear"
              (click)="actions.clear('toolbar')"
            >
              <rmq-icon name="trash" [size]="18" />
              <span>Clear</span>
            </button>
          }
        </div>
        <div class="flex items-center gap-1.5" role="group" aria-label="View">
          <button
            type="button"
            [class]="button"
            aria-label="Zoom out"
            data-testid="zoom-out"
            (click)="actions.zoomOut()"
          >
            <rmq-icon name="zoom-out" [size]="18" />
          </button>
          <button
            type="button"
            [class]="button"
            [attr.aria-label]="'Reset the zoom to 100%, now ' + percent()"
            data-testid="zoom-reset"
            (click)="actions.resetZoom()"
          >
            {{ percent() }}
          </button>
          <button type="button" [class]="button" aria-label="Zoom in" data-testid="zoom-in" (click)="actions.zoomIn()">
            <rmq-icon name="zoom-in" [size]="18" />
          </button>
          <button
            type="button"
            [class]="button"
            [attr.title]="'Fit the canvas (' + fitKeys + ')'"
            aria-keyshortcuts="F"
            data-testid="fit"
            (click)="actions.fit()"
          >
            <rmq-icon name="fit" [size]="18" />
            <span>Fit</span>
          </button>
          <span class="flex items-center gap-2">
            <span id="rmq-default-exchange-label" class="text-muted">Default exchange</span>
            <rmq-switch
              [checked]="store.document().settings.showDefaultExchange"
              labelledBy="rmq-default-exchange-label"
              (turn)="actions.setDefaultExchange($event)"
            />
          </span>
        </div>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <p class="flex min-w-36 items-center gap-1.5" data-testid="save-state" [class]="saveClass()">
          <rmq-icon [name]="saveIcon()" [size]="16" />
          <span>{{ save().text }}</span>
        </p>
        <button
          type="button"
          [class]="button"
          aria-label="Help"
          aria-haspopup="dialog"
          aria-keyshortcuts="?"
          title="Help: keyboard shortcuts and commands (?)"
          data-testid="help"
          (click)="actions.openCheatSheet()"
        >
          <rmq-icon name="help" [size]="18" />
        </button>
        <span class="flex items-center gap-1.5">
          <span class="text-muted" aria-hidden="true"><rmq-icon [name]="themeIcon()" [size]="18" /></span>
          <select
            class="border-border bg-surface rounded-md border px-2 py-1"
            aria-label="Theme"
            title="Theme"
            data-testid="theme"
            (change)="chooseTheme($event)"
          >
            @for (choice of choices; track choice) {
              <option [value]="choice" [selected]="choice === theme.preference()">{{ labels[choice] }}</option>
            }
          </select>
        </span>
      </div>
    </header>
  `,
})
export class TopBar {
  protected readonly name = APP_NAME;
  /** In a workspace (ADR-0072) the name of the product is the one heading of the page, and it is in the strip of open canvases. */
  protected readonly inWorkspace = inject(CANVAS_HOST) !== null;
  protected readonly theme = inject(ThemeService);
  protected readonly store = inject(DocumentStore);
  protected readonly actions = inject(EditorActions);
  private readonly session = inject(CanvasSession);
  private readonly viewport = inject(FlowViewport);

  protected readonly button = BUTTON;
  protected readonly undoKeys = formatChord({ key: 'z', mod: true });
  protected readonly redoKeys = formatChord({ key: 'z', mod: true, shift: true });
  protected readonly fitKeys = formatChord({ key: 'f' });

  protected readonly choices = THEME_PREFERENCES;
  /** The icon that stands for the choice, in place of a word, so that the bar has room for what it says about saving. */
  protected readonly themeIcon = computed(() => THEME_ICON[this.theme.preference()]);
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

  /** The name of the button says what it would take back, when there is something. Without it, the words on the button are its name. */
  protected readonly undoName = computed(() => {
    const label = this.store.undoLabel();
    return label === undefined ? null : `Undo: ${label}`;
  });
  protected readonly redoName = computed(() => {
    const label = this.store.redoLabel();
    return label === undefined ? null : `Redo: ${label}`;
  });
  protected readonly percent = computed(() => `${Math.round(this.viewport.zoom() * 100)}%`);

  protected chooseTheme(event: Event): void {
    this.theme.set(parseTheme((event.target as HTMLSelectElement).value));
  }
}
