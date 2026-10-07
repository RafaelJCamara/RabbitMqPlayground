import type { TopicMiss, TopicSegment } from '@rmq/engine';
import type {
  BindingDetail,
  BindingNode,
  ExchangeNode,
  QueueExplanation,
  ReasonNode,
  RoutedExplanation,
  RouteExplanation,
} from './types';
import { exchangeText, keyText, quoted, valueText } from './words';

/**
 * The explanation as lines of text (ADR-0060): deterministic, with `\n`, and readable in a diff. It is what a golden file holds, and a template draws the same data with marks and a table. It is written with
 * explicit stacks and not by recursion, so that a chain of exchanges as long as a canvas may hold is as safe as a short one.
 */

const MATCHED = '✓';
const MISSED = '✗';
const INDENT = '  ';

/** The word of a cell: an empty word is two quotes, so that it is seen. */
const cellWord = (word: string): string => (word === '' ? '""' : word);

function cellOf(segment: TopicSegment): { top: string; bottom: string } {
  const took = segment.words.length === 0 ? '-' : segment.words.map(cellWord).join('.');
  const mark = segment.outcome === 'matched' ? MATCHED : MISSED;
  return { top: cellWord(segment.pattern), bottom: `${took} ${mark}` };
}

/** A topic binding laid out word by word, the pattern on one line and the key words that each word took under it, with a mark for each. */
export function alignmentLines(segments: readonly TopicSegment[], key: readonly string[], miss?: TopicMiss): string[] {
  const cells = segments.map(cellOf);
  if (miss?.kind === 'key-has-extra-words') {
    for (const word of key.slice(miss.keyIndex)) {
      cells.push({ top: '-', bottom: `${cellWord(word)} ${MISSED}` });
    }
  }
  const widths = cells.map(({ top, bottom }) => Math.max([...top].length, [...bottom].length));
  const row = (label: string, pick: (cell: { top: string; bottom: string }) => string): string =>
    `${label}${cells.map((cell, index) => pick(cell).padEnd(widths[index] as number)).join(' | ')}`.trimEnd();
  return [row('pattern  ', ({ top }) => top), row('key      ', ({ bottom }) => bottom)];
}

function detailLines(detail: BindingDetail): string[] {
  switch (detail.kind) {
    case 'topic':
      return alignmentLines(detail.segments, detail.key, detail.miss);
    case 'headers':
      return detail.conditions.map(
        ({ outcome, text }) => `${outcome === 'pass' ? MATCHED : outcome === 'fail' ? MISSED : '-'} ${text}`,
      );
    default:
      return [];
  }
}

function bindingHeader(binding: BindingNode): string {
  const mark = binding.verdict === 'matched' ? MATCHED : MISSED;
  return `${mark} ${exchangeText(binding.from)} -> ${binding.to.kind} ${binding.to.name} (${binding.label}) [${binding.short}]`;
}

type Step =
  | { readonly kind: 'exchange'; readonly node: ExchangeNode; readonly depth: number }
  | { readonly kind: 'binding'; readonly node: BindingNode; readonly depth: number };

/** The tree of a route: each exchange that the message reached with the bindings that it tried, and under a binding the exchange that it took the message to. */
function treeLines(root: ExchangeNode): string[] {
  const lines: string[] = [];
  const stack: Step[] = [{ kind: 'exchange', node: root, depth: 0 }];
  for (let step = stack.pop(); step !== undefined; step = stack.pop()) {
    const pad = INDENT.repeat(step.depth);
    if (step.kind === 'exchange') {
      lines.push(
        `${pad}${step.node.type === 'default' ? 'the default exchange' : `exchange ${step.node.name} (${step.node.type})`}: ${step.node.text}`,
      );
      for (const binding of [...step.node.bindings].reverse()) {
        stack.push({ kind: 'binding', node: binding, depth: step.depth + 1 });
      }
    } else {
      lines.push(`${pad}${bindingHeader(step.node)}`);
      lines.push(`${pad}${INDENT}${step.node.text}`);
      for (const line of detailLines(step.node.detail)) {
        lines.push(`${pad}${INDENT}${line}`);
      }
      if (step.node.next !== null) {
        stack.push({ kind: 'exchange', node: step.node.next, depth: step.depth + 1 });
      }
    }
  }
  return lines;
}

/** The reasons that a queue did not get a message, nested as they were found. */
function reasonLines(reasons: readonly ReasonNode[], depth: number): string[] {
  const lines: string[] = [];
  const stack: { reason: ReasonNode; depth: number }[] = [...reasons].reverse().map((reason) => ({ reason, depth }));
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const pad = INDENT.repeat(item.depth);
    lines.push(`${pad}- ${item.reason.text}`);
    if (item.reason.kind === 'binding-did-not-match') {
      for (const line of detailLines(item.reason.binding.detail)) {
        lines.push(`${pad}${INDENT}${line}`);
      }
    } else if (item.reason.kind === 'exchange-not-reached') {
      for (const inner of [...item.reason.because].reverse()) {
        stack.push({ reason: inner, depth: item.depth + 1 });
      }
    }
  }
  return lines;
}

function queueLines(explanation: QueueExplanation): string[] {
  if (explanation.reached) {
    return [
      `queue ${explanation.queue}: reached`,
      ...explanation.path.flatMap((binding) => [
        `${INDENT}${bindingHeader(binding)}`,
        ...detailLines(binding.detail).map((line) => `${INDENT}${INDENT}${line}`),
      ]),
    ];
  }
  return [
    `queue ${explanation.queue}: not reached`,
    `${INDENT}${explanation.text}`,
    ...reasonLines(explanation.because, 1),
  ];
}

const isRouted = (explanation: RouteExplanation): explanation is RoutedExplanation =>
  explanation.outcome === 'routed' || explanation.outcome === 'unroutable';

/** The message as it is published, in one line. */
function messageLine(explanation: RouteExplanation): string {
  const { message } = explanation;
  const headers = message.headers.map(({ key, value }) => `${key}=${valueText(value)}`);
  return `message: published to ${message.exchange === '' ? 'the default exchange' : quoted(message.exchange)} with key ${keyText(message.key)}${headers.length === 0 ? '' : `, headers ${headers.join(' ')}`}`;
}

/**
 * The explanation of a message, and of the queues that it is asked about, as text. The lines that start `outcome:` and `reached:` are for a reader that checks the words against the broker, which is what
 * `tools/explain` does with the fixtures that RabbitMQ recorded.
 */
export function explanationText(explanation: RouteExplanation, queues: readonly QueueExplanation[] = []): string {
  const routed = isRouted(explanation);
  const lines = [
    messageLine(explanation),
    `outcome: ${explanation.outcome}`,
    `reached: ${routed && explanation.queues.length > 0 ? explanation.queues.join(', ') : 'nothing'}`,
    `summary: ${routed ? explanation.summary : explanation.text}`,
  ];
  if (routed) {
    lines.push('', ...treeLines(explanation.root));
  }
  for (const queue of queues) {
    lines.push('', ...queueLines(queue));
  }
  return `${lines.join('\n')}\n`;
}
