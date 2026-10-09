import { Component, computed, inject } from '@angular/core';
import { LinkOpening } from './core/share/link-opening';
import { ThemeService } from './core/theme/theme-service';
import { LinkFailed } from './canvases/link-failed';
import { SharedView } from './canvases/shared-view';
import { Workspace } from './canvases/workspace';

/**
 * The root (ADR-0030, ADR-0084). It shows the workspace of the canvases, which the compiler loads as a chunk of its own. The theme is applied here, because it belongs to the page and not to
 * the editor. A link in the address (ADR-0078) makes the page a shared canvas, or the page that says why the link cannot be opened; the shared view is a chunk of its own, like the workspace.
 */
@Component({
  selector: 'rmq-root',
  imports: [LinkFailed, SharedView, Workspace],
  templateUrl: './app.html',
})
export class App {
  private readonly link = inject(LinkOpening);
  /** The link in the address is being unpacked. */
  protected readonly opening = computed(() => this.link.state().kind === 'opening');
  /** What the link carried, once it is unpacked: the page is then a shared canvas. */
  protected readonly shared = computed(() => {
    const state = this.link.state();
    return state.kind === 'shared' ? state.shared : null;
  });
  /** Why the link cannot be opened, once it is known. */
  protected readonly refusal = computed(() => {
    const state = this.link.state();
    return state.kind === 'failed' ? state.error : null;
  });

  constructor() {
    inject(ThemeService);
  }
}
