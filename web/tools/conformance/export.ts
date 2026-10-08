import { applyCommand, emptyDocument, type CanvasDocument } from '@rmq/domain';
import { exportDefinitions, type ExportedDefinitions } from '@rmq/persistence';
import { commandOfStep, sequentialIds, type RecordedStep } from '@rmq/testing';
import { runScenario } from './executor';
import { toScenario, type Fixture } from './fixtures';
import type { LiveBroker } from './management';
import type { Step } from './scenario';
import type { BrokerSession, Observed } from './session';

/**
 * The export, against a real broker (ADR-0079, ADR-0015). The app writes a definitions file, and the file is only worth anything if a broker takes it and routes as the app says. So each routing scenario that only declares, binds and publishes
 * is made into a canvas by the commands of the domain, exported, imported into a broker the way the management UI imports a file, and its publishes are played against the vhost that the file made. What each queue got is compared
 * with what the fixture recorded, by the same check as the rest of the run. A difference is drift of one of two things, and a person finds out which: the file is wrong, or the model is.
 */

/** What a scenario may do for its steps to be a canvas and a file: declare, bind, and publish. */
const EXPORTABLE = new Set<Step['op']>(['exchange.declare', 'queue.declare', 'bind', 'basic.publish']);

/** Why a fixture cannot be exported and played again against the broker that imported it, or `null` when it can. Each reason is a sentence, because the spec lists them. */
export function whyNotExportable(fixture: Fixture): string | null {
  if (fixture.kind !== 'routing') {
    return 'it is a delivery scenario, which is about consumers, and a definitions file has none';
  }
  const other = fixture.steps.find((step) => !EXPORTABLE.has(step.op));
  if (other !== undefined) {
    return `it has a ${other.op} step, which a definitions file cannot say`;
  }
  // `refused` can only be true, and is left out of a step that the broker accepted (scenario.ts), so its being there is the answer.
  if (fixture.steps.some((step) => 'refused' in step)) {
    return 'the broker refused one of its steps, and a file is only what a broker accepted';
  }
  if (fixture.steps.some((step) => step.op === 'queue.declare' && step.exclusive === true)) {
    return 'it declares an exclusive queue, which the app does not model (ADR-0024)';
  }
  if (
    fixture.steps.some((step) => step.op === 'bind' && step.headers?.args.some(({ value }) => value.t === 'exists'))
  ) {
    return 'it binds on a header that has to exist, which a definitions file cannot say (ADR-0079)';
  }
  const firstPublish = fixture.steps.findIndex((step) => step.op === 'basic.publish');
  if (firstPublish >= 0 && fixture.steps.slice(firstPublish).some((step) => step.op !== 'basic.publish')) {
    return 'it changes the topology between its publishes, and a file is the topology as it ends';
  }
  return null;
}

/** The canvas that the declarations and the bindings of a fixture make, by the commands of the domain, as the app would. */
export function canvasOf(fixture: Fixture): CanvasDocument {
  const ids = sequentialIds();
  let document = emptyDocument();
  fixture.steps.forEach((step, index) => {
    const command = commandOfStep(step as unknown as RecordedStep);
    if (command === undefined) {
      return;
    }
    const result = applyCommand(document, command, ids);
    if (!result.ok) {
      throw new Error(`${fixture.id}, step ${index + 1} (${step.op}): the canvas refused it: ${result.error.message}`);
    }
    document = result.value;
  });
  return document;
}

/** The definitions file for a fixture, to a vhost. It throws, saying which fixture, when the app would not make one. */
export function exportFixture(fixture: Fixture, vhost: string): ExportedDefinitions {
  const exported = exportDefinitions(canvasOf(fixture), vhost);
  if (!exported.ok) {
    throw new Error(`${fixture.id}: ${exported.error.message}`);
  }
  return exported.value;
}

/** Each export gets a vhost of its own, as each scenario does, so that no case can see another's exchanges, queues or messages. */
export function exportVhostFor(scenarioId: string): string {
  return `conformance-export-${scenarioId.replace('/', '-')}`;
}

const DECLARATIONS = new Set<string | symbol>(['declareExchange', 'declareQueue', 'bind']);

/** The session of a vhost that a file made: what the steps would declare and bind is there already, and is not done again. The rest goes to the session as it is. */
export function alreadyDeclared(session: BrokerSession): BrokerSession {
  return new Proxy(session, {
    get(target, property) {
      if (DECLARATIONS.has(property)) {
        return () => Promise.resolve();
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Plays a fixture against a broker that has imported its export, and cleans up, whether or not it worked. */
export async function observeExported(broker: LiveBroker, fixture: Fixture): Promise<Observed> {
  const vhost = exportVhostFor(fixture.id);
  const { text } = exportFixture(fixture, vhost);
  const session = await broker.openImportedSession(vhost, text);
  try {
    return await runScenario(alreadyDeclared(session), toScenario(fixture));
  } finally {
    await session.close();
  }
}
