import { fileURLToPath } from 'node:url';
import { RABBITMQ_BASELINE } from '@rmq/engine';
import { describe, expect, it } from 'vitest';
import { readFixtureSet, toScenario, type Fixture } from './fixtures';
import { CONFORMANCE_IMAGE } from './run';
import { SCENARIOS } from './scenarios';
import type { StepOf } from './session';
import { checkManifest } from './verify';

/**
 * The fixtures in `fixtures/conformance/<baseline>/` are what the engine is held to from S1 on (M1 plan, section 5),
 * so they have to be a faithful record: made by the pinned image, of the scenarios as they are written now. These
 * checks need no broker. They fail when a scenario is edited without recording again, when a fixture is edited by
 * hand, or when fixtures recorded on some other broker (CONFORMANCE_BROKER_HOST) are committed.
 *
 * Whether the broker still does what the fixtures say is the nightly job's question (verify mode), not this one's.
 */

const fixturesRoot = fileURLToPath(new URL('../../fixtures/conformance', import.meta.url));
const { fixtures, manifest } = readFixtureSet(fixturesRoot, RABBITMQ_BASELINE);

const stepsOf = <Op extends Fixture['steps'][number]['op']>(fixture: Fixture, op: Op): StepOf<Op>[] =>
  fixture.steps.filter((step): step is StepOf<Op> => step.op === op);

const unique = (names: readonly string[]) => [...new Set(names)].sort();

describe('the manifest', () => {
  it('exists, because the fixtures are recorded together with it', () => {
    expect(manifest, 'run the Nightly workflow in record mode, review what it prints, and commit it').not.toBeNull();
  });

  it('says the fixtures were recorded on the pinned image, not on some other broker', () => {
    expect(manifest?.image).toBe(CONFORMANCE_IMAGE);
  });

  it('pins that image by its digest', () => {
    expect(manifest?.imageDigest).toMatch(/^[\w./-]+@sha256:[0-9a-f]{64}$/);
  });

  it('names a server of the baseline version line', () => {
    expect(manifest?.serverVersion.split('.').slice(0, 2).join('.')).toBe(RABBITMQ_BASELINE);
    expect(manifest?.erlangVersion).toMatch(/^\d+\.\d+/);
  });

  it('names the commit whose scenarios and runner recorded the fixtures, and when', () => {
    expect(manifest?.generatorSha).toMatch(/^[0-9a-f]{40}$/);
    expect(new Date(manifest?.recordedAt ?? '').toISOString()).toBe(manifest?.recordedAt);
  });

  it('agrees with the fixtures about the baseline and how many there are', () => {
    expect(checkManifest(manifest, fixtures).problems).toEqual([]);
  });
});

describe('the fixtures', () => {
  it('are exactly the scenarios in scenarios/, so changing a scenario means recording again', () => {
    expect(fixtures.map((fixture) => fixture.id).sort()).toEqual(SCENARIOS.map((scenario) => scenario.id).sort());
  });

  it.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
    '%s has the inputs of its scenario as written now',
    (id, fixture) => {
      expect(toScenario(fixture)).toEqual(SCENARIOS.find((scenario) => scenario.id === id));
    },
  );

  const routing = fixtures.flatMap((fixture) =>
    'routes' in fixture.observed ? [[fixture, fixture.observed] as const] : [],
  );
  it.each(routing.map(([fixture, observed]) => [fixture.id, fixture, observed] as const))(
    '%s records an outcome for every publish the broker accepted, in order',
    (_id, fixture, observed) => {
      expect(observed.routes.map((route) => route.body)).toEqual(
        stepsOf(fixture, 'basic.publish')
          .filter((step) => step.refused !== true)
          .map((step) => step.body),
      );
    },
  );

  it.each(routing.map(([fixture, observed]) => [fixture.id, fixture, observed] as const))(
    '%s records a refusal for exactly the steps that its scenario expects the broker to refuse',
    (_id, fixture, observed) => {
      const expected = fixture.steps.flatMap((step, index) => ('refused' in step && step.refused ? [index + 1] : []));

      expect((observed.refusals ?? []).map((refusal) => refusal.step)).toEqual(expected);
    },
  );

  it('record what the broker said without the name of the vhost that the runner gave each scenario', () => {
    const texts = routing.flatMap(([, observed]) => (observed.refusals ?? []).map((refusal) => refusal.text));

    for (const text of texts) {
      expect(text).not.toContain('conformance-');
    }
  });

  const delivery = fixtures.flatMap((fixture) =>
    'deliveries' in fixture.observed ? [[fixture, fixture.observed] as const] : [],
  );
  it.each(delivery.map(([fixture, observed]) => [fixture.id, fixture, observed] as const))(
    '%s records every consumer, and every queue',
    (_id, fixture, observed) => {
      expect(Object.keys(observed.deliveries).sort()).toEqual(
        unique(stepsOf(fixture, 'basic.consume').map((step) => step.consumer)),
      );
      expect(Object.keys(observed.ready).sort()).toEqual(
        unique(stepsOf(fixture, 'queue.declare').map((step) => step.name)),
      );
    },
  );
});
