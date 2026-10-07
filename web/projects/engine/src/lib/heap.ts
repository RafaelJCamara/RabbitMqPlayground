/**
 * A binary min-heap, for the events that are waiting to happen (ADR-0007, ADR-0052). Two items that tie are told apart by
 * the order in which they were pushed, so that the order of everything that happens is total, and the same commands always
 * give the same order. The heap holds data and not functions, so that it can be saved in a snapshot.
 */

export interface Timed {
  /** When it happens, in whole virtual milliseconds. */
  readonly at: number;
  /** The order in which it was scheduled, which settles a tie. Never used twice. */
  readonly seq: number;
}

const before = (a: Timed, b: Timed): boolean => a.at < b.at || (a.at === b.at && a.seq < b.seq);

export interface Heap<Item extends Timed> {
  readonly size: number;
  push(item: Item): void;
  /** The item that happens first, or `undefined` when there is none. It stays. */
  peek(): Item | undefined;
  /** Takes the item that happens first, or answers `undefined` when there is none. */
  pop(): Item | undefined;
  /** Takes out every item that `unwanted` is true of, and answers how many. The rest keep their order. */
  removeWhere(unwanted: (item: Item) => boolean): number;
  /** Every item, in the order in which they will happen. The heap is not changed. */
  sorted(): Item[];
  /** Every item, in no order that anyone should rely on. It is cheaper than `sorted`, for a count. */
  values(): readonly Item[];
}

export function createHeap<Item extends Timed>(initial: readonly Item[] = []): Heap<Item> {
  let items: Item[] = [];

  const up = (from: number): void => {
    let index = from;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (!before(items[index] as Item, items[parent] as Item)) {
        return;
      }
      [items[index], items[parent]] = [items[parent] as Item, items[index] as Item];
      index = parent;
    }
  };

  const down = (from: number): void => {
    let index = from;
    for (;;) {
      const left = 2 * index + 1;
      const right = left + 1;
      let first = index;
      if (left < items.length && before(items[left] as Item, items[first] as Item)) {
        first = left;
      }
      if (right < items.length && before(items[right] as Item, items[first] as Item)) {
        first = right;
      }
      if (first === index) {
        return;
      }
      [items[index], items[first]] = [items[first] as Item, items[index] as Item];
      index = first;
    }
  };

  const push = (item: Item): void => {
    items.push(item);
    up(items.length - 1);
  };
  for (const item of initial) {
    push(item);
  }

  return {
    get size() {
      return items.length;
    },
    push,
    peek: () => items[0],
    pop() {
      const top = items[0];
      const last = items.pop();
      if (top !== undefined && last !== undefined && items.length > 0) {
        items[0] = last;
        down(0);
      }
      return top;
    },
    removeWhere(unwanted) {
      const kept = items.filter((item) => !unwanted(item));
      const removed = items.length - kept.length;
      if (removed > 0) {
        items = [];
        for (const item of kept) {
          push(item);
        }
      }
      return removed;
    },
    sorted: () => [...items].sort((a, b) => (before(a, b) ? -1 : 1)),
    values: () => items,
  };
}
