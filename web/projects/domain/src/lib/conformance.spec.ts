import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  route,
  type Binding,
  type Exchange,
  type HeaderCondition,
  type HeaderEntry,
  type HeaderValue,
  type Topology,
  type XMatch,
} from '@rmq/engine';
import { bindingKey, canonicalTopology, sequentialIds } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands/apply';
import type { BindCommand, DeclareExchange, DeclareQueue, DocumentCommand } from './commands/types';
import { canonicalHeaders } from './document/headers';
import { emptyDocument, type CanvasDocument } from './document/schema';
import { toTopology } from './document/topology';
import { validateDocument } from './document/validate';
import { formatCommand } from './syntax/format';
import { parseCommand } from './syntax/parse';

/**
 * The routing fixtures are what RabbitMQ 4.3 did with each scenario, recorded on the pinned image by the conformance runner.
 * The engine replays their publishes through `route()`. This replays their declarations and their bindings through the
 * commands of the domain, and checks the answers that a broker gave (ADR-0021, ADR-0022): a step that the broker refused is
 * refused, with the code and the text that it recorded, and a step that the broker accepted is accepted. It is the check that
 * the simulator reproduces the refusals, and the nightly run asks whether the broker still gives them.
 *
 * A step that this does not know is an error, never skipped, and so is a fixture that uses something that the M1 model
 * cannot say, unless it is on the list below, with its reason. The list is the one place where the model is narrower than
 * the broker, and it is checked, so that a new recording cannot slip past the replay by being outside the model.
 */

type Json = Record<string, unknown>;

interface Fixture {
  readonly id: string;
  readonly steps: readonly Json[];
  readonly observed: {
    readonly routes: readonly {
      readonly body: string;
      readonly returned: boolean;
      readonly queues: readonly string[];
    }[];
    readonly refusals?: readonly {
      readonly step: number;
      readonly level: string;
      readonly code: number;
      readonly text: string;
    }[];
  };
}

const ROUTING = fileURLToPath(new URL('../../../../fixtures/conformance/4.3/routing/', import.meta.url));

const fixtures: Fixture[] = readdirSync(ROUTING)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(`${ROUTING}${name}`, 'utf8')) as Fixture);

/** What the M1 model cannot say, by fixture, and why. An exclusive queue arrives with connections and lifecycles in M3. */
const OUTSIDE_THE_MODEL: Readonly<Record<string, string>> = {
  'routing/a-queue-that-is-not-durable-is-accepted-when-it-is-exclusive':
    'it declares an exclusive queue, and M1 has no exclusive flag (ADR-0024)',
};

const asValue = (json: Json): HeaderValue => {
  const { t, v } = json as { t: HeaderValue['t']; v: never };
  return { t, v } as HeaderValue; // The width of an integer on the wire is not in the model, which does not need it (ADR-0009).
};
const asCondition = (json: Json): HeaderCondition => (json['t'] === 'exists' ? { t: 'exists' } : asValue(json));
const asEntries = <V>(list: unknown, convert: (value: Json) => V): HeaderEntry<V>[] =>
  ((list ?? []) as { key: string; value: Json }[]).map(({ key, value }) => ({ key, value: convert(value) }));

/** The command that a declaration or a binding of a fixture is, or `undefined` for a step that is not one. */
function commandOf(step: Json): DocumentCommand | undefined {
  switch (step['op']) {
    case 'exchange.declare':
      return {
        type: 'declare-exchange',
        name: step['name'] as string,
        exchangeType: step['type'] as DeclareExchange['exchangeType'],
        durable: (step['durable'] as boolean | undefined) ?? true,
        autoDelete: (step['autoDelete'] as boolean | undefined) ?? false,
        internal: step['internal'] === true,
      };
    case 'queue.declare':
      return {
        type: 'declare-queue',
        name: step['name'] as string,
        durable: (step['durable'] as boolean | undefined) ?? true,
      } satisfies DeclareQueue;
    case 'bind': {
      const headers = step['headers'] as { xMatch: XMatch | null; args: unknown } | undefined;
      return {
        type: 'bind',
        source: step['source'] as string,
        destination: step['destination'] as BindCommand['destination'],
        key: (step['key'] as string | undefined) ?? '',
        ...(headers ? { headers: { xMatch: headers.xMatch, args: asEntries(headers.args, asCondition) } } : {}),
      };
    }
    default:
      return undefined;
  }
}

