import type { Bind, Binding, Topology, Unbind } from '@rmq/engine';

/**
 * Comparing topologies in specs. A broker keeps its bindings as a set, and the order of the arguments of a binding says nothing, so two topologies
 * that were built in another order are one topology to a broker. These put what a broker keeps in a fixed order, and write it out in a way that
 * shares no code with the engine or the domain, so that a spec can disagree with them.
 */

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * What a broker keeps about a binding: its two ends, its key and its arguments. The order of the arguments does not
 * matter, and a binding with no arguments is the same as one with an empty list and no `x-match`.
 */
export function bindingKey(binding: Bind | Unbind): string {
  const { headers } = binding;
  const arguments_ =
    headers === undefined || (headers.xMatch === null && headers.args.length === 0)
      ? null
      : [
          headers.xMatch,
          headers.args.map(({ key, value }) => [key, value] as [string, unknown]).sort(([a], [b]) => compareText(a, b)),
        ];
  return JSON.stringify([binding.source, binding.destination.kind, binding.destination.name, binding.key, arguments_]);
}

const byName = (a: { readonly name: string }, b: { readonly name: string }): number => compareText(a.name, b.name);

/**
 * The same topology with everything in a fixed order, so that two topologies can be compared whatever order they were
 * built in: exchanges and queues by name, bindings by what a broker keeps about them, and the arguments of a binding by
 * key. A broker keeps its bindings as a set, so their order says nothing that a broker could tell.
 */
export function canonicalTopology(topology: Topology): Topology {
  const bindings = topology.bindings.map((binding): Binding => {
    const { headers, ...rest } = binding;
    if (headers === undefined || (headers.xMatch === null && headers.args.length === 0)) {
      return rest;
    }
    return {
      ...rest,
      headers: { xMatch: headers.xMatch, args: [...headers.args].sort((a, b) => compareText(a.key, b.key)) },
    };
  });
  return {
    vhost: topology.vhost,
    exchanges: [...topology.exchanges].sort(byName),
    queues: [...topology.queues].sort(),
    bindings: bindings.sort((a, b) => compareText(bindingKey({ op: 'bind', ...a }), bindingKey({ op: 'bind', ...b }))),
  };
}
