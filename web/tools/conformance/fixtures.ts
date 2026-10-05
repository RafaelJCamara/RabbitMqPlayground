import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateScenario, type Scenario, type ScenarioKind, type Step } from './scenario';
import type { Delivery, DeliveryObserved, Observed, RoutingObserved } from './session';

/**
 * A fixture is a scenario together with what the broker did with it: the inputs and the outputs in one file
 * (M1 plan, section 5), at `fixtures/conformance/<baseline>/<kind>/<name>.json`. A `manifest.json` next to them says
 * which broker produced them.
 */

export interface Fixture {
  readonly id: string;
  readonly kind: ScenarioKind;
  readonly title: string;
  readonly origin?: string;
  readonly steps: readonly Step[];
  readonly observed: Observed;
}

export interface Manifest {
  /** The RabbitMQ version line (ADR-0008). It is also the name of the folder. */
  readonly baseline: string;
  readonly image: string;
  /** The content digest of the image the fixtures were recorded on. */
  readonly imageDigest: string;
  readonly serverVersion: string;
  readonly erlangVersion: string;
  /** The commit whose scenarios and runner recorded the fixtures. */
  readonly generatorSha: string;
  readonly recordedAt: string;
  readonly counts: Readonly<Record<ScenarioKind, number>>;
}

export class FixtureError extends Error {
  constructor(source: string, message: string) {
    super(`${source}: ${message}`);
    this.name = 'FixtureError';
  }
}

export function toFixture(scenario: Scenario, observed: Observed): Fixture {
  return {
    id: scenario.id,
    kind: scenario.kind,
    title: scenario.title,
    ...(scenario.origin ? { origin: scenario.origin } : {}),
    steps: scenario.steps,
    observed,
  };
}

export function toScenario(fixture: Fixture): Scenario {
  return {
    id: fixture.id,
    kind: fixture.kind,
    title: fixture.title,
    ...(fixture.origin ? { origin: fixture.origin } : {}),
    steps: fixture.steps,
  };
}

export function countFixtures(fixtures: readonly Pick<Fixture, 'kind'>[]): Record<ScenarioKind, number> {
  return {
    routing: fixtures.filter((fixture) => fixture.kind === 'routing').length,
    delivery: fixtures.filter((fixture) => fixture.kind === 'delivery').length,
  };
}

// --- files ---------------------------------------------------------------------------------------------------------

const toText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const serializeFixture = (fixture: Fixture): string => toText(fixture);
export const serializeManifest = (manifest: Manifest): string => toText(manifest);

export function fixtureFile(root: string, baseline: string, id: string): string {
  return join(root, baseline, `${id}.json`);
}

/** Writes the whole set and removes any fixture file that is not in it, so the folder is exactly what was recorded. */
export function writeFixtureSet(root: string, manifest: Manifest, fixtures: readonly Fixture[]): void {
  for (const kind of ['routing', 'delivery'] as const) {
    rmSync(join(root, manifest.baseline, kind), { recursive: true, force: true });
  }
  for (const fixture of fixtures) {
    const file = fixtureFile(root, manifest.baseline, fixture.id);
    mkdirSync(join(file, '..'), { recursive: true });
    writeFileSync(file, serializeFixture(fixture));
  }
  mkdirSync(join(root, manifest.baseline), { recursive: true });
  writeFileSync(join(root, manifest.baseline, 'manifest.json'), serializeManifest(manifest));
}

export interface FixtureSet {
  readonly fixtures: readonly Fixture[];
  /** `null` when there is no manifest.json. */
  readonly manifest: Manifest | null;
}

export function readFixtureSet(root: string, baseline: string): FixtureSet {
  const fixtures: Fixture[] = [];
  for (const kind of ['routing', 'delivery'] as const) {
    const dir = join(root, baseline, kind);
    for (const name of safeList(dir)
      .filter((file) => file.endsWith('.json'))
      .sort()) {
      const source = `${baseline}/${kind}/${name}`;
      const fixture = parseFixture(readFileSync(join(dir, name), 'utf8'), source);
      if (fixture.id !== `${kind}/${name.slice(0, -'.json'.length)}`) {
        throw new FixtureError(source, `the id "${fixture.id}" does not match the file name`);
      }
      fixtures.push(fixture);
    }
  }

  const manifestFile = join(root, baseline, 'manifest.json');
  const manifest = safeList(join(root, baseline)).includes('manifest.json')
    ? parseManifest(readFileSync(manifestFile, 'utf8'), `${baseline}/manifest.json`)
    : null;
  return { fixtures, manifest };
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

// --- validation ----------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(text: string, source: string): Json {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new FixtureError(source, `it is not valid JSON (${(error as Error).message})`);
  }
  if (!isRecord(value)) {
    throw new FixtureError(source, 'it must be a JSON object');
  }
  return value;
}

