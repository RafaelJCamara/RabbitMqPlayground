import { explainQueue, explainRoute, explanationHeader, explanationText } from '@rmq/domain';
import { join } from 'node:path';
import type { Fixture } from '../conformance/fixtures';
import { publishesOf, type Publish, type Recorded } from './replay';

/**
 * The golden files of the explanation (ADR-0060): for every routing fixture that RabbitMQ 4.3 recorded, what a learner is told about each of its publishes, written by the function that the app renders
 * from (`explainRoute`, `explainQueue` and `explanationText` of the domain), with what the broker recorded for the publish beside it. A golden file is read as a diff, and it is never regenerated to
 * make a failure go away: a difference is either a change of wording that is meant, which is regenerated in the commit that makes it, or a bug.
 */

/**
 * How many publishes of a fixture are written in full. The rest are written as their four lines (how it was published, the outcome, the queues that were reached and the summary), because the
 * explanation of each is the same function on the same topology, and the spec holds all of them to the broker. A fixture that is a table of every case (83 patterns against 39 keys) would
 * otherwise be two megabytes of text.
 */
export const FULL_PUBLISHES = 8;

/** Where the golden files are, below `web/fixtures/explain/`. */
export const BASELINE = '4.3';

/** The path of the golden file of a fixture, below `root`: `routing/<name>` is `<root>/4.3/routing/<name>.txt`. */
export const goldenFile = (root: string, fixtureId: string): string => join(root, BASELINE, `${fixtureId}.txt`);

/** What the broker recorded, in one line: the queues that got a copy, that none did, or its refusal. */
export function brokerLine(recorded: Recorded): string {
  if (recorded.kind === 'refused') {
    return `broker: refused ${recorded.code} ${recorded.text}`;
  }
  if (recorded.queues.length === 0) {
    return recorded.returned ? 'broker: returned, no queue got it' : 'broker: reached nothing';
  }
  return `broker: reached ${[...new Set(recorded.queues)].sort().join(', ')}`;
}

/** The explanation of one publish: the message and the queues of the topology that it met, as the learner would read them. */
export function publishText(publish: Publish): string {
  const { message, topology } = publish;
  return explanationText(
    explainRoute(topology, message),
    topology.queues.map((queue) => explainQueue(topology, message, queue)),
  );
}

/** What a golden file says of a publish: in full, or, past the first few, its four lines. */
export function goldenText(publish: Publish): string {
  return publish.number <= FULL_PUBLISHES
    ? publishText(publish).trimEnd()
    : explanationHeader(explainRoute(publish.topology, publish.message)).join('\n');
}

export function renderGolden(fixture: Fixture): string {
  const lines = [
    `# ${fixture.id}`,
    `# ${fixture.title}`,
    '#',
    '# What a learner is told about each publish of this scenario, as `explanationText` writes it (ADR-0060).',
    '# The lines that start `broker:` are what RabbitMQ 4.3 recorded. A golden file is never regenerated to make a failure go away.',
    `# The first ${FULL_PUBLISHES} publishes are written in full, and the others as their four lines: the spec holds all of them to the broker.`,
  ];
  for (const publish of publishesOf(fixture)) {
    lines.push(
      '',
      `## publish ${publish.number} of ${publish.of}: ${JSON.stringify(publish.body)} (step ${publish.step})`,
      brokerLine(publish.recorded),
      goldenText(publish),
    );
  }
  return `${lines.join('\n')}\n`;
}
