import type { DocumentCommand } from '@rmq/domain';
import type { HeaderEntry, HeaderValue } from '@rmq/engine';

/**
 * What the table of a producer's headers does to the message, as commands (ADR-0069): the lines that a learner could type, `unset sender header:old` and `set sender header:new=pdf`. A header that is not in the
 * table any more is taken off, and one that is new or has another value is set; one that is the same is left alone. A name that is changed is both, and the two are one batch, so it is one step of undo.
 */
export function messageHeadersCommand(
  producer: string,
  current: readonly HeaderEntry<HeaderValue>[],
  next: readonly HeaderEntry<HeaderValue>[],
): DocumentCommand | undefined {
  const removed = current.filter(({ key }) => !next.some((header) => header.key === key)).map(({ key }) => key);
  const changed = next.filter(({ key, value }) => {
    const before = current.find((header) => header.key === key)?.value;
    return before === undefined || before.t !== value.t || !Object.is(before.v, value.v);
  });
  const commands: DocumentCommand[] = [
    ...(removed.length === 0 ? [] : [{ type: 'unset', kind: 'producer', name: producer, headers: removed } as const]),
    ...(changed.length === 0
      ? []
      : [{ type: 'set', kind: 'producer', name: producer, changes: { headers: changed } } as const]),
  ];
  const [only] = commands;
  return commands.length === 0 ? undefined : commands.length === 1 ? only : { type: 'batch', commands };
}
