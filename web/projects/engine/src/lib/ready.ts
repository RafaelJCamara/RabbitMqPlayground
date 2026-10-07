/**
 * The messages that a queue holds and has not given to anyone (ADR-0053). A queue is first in, first out, so a message that comes in goes to the
 * back and the one that is given away is at the front, and one that is given back (a channel was closed) goes to the place that it had,
 * which is the order in which the copies came into the queue.
 */

/** A copy of a message in a queue. `order` counts the copies that have come into that queue, so it says where the copy belongs. */
export interface Entry<Message> {
  readonly message: Message;
  readonly order: number;
  /** Whether it has been given away and come back. It stays so for as long as the copy lives. */
  redelivered: boolean;
}

/** How far the front has moved before the list is made smaller again, so that taking from the front does not cost the length of the list. */
const COMPACT_AFTER = 1024;

export class ReadyList<Message> {
  private items: Entry<Message>[];
  private head = 0;

  constructor(entries: readonly Entry<Message>[] = []) {
    this.items = [...entries];
  }

  get length(): number {
    return this.items.length - this.head;
  }

  /** How many entries the list keeps in memory: those that it holds, and those that were taken from the front and have not been let go of yet. A spec says that it stays bounded. */
  get retained(): number {
    return this.items.length;
  }

  /** Puts a copy at the back, which is where a copy that has just come into the queue belongs. */
  push(entry: Entry<Message>): void {
    this.items.push(entry);
  }

  /** Takes the copy at the front, or answers `undefined` when there is none. */
  shift(): Entry<Message> | undefined {
    const entry = this.items[this.head];
    if (entry === undefined) {
      return undefined;
    }
    this.head += 1;
    if (this.head >= COMPACT_AFTER && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return entry;
  }

  /** Puts a copy that was given away back in the place that its `order` says. */
  insert(entry: Entry<Message>): void {
    let low = this.head;
    let high = this.items.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if ((this.items[middle] as Entry<Message>).order < entry.order) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    this.items.splice(low, 0, entry);
  }

  /** The first `count` copies, front first. The list is not changed. */
  first(count: number): Entry<Message>[] {
    return this.items.slice(this.head, this.head + count);
  }

  /** Takes every copy out, and answers how many there were. */
  clear(): number {
    const count = this.length;
    this.items = [];
    this.head = 0;
    return count;
  }

  /** The copies, front first. */
  toArray(): Entry<Message>[] {
    return this.items.slice(this.head);
  }
}
