import { CdkContextMenuTrigger, CdkMenu, CdkMenuItem } from '@angular/cdk/menu';
import {
  afterNextRender,
  Component,
  DestroyRef,
  DOCUMENT,
  inject,
  Injector,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { ContextTarget } from '../canvas/model/intents';
import type { Point } from '../canvas/model/transform';
import { Icon } from '../core/ui/icon';
import type { IconName } from '../core/ui/icons';

export type MenuActionName = 'rename' | 'delete';

/** What was chosen, and what it is for. */
export interface MenuAction {
  readonly action: MenuActionName;
  readonly target: ContextTarget;
}

interface MenuItem {
  readonly action: MenuActionName;
  readonly label: string;
  readonly icon: IconName;
  readonly keys: string;
}

const RENAME: MenuItem = { action: 'rename', label: 'Rename', icon: 'rename', keys: 'F2' };
const DELETE: MenuItem = { action: 'delete', label: 'Delete', icon: 'trash', keys: 'Delete' };

/**
 * The context menu of a node or an edge (ADR-0010): what the pointer can do there, which is also what a key does, and each item says
 * which key. It is the CDK's menu, which has the roles, the arrow keys, the type-ahead and the way out with Escape, opened where the
 * canvas says (a right click, or the menu key on the selection). It does nothing itself: it says what was chosen, or that it was
 * closed without a choice, so that the focus can go back to the canvas.
 */
@Component({
  selector: 'rmq-context-menu',
  imports: [CdkMenu, CdkMenuItem, CdkContextMenuTrigger, Icon],
  template: `
    <span
      class="fixed size-0"
      [cdkContextMenuTriggerFor]="menu"
      (cdkContextMenuOpened)="focusFirst()"
      (cdkContextMenuClosed)="closed()"
    ></span>
    <ng-template #menu>
      <!-- The CDK draws a menu in a container at the end of the page, outside every landmark, so the menu has one of its own. -->
      <div role="region" aria-label="Context menu">
        <div
          cdkMenu
          class="bg-panel border-border text-fg min-w-48 rounded-md border p-1 shadow-lg"
          [attr.aria-label]="title()"
        >
          @for (item of items(); track item.action) {
            <button
              cdkMenuItem
              type="button"
              class="hover:bg-canvas focus:bg-canvas flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm"
              [attr.data-testid]="'menu-' + item.action"
              (cdkMenuItemTriggered)="choose(item.action)"
            >
              <rmq-icon [name]="item.icon" [size]="16" />
              <span>{{ item.label }}</span>
              <kbd class="text-muted ml-auto text-xs">{{ item.keys }}</kbd>
            </button>
          }
        </div>
      </div>
    </ng-template>
  `,
})
export class ContextMenu {
  /** A choice was made. */
  readonly act = output<MenuAction>();
  /** The menu was closed without one. */
  readonly dismissed = output<void>();

  protected readonly items = signal<readonly MenuItem[]>([]);
  protected readonly title = signal('');
  private readonly target = signal<ContextTarget | null>(null);
  private readonly trigger = viewChild.required(CdkContextMenuTrigger);
  private readonly menuRef = viewChild(CdkMenu);
  private readonly injector = inject(Injector);
  private readonly page = inject(DOCUMENT);
  private chosen = false;
  /** Holds the end of the click that opened the menu, from the moment that it opens until something else happens. */
  private hold: AbortController | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hold?.abort());
  }

  /** Opens the menu for a node or an edge, where the pointer was. `title` says what it is for, for a screen reader. */
  open(target: ContextTarget, client: Point, title: string): void {
    this.target.set(target);
    this.title.set(title);
    this.items.set(target.kind === 'node' ? [RENAME, DELETE] : [DELETE]);
    this.chosen = false;
    this.trigger().open(client);
    this.holdTheEndOfTheClick();
  }

  /**
   * On macOS and Linux the browser sends `contextmenu` when the right button goes down, so the menu opens while the button is still
   * held, and the release, an `auxclick` (a `click` for the Control click of a Mac), is a click outside a menu that has just opened,
   * which closes it. The CDK keeps its own menu open through that when its listener opens it, and not when it is told to open at a
   * point, which is how this one is opened: the canvas says what was pointed at, and a key opens it as well. Windows sends
   * `contextmenu` after the release, so there is nothing to hold there, and the hold ends at the next press or key, which is when
   * a click outside is meant to close the menu.
   */
  private holdTheEndOfTheClick(): void {
    this.hold?.abort();
    const hold = new AbortController();
    this.hold = hold;
    const options = { capture: true, signal: hold.signal };
    const end = () => hold.abort();
    // A click in the menu is a choice, and it is the menu that hears it.
    const release = (event: Event) => {
      if (!(event.target instanceof Node && this.menuRef()?.nativeElement.contains(event.target))) {
        event.stopPropagation();
        end();
      }
    };
    this.page.addEventListener('pointerdown', end, options);
    this.page.addEventListener('keydown', end, options);
    this.page.addEventListener('click', release, options);
    this.page.addEventListener('auxclick', release, options);
  }

  protected choose(action: MenuActionName): void {
    const target = this.target();
    if (target !== null) {
      this.chosen = true;
      this.act.emit({ action, target });
    }
  }

  /**
   * The menu has the focus when it opens, on its first item, so that the arrow keys and Enter work at once. It is the menu that
   * does it, so that the first item is the active one too, and the first arrow key goes to the second.
   */
  protected focusFirst(): void {
    afterNextRender(() => this.menuRef()?.focusFirstItem('program'), { injector: this.injector });
  }

  protected closed(): void {
    if (!this.chosen) {
      this.dismissed.emit();
    }
  }
}