/** What reading a command back from its text must give: the command, with arguments that say nothing left out. */
function normalise(command: DocumentCommand): DocumentCommand {
  if (command.type !== 'bind') {
    return command;
  }
  const { headers, ...rest } = command;
  const canonical = canonicalHeaders(headers);
  return canonical === undefined ? rest : { ...rest, headers: canonical };
}

interface Replayed {
  readonly problems: string[];
  /** The declarations and bindings that were played, and the refusals that they were checked against. */
  readonly counts: { readonly steps: number; readonly refused: number; readonly published: number };
  readonly document: CanvasDocument;
}

/**
 * Plays a fixture's steps into a canvas: the declarations and the bindings through the commands, the publishes through
 * `route()` on the topology of the canvas. Returns what differs from what the broker did.
 */
function replay(fixture: Fixture): Replayed {
  const problems: string[] = [];
  const counts = { steps: 0, refused: 0, published: 0 };
  const ids = sequentialIds();
  const refusals = new Map((fixture.observed.refusals ?? []).map((refusal) => [refusal.step, refusal]));
  const routes = [...fixture.observed.routes];
  let document = emptyDocument();
  // What the broker holds, built by hand from the steps that it accepted, to compare with the topology of the canvas.
  const expected: { exchanges: Exchange[]; queues: string[]; bindings: Binding[] } = {
    exchanges: [],
    queues: [],
    bindings: [],
  };
  const seen = new Set<string>();

  fixture.steps.forEach((step, index) => {
    const at = `${fixture.id}, step ${index + 1} (${String(step['op'])})`;
    const refused = step['refused'] === true;
    const command = commandOf(step);

    if (command === undefined) {
      if (step['op'] !== 'basic.publish') {
        throw new Error(
          `${at}: this replay does not know the step "${String(step['op'])}". Teach it, so that it is not skipped`,
        );
      }
      counts.published += 1;
      const result = route(toTopology(document), {
        exchange: step['exchange'] as string,
        key: (step['key'] as string | undefined) ?? '',
        headers: asEntries(step['headers'], asValue),
      });
      if (refused) {
        const recorded = refusals.get(index + 1);
        counts.refused += 1;
        if (result.ok || recorded === undefined || result.code !== recorded.code || result.text !== recorded.text) {
          problems.push(
            `${at}: the broker refused with ${JSON.stringify(recorded)}, and route() gave ${JSON.stringify(result.ok ? 'a route' : result)}`,
          );
        }
        return;
      }
      const observed = routes.shift();
      if (observed === undefined || !result.ok) {
        problems.push(
          `${at}: the broker accepted the publish, and the canvas ${result.ok ? 'has no route recorded' : 'refused it'}`,
        );
        return;
      }
      if (JSON.stringify([...new Set(observed.queues)].sort()) !== JSON.stringify([...result.queues].sort())) {
        problems.push(
          `${at} ("${observed.body}"): the broker put it in ${JSON.stringify(observed.queues)}, and the canvas in ${JSON.stringify(result.queues)}`,
        );
      }
      return;
    }

    if (step['exclusive'] === true) {
      problems.push(
        `${at}: declares an exclusive queue, which the M1 model cannot say. List the fixture, with a reason, or add the flag`,
      );
      return;
    }

    counts.steps += 1;
    const result = applyCommand(document, command, ids);
    if (refused) {
      counts.refused += 1;
      const recorded = refusals.get(index + 1);
      if (result.ok || recorded === undefined) {
        problems.push(
          `${at}: the broker refused with ${JSON.stringify(recorded)}, and the canvas ${result.ok ? 'accepted it' : 'refused it without a reply'}`,
        );
      } else if (result.error.refusal?.code !== recorded.code || result.error.refusal.text !== recorded.text) {
        problems.push(
          `${at}: the broker refused with ${recorded.code} ${JSON.stringify(recorded.text)}, and the canvas with ${JSON.stringify(result.error.refusal)}`,
        );
      } else if (result.error.message === recorded.text || result.error.message.length < 20) {
        problems.push(
          `${at}: the message does not say more than the broker's words: ${JSON.stringify(result.error.message)}`,
        );
      }
      return;
    }
    if (!result.ok) {
      problems.push(`${at}: the broker accepted it, and the canvas refused it: ${result.error.message}`);
      return;
    }

    // What a command is, written in words, reads back as the same command, whatever the names and the keys are.
    const text = formatCommand(command, document);
    const read = parseCommand(text, document);
    if (!read.ok || JSON.stringify(read.value) !== JSON.stringify(normalise(command))) {
      problems.push(
        `${at}: written as ${JSON.stringify(text)}, which reads back as ${JSON.stringify(read.ok ? read.value : read.error.message)}`,
      );
    }
    document = result.value;

    if (command.type === 'declare-exchange') {
      expected.exchanges.push({ name: command.name, type: command.exchangeType, internal: command.internal });
    } else if (command.type === 'declare-queue') {
      expected.queues.push(command.name);
    } else if (command.type === 'bind') {
      const binding: Binding = {
        source: command.source,
        destination: command.destination,
        key: command.key,
        ...(command.headers ? { headers: command.headers } : {}),
      };
      // A broker keeps a binding once, so binding it again is the same binding.
      const key = bindingKey({ op: 'bind', ...binding });
      if (!seen.has(key)) {
        seen.add(key);
        expected.bindings.push(binding);
      }
    }
  });

  const topology: Topology = { vhost: '/', ...expected };
  const built = canonicalTopology(toTopology(document));
  if (JSON.stringify(built) !== JSON.stringify(canonicalTopology(topology))) {
    problems.push(
      `${fixture.id}: the canvas holds ${JSON.stringify(built)}, and the broker held ${JSON.stringify(canonicalTopology(topology))}`,
    );
  }
  const invalid = validateDocument(document);
  if (invalid.length > 0) {
    problems.push(
      `${fixture.id}: the canvas that the steps made is not valid: ${invalid.map((issue) => issue.message).join(' ')}`,
    );
  }
  return { problems, counts, document };
}

