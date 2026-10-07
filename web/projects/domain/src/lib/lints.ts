import type { HeaderArguments } from '@rmq/engine';
import { elements, lookup } from './document/elements';
import type { CanvasDocument, Id } from './document/schema';

/**
 * Lints: things that a broker accepts and that a learner probably did not mean. They never stop a command, and they never
 * change a document. A lint is a warning that the editor shows on the node or the binding that it is about (ADR-0011,
 * ADR-0009).
 */

/**
 * The sentence of the lint about a headers binding with `x-match=any` (or `any-with-x`) and no condition that counts, or `null` when there is nothing to say (ADR-0068). Under `any`, a condition whose
 * name starts with `x-` does not count. It is the one place that words it: `lint()` says it of a binding that is on the canvas, and the editor says it of a draft that is not yet.
 */
export function headersLint(source: string, target: string, headers: HeaderArguments | undefined): string | null {
  if (headers === undefined || (headers.xMatch !== 'any' && headers.xMatch !== 'any-with-x')) {
    return null;
  }
  const counted = headers.args.filter(({ key }) => headers.xMatch === 'any-with-x' || !key.startsWith('x-'));
  return counted.length === 0
    ? `The binding from '${source}' to '${target}' has x-match=${headers.xMatch} and no condition that counts, so it matches no message: with nothing to match, 'any' matches none.`
    : null;
}

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
    if (source?.type !== 'headers') {
      continue;
    }
    const target = lookup(binding.dest.kind === 'queue' ? document.queues : document.exchanges, binding.dest.id);
    const message = headersLint(source.name, target?.name ?? binding.dest.id, binding.headers);
    if (message !== null) {
      lints.push({ kind: 'any-without-conditions', severity: 'warning', message, subject: { kind: 'binding', id } });
    }
  }

  return lints;
}
