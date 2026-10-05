import { describe, expect, it } from 'vitest';
import { FakeBroker, FakeSession } from './fake-session';
import { toFixture } from './fixtures';
import { buildManifest, CONFORMANCE_IMAGE, observe, parseMode, vhostFor } from './run';
import type { Scenario } from './scenario';

const scenario: Scenario = {
  id: 'routing/some-case',
  kind: 'routing',
  title: 'x',
  steps: [{ op: 'queue.declare', name: 'q' }],
};

describe('CONFORMANCE_IMAGE', () => {
  it('is the management image of the engine baseline', () => {
    expect(CONFORMANCE_IMAGE).toBe('rabbitmq:4.3-management');
  });
});

describe('parseMode', () => {
  it.each([undefined, '', '  ', 'verify'])('reads %j as verify, which only reads', (value) => {
    expect(parseMode(value)).toBe('verify');
  });

  it('reads record', () => {
    expect(parseMode('record')).toBe('record');
  });

  it.each(['Record', 'update', 'true', 'verify '])('refuses %j instead of guessing', (value) => {
    expect(() => parseMode(value)).toThrow(`CONFORMANCE_MODE must be "verify" or "record", got "${value}"`);
  });
});

describe('vhostFor', () => {
  it('gives every scenario a vhost of its own', () => {
    expect(vhostFor('routing/some-case')).toBe('conformance-routing-some-case');
    expect(vhostFor('delivery/some-case')).not.toBe(vhostFor('routing/some-case'));
  });
});

describe('observe', () => {
  it('plays the scenario in its own vhost and closes the session afterwards', async () => {
    const broker = new FakeBroker();

    const observed = await observe(broker, scenario);

    expect(broker.vhosts).toEqual(['conformance-routing-some-case']);
    expect(broker.sessions[0]?.closed).toBe(true);
    expect(observed).toEqual({ routes: [] });
  });

  it('closes the session when the scenario fails, and passes the failure on', async () => {
    const broker = new FakeBroker();
    broker.openSession = (vhost) => {
      const session = new FakeSession();
      session.failOn = 'queue.declare';
      broker.vhosts.push(vhost);
      broker.sessions.push(session);
      return Promise.resolve(session);
    };

    await expect(observe(broker, scenario)).rejects.toThrow('scripted failure on queue.declare q');
    expect(broker.sessions[0]?.closed).toBe(true);
  });
});

describe('buildManifest', () => {
  it('says which broker, which commit and when, and counts the fixtures by kind', () => {
    const fixtures = [toFixture(scenario, { routes: [] })];

    expect(
      buildManifest({
        info: {
          image: 'rabbitmq:4.3-management',
          imageDigest: 'sha256:abc',
          serverVersion: '4.3.6',
          erlangVersion: '27.3',
        },
        fixtures,
        generatorSha: 'deadbeef',
        recordedAt: new Date('2026-10-05T12:00:00.000Z'),
      }),
    ).toEqual({
      baseline: '4.3',
      image: 'rabbitmq:4.3-management',
      imageDigest: 'sha256:abc',
      serverVersion: '4.3.6',
      erlangVersion: '27.3',
      generatorSha: 'deadbeef',
      recordedAt: '2026-10-05T12:00:00.000Z',
      counts: { routing: 1, delivery: 0 },
    });
  });
});
