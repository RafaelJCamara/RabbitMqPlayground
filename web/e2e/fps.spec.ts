import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { edgeKeys, type DocumentCommand } from '@rmq/domain';
import {
  recordFileName,
  summarise,
  TARGET_FPS,
  TARGET_MESSAGES,
  verdict,
  type FpsRecord,
  type PowerState,
  type Rate,
} from '../tools/perf/fps';
import { EditorPage } from './pages/editor-page';
import { BIG_EDGES, BIG_NODES, bigCommands } from './support/big-canvas';
import { buildDocument, seedCanvas } from './support/seed';
import { expect, test } from './support/test';

/**
 * The frame rate of the editor with TARGET_MESSAGES messages in flight on the canvas that the plan sizes it for (200 nodes, 500 edges). It is run by hand, on a real machine, with
 * `playwright.fps.config.ts` (docs/performance.md), and it writes a record of the run into docs/performance/records. It does not fail on a low frame rate: the record is the result.
 * It fails only when the scenario did not hold (fewer than 100 messages were ever in flight) or the page threw.
 *
 *   FPS_SECONDS  seconds measured at each rate (10)
 *   FPS_THROTTLE the slowdowns of the processor to measure at, 1 being none ("1,4")
 */

const PRODUCER_EVERY_MS = 200;
const REPO = new URL('../../', import.meta.url);

/**
 * BIG_CANVAS made to carry the load: every producer publishes one message every 200 ms with a key that ROUTES, so that the message goes to one queue and to its consumer and not into
 * the void (a message that no binding takes ends at the exchange). The producers on a fanout exchange (p1, p4, ..., p19) are pointed at direct ones, because a fanout copies
 * a message to about ten queues and the engine counts every copy in `travelling`: that would be 3,500 copies a second from seven producers. A producer has one target, so the
 * edges stay 500. A message is on a leg for publishMs + brokerMs + deliverMs (a queued message is not counted), so 20 producers at 5 a second hold PER_SECOND x latency in flight:
 * the latency is TARGET_MESSAGES' worth of seconds plus a fifth, because the producers publish in step and the count falls by a batch just before each publish.
 */
function scenario() {
  const types = new Map<string, string>();
  const links = new Map<string, string>();
  const keys = new Map<string, string[]>();
  for (const command of bigCommands()) {
    if (command.type === 'declare-exchange') {
      types.set(command.name, command.exchangeType);
    } else if (command.type === 'link') {
      links.set(command.producer, command.target.name);
    } else if (command.type === 'bind' && command.destination.kind === 'queue' && command.key !== '') {
      keys.set(command.source, [...(keys.get(command.source) ?? []), command.key]);
    }
  }
  const free = [...types].filter(([name, type]) => type === 'direct' && ![...links.values()].includes(name));
  const perSecond = (links.size * 1000) / PRODUCER_EVERY_MS;
  const latency = Math.ceil(((TARGET_MESSAGES / perSecond) * 1200) / 100) * 100;
  const timing = { publishMs: Math.round((latency * 5) / 12), brokerMs: Math.round(latency / 6) };

  const commands: DocumentCommand[] = [];
  const taken = new Set<string>();
  let relinked = 0;
  for (const [producer, own] of links) {
    let exchange = own;
    if (types.get(own) === 'fanout') {
      exchange = free[relinked++ % free.length]![0];
      commands.push({ type: 'link', producer, target: { kind: 'exchange', name: exchange } });
    }
    const key = (keys.get(exchange) ?? []).find((candidate) => !taken.has(candidate)) ?? '';
    taken.add(key);
    commands.push({
      type: 'set',
      kind: 'producer',
      name: producer,
      changes: { burst: 1, everyMs: PRODUCER_EVERY_MS, repeat: true, key, payload: 'x' },
    });
  }
  commands.push({
    type: 'set',
    kind: 'canvas',
    changes: { ...timing, deliverMs: latency - timing.publishMs - timing.brokerMs },
  });
  return { document: buildDocument([...bigCommands(), ...commands]), latency };
}

interface Frames {
  readonly stamps: number[];
  readonly travelling: number[];
  readonly hidden: boolean;
}

