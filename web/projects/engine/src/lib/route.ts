import { headerValueIssue, matchHeaders, type HeadersMatch } from './headers';
import { routingKeyIssue } from './keys';
import { alignTopic, splitTopic, type TopicAlignment } from './topic';
import type { Binding, Destination, Exchange, ExchangeType, Message, Topology } from './topology';

/**
 * Routing (ADR-0007, ADR-0008, ADR-0009). `route` decides, in one step and without side effects, which queues a message
 * reaches, and explains each decision: it is the function behind the Why? overlay, the what-if tester and, later, the
 * simulation. Everything it returns is plain data that survives JSON.
 */

/** A publish that the broker would refuse (ADR-0021). The code and the text are the broker's. */
export interface RouteRefusal {
  readonly ok: false;
  readonly code: 403 | 404;
  readonly text: string;
}

/** One step of a path: from an exchange, through one of its bindings, to a queue or to another exchange. */
export interface Hop {
  readonly from: string;
  /** Where the binding is in `topology.bindings`. `null` for the default exchange, which has none. */
  readonly binding: number | null;
  readonly to: Destination;
}

/** How a queue was reached: the hops from the exchange that the message was published to. */
export interface RoutePath {
  readonly queue: string;
  readonly hops: readonly Hop[];
}

/** What a binding made of a message, in the terms of its exchange's type. */
export type BindingMatch =
  | { readonly kind: 'direct'; readonly bindingKey: string; readonly routingKey: string }
  | { readonly kind: 'fanout' }
  | {
      readonly kind: 'topic';
      readonly pattern: readonly string[];
      readonly key: readonly string[];
      readonly alignment: TopicAlignment;
    }
  | { readonly kind: 'headers'; readonly result: HeadersMatch }
  /** The implicit binding of the default exchange: the queue that has the routing key as its name. */
  | { readonly kind: 'default'; readonly queue: string; readonly routingKey: string };

/** What came of a binding that matched. */
export type BindingOutcome =
  | 'queue-first-copy'
  | 'queue-already-had-a-copy'
  | 'exchange-visited-next'
  | 'exchange-already-visited'
  /** The topology has no queue or exchange with that name. A topology that is valid has no such binding. */
  | 'destination-missing';

export interface BindingEvaluation {
  /** Where the binding is in `topology.bindings`. `null` for the default exchange. */
  readonly index: number | null;
  readonly destination: Destination;
  readonly key: string;
  readonly matched: boolean;
  readonly match: BindingMatch;
  /** Only for a binding that matched. */
  readonly outcome?: BindingOutcome;
}

/** One exchange that the message reached, with every binding that starts from it. */
export interface ExchangeVisit {
  readonly exchange: string;
  readonly type: ExchangeType | 'default';
  /** The binding that led to this exchange. Left out for the exchange that was published to. */
  readonly via?: { readonly from: string; readonly binding: number };
  /** Every binding that starts from the exchange, matched or not, in the order they were made. */
  readonly bindings: readonly BindingEvaluation[];
}

export interface RouteTrace {
  /** The exchange that was published to. `""` is the default exchange. */
  readonly exchange: string;
  /** The exchanges that the message reached, breadth first, each once. */
  readonly visits: readonly ExchangeVisit[];
}

export interface Routed {
  readonly ok: true;
  /** Each queue that gets a copy, once, in the order that it was first reached. Empty when the message is unroutable. */
  readonly queues: readonly string[];
  /** The way to each queue, in the same order. */
  readonly paths: readonly RoutePath[];
  readonly trace: RouteTrace;
}

export type RouteResult = Routed | RouteRefusal;

function evaluate(exchange: Exchange, binding: Binding, message: Message): { matched: boolean; match: BindingMatch } {
  switch (exchange.type) {
    case 'direct':
      return {
        matched: binding.key === message.key,
        match: { kind: 'direct', bindingKey: binding.key, routingKey: message.key },
      };
    case 'fanout':
      return { matched: true, match: { kind: 'fanout' } };
    case 'topic': {
      const alignment = alignTopic(binding.key, message.key);
      return {
        matched: alignment.matched,
        match: { kind: 'topic', pattern: splitTopic(binding.key), key: splitTopic(message.key), alignment },
      };
    }
    case 'headers': {
      const result = matchHeaders(binding.headers, message.headers);
      return { matched: result.matched, match: { kind: 'headers', result } };
    }
  }
}

function routeByQueueName(topology: Topology, message: Message): Routed {
  if (!topology.queues.includes(message.key)) {
    return {
      ok: true,
      queues: [],
      paths: [],
      trace: { exchange: '', visits: [{ exchange: '', type: 'default', bindings: [] }] },
    };
  }
  const destination: Destination = { kind: 'queue', name: message.key };
  return {
    ok: true,
    queues: [message.key],
    paths: [{ queue: message.key, hops: [{ from: '', binding: null, to: destination }] }],
    trace: {
      exchange: '',
      visits: [
        {
          exchange: '',
          type: 'default',
          bindings: [
            {
              index: null,
              destination,
              key: message.key,
              matched: true,
              match: { kind: 'default', queue: message.key, routingKey: message.key },
              outcome: 'queue-first-copy',
            },
          ],
        },
      ],
    },
  };
}

