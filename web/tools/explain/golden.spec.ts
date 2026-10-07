import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainQueue, explainRoute, explanationText } from '@rmq/domain';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Fixture } from '../conformance/fixtures';
import {
  checkGolden,
  FIXTURES_ROOT,
  GOLDEN_ROOT,
  readGolden,
  recordedFixtures,
  renderAll,
  routingFixtures,
  writeGolden,
} from './golden';
import { BASELINE, brokerLine, FULL_PUBLISHES, goldenFile, renderGolden } from './render';
import { OUTSIDE_THE_MODEL, publishesOf } from './replay';

const fixtures = recordedFixtures();
const modelled = routingFixtures(fixtures);

describe('the golden explanations of the routing fixtures (ADR-0060)', () => {
  it('are exactly what the fixtures render: the same check as `npm run explain:check`', () => {
    expect(checkGolden(renderAll(fixtures), readGolden(GOLDEN_ROOT))).toEqual([]);
  });

  it('are there for every routing fixture that the model can say, and for no other, and there are many', () => {
    const files = [...readGolden(GOLDEN_ROOT).keys()].sort();

    expect(modelled.length).toBeGreaterThan(80);
    expect(files).toEqual(modelled.map(({ id }) => `${BASELINE}/${id}.txt`).sort());
    expect(modelled.map(({ id }) => id)).not.toContain(Object.keys(OUTSIDE_THE_MODEL)[0]);
    expect(goldenFile('root', 'routing/x')).toBe(join('root', '4.3', 'routing/x.txt'));
  });

  it('say, for a publish that the broker did not accept, the refusal that the broker gave', () => {
    const refusing = modelled.filter((fixture) =>
      publishesOf(fixture).some(({ recorded }) => recorded.kind === 'refused'),
    );

    expect(refusing.length).toBeGreaterThan(0);
    for (const fixture of refusing) {
      for (const publish of publishesOf(fixture).filter(({ recorded }) => recorded.kind === 'refused')) {
        const explanation = explainRoute(publish.topology, publish.message);

        expect(explanation.outcome, `${fixture.id}, step ${publish.step}`).toBe('refused');
        expect(
          publish.recorded.kind === 'refused' && explanation.outcome === 'refused'
            ? { code: explanation.code, reply: explanation.reply }
            : null,
        ).toEqual(
          publish.recorded.kind === 'refused' ? { code: publish.recorded.code, reply: publish.recorded.text } : null,
        );
      }
    }
  });

  describe.each(modelled.map((fixture) => [fixture.id, fixture] as const))('%s', (_id, fixture) => {
    it('says the queues that the broker used, in its text and in its data, and no other', () => {
      for (const publish of publishesOf(fixture)) {
        const { recorded, topology, message } = publish;
        const explanation = explainRoute(topology, message);
        const at = `${fixture.id}, publish ${publish.number} (step ${publish.step})`;
        if (recorded.kind === 'refused') {
          continue;
        }
        const wanted = [...new Set(recorded.queues)].sort();
        const said = explanationText(explanation)
          .split('\n')
          .find((line) => line.startsWith('reached: '))
          ?.slice('reached: '.length);

        expect(said === 'nothing' ? [] : (said ?? '').split(', ').sort(), at).toEqual(wanted);
        expect(
          explanation.outcome === 'routed' || explanation.outcome === 'unroutable'
            ? [...explanation.queues].sort()
            : null,
          at,
        ).toEqual(wanted);
        expect(explanation.outcome === 'unroutable', `${at}: the broker returned it: ${recorded.returned}`).toBe(
          recorded.returned,
        );
        for (const queue of topology.queues) {
          const answer = explainQueue(topology, message, queue);

          expect(answer.reached, `${at}, queue ${queue}`).toBe(wanted.includes(queue));
          expect(answer.reached ? answer.path.length > 0 : answer.because.length > 0, `${at}, queue ${queue}`).toBe(
            true,
          );
        }
      }
    });

    it('has, in its golden file, the broker line of each publish beside the queues that the explanation says', () => {
      const text = readFileSync(goldenFile(GOLDEN_ROOT, fixture.id), 'utf8').replaceAll('\r\n', '\n');
      const blocks = text.split('\n## ').slice(1);
      const publishes = publishesOf(fixture);

      expect(blocks).toHaveLength(publishes.length);
      blocks.forEach((block, index) => {
        const lines = block.split('\n');
        const broker = lines.find((line) => line.startsWith('broker: '));
        const reached = lines.find((line) => line.startsWith('reached: '));
        const outcome = lines.find((line) => line.startsWith('outcome: '));
        const at = `${fixture.id}, publish ${index + 1}`;

        expect(broker, at).toBe(brokerLine((publishes[index] as (typeof publishes)[number]).recorded));
        if (broker?.startsWith('broker: refused')) {
          expect(outcome, at).toBe('outcome: refused');
        } else if (broker?.startsWith('broker: reached nothing') || broker?.startsWith('broker: returned')) {
          expect(reached, at).toBe('reached: nothing');
        } else {
          expect([...(reached ?? '').slice('reached: '.length).split(', ')].sort().join(', '), at).toBe(
            (broker ?? '').slice('broker: reached '.length),
          );
        }
      });
    });
  });

  it('write the first publishes of a fixture in full and the rest as their four lines, which is how the biggest table stays small', () => {
    const table = modelled.find(({ id }) => id.includes('every-pattern-of-up-to-three-words')) as Fixture;
    const text = renderGolden(table);
    const blocks = text.split('\n## ').slice(1);

    expect(blocks.length).toBeGreaterThan(FULL_PUBLISHES);
    expect(blocks[0]?.split('\n').length).toBeGreaterThan(100);
    // Its heading, the line of the broker, the four lines, and the blank line that comes before the next.
    expect(blocks[FULL_PUBLISHES]?.split('\n')).toHaveLength(7);
    expect(blocks[FULL_PUBLISHES]?.split('\n').filter((line) => line.startsWith('reached: '))).toHaveLength(1);
    expect(text.length).toBeLessThan(500_000);
  });

  it('add up to less than two megabytes, so that the repository carries them lightly', () => {
    const total = [...readGolden(GOLDEN_ROOT).values()].reduce((sum, text) => sum + text.length, 0);

    expect(total).toBeLessThan(2_000_000);
  });
});

