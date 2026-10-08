import type { Command } from '../commands/types';
import type { CommandSpec } from './spec';
import { bind, unbind } from './specs/bind';
import { addConsumer, addProducer, declareExchange, declareQueue } from './specs/declare';
import { link, subscribe, unlink, unsubscribe } from './specs/links';
import { helpSpec } from './specs/help';
import { clear, deleteElement, layout, move, moveLabel, redo, rename, undo } from './specs/place';
import { clearMessages, pause, play, publish, purge, resetCounters, speed, step } from './specs/runtime';
import { set, unset } from './specs/set';
import { share } from './specs/share';

/** `help` answers with the names of every command, which are these. */
const help = helpSpec(() => SPECS.map(({ name }) => name));

/**
 * Every command of the command bar (ADR-0011). It is one list, and the parser, the formatter, the completer, `help` and
 * `docs/commands.md` all read it, so a command that is added here is typed, logged, completed and documented, and one
 * that is not here is none of those.
 */
export const SPECS: readonly CommandSpec[] = [
  declareExchange,
  declareQueue,
  addProducer,
  addConsumer,
  bind,
  unbind,
  link,
  unlink,
  subscribe,
  unsubscribe,
  set,
  unset,
  move,
  moveLabel,
  rename,
  deleteElement,
  clear,
  layout,
  publish,
  purge,
  play,
  pause,
  step,
  speed,
  clearMessages,
  resetCounters,
  undo,
  redo,
  help,
  share,
];

/** The commands by what they are called, which is one word or two. */
const BY_NAME = new Map(SPECS.map((spec) => [spec.name, spec]));
const BY_TYPE = new Map<string, CommandSpec>(SPECS.map((spec) => [spec.type, spec]));

/** The words of a command's name: `['declare', 'exchange']`. */
export const nameWords = (spec: CommandSpec): string[] => spec.name.split(' ');

/**
 * The command that these words start with, and how many of them are its name: two words if they are the name of a command
 * (`declare exchange`), and one if the first is (`move`), so `move label` is found before `move`.
 */
export function matchSpec(
  words: readonly string[],
): { readonly spec: CommandSpec; readonly count: number } | undefined {
  const [first, second] = words;
  const two = second === undefined ? undefined : BY_NAME.get(`${first} ${second}`);
  if (two !== undefined) {
    return { spec: two, count: 2 };
  }
  const one = first === undefined ? undefined : BY_NAME.get(first);
  return one === undefined ? undefined : { spec: one, count: 1 };
}

/** The spec of a command that is not a batch, which is not typed as a command of its own. */
export function specFor(type: Exclude<Command['type'], 'batch'>): CommandSpec {
  return BY_TYPE.get(type) as CommandSpec;
}
