import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countFixtures,
  FixtureError,
  parseFixture,
  parseManifest,
  readFixtureSet,
  serializeFixture,
  toFixture,
  toScenario,
  writeFixtureSet,
  type Fixture,
  type Manifest,
} from './fixtures';
import type { Scenario } from './scenario';

const scenario: Scenario = {
  id: 'routing/direct',
  kind: 'routing',
  title: 'Direct',
  steps: [
    { op: 'exchange.declare', name: 'e', type: 'direct' },
    { op: 'queue.declare', name: 'q' },
    { op: 'bind', source: 'e', destination: { kind: 'queue', name: 'q' }, key: 'k' },
    { op: 'basic.publish', exchange: 'e', key: 'k', body: 'm1' },
  ],
};
const routingFixture: Fixture = toFixture(scenario, { routes: [{ body: 'm1', returned: false, queues: ['q'] }] });
const refusedFixture: Fixture = toFixture(
  {
    id: 'routing/refused',
    kind: 'routing',
    title: 'Refused',
    steps: [
      { op: 'exchange.declare', name: 'e', type: 'direct' },
      { op: 'basic.publish', exchange: 'nope', body: 'm1', refused: true },
      { op: 'basic.publish', exchange: 'e', body: 'm2' },
    ],
  },
  {
    routes: [{ body: 'm2', returned: true, queues: [] }],
    refusals: [{ step: 2, level: 'channel', code: 404, text: "NOT_FOUND - no exchange 'nope' in vhost '/'" }],
  },
);
const deliveryFixture: Fixture = {
  id: 'delivery/one',
  kind: 'delivery',
  title: 'One',
  origin: 'somewhere#1',
  steps: [
    { op: 'queue.declare', name: 'q' },
    { op: 'channel.open', channel: 'ch' },
    { op: 'basic.consume', channel: 'ch', queue: 'q', consumer: 'c', ack: 'auto' },
  ],
  observed: { deliveries: { c: [{ body: 'm1', redelivered: false }] }, ready: { q: [] } },
};
const manifest: Manifest = {
  baseline: '4.3',
  image: 'rabbitmq:4.3-management',
  imageDigest: 'sha256:abc',
  serverVersion: '4.3.6',
  erlangVersion: '27.3',
  generatorSha: 'deadbeef',
  recordedAt: '2026-10-05T12:00:00.000Z',
  counts: { routing: 1, delivery: 1 },
};

describe('toFixture and toScenario', () => {
  it('keep the scenario and add what was observed', () => {
    expect(routingFixture).toEqual({
      ...scenario,
      observed: { routes: [{ body: 'm1', returned: false, queues: ['q'] }] },
    });
    expect(toScenario(routingFixture)).toEqual(scenario);
  });

  it('carry the origin when there is one, and leave the key out when there is not', () => {
    expect(toScenario(deliveryFixture).origin).toBe('somewhere#1');
    expect('origin' in routingFixture).toBe(false);
    expect('origin' in toScenario(routingFixture)).toBe(false);
  });
});

describe('countFixtures', () => {
  it('counts each kind', () => {
    expect(countFixtures([routingFixture, deliveryFixture, deliveryFixture])).toEqual({ routing: 1, delivery: 2 });
    expect(countFixtures([])).toEqual({ routing: 0, delivery: 0 });
  });
});

describe('serializeFixture', () => {
  it('writes indented JSON that ends with a newline, so diffs are line by line', () => {
    const text = serializeFixture(routingFixture);

    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "id": "routing/direct"');
    expect(JSON.parse(text)).toEqual(routingFixture);
  });
});

