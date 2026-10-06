import type { ApplyContext } from '../commands/helpers';
import type { CanvasDocument } from '../document/schema';

/**
 * Ids for a canvas that is only a step on the way to a batch that is being read or written: it is thrown away, and the
 * only thing that matters is that an id is never one that the canvas already has. `current` gives that canvas.
 */
export function scratchIds(current: () => CanvasDocument): ApplyContext {
  let counter = 0;
  return {
    newId() {
      const document = current();
      let id: string;
      do {
        counter += 1;
        id = `scratch${counter}`;
      } while (
        [document.exchanges, document.queues, document.bindings, document.producers, document.consumers].some(
          (record) => Object.hasOwn(record, id),
        )
      );
      return id;
    },
  };
}