/** In the page: the stamp of every animation frame for `milliseconds`, and the messages on a leg twice a second (the view of the engine is built on each call, so not every frame). */
function frames(page: Page, milliseconds: number): Promise<Frames> {
  return page.evaluate(
    (length) =>
      new Promise<Frames>((resolve) => {
        const stamps: number[] = [];
        const travelling: number[] = [];
        const sample = () => travelling.push(window.__rmq?.simulationState()?.view.travelling ?? 0);
        sample();
        const timer = setInterval(sample, 500);
        const end = performance.now() + length;
        const frame = () => {
          const now = performance.now();
          stamps.push(now);
          if (now < end) {
            requestAnimationFrame(frame);
          } else {
            clearInterval(timer);
            sample();
            resolve({ stamps, travelling, hidden: document.visibilityState !== 'visible' });
          }
        };
        requestAnimationFrame(frame);
      }),
    milliseconds,
  );
}

/** The median gap between frames of a page with nothing on it is the refresh rate of the display. */
function hertz(stamps: readonly number[]): number {
  const gaps = stamps
    .slice(1)
    .map((stamp, index) => stamp - stamps[index]!)
    .sort((a, b) => a - b);
  return Math.round(1000 / gaps[Math.floor(gaps.length / 2)]!);
}

function run(command: string, args: string[], cwd?: string): string | null {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
}

/** The plan of power of the machine, as the system says it: a line of text, or `null` where there is no tool that says it. */
function powerPlan(): string | null {
  if (process.platform === 'win32') {
    return run('powercfg', ['/getactivescheme'])?.trim() || null;
  }
  if (process.platform === 'darwin') {
    return run('pmset', ['-g', 'batt'])?.split('\n')[0]?.trim() || null;
  }
  return null;
}