describe('a fixture folder', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fixtures-'));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('is written below the baseline, by kind, with a manifest, and reads back the same', () => {
    writeFixtureSet(root, manifest, [routingFixture, deliveryFixture]);

    expect(readFileSync(join(root, '4.3', 'routing', 'direct.json'), 'utf8')).toBe(serializeFixture(routingFixture));
    expect(readFileSync(join(root, '4.3', 'delivery', 'one.json'), 'utf8')).toBe(serializeFixture(deliveryFixture));
    expect(readFixtureSet(root, '4.3')).toEqual({ fixtures: [routingFixture, deliveryFixture], manifest });
  });

  it('is replaced as a whole, so a fixture that is no longer recorded does not linger', () => {
    writeFixtureSet(root, manifest, [routingFixture, deliveryFixture]);
    writeFixtureSet(root, { ...manifest, counts: { routing: 1, delivery: 0 } }, [routingFixture]);

    expect(readFixtureSet(root, '4.3').fixtures).toEqual([routingFixture]);
  });

  it('leaves another baseline alone', () => {
    writeFixtureSet(root, { ...manifest, baseline: '4.2' }, [routingFixture]);
    writeFixtureSet(root, manifest, [deliveryFixture]);

    expect(readFixtureSet(root, '4.2').fixtures).toEqual([routingFixture]);
  });

  it('reads as empty, with no manifest, when nothing has been recorded', () => {
    expect(readFixtureSet(root, '4.3')).toEqual({ fixtures: [], manifest: null });
  });

  it('ignores files that are not fixtures', () => {
    writeFixtureSet(root, manifest, [routingFixture]);
    writeFileSync(join(root, '4.3', 'routing', 'README.txt'), 'notes');

    expect(readFixtureSet(root, '4.3').fixtures).toEqual([routingFixture]);
  });

  it('refuses a fixture whose id does not match its file name', () => {
    mkdirSync(join(root, '4.3', 'routing'), { recursive: true });
    writeFileSync(join(root, '4.3', 'routing', 'other-name.json'), serializeFixture(routingFixture));

    expect(() => readFixtureSet(root, '4.3')).toThrow(/id "routing\/direct" does not match the file name/);
  });

  it('says which file is broken', () => {
    mkdirSync(join(root, '4.3', 'delivery'), { recursive: true });
    writeFileSync(join(root, '4.3', 'delivery', 'broken.json'), '{ nope');

    expect(() => readFixtureSet(root, '4.3')).toThrow(/^4\.3\/delivery\/broken\.json: it is not valid JSON/);
  });
});

