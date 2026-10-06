import { afterNextRender, inject, Injectable, Injector } from '@angular/core';
import { findId, lookup, type ElementKind } from '@rmq/domain';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { frameOf } from '../canvas/model/shapes';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';

/**
 * What the editor does for a node that it has just made (ADR-0031, ADR-0042): it is selected, so that the inspector shows it and the keys act on it, and it is brought
 * into view once the canvas has drawn it. A drop from the toolbox and a drop on nothing both end here.
 */
@Injectable()
export class NewNodeFocus {
  private readonly store = inject(DocumentStore);
  private readonly selection = inject(SelectionStore);
  private readonly viewport = inject(FlowViewport);
  private readonly injector = inject(Injector);

  show(kind: ElementKind, name: string): void {
    const document = this.store.document();
    const id = findId(document, kind, name);
    if (id === undefined) {
      return;
    }
    this.selection.select([id]);
    const position = lookup(document.layout.nodes, id);
    if (position !== undefined) {
      const { width, height } = frameOf(kind);
      // The canvas draws the node on the next render, and the library fits what it has drawn, so the node is brought into view then.
      afterNextRender(() => this.viewport.reveal({ id, x: position.x, y: position.y, width, height }), {
        injector: this.injector,
      });
    }
  }
}