const inside = fixtures.filter(({ id }) => !(id in OUTSIDE_THE_MODEL));

describe('the routing fixtures recorded on RabbitMQ 4.3, replayed through the commands of the domain', () => {
  it('are all there, and there are many: the replay below cannot pass by finding none', () => {
    expect(fixtures.length).toBeGreaterThan(50);
    expect(inside.length).toBeGreaterThan(50);
  });

  it('leave out only the fixtures that use what the M1 model cannot say, and each of those is listed with its reason', () => {
    const exclusive = fixtures
      .filter(({ steps }) => steps.some((step) => step['op'] === 'queue.declare' && step['exclusive'] === true))
      .map(({ id }) => id);

    expect(exclusive.sort()).toEqual(Object.keys(OUTSIDE_THE_MODEL).sort());
    for (const reason of Object.values(OUTSIDE_THE_MODEL)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });

  it.each(inside.map((fixture) => [fixture.id, fixture] as const))(
    '%s: the commands answer as the broker did',
    (_id, fixture) => {
      expect(replay(fixture).problems).toEqual([]);
    },
  );

  it('replays every refusal that the broker recorded, for declarations, bindings and publishes: none is left unchecked', () => {
    let recorded = 0;
    let replayed = 0;
    let steps = 0;
    for (const fixture of inside) {
      recorded += (fixture.observed.refusals ?? []).length;
      const result = replay(fixture);
      replayed += result.counts.refused;
      steps += result.counts.steps;
    }

    expect(recorded).toBeGreaterThanOrEqual(23);
    expect(replayed).toBe(recorded);
    expect(steps).toBeGreaterThan(1000);
  });

  it('refuses each kind of thing that ADR-0021 and ADR-0022 say it reproduces: the codes 403, 404, 406 and 541', () => {
    const codes = new Set<number>();
    for (const fixture of inside) {
      for (const refusal of fixture.observed.refusals ?? []) {
        codes.add(refusal.code);
      }
    }

    expect([...codes].sort()).toEqual([403, 404, 406, 541]);
  });

  describe('the replay itself', () => {
    const named = (id: string): Fixture => fixtures.find((fixture) => fixture.id === id) as Fixture;
    const amq = named('routing/names-that-start-with-amq-are-refused');
    const transient = named('routing/a-queue-that-is-neither-durable-nor-exclusive-is-refused');
    const direct = named('routing/direct-matches-the-whole-key-case-sensitively');

    /** A fixture with one of the refusals that it recorded changed. */
    const withRefusal = (fixture: Fixture, step: number, change: object): Fixture => ({
      ...fixture,
      observed: {
        ...fixture.observed,
        refusals: (fixture.observed.refusals ?? []).map((refusal) =>
          refusal.step === step ? { ...refusal, ...change } : refusal,
        ),
      },
    });

    it('notices a refusal that has another code, or other words', () => {
      expect(replay(withRefusal(amq, 4, { code: 404 })).problems.join('\n')).toMatch(
        /step 4 \(exchange\.declare\): the broker refused with 404/,
      );
      expect(
        replay(withRefusal(transient, 2, { text: 'INTERNAL_ERROR - something else' })).problems.join('\n'),
      ).toMatch(/step 2 \(queue\.declare\)/);
    });

    it('notices a step that the broker refused and the canvas accepted, and one that the canvas refused and the broker accepted', () => {
      const accepted = {
        ...amq,
        steps: amq.steps.map((step, index) => (index === 3 ? { ...step, name: 'fine' } : step)),
      };
      const refusedByCanvas = {
        ...direct,
        steps: direct.steps.map((step, index) => (index === 0 ? { ...step, name: 'amq.d' } : step)),
      };

      expect(replay(accepted).problems.join('\n')).toMatch(/the broker refused with .*, and the canvas accepted it/);
      expect(replay(refusedByCanvas).problems.join('\n')).toMatch(/the broker accepted it, and the canvas refused it/);
    });

    it('notices a refusal that the broker did not record, and a step marked as refused that was not', () => {
      const unrecorded = { ...amq, observed: { ...amq.observed, refusals: [] } };
      const marked = {
        ...direct,
        steps: direct.steps.map((step, index) => (index === 0 ? { ...step, refused: true } : step)),
      };

      expect(replay(unrecorded).problems.join('\n')).toMatch(/the broker refused with undefined/);
      expect(replay(marked).problems.join('\n')).toMatch(
        /the broker refused with undefined, and the canvas accepted it/,
      );
    });

    it('notices a publish that the canvas routes in another way than the broker did', () => {
      const [first, ...rest] = direct.observed.routes;
      const wrong = {
        ...direct,
        observed: { ...direct.observed, routes: [{ ...(first as object), queues: ['created-upper'] }, ...rest] },
      } as Fixture;

      expect(replay(wrong).problems.join('\n')).toMatch(/the broker put it in \["created-upper"\]/);
    });

    it('notices an exclusive queue, which the model cannot say, in a fixture that is not on the list', () => {
      const exclusive = {
        ...direct,
        steps: [{ op: 'queue.declare', name: 'mine', durable: false, exclusive: true }, ...direct.steps],
      };

      expect(replay(exclusive).problems.join('\n')).toMatch(
        /declares an exclusive queue, which the M1 model cannot say/,
      );
    });

    it('does not skip a step that it does not know', () => {
      const odd = { ...direct, steps: [...direct.steps, { op: 'queue.purge', name: 'x' }] };

      expect(() => replay(odd)).toThrow('does not know the step "queue.purge"');
    });
  });
});
