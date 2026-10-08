import { Component, computed, input } from '@angular/core';
import type { ElementKind } from '@rmq/domain';
import { shapePath } from '../canvas/model/shapes';
import type { Thumbnail } from './thumbnail';

/** The outline of each kind, at its own size: the thumbnail is drawn in canvas units, so a node is the shape that the canvas draws. */
const PATHS: Readonly<Record<ElementKind, string>> = {
  exchange: shapePath('exchange'),
  queue: shapePath('queue'),
  producer: shapePath('producer'),
  consumer: shapePath('consumer'),
};

/** The colours of the canvas for each kind, as the utilities of the theme give them. */
const PAINT: Readonly<Record<ElementKind, string>> = {
  exchange: 'fill-exchange-fill stroke-exchange',
  queue: 'fill-queue-fill stroke-queue',
  producer: 'fill-producer-fill stroke-producer',
  consumer: 'fill-consumer-fill stroke-consumer',
};

/**
 * The drawing of a canvas on its card (ADR-0073). It is decoration: it says nothing that the words of the card do not, so a screen reader does not meet it. The
 * outlines are the canvas's, one for each kind, so that colour is not the only sign of a kind; a line is as thin at any size.
 */
@Component({
  selector: 'rmq-thumbnail',
  template: `
    @if (box(); as view) {
      <svg
        class="size-full"
        [attr.viewBox]="view"
        preserveAspectRatio="xMidYMid meet"
        aria-hidden="true"
        focusable="false"
        data-testid="thumbnail"
      >
        @for (edge of thumbnail().edges; track $index) {
          <line
            class="stroke-[var(--rmq-edge)]"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
            [attr.x1]="edge.x1"
            [attr.y1]="edge.y1"
            [attr.x2]="edge.x2"
            [attr.y2]="edge.y2"
          />
        }
        @for (node of thumbnail().nodes; track $index) {
          <path
            [class]="paint[node.kind]"
            stroke-width="1.5"
            vector-effect="non-scaling-stroke"
            [attr.d]="paths[node.kind]"
            [attr.transform]="'translate(' + node.x + ' ' + node.y + ')'"
          />
        }
      </svg>
    } @else {
      <span
        class="text-muted grid size-full place-items-center text-sm"
        aria-hidden="true"
        data-testid="thumbnail-empty"
      >
        Empty
      </span>
    }
  `,
  host: { class: 'block size-full' },
})
export class ThumbnailView {
  readonly thumbnail = input.required<Thumbnail>();

  protected readonly paths = PATHS;
  protected readonly paint = PAINT;
  protected readonly box = computed(() => {
    const box = this.thumbnail().box;
    return box === null ? null : `${box.x} ${box.y} ${box.width} ${box.height}`;
  });
}
