import type { HeaderArguments } from './headers';

/**
 * What a broker keeps about a binding (ADR-0008, rule 27; ADR-0051): its two ends, its key and its arguments. The engine's `bind` and
 * `unbind` and the domain's `reconcile` and commands all ask whether two bindings are the same one, so the question is asked here, once.
 */

/**
 * The arguments of a binding in their one plain form. A binding with no `x-match` and no conditions has no arguments at
 * all, so it is written without any, and two ways of saying "nothing" are not two bindings.
 */
export function canonicalHeaders(headers: HeaderArguments | undefined): HeaderArguments | undefined {
  return headers === undefined || (headers.xMatch === null && headers.args.length === 0) ? undefined : headers;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What a broker keeps about a binding, as one string: its two ends, its key and its arguments. The order of the arguments
 * does not matter, because a table has none. The ends are ids in a document and names in the engine, and the caller
 * says which, as long as it says the same thing on both sides of a comparison.
 */
export function bindingSignature(
  source: string,
  destinationKind: 'queue' | 'exchange',
  destination: string,
  key: string,
  headers: HeaderArguments | undefined,
): string {
  const canonical = canonicalHeaders(headers);
  const args =
    canonical === undefined
      ? null
      : [
          canonical.xMatch,
          canonical.args
            .map(({ key: name, value }) => [name, value.t, 'v' in value ? value.v : null] as const)
            .sort((a, b) => compareText(a[0], b[0])),
        ];
  return JSON.stringify([source, destinationKind, destination, key, args]);
}
