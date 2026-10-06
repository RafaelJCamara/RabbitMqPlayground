import { Component, inject } from '@angular/core';
import { APP_DISCLAIMER, APP_NAME } from './core/app-info';
import { FeatureFlags } from './core/flags/feature-flags';
import { ThemeService } from './core/theme/theme-service';
import { Editor } from './editor/editor';

/**
 * The root (ADR-0030). Behind the `editor` flag it shows the editor, which the compiler loads as a chunk of its own, so that a
 * visitor without the flag downloads none of it. Without the flag it shows the placeholder. The theme is applied here, because it
 * belongs to the page and not to the editor.
 */
@Component({
  selector: 'rmq-root',
  imports: [Editor],
  templateUrl: './app.html',
})
export class App {
  protected readonly name = APP_NAME;
  protected readonly disclaimer = APP_DISCLAIMER;
  protected readonly editor = inject(FeatureFlags).isEnabled('editor');

  constructor() {
    inject(ThemeService);
  }
}