function string(value: Json, key: string, source: string): string {
  const found = value[key];
  if (typeof found !== 'string') {
    throw new FixtureError(source, `"${key}" must be a string`);
  }
  return found;
}

function deliveries(value: unknown, where: string, source: string): Delivery[] {
  if (!Array.isArray(value)) {
    throw new FixtureError(source, `${where} must be an array`);
  }
  return value.map((item, index) => {
    if (!isRecord(item) || typeof item['body'] !== 'string' || typeof item['redelivered'] !== 'boolean') {
      throw new FixtureError(source, `${where}[${index}] must be { body: string, redelivered: boolean }`);
    }
    return { body: item['body'], redelivered: item['redelivered'] };
  });
}

function deliveryMap(value: unknown, where: string, source: string): Record<string, Delivery[]> {
  if (!isRecord(value)) {
    throw new FixtureError(source, `${where} must be an object`);
  }
  return Object.fromEntries(
    Object.entries(value).map(([name, list]) => [name, deliveries(list, `${where}.${name}`, source)]),
  );
}

function parseObserved(kind: ScenarioKind, value: unknown, source: string): Observed {
  if (!isRecord(value)) {
    throw new FixtureError(source, '"observed" must be an object');
  }
  if (kind === 'routing') {
    const routes = value['routes'];
    if (!Array.isArray(routes)) {
      throw new FixtureError(source, '"observed.routes" must be an array');
    }
    const observed: RoutingObserved = {
      routes: routes.map((route, index) => {
        const queues = isRecord(route) ? route['queues'] : undefined;
        if (
          !isRecord(route) ||
          typeof route['body'] !== 'string' ||
          typeof route['returned'] !== 'boolean' ||
          !Array.isArray(queues) ||
          !queues.every((queue) => typeof queue === 'string')
        ) {
          throw new FixtureError(source, `observed.routes[${index}] must be { body, returned, queues: string[] }`);
        }
        return { body: route['body'], returned: route['returned'], queues: queues as string[] };
      }),
    };
    return observed;
  }
  const observed: DeliveryObserved = {
    deliveries: deliveryMap(value['deliveries'], 'observed.deliveries', source),
    ready: deliveryMap(value['ready'], 'observed.ready', source),
  };
  return observed;
}

/** Reads a fixture and checks it, including that its steps are a valid scenario of its kind. */
export function parseFixture(text: string, source: string): Fixture {
  const json = parseJson(text, source);
  const id = string(json, 'id', source);
  const kind = json['kind'];
  if (kind !== 'routing' && kind !== 'delivery') {
    throw new FixtureError(source, '"kind" must be "routing" or "delivery"');
  }
  const title = string(json, 'title', source);
  const origin = json['origin'];
  if (origin !== undefined && typeof origin !== 'string') {
    throw new FixtureError(source, '"origin" must be a string when present');
  }
  if (!Array.isArray(json['steps'])) {
    throw new FixtureError(source, '"steps" must be an array');
  }

  const fixture: Fixture = {
    id,
    kind,
    title,
    ...(origin === undefined ? {} : { origin }),
    steps: json['steps'] as Step[],
    observed: parseObserved(kind, json['observed'], source),
  };
  try {
    validateScenario(toScenario(fixture));
  } catch (error) {
    throw new FixtureError(source, (error as Error).message);
  }
  return fixture;
}

export function parseManifest(text: string, source: string): Manifest {
  const json = parseJson(text, source);
  const counts = json['counts'];
  if (!isRecord(counts) || typeof counts['routing'] !== 'number' || typeof counts['delivery'] !== 'number') {
    throw new FixtureError(source, '"counts" must be { routing: number, delivery: number }');
  }
  return {
    baseline: string(json, 'baseline', source),
    image: string(json, 'image', source),
    imageDigest: string(json, 'imageDigest', source),
    serverVersion: string(json, 'serverVersion', source),
    erlangVersion: string(json, 'erlangVersion', source),
    generatorSha: string(json, 'generatorSha', source),
    recordedAt: string(json, 'recordedAt', source),
    counts: { routing: counts['routing'], delivery: counts['delivery'] },
  };
}
