import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fixture, Manifest } from './fixtures';
import type { Observed } from './session';
import { checkManifest, describeDrift, verifyCase, writeDiffs, type Verdict } from './verify';

const observed: Observed = { routes: [{ body: 'm1', returned: false, queues: ['a', 'b'] }] };
const fixture: Fixture = {
  id: 'routing/x',
  kind: 'routing',
  title: 'x',
  steps: [{ op: 'exchange.declare', name: 'e', type: 'fanout' }],
  observed,
};
const manifest: Manifest = {
  baseline: '4.3',
  image: 'rabbitmq:4.3-management',
  imageDigest: 'sha256:aaa',
  serverVersion: '4.3.6',
  erlangVersion: '27',
  generatorSha: 'abc',
  recordedAt: '2026-10-05T00:00:00.000Z',
  counts: { routing: 1, delivery: 0 },
};

describe('verifyCase', () => {
  it('finds no drift when the broker did what was recorded', () => {
    expect(verifyCase(fixture, structuredClone(observed))).toEqual({ id: 'routing/x', drifted: false });
  });

  it('finds drift in a queue, in the returned flag, and in the order of queues', () => {
    for (const actual of [
      { routes: [{ body: 'm1', returned: false, queues: ['a'] }] },
      { routes: [{ body: 'm1', returned: true, queues: ['a', 'b'] }] },
      { routes: [{ body: 'm1', returned: false, queues: ['b', 'a'] }] },
    ]) {
      expect(verifyCase(fixture, actual)).toEqual({ id: 'routing/x', drifted: true, expected: observed, actual });
    }
  });

  it('does not care about the order of keys inside an object', () => {
    const reordered = { routes: [{ queues: ['a', 'b'], returned: false, body: 'm1' }] };

    expect(verifyCase(fixture, reordered).drifted).toBe(false);
  });
});

describe('describeDrift', () => {
  it('names the case and shows what was recorded and what is observed now', () => {
    const verdict = verifyCase(fixture, { routes: [] });
    if (!verdict.drifted) throw new Error('expected drift');

    const text = describeDrift(verdict);

    expect(text).toContain('routing/x: the broker no longer does what the fixture recorded.');
    expect(text).toContain('Recorded:');
    expect(text).toContain('"queues": [\n        "a",\n        "b"');
    expect(text).toContain('Observed now:\n{\n  "routes": []\n}');
  });
});

describe('checkManifest', () => {
  const live = { serverVersion: '4.3.6', imageDigest: 'sha256:aaa' };

  it('has no problems and no notes when everything agrees', () => {
    expect(checkManifest(manifest, [fixture], live)).toEqual({ problems: [], notes: [] });
  });

  it('reports a missing manifest as a problem', () => {
    expect(checkManifest(null, [fixture]).problems).toEqual(['There is no manifest.json. Record the fixtures first.']);
  });

  it('reports a manifest for another baseline', () => {
    expect(checkManifest({ ...manifest, baseline: '4.2' }, [fixture]).problems).toEqual([
      "The manifest is for RabbitMQ 4.2, but the engine's baseline is 4.3.",
    ]);
  });

  it('reports counts that do not match the fixture files, for each kind', () => {
    const { problems } = checkManifest({ ...manifest, counts: { routing: 2, delivery: 1 } }, [fixture]);

    expect(problems).toEqual([
      'The manifest says 2 routing fixtures, but there are 1.',
      'The manifest says 1 delivery fixtures, but there are 0.',
    ]);
  });

  it('only notes a new broker version or image, because the fixtures decide whether behaviour changed', () => {
    const { problems, notes } = checkManifest(manifest, [fixture], {
      serverVersion: '4.3.7',
      imageDigest: 'sha256:bbb',
    });

    expect(problems).toEqual([]);
    expect(notes).toEqual([
      'The broker is 4.3.7; the fixtures were recorded on 4.3.6.',
      'The image is sha256:bbb; the fixtures were recorded on sha256:aaa.',
    ]);
  });
});

describe('writeDiffs', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'diffs-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the recorded and the observed behaviour of each case that drifted, and a summary', () => {
    const drifted: Verdict = { id: 'delivery/one', drifted: true, expected: observed, actual: { routes: [] } };

    writeDiffs(dir, [{ id: 'routing/x', drifted: false }, drifted], ['The broker is newer.']);

    expect(readdirSync(dir).sort()).toEqual(['delivery__one.actual.json', 'delivery__one.expected.json', 'summary.md']);
    expect(JSON.parse(readFileSync(join(dir, 'delivery__one.expected.json'), 'utf8'))).toEqual(observed);
    expect(JSON.parse(readFileSync(join(dir, 'delivery__one.actual.json'), 'utf8'))).toEqual({ routes: [] });
    const summary = readFileSync(join(dir, 'summary.md'), 'utf8');
    expect(summary).toContain('1 of 2 cases drifted:');
    expect(summary).toContain('- `delivery/one`');
    expect(summary).toContain('- The broker is newer.');
  });

  it('says that nothing drifted when nothing did, and writes no case files', () => {
    writeDiffs(dir, [{ id: 'routing/x', drifted: false }]);

    expect(readdirSync(dir)).toEqual(['summary.md']);
    expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toContain('Nothing drifted.');
  });
});