describe('parseFixture', () => {
  const valid = () => JSON.parse(serializeFixture(routingFixture)) as Record<string, unknown>;
  const parse = (value: unknown) => parseFixture(JSON.stringify(value), 'f.json');

  it('accepts what serializeFixture wrote', () => {
    expect(parseFixture(serializeFixture(routingFixture), 'f.json')).toEqual(routingFixture);
    expect(parseFixture(serializeFixture(deliveryFixture), 'f.json')).toEqual(deliveryFixture);
  });

  it('accepts a fixture that records a refusal, and gives it back as it was written', () => {
    expect(parseFixture(serializeFixture(refusedFixture), 'f.json')).toEqual(refusedFixture);
    expect(serializeFixture(refusedFixture)).toContain('"code": 404');
  });

  it('accepts a refusal that closed the connection, as well as one that closed a channel', () => {
    const closedConnection: Fixture = {
      ...refusedFixture,
      observed: {
        routes: [],
        refusals: [{ step: 2, level: 'connection', code: 541, text: 'INTERNAL_ERROR - gone' }],
      },
    };

    expect(parseFixture(serializeFixture(closedConnection), 'f.json')).toEqual(closedConnection);
  });

  it.each<[string, (fixture: Record<string, unknown>) => unknown, RegExp]>([
    ['not JSON', () => '{', /not valid JSON/],
    ['an array', () => [], /must be a JSON object/],
    ['a missing id', ({ id: _id, ...rest }) => rest, /"id" must be a string/],
    ['an unknown kind', (f) => ({ ...f, kind: 'other' }), /"kind" must be "routing" or "delivery"/],
    ['a missing title', ({ title: _title, ...rest }) => rest, /"title" must be a string/],
    ['an origin that is not a string', (f) => ({ ...f, origin: 3 }), /"origin" must be a string/],
    ['steps that are not an array', (f) => ({ ...f, steps: {} }), /"steps" must be an array/],
    ['no observed', ({ observed: _observed, ...rest }) => rest, /"observed" must be an object/],
    ['routes that are not an array', (f) => ({ ...f, observed: { routes: 1 } }), /observed\.routes" must be an array/],
    [
      'a route with the wrong shape',
      (f) => ({ ...f, observed: { routes: [{ body: 'm1' }] } }),
      /observed\.routes\[0\] must be/,
    ],
    [
      'a route whose queues are not strings',
      (f) => ({ ...f, observed: { routes: [{ body: 'm1', returned: false, queues: [1] }] } }),
      /observed\.routes\[0\]/,
    ],
    [
      'refusals that are not an array',
      (f) => ({ ...f, observed: { routes: [], refusals: {} } }),
      /"observed\.refusals" must be a list with at least one refusal/,
    ],
    [
      'an empty list of refusals, which is written by leaving the key out',
      (f) => ({ ...f, observed: { routes: [], refusals: [] } }),
      /"observed\.refusals" must be a list with at least one refusal/,
    ],
    [
      'a refusal of the wrong shape',
      (f) => ({ ...f, observed: { routes: [], refusals: [{ step: 1, level: 'channel', code: 404 }] } }),
      /observed\.refusals\[0\] must be \{ step/,
    ],
    [
      'a refusal with a level that is neither channel nor connection',
      (f) => ({ ...f, observed: { routes: [], refusals: [{ step: 1, level: 'link', code: 404, text: 'x' }] } }),
      /observed\.refusals\[0\] must be \{ step/,
    ],
    [
      'a refusal at a step that is not a whole number',
      (f) => ({ ...f, observed: { routes: [], refusals: [{ step: 1.5, level: 'channel', code: 404, text: 'x' }] } }),
      /observed\.refusals\[0\] must be \{ step/,
    ],
    [
      'a refusal whose code is not a whole number',
      (f) => ({ ...f, observed: { routes: [], refusals: [{ step: 1, level: 'channel', code: 404.5, text: 'x' }] } }),
      /observed\.refusals\[0\] must be \{ step/,
    ],
    [
      'a refusal whose code is not a number',
      (f) => ({ ...f, observed: { routes: [], refusals: [{ step: 1, level: 'channel', code: '404', text: 'x' }] } }),
      /observed\.refusals\[0\] must be \{ step/,
    ],
    [
      'a refusal that is not an object',
      (f) => ({ ...f, observed: { routes: [], refusals: ['404'] } }),
      /observed\.refusals\[0\] must be \{ step/,
    ],
    [
      'a refusal at step 0, because steps are counted from 1',
      (f) => ({ ...f, observed: { routes: [], refusals: [{ step: 0, level: 'channel', code: 404, text: 'x' }] } }),
      /observed\.refusals\[0\] must be \{ step/,
    ],
    [
      'refusals that are not in the order of the steps',
      (f) => ({
        ...f,
        observed: {
          routes: [],
          refusals: [
            { step: 3, level: 'channel', code: 404, text: 'x' },
            { step: 2, level: 'channel', code: 404, text: 'x' },
          ],
        },
      }),
      /"observed\.refusals" must be in the order of the steps, each step once/,
    ],
    [
      'two refusals at the same step',
      (f) => ({
        ...f,
        observed: {
          routes: [],
          refusals: [
            { step: 2, level: 'channel', code: 404, text: 'x' },
            { step: 2, level: 'channel', code: 404, text: 'x' },
          ],
        },
      }),
      /"observed\.refusals" must be in the order of the steps, each step once/,
    ],
    [
      'steps that are not a valid scenario',
      (f) => ({ ...f, steps: [{ op: 'basic.publish', exchange: 'nope', body: 'm1' }] }),
      /exchange "nope" is not declared/,
    ],
  ])('rejects %s', (_name, change, message) => {
    const broken = change(valid());

    expect(() => (typeof broken === 'string' ? parseFixture(broken, 'f.json') : parse(broken))).toThrow(FixtureError);
    expect(() => (typeof broken === 'string' ? parseFixture(broken, 'f.json') : parse(broken))).toThrow(message);
  });

  it.each<[string, unknown, RegExp]>([
    ['deliveries that are not an object', { deliveries: [], ready: {} }, /observed\.deliveries must be an object/],
    [
      'a delivery list that is not an array',
      { deliveries: { c: 1 }, ready: {} },
      /observed\.deliveries\.c must be an array/,
    ],
    [
      'a delivery with the wrong shape',
      { deliveries: { c: [{ body: 'm1' }] }, ready: {} },
      /observed\.deliveries\.c\[0\] must be/,
    ],
    [
      'a ready list with the wrong shape',
      { deliveries: {}, ready: { q: [{ body: 1, redelivered: false }] } },
      /observed\.ready\.q\[0\] must be/,
    ],
  ])('rejects a delivery fixture with %s', (_name, observed, message) => {
    expect(() => parse({ ...JSON.parse(serializeFixture(deliveryFixture)), observed })).toThrow(message);
  });
});

describe('parseManifest', () => {
  const valid = () => JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;

  it('accepts a manifest', () => {
    expect(parseManifest(JSON.stringify(manifest), 'm.json')).toEqual(manifest);
  });

  it.each<[string, (m: Record<string, unknown>) => unknown, RegExp]>([
    ['counts that are missing', ({ counts: _counts, ...rest }) => rest, /"counts" must be/],
    ['counts that are not numbers', (m) => ({ ...m, counts: { routing: '1', delivery: 1 } }), /"counts" must be/],
    ['a missing baseline', ({ baseline: _baseline, ...rest }) => rest, /"baseline" must be a string/],
    ['a missing digest', ({ imageDigest: _digest, ...rest }) => rest, /"imageDigest" must be a string/],
    ['a missing generator commit', ({ generatorSha: _sha, ...rest }) => rest, /"generatorSha" must be a string/],
  ])('rejects %s', (_name, change, message) => {
    expect(() => parseManifest(JSON.stringify(change(valid())), 'm.json')).toThrow(message);
  });
});
