import { Component, computed, inject } from '@angular/core';
import { APP_DISCLAIMER, APP_NAME } from './core/app-info';
import { FeatureFlags } from './core/flags/feature-flags';
import { LinkOpening } from './core/share/link-opening';
import { ThemeService } from './core/theme/theme-service';
import { LinkFailed } from './canvases/link-failed';
import { SharedView } from './canvases/shared-view';
import { Workspace } from './canvases/workspace';
import { Editor } from './editor/editor';

/**
 * The root (ADR-0030). Behind the `editor` flag it shows the editor, which the compiler loads as a chunk of its own, so that a
 * visitor without the flag downloads none of it. Without the flag it shows the placeholder. The theme is applied here, because it
 * belongs to the page and not to the editor. A link in the address (ADR-0078), with the flags `share` and `editor`, makes the page a shared canvas, or the page that says why the link cannot be opened; the shared view
 * is a chunk of its own, like the workspace.
 */
@Component({
  selector: 'rmq-root',
  imports: [Editor, LinkFailed, SharedView, Workspace],
  templateUrl: './app.html',
})
export class App {
  protected readonly name = APP_NAME;
  protected readonly disclaimer = APP_DISCLAIMER;
  private readonly flags = inject(FeatureFlags);
  protected readonly editor = this.flags.isEnabled('editor');
  /** With the flag `canvases` (and the editor) the editor is inside a workspace of several canvases (ADR-0072). */
  protected readonly canvases = this.flags.isEnabled('canvases');

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
