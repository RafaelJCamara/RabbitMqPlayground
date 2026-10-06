import { elements, lookup } from './document/elements';
import type { CanvasDocument, Id } from './document/schema';

/**
 * Lints: things that a broker accepts and that a learner probably did not mean. They never stop a command, and they never
 * change a document. A lint is a warning that the editor shows on the node or the binding that it is about (ADR-0011,
 * ADR-0009).
 */

export type LintKind = 'exchange-without-bindings' | 'any-without-conditions';

export interface Lint {
  readonly kind: LintKind;
  readonly severity: 'warning';
  readonly message: string;
  /** What it is about: an exchange, or a binding. */
  readonly subject: { readonly kind: 'exchange' | 'binding'; readonly id: Id };
}

/**
 * The lints of a canvas, in the order of what they are about: the exchanges first, in the order they were made, and then
 * the bindings.
 *
 * - **An exchange with no binding that starts from it** routes every message nowhere. A message that no queue gets is
 *   dropped, or returned to a publisher that asked for that (ADR-0008, rules 10 and 12).
 * - **A headers binding with `x-match=any`, or `any-with-x`, and no condition that counts** matches no message. With
 *   nothing to match, `any` matches none, and `all` matches every message (ADR-0009). Under `any`, a condition whose name
 *   starts with `x-` does not count.
 */
export function lint(document: CanvasDocument): Lint[] {
  const lints: Lint[] = [];

  const hasBindings = new Set(Object.values(document.bindings).map(({ source }) => source));
  for (const { kind, id, name } of elements(document)) {
    if (kind === 'exchange' && !hasBindings.has(id)) {
      lints.push({
        kind: 'exchange-without-bindings',
        severity: 'warning',
        message: `Nothing is bound from the exchange '${name}', so every message that reaches it goes nowhere. Bind it to a queue or to another exchange.`,
        subject: { kind: 'exchange', id },
      });
    }
  }

  for (const [id, binding] of Object.entries(document.bindings)) {
    const source = lookup(document.exchanges, binding.source);
    const { headers } = binding;
    if (
      source?.type !== 'headers' ||
      headers === undefined ||
      (headers.xMatch !== 'any' && headers.xMatch !== 'any-with-x')
    ) {
      continue;
    }
    const counted = headers.args.filter(({ key }) => headers.xMatch === 'any-with-x' || !key.startsWith('x-'));
    if (counted.length === 0) {
      const target = lookup(binding.dest.kind === 'queue' ? document.queues : document.exchanges, binding.dest.id);
      lints.push({
        kind: 'any-without-conditions',
        severity: 'warning',
        message: `The binding from '${source.name}' to '${target?.name ?? binding.dest.id}' has x-match=${headers.xMatch} and no condition that counts, so it matches no message: with nothing to match, 'any' matches none.`,
        subject: { kind: 'binding', id },
      });
    }
  }

  return lints;
}
