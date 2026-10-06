import { Component, ElementRef, output, signal, viewChildren } from '@angular/core';
import { DragSource } from '../canvas/flow/drag-source';
import { newNodeKey, type NewNode } from '../canvas/model/new-node';
import { Icon } from '../core/ui/icon';
import type { IconName } from '../core/ui/icons';

export interface ToolboxItem {
  readonly node: NewNode;
  readonly key: string;
  readonly label: string;
  readonly icon: IconName;
}

const item = (node: NewNode, label: string): ToolboxItem => ({ node, key: newNodeKey(node), label, icon: node.kind });

/** What the toolbox offers, in the order that a message travels: where it leaves, where it is routed, where it waits, where it ends. */
export const TOOLBOX: readonly ToolboxItem[] = [
  item({ kind: 'producer' }, 'Producer'),
  item({ kind: 'exchange', exchangeType: 'direct' }, 'Direct exchange'),
  item({ kind: 'exchange', exchangeType: 'fanout' }, 'Fanout exchange'),
  item({ kind: 'exchange', exchangeType: 'topic' }, 'Topic exchange'),
  item({ kind: 'exchange', exchangeType: 'headers' }, 'Headers exchange'),
  item({ kind: 'queue' }, 'Queue'),
  item({ kind: 'consumer' }, 'Consumer'),
];

/** The colour of the edge of an item, which is the colour of its kind. Written out so that Tailwind finds every name. */
const EDGE: Readonly<Record<NewNode['kind'], string>> = {
  producer: 'border-l-producer',
  exchange: 'border-l-exchange',
  queue: 'border-l-queue',
  consumer: 'border-l-consumer',
};

/**
 * The toolbox (ADR-0010): click an item to add it, or drag it onto the canvas. It is one toolbar with one tab stop, as the
 * pattern for a toolbar says, and the arrow keys move along it (ADR-0017: Tab moves between the regions, not between the
 * items). Dragging is the library's, and clicking is the way that needs no drag (WCAG 2.5.7).
 */
@Component({
  selector: 'rmq-toolbox',
  imports: [Icon, DragSource],
  template: `
    <h2 class="text-muted mb-2 text-xs font-semibold tracking-wide uppercase">Add to the canvas</h2>
    <div role="toolbar" aria-label="Add a node" aria-orientation="vertical" class="flex flex-col gap-1.5">
      @for (entry of items; track entry.key; let index = $index) {
        <button
          #button
          type="button"
          class="border-border bg-surface hover:bg-canvas flex items-center gap-2 rounded-md border border-l-4 px-2.5 py-2 text-left text-sm"
          [class]="edge[entry.node.kind]"
          [attr.data-testid]="'add-' + entry.key"
          [rmqDragSource]="entry.node"
          [rmqDragSourceId]="entry.key"
          [attr.tabindex]="index === active() ? 0 : -1"
          (focus)="active.set(index)"
          (keydown)="onKey($event)"
          (click)="add.emit(entry.node)"
        >
          <rmq-icon [name]="entry.icon" [size]="18" />
          <span>{{ entry.label }}</span>
        </button>
      }
    </div>
    <p class="text-muted mt-3 text-xs">Click to add, or drag onto the canvas.</p>
  `,
})
export class Toolbox {
  readonly add = output<NewNode>();

  protected readonly items = TOOLBOX;
  protected readonly edge = EDGE;
  protected readonly active = signal(0);
  private readonly buttons = viewChildren<ElementRef<HTMLButtonElement>>('button');

  protected onKey(event: KeyboardEvent): void {
    const last = this.items.length - 1;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? Math.min(this.active() + 1, last)
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? Math.max(this.active() - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : undefined;
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    this.active.set(next);
    this.buttons()[next]?.nativeElement.focus();
  }
}
