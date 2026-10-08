import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RABBITMQ_BASELINE } from '@rmq/engine';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { startRabbitMq } from './container';
import { observeExported, whyNotExportable } from './export';
import { readFixtureSet, toFixture, toScenario, writeFixtureSet, type Fixture } from './fixtures';
import { connectBroker, type LiveBroker } from './management';
import { buildManifest, CONFORMANCE_IMAGE, observe, parseMode } from './run';
import { SCENARIOS } from './scenarios';
import { checkManifest, describeDrift, verifyCase, writeDiffs, type Verdict } from './verify';

/**
 * The live conformance run (ADR-0015): play the scenarios against a real RabbitMQ, and either record what it does
 * (`CONFORMANCE_MODE=record`) or check that it still does what the fixtures say (`verify`, the default).
 *
 *   npm run test:conformance
 *
 * It needs Docker, which a developer machine or the cloud container may not have. There it is skipped, with a notice,
 * unless CONFORMANCE_REQUIRED=true, which the nightly job sets so that a missing Docker is a failure there.
 *
 * In verify mode it asks a second question of the same fixtures (ADR-0079): the definitions file that the app exports for each routing scenario that only declares, binds and publishes is imported into the broker, the way the
 * management UI imports one, and the publishes are played against the vhost it made. The queues must get what the fixture recorded. A difference is drift of the file or of the model, and a person finds out which.
 *
 * To debug against a broker that is already running, set CONFORMANCE_BROKER_HOST (and, if they differ from the
 * defaults, CONFORMANCE_AMQP_PORT and CONFORMANCE_MANAGEMENT_URL). Such a broker is not the pinned image, so the
 * manifest says "external", and the offline fixture spec refuses to accept a manifest recorded that way.
 */

const webRoot = fileURLToPath(new URL('../../', import.meta.url));
const mode = parseMode(process.env['CONFORMANCE_MODE']);
const required = process.env['CONFORMANCE_REQUIRED'] === 'true';
const externalHost = process.env['CONFORMANCE_BROKER_HOST'];
const fixturesRoot = process.env['CONFORMANCE_FIXTURES'] ?? `${webRoot}fixtures/conformance`;
const diffDir = process.env['CONFORMANCE_DIFF_DIR'] ?? `${webRoot}conformance-diff`;

// global-setup.ts has already worked this out, and printed a notice if the run is going to be skipped.
const runtime = inject('conformanceRuntime');

function generatorSha(): string {
  const fromCi = process.env['GITHUB_SHA'];
  if (fromCi) {
    return fromCi;
  }
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: webRoot, encoding: 'utf8' });
  return git.status === 0 ? git.stdout.trim() : 'unknown';
}

async function acquireBroker(): Promise<LiveBroker> {
  if (externalHost) {
    return connectBroker({
      hostname: externalHost,
      amqpPort: Number(process.env['CONFORMANCE_AMQP_PORT'] ?? 5672),
      managementUrl: process.env['CONFORMANCE_MANAGEMENT_URL'] ?? `http://${externalHost}:15672`,
      image: 'external',
      imageDigest: 'external',
    });
  }
  if (!runtime.available) {
    throw new Error(`Docker is required for the conformance run, and it is not available: ${runtime.reason}`);
  }
  return startRabbitMq(CONFORMANCE_IMAGE);
}

describe.skipIf(!runtime.available && !required)(`conformance against RabbitMQ ${RABBITMQ_BASELINE} (${mode})`, () => {
  let broker: LiveBroker;
  beforeAll(async () => {
    broker = await acquireBroker();
  }, 300_000);
  afterAll(async () => {
    await broker?.stop();
  });

  if (mode === 'record') {
    const recorded: Fixture[] = [];

    it.each(SCENARIOS.map((scenario) => [scenario.id, scenario] as const))('records %s', async (_id, scenario) => {
      recorded.push(toFixture(scenario, await observe(broker, scenario)));
    });

    it('writes the fixtures and the manifest', () => {
      expect(recorded, 'every scenario was recorded').toHaveLength(SCENARIOS.length);
      const manifest = buildManifest({
        info: broker.info,
        fixtures: recorded,
        generatorSha: generatorSha(),
        recordedAt: new Date(),
      });
      writeFixtureSet(fixturesRoot, manifest, recorded);
    });
  } else {
    const { fixtures, manifest } = readFixtureSet(fixturesRoot, RABBITMQ_BASELINE);
    const verdicts: Verdict[] = [];
    const exported = fixtures.filter((fixture) => whyNotExportable(fixture) === null);

    it('has fixtures to check', () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });

    it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
      '%s still behaves as recorded',
      async (_id, fixture) => {
        const verdict = verifyCase(fixture, await observe(broker, toScenario(fixture)));
        verdicts.push(verdict);
        expect(verdict.drifted ? describeDrift(verdict) : 'no drift').toBe('no drift');
      },
    );

    it('has scenarios that a definitions file can say', () => {
      expect(exported.length).toBeGreaterThan(30);
    });

    it.each(exported.map((fixture) => [fixture.id, fixture] as const))(
      '%s, exported and imported, routes as recorded',
      async (_id, fixture) => {
        const verdict = verifyCase(fixture, await observeExported(broker, fixture));
        verdicts.push({ ...verdict, id: `export-${verdict.id}` });
        expect(verdict.drifted ? describeDrift(verdict) : 'no drift').toBe('no drift');
      },
    );

    it('has a manifest that matches the fixtures', () => {
      const { problems } = checkManifest(manifest, fixtures, broker.info);
      expect(problems).toEqual([]);
    });

    afterAll(() => {
      const { notes } = checkManifest(manifest, fixtures, broker?.info);
      writeDiffs(diffDir, verdicts, notes);
    });
  }
});
