import { Directive } from '@angular/core';
import { FExternalItem } from '@foblex/flow';

/**
 * Makes an element something that can be dragged onto the canvas to make a node (ADR-0033). It is Foblex's external item, with
 * the data that it carries named for what it is (a `NewNode`), so that the toolbox, which may not import Foblex, can use it. The
 * library reports the drop to the canvas as an event, and the canvas reports it as an intent.
 *
 * The attribute is there because the library finds the item that was pressed with `closest('[fExternalItem]')`, and a host
 * directive does not put the attribute of its selector on the element. Without it nothing is found, and a drag never starts,
 * without a word. The contract suite has the test that fails if the library finds its items another way.
 */
@Directive({
  selector: '[rmqDragSource]',
  hostDirectives: [{ directive: FExternalItem, inputs: ['fData: rmqDragSource', 'fExternalItemId: rmqDragSourceId'] }],
  host: { fExternalItem: '' },
})
export class DragSource {}
