import { Component, inject } from '@angular/core';
import { BUILD } from '../build-info';

/**
 * "Build 3f2a9c1" (ADR-0109): the commit that the page was built from, as a link to it, for the foot of the home. It says nothing when the page has no build, and a
 * place that wraps it in an element of its own (a list item) asks for `BUILD` first, so that the element is not left empty.
 */
@Component({
  selector: 'rmq-build-stamp',
  template: `
    @if (build; as b) {
      <span data-testid="build-stamp">
        Build
        @if (b.url; as url) {
          <a class="text-link underline underline-offset-4" [href]="url" [title]="b.commit">{{ b.short }}</a>
        } @else {
          <span>{{ b.short }}</span>
        }
      </span>
    }
  `,
})
export class BuildStamp {
  protected readonly build = inject(BUILD);
}