describe('checkGolden', () => {
  const generated = new Map([
    ['4.3/routing/a.txt', 'one\ntwo\nthree\n'],
    ['4.3/routing/b.txt', 'b\n'],
  ]);

  it('is happy with the files that the fixtures render, and says nothing', () => {
    expect(checkGolden(generated, new Map(generated))).toEqual([]);
  });

  it('names a file that is missing, a file that no fixture renders, and the first line that differs', () => {
    expect(
      checkGolden(
        generated,
        new Map([
          ['4.3/routing/a.txt', 'one\nEDITED\nthree\n'],
          ['4.3/routing/old.txt', 'x\n'],
        ]),
      ),
    ).toEqual([
      'fixtures/explain/4.3/routing/a.txt differs from what its fixture renders, first at line 2.',
      'fixtures/explain/4.3/routing/b.txt is not there.',
      'fixtures/explain/4.3/routing/old.txt has no fixture that renders it.',
    ]);
  });

  it('notices a file that was cut short, a file with extra lines, and a change of whitespace alone', () => {
    const one = (text: string) => checkGolden(new Map([['f.txt', 'one\ntwo\n']]), new Map([['f.txt', text]]));

    expect(one('one\n')).toEqual(['fixtures/explain/f.txt differs from what its fixture renders, first at line 2.']);
    expect(one('one\ntwo\nthree\n')).toEqual([
      'fixtures/explain/f.txt differs from what its fixture renders, first at line 3.',
    ]);
    expect(one('one\ntwo \n')).toHaveLength(1);
  });
});

describe('readGolden and writeGolden', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'golden-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('write what is given and take away what is not, and read it back, with CRLF line endings read as the same text', () => {
    mkdirSync(join(dir, '4.3', 'routing'), { recursive: true });
    writeFileSync(join(dir, '4.3', 'routing', 'stale.txt'), 'old\n');
    writeGolden(dir, new Map([['4.3/routing/new.txt', 'a\nb\n']]));

    expect(readdirSync(join(dir, '4.3', 'routing'))).toEqual(['new.txt']);
    expect(readGolden(dir)).toEqual(new Map([['4.3/routing/new.txt', 'a\nb\n']]));
    writeFileSync(join(dir, '4.3', 'routing', 'new.txt'), 'a\r\nb\r\n');
    expect(readGolden(dir).get('4.3/routing/new.txt')).toBe('a\nb\n');
  });

  it('read nothing from a folder that is not there', () => {
    expect(readGolden(join(dir, 'nowhere'))).toEqual(new Map());
  });
});

describe('the script behind `npm run explain:check`', () => {
  const webRoot = fileURLToPath(new URL('../../', import.meta.url));
  // `npx` is `npx.cmd` on Windows, which cannot be spawned without a shell. This is the entry point `tsx` points to.
  const tsx = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));
  const script = (...args: string[]) =>
    spawnSync(process.execPath, [tsx, 'tools/explain/render-fixtures.ts', ...args], { cwd: webRoot, encoding: 'utf8' });
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'explain-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes the golden files where it is told, and then finds them up to date', () => {
    const written = script(`--golden=${dir}`);
    const checked = script(`--golden=${dir}`, '--check');

    expect(written.status).toBe(0);
    expect(written.stdout).toMatch(/^Wrote 90 golden explanations\./);
    expect(existsSync(join(dir, '4.3', 'routing', 'default-exchange-routes-to-the-queue-with-that-name.txt'))).toBe(
      true,
    );
    expect(checked.status).toBe(0);
    expect(checked.stdout).toMatch(/^90 golden explanations are up to date\./);
  }, 60_000);

  it('fails, and says which file and where, when one is edited, and says that it is not to be regenerated to get green', () => {
    script(`--golden=${dir}`);
    const file = join(dir, '4.3', 'routing', 'fanout-ignores-the-routing-key.txt');
    writeFileSync(file, readFileSync(file, 'utf8').replace('Reached', 'Got to'));

    const checked = script(`--golden=${dir}`, '--check');

    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain(
      'fixtures/explain/4.3/routing/fanout-ignores-the-routing-key.txt differs from what its fixture renders, first at line',
    );
    expect(checked.stderr).toContain('never regenerated to make a failure go away');
  }, 60_000);

  it('fails when there are no golden files at all, naming each', () => {
    const checked = script(`--golden=${join(dir, 'nowhere')}`, '--check');

    expect(checked.status).toBe(1);
    expect(checked.stderr.split('\n').filter((line) => line.endsWith('is not there.'))).toHaveLength(90);
  }, 60_000);

  it('reads the fixtures that it is told to read', () => {
    expect(FIXTURES_ROOT.replaceAll('\\', '/')).toMatch(/web\/fixtures\/conformance\/$/);
    expect(GOLDEN_ROOT.replaceAll('\\', '/')).toMatch(/web\/fixtures\/explain\/$/);
  });
});
