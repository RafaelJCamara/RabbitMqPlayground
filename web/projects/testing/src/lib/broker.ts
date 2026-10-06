import type { Bind, Binding, EngineCommand, ExchangeDeclare, QueueDeclare, Topology, Unbind } from '@rmq/engine';

/**
 * A test oracle for the engine's topology commands: a small pure reducer that applies them to a broker's topology the way
 * a broker would, and refuses what a broker would refuse. A property test feeds it the commands of `reconcile` and
 * compares the topology it ends with to the document's, so the oracle is stricter than a broker on purpose: it also
 * refuses what is redundant (declaring a name that exists, binding what is already bound), because `reconcile` never has
 * a reason to ask for it. It shares no code with the domain, so that it can disagree with it. It is not the engine: the
 * dispatcher of slice S6 is, and its own specs check it.
 */

export interface BrokerState {
  readonly vhost: string;
  /** In the order they were declared. */
  readonly exchanges: readonly ExchangeDeclare[];
  readonly queues: readonly QueueDeclare[];
  /** In the order they were made. */
  readonly bindings: readonly Bind[];
}

export const emptyBroker = (vhost = '/'): BrokerState => ({ vhost, exchanges: [], queues: [], bindings: [] });

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

/** What the oracle says when a command is one that a broker would refuse, or that `reconcile` should never make. */
export class BrokerError extends Error {
  constructor(command: EngineCommand, why: string) {
    super(`${command.op} ${JSON.stringify(command)}: ${why}`);
    this.name = 'BrokerError';
  }
}

/** Applies one command. It throws a `BrokerError` for a command that the topology cannot take. */
export function applyEngineCommand(state: BrokerState, command: EngineCommand): BrokerState {
  const fail = (why: string): never => {
    throw new BrokerError(command, why);
  };
  const hasExchange = (name: string) => state.exchanges.some((exchange) => exchange.name === name);
  const hasQueue = (name: string) => state.queues.some((queue) => queue.name === name);

  switch (command.op) {
    case 'exchange.declare':
      if (command.name === '') {
        fail('the default exchange cannot be declared');
      }
      if (hasExchange(command.name)) {
        fail(`an exchange with that name exists`);
      }
      return { ...state, exchanges: [...state.exchanges, command] };
    case 'exchange.delete':
      if (!hasExchange(command.name)) {
        fail('there is no exchange with that name');
      }
      return {
        ...state,
        exchanges: state.exchanges.filter((exchange) => exchange.name !== command.name),
        // A broker deletes the bindings that start from an exchange and the ones that end at it.
        bindings: state.bindings.filter(
          ({ source, destination }) =>
            source !== command.name && !(destination.kind === 'exchange' && destination.name === command.name),
        ),
      };
    case 'queue.declare':
      if (command.name === '') {
        fail('a queue needs a name');
      }
      if (hasQueue(command.name)) {
        fail('a queue with that name exists');
      }
      return { ...state, queues: [...state.queues, command] };
    case 'queue.delete':
      if (!hasQueue(command.name)) {
        fail('there is no queue with that name');
      }
      return {
        ...state,
        queues: state.queues.filter((queue) => queue.name !== command.name),
        bindings: state.bindings.filter(
          ({ destination }) => !(destination.kind === 'queue' && destination.name === command.name),
        ),
      };
    case 'bind':
    case 'unbind': {
      const { source, destination } = command;
      if (source === '' || (destination.kind === 'exchange' && destination.name === '')) {
        fail('the default exchange cannot be bound from or to');
      }
      if (!hasExchange(source)) {
        fail('the source exchange does not exist');
      }
      if (!(destination.kind === 'queue' ? hasQueue(destination.name) : hasExchange(destination.name))) {
        fail(`the destination ${destination.kind} does not exist`);
      }
      const key = bindingKey(command);
      const exists = state.bindings.some((binding) => bindingKey(binding) === key);
      if (command.op === 'bind') {
        if (exists) {
          fail('that binding exists');
        }
        return { ...state, bindings: [...state.bindings, command] };
      }
      if (!exists) {
        fail('there is no such binding');
      }
      return { ...state, bindings: state.bindings.filter((binding) => bindingKey(binding) !== key) };
    }
  }
}

/** Applies the commands in order. */
export function applyEngineCommands(state: BrokerState, commands: readonly EngineCommand[]): BrokerState {
  return commands.reduce(applyEngineCommand, state);
}

/** The topology that the engine's `route()` reads, as the broker holds it now. */
export function topologyOf(state: BrokerState): Topology {
  return {
    vhost: state.vhost,
    exchanges: state.exchanges.map(({ name, type, internal }) => ({ name, type, internal })),
    queues: state.queues.map(({ name }) => name),
    bindings: state.bindings.map(({ source, destination, key, headers }) => ({
      source,
      destination,
      key,
      ...(headers === undefined ? {} : { headers }),
    })),
  };
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
