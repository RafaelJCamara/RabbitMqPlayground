import { RABBITMQ_BASELINE } from '@rmq/engine';
import { runScenario } from './executor';
import { countFixtures, type Fixture, type Manifest } from './fixtures';
import type { BrokerInfo, LiveBroker } from './management';
import type { Scenario } from './scenario';
import type { Observed } from './session';

/** The image the fixtures are recorded on. The baseline picks the version line (ADR-0008). */
export const CONFORMANCE_IMAGE = `rabbitmq:${RABBITMQ_BASELINE}-management`;

export type Mode = 'verify' | 'record';

/** `verify` is the default and is read-only. `record` writes fixtures, and a person reviews and commits them. */
export function parseMode(value: string | undefined): Mode {
  if (value === undefined || value.trim() === '' || value === 'verify') {
    return 'verify';
  }
  if (value === 'record') {
    return 'record';
  }
  throw new Error(`CONFORMANCE_MODE must be "verify" or "record", got "${value}"`);
}

/** Each scenario gets a vhost of its own, so no case can see another's exchanges, queues or messages. */
export function vhostFor(scenarioId: string): string {
  return `conformance-${scenarioId.replace('/', '-')}`;
}

/** Plays one scenario on a fresh vhost and cleans up, whether or not it worked. */
export async function observe(broker: LiveBroker, scenario: Scenario): Promise<Observed> {
  const session = await broker.openSession(vhostFor(scenario.id));
  try {
    return await runScenario(session, scenario);
  } finally {
    await session.close();
  }
}

export function buildManifest(args: {
  readonly info: BrokerInfo;
  readonly fixtures: readonly Fixture[];
  readonly generatorSha: string;
  readonly recordedAt: Date;
}): Manifest {
  return {
    baseline: RABBITMQ_BASELINE,
    image: args.info.image,
    imageDigest: args.info.imageDigest,
    serverVersion: args.info.serverVersion,
    erlangVersion: args.info.erlangVersion,
    generatorSha: args.generatorSha,
    recordedAt: args.recordedAt.toISOString(),
    counts: countFixtures(args.fixtures),
  };
}
