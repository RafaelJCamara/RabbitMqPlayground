import { Component, computed, input } from '@angular/core';
import { ICONS, type IconName } from './icons';

/** An icon, in the colour of the text around it. It is decoration, so it is hidden from a screen reader. */
@Component({
  selector: 'rmq-icon',
  template: `
    <svg
      class="size-full"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path [attr.d]="path()" />
    </svg>
  `,
  host: {
    class: 'inline-flex shrink-0 items-center justify-center',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
})
export class Icon {
  readonly name = input.required<IconName>();
  /** The width and height, in pixels. */
  readonly size = input(20);

  protected readonly path = computed(() => ICONS[this.name()]);
}