/**
 * Routes `message` through `topology`.
 *
 * The default exchange sends a message to the queue named by its key. Any other exchange applies its type to each of its
 * own bindings, and a binding to another exchange passes the message on with the same key and headers. Exchanges are
 * visited breadth first, each once, so a cycle ends, and a queue that several paths reach gets one copy (ADR-0008,
 * rule 7). A publish to an exchange that does not exist, or to an internal one, is refused with the broker's code and
 * text.
 *
 * A message that no client could send is not a refusal but a mistake of the caller, and throws a `RangeError`: a key of
 * more than 255 bytes, or a header value that is not exact (see `routingKeyIssue` and `headerValueIssue`). The topology
 * is taken as valid: its names, keys and arguments were checked when they were made.
 */
export function route(topology: Topology, message: Message): RouteResult {
  const keyIssue = routingKeyIssue(message.key);
  if (keyIssue !== null) {
    throw new RangeError(keyIssue);
  }
  for (const { key, value } of message.headers) {
    const issue = headerValueIssue(value);
    if (issue !== null) {
      throw new RangeError(`Header "${key}": ${issue}`);
    }
  }

  if (message.exchange === '') {
    return routeByQueueName(topology, message);
  }

  const exchanges = new Map(topology.exchanges.map((exchange) => [exchange.name, exchange]));
  const start = exchanges.get(message.exchange);
  if (start === undefined) {
    return { ok: false, code: 404, text: `NOT_FOUND - no exchange '${message.exchange}' in vhost '${topology.vhost}'` };
  }
  if (start.internal) {
    return {
      ok: false,
      code: 403,
      text: `ACCESS_REFUSED - cannot publish to internal exchange '${message.exchange}' in vhost '${topology.vhost}'`,
    };
  }

  const queueNames = new Set(topology.queues);
  const bindingsOf = new Map<string, number[]>();
  topology.bindings.forEach((binding, index) => {
    const list = bindingsOf.get(binding.source);
    if (list === undefined) {
      bindingsOf.set(binding.source, [index]);
    } else {
      list.push(index);
    }
  });

  const visits: ExchangeVisit[] = [];
  /** How each exchange was first reached, which is the way back to the one that was published to. */
  const arrival = new Map<string, Hop>();
  const paths = new Map<string, RoutePath>();
  const hopsTo = (exchangeName: string): Hop[] => {
    const hops: Hop[] = [];
    for (let hop = arrival.get(exchangeName); hop !== undefined; hop = arrival.get(hop.from)) {
      hops.unshift(hop);
    }
    return hops;
  };

  const seen = new Set([start.name]);
  const work: Exchange[] = [start];
  for (let exchange = work.shift(); exchange !== undefined; exchange = work.shift()) {
    const evaluations: BindingEvaluation[] = [];
    for (const index of bindingsOf.get(exchange.name) ?? []) {
      const binding = topology.bindings[index] as Binding;
      const { matched, match } = evaluate(exchange, binding, message);
      const base = { index, destination: binding.destination, key: binding.key, matched, match };
      if (!matched) {
        evaluations.push(base);
        continue;
      }

      const hop: Hop = { from: exchange.name, binding: index, to: binding.destination };
      let outcome: BindingOutcome;
      if (binding.destination.kind === 'queue') {
        if (!queueNames.has(binding.destination.name)) {
          outcome = 'destination-missing';
        } else if (paths.has(binding.destination.name)) {
          outcome = 'queue-already-had-a-copy';
        } else {
          paths.set(binding.destination.name, {
            queue: binding.destination.name,
            hops: [...hopsTo(exchange.name), hop],
          });
          outcome = 'queue-first-copy';
        }
      } else {
        const next = exchanges.get(binding.destination.name);
        if (next === undefined) {
          outcome = 'destination-missing';
        } else if (seen.has(next.name)) {
          outcome = 'exchange-already-visited';
        } else {
          seen.add(next.name);
          arrival.set(next.name, hop);
          work.push(next);
          outcome = 'exchange-visited-next';
        }
      }
      evaluations.push({ ...base, outcome });
    }

    const arrived = arrival.get(exchange.name);
    visits.push({
      exchange: exchange.name,
      type: exchange.type,
      ...(arrived === undefined ? {} : { via: { from: arrived.from, binding: arrived.binding as number } }),
      bindings: evaluations,
    });
  }

  return {
    ok: true,
    queues: [...paths.keys()],
    paths: [...paths.values()],
    trace: { exchange: start.name, visits },
  };
}