/** Writes a file that is not there yet: `name`, or `name-2`, `name-3`, and so on before the extension. */
function writeNew(directory: string, name: string, text: string): string {
  mkdirSync(directory, { recursive: true });
  const dot = name.lastIndexOf('.');
  const [stem, extension] = dot < 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot)];
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? name : `${stem}-${n}${extension}`;
    try {
      writeFileSync(join(directory, candidate), text, { flag: 'wx' });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

test('holds its frame rate with the messages of the plan in flight on a canvas of 200 nodes and 500 edges', async ({
  page,
  browser,
}) => {
  const slowdown = Number(process.env['E2E_CPU_SLOWDOWN'] ?? '1');
  expect(
    slowdown,
    'E2E_CPU_SLOWDOWN slows every page and would spoil the rate 1: unset it (FPS_THROTTLE sets the slowdowns)',
  ).toBeLessThanOrEqual(1);
  const seconds = Number(process.env['FPS_SECONDS'] ?? '10');
  const throttles = (process.env['FPS_THROTTLE'] ?? '1,4').split(',').map(Number);
  expect(
    seconds >= 1 && throttles.every((rate) => rate >= 1),
    'FPS_SECONDS is 1 or more, and FPS_THROTTLE is rates of 1 or more',
  ).toBe(true);

  const { document, latency } = scenario();
  expect(edgeKeys(document).size, 'the producers were pointed at other exchanges and have one edge each').toBe(
    BIG_EDGES,
  );
  test.setTimeout(300_000 + throttles.length * (seconds + latency / 1000 + 20) * 1000);

  // A window asks for the icon of the page it shows, which a headless browser never does, and the page of the build's data has none: the 404 would be a console error.
  await page.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }));
  // The page of the build's own data comes first (seedCanvas): an idle page, where the display's refresh rate shows, and which says how old the build is.
  await seedCanvas(page, document, 'Frame rate');
  await page.bringToFront();
  const idle = await frames(page, 1000);
  const probe = await page.evaluate(async () => {
    const canvas = window.document.createElement('canvas');
    const gl = canvas.getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const battery = await (
      navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number }> }
    ).getBattery?.();
    return {
      gpu: gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      charging: battery?.charging ?? null,
      level: battery ? Math.round(battery.level * 100) / 100 : null, // as the browser says it: 0 to 1
      devicePixelRatio: window.devicePixelRatio,
      screen: `${screen.width}x${screen.height}`,
      build: (await fetch('build-info.json').then((response) => response.json())) as {
        commit: string;
        builtAt: string;
      },
    };
  });
  expect(idle.stamps.length, 'the window drew no frames: is it minimised?').toBeGreaterThan(10);

  const editor = new EditorPage(page);
  await editor.goto();
  await page.waitForFunction((edges) => (window.__rmq?.drawnEdges().length ?? 0) >= edges, BIG_EDGES, {
    timeout: 30_000,
  });
  await editor.settled();
  const session = await page.context().newCDPSession(page);
  const inFlight = () => page.evaluate(() => window.__rmq?.simulationState()?.view.travelling ?? 0);
  // The messages fill in as the clock runs: one latency (6 s) from the start to the most, so the warm-up is the clock passing that and the count being at the target, and not the first time that it crosses it.
  const fill = () =>
    page
      .waitForFunction(
        ({ target, warm }) => {
          const state = window.__rmq?.simulationState();
          return (state?.now ?? 0) >= warm && (state?.view.travelling ?? 0) >= target;
        },
        { target: TARGET_MESSAGES, warm: latency + 1000 },
        { polling: 500, timeout: latency * 3 + 10_000 },
      )
      .catch(() => undefined); // short of the target is a result, not a failure: the record says how far it got

  const rates: Rate[] = [];
  let most = 0;
  for (const cpuThrottle of throttles) {
    await session.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    await page.waitForTimeout(1000);
    await fill();
    const run_ = await frames(page, seconds * 1000);
    expect(run_.hidden, 'the window was hidden while it was measured').toBe(false);
    expect(run_.stamps.length, `the page drew ${run_.stamps.length} frames in ${seconds} s`).toBeGreaterThanOrEqual(3);
    const stats = summarise(run_.stamps);
    const min = Math.min(...run_.travelling);
    most = Math.max(most, ...run_.travelling, await inFlight());
    rates.push({
      cpuThrottle,
      stats,
      travelling: {
        min,
        mean: Math.round((run_.travelling.reduce((sum, n) => sum + n, 0) / run_.travelling.length) * 10) / 10,
      },
      meets: cpuThrottle === 1 ? verdict(stats, min) : null,
    });
  }
  await session.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const overlay = await page.evaluate(() => window.__rmq?.overlayFrame() ?? null);
  expect(most, 'the scenario did not hold: fewer than 100 messages were ever in flight').toBeGreaterThanOrEqual(100);
  expect(overlay?.reducedMotion, 'the overlay is in reduced motion and draws no moving messages').not.toBe(true);

  const cpus = os.cpus();
  const status = run(
    'git',
    ['status', '--porcelain', '--', '.', ':(exclude)docs/performance/records'],
    fileURLToPath(REPO),
  );
  const head = run('git', ['rev-parse', 'HEAD'], fileURLToPath(REPO))?.trim() ?? 'unknown';
  const committed = Date.parse(run('git', ['log', '-1', '--format=%cI'], fileURLToPath(REPO))?.trim() ?? '');
  // The build is what was measured: dirty also when it was made before the commit, or from another one (a CI build says its commit, a local one says `local`).
  const stale =
    Date.parse(probe.build.builtAt) < committed || (probe.build.commit !== 'local' && probe.build.commit !== head);
  const power: PowerState = { charging: probe.charging, level: probe.level, plan: powerPlan() };
  const record: FpsRecord = {
    schema: 1,
    date: new Date().toISOString(),
    commit: head,
    dirty: (status?.trim() ?? 'unknown') !== '' || stale,
    scenario: { nodes: BIG_NODES, edges: BIG_EDGES, messagesTarget: TARGET_MESSAGES, seconds },
    machine: {
      cpu: (cpus[0]?.model ?? 'unknown').replace(/\s+/g, ' ').trim(),
      cores: cpus.length,
      memoryGb: Math.round(os.totalmem() / 2 ** 30),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      gpu: probe.gpu,
      browser: `${browser.browserType().name()} ${browser.version()}`,
      displayHz: hertz(idle.stamps),
      devicePixelRatio: probe.devicePixelRatio,
      screen: probe.screen,
    },
    power,
    rates,
  };
  const file = writeNew(
    fileURLToPath(new URL('docs/performance/records/', REPO)),
    recordFileName(record),
    `${JSON.stringify(record, null, 2)}\n`,
  );

  // The overlay draws messages that are in the same place on an edge as one shape, up to SHAPE_LIMIT (500).
  const markers = `${overlay?.markers.length ?? 'no'} shapes drawn for ${await inFlight()} messages in flight`;
  test.info().annotations.push({ type: 'markers', description: markers }, { type: 'record', description: file });
  const line = rates
    .map(
      ({ cpuThrottle, stats, travelling, meets }) =>
        `${cpuThrottle}x ${stats.averageFps.toFixed(1)} fps (low ${stats.lowFps.toFixed(1)}, worst ${stats.worstFrameMs.toFixed(0)} ms, ${travelling.min}-${travelling.mean} msgs, meets ${meets})`,
    )
    .join('; ');
  console.log(
    `fps ${head.slice(0, 7)}${record.dirty ? '+dirty' : ''} ${record.machine.cpu} ${record.machine.displayHz} Hz, target ${TARGET_FPS} fps: ${line}; ${markers}; ${file}`,
  );
});
