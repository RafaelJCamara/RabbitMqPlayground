import { findId, type CanvasDocument, type ElementKind, type Id, type IdKind } from '@rmq/domain';

/**
 * Where new ids come from (ADR-0031). `applyCommand` takes the id of something new from its caller (ADR-0026), and throws if it
 * is given one that the canvas has or that is not an id. These are a letter for the kind and a number that only goes up, so
 * they match `ID_PATTERN`, are unique across the kinds, and are never made twice.
 */

const PREFIX: Readonly<Record<IdKind, string>> = {
  exchange: 'x',
  queue: 'q',
  producer: 'p',
  consumer: 'c',
  binding: 'b',
};

const COLLECTIONS = ['exchanges', 'queues', 'bindings', 'producers', 'consumers'] as const;

export interface IdGenerator {
  /** An id for something new, that the canvas does not have and that this generator has not made before. */
  readonly newId: (kind: IdKind) => Id;
  /**
   * Notes where the counters are, and answers a function that puts them back. A command that is refused has made no element, so the ids that it
   * asked for are given back, and what is made next has the id that a replay of the commands that were accepted makes (ADR-0046).
   */
  readonly mark: () => () => void;
}

/**
 * `document` is asked every time, so that it is the canvas as it is when the id is wanted. An id that a canvas from a file or
 * from an earlier session already has is skipped. The numbers never go down, not even when undo takes what had an id away,
 * because the history can bring it back.
 */
export function createIdGenerator(document: () => CanvasDocument): IdGenerator {
  const counters = new Map<IdKind, number>();
  const has = (current: CanvasDocument, id: Id): boolean =>
    COLLECTIONS.some((collection) => Object.hasOwn(current[collection], id));

  return {
    newId(kind) {
      const current = document();
      let id: Id;
      do {
        const next = (counters.get(kind) ?? 0) + 1;
        counters.set(kind, next);
        id = `${PREFIX[kind]}${next}`;
      } while (has(current, id));
      return id;
    },
    mark() {
      const saved = new Map(counters);
      return () => {
        counters.clear();
        for (const [kind, count] of saved) {
          counters.set(kind, count);
        }
      };
    },
  };
}

/** A name for something new: the kind and the smallest number that no element of that kind has, as `queue2`. */
export function nextName(document: CanvasDocument, kind: ElementKind): string {
  let number = 1;
  while (findId(document, kind, `${kind}${number}`) !== undefined) {
    number += 1;
  }
  return `${kind}${number}`;
}
