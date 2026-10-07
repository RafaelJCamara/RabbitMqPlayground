import {
  createEnvironmentInjector,
  EnvironmentInjector,
  type EnvironmentProviders,
  type Provider,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { allowedTargets, edgeKeys, elements, type CanvasDocument, type Id } from '@rmq/domain';
import type { EngineEvent } from '@rmq/engine';
import { configureFastCheck, manualFrames } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CommandRunner } from '../command-bar/runner';
import { nextSteps } from '../command-bar/suggestions';
import { FlowViewport } from '../canvas/model/flow-viewport';
import type { CanvasIntent, LinkVia } from '../canvas/model/intents';
import { Announcer } from '../core/announcer';
import { FeatureFlags, FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { rebindCommand, unbindCommand } from '../core/state/binding-commands';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { EditorActions } from './actions';
import { IntentHandler } from './intents';
import { LinkFlow } from './link-flow';
import { NewNodeFocus } from './new-node-focus';
import { TOOLBOX } from './toolbox';

/**
 * The exit criterion of S5 (ADR-0046): gestures and typed commands are interchangeable, which is that every logged equivalent command, typed again, makes the same document. This is the
 * property that holds it for whatever the app can do: a sequence of what a learner does, played through the services that the editor is made of (the intents of the canvas, the
 * one function that links, the commands of the inspector, the actions of the top bar and the lines of the command bar), is logged, and the log is run through the function that
 * the bar uses in an editor that begins empty. The two documents are equal, ids and places included, and the replayed lines are the logged lines, which is what makes a log copyable.
 *
 * It holds the simulation too (ADR-0054): what is done to it, with a key, a button, the inspector or a line, is in the log, and a log that is typed again makes the same simulation,
 * which is that the same seed and the same commands say the same events, in the same order, and the engine ends with the same view. The clock only moves by `step`, which a line can say.
 *
 * It runs in the hook and in CI with the seed and the number of runs of the libraries (FC_SEED, FC_NUM_RUNS: 100), and in the nightly job at 5,000 with a seed of its own.
 */

// The app has no Node typings, and the properties here run as many times as the libraries' do, with the same seed.
configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

/** The keys that a link is given: ones that every kind of exchange takes, one that only a topic exchange refuses, and one that is refused by length. */
const KEYS = ['', 'a', 'order.created', 'order.*', '#', 'a.#', '#.#.#', 'two words', 'quote"d', 'k=v', 'x'.repeat(300)];
const NAMES = ['orders', 'billing', 'archive', 'my queue', 'exchange2', 'a;b', 'amq.mine', '', 'sender', 'x->y'];

type Origin = 'gesture' | 'key' | 'menu' | 'toolbar' | 'inspector';

/** What the learner does. Each number picks among what the canvas has at that moment, so that most actions are about something that is there. */
type Action =
  | {
      readonly kind: 'add';
      readonly item: number;
      readonly at: { x: number; y: number } | null;
      readonly origin: Origin;
    }
  | { readonly kind: 'link'; readonly from: number; readonly to: number; readonly via: LinkVia; readonly key: number }
  | { readonly kind: 'link-invalid'; readonly from: number; readonly to: number; readonly via: LinkVia }
  | { readonly kind: 'picker'; readonly from: number; readonly choice: number; readonly key: number }
  | {
      readonly kind: 'link-new';
      readonly from: number;
      readonly node: number;
      readonly at: { x: number; y: number };
      readonly key: number;
    }
  | { readonly kind: 'rename'; readonly node: number; readonly name: number; readonly origin: Origin }
  | {
      readonly kind: 'move';
      readonly node: number;
      readonly x: number;
      readonly y: number;
      readonly by: 'pointer' | 'keyboard';
    }
  | { readonly kind: 'delete-node'; readonly node: number; readonly by: 'pointer' | 'keyboard' }
  | { readonly kind: 'delete-edge'; readonly edge: number; readonly by: 'pointer' | 'keyboard' }
  | { readonly kind: 'rekey'; readonly binding: number; readonly key: number }
  | { readonly kind: 'unbind'; readonly binding: number }
  | { readonly kind: 'move-label'; readonly edge: number; readonly at: number }
  | { readonly kind: 'default-exchange'; readonly on: boolean }
  | { readonly kind: 'set'; readonly node: number; readonly value: number }
  | { readonly kind: 'layout' }
  | { readonly kind: 'publish'; readonly producer: number; readonly origin: 'key' | 'toolbar' | 'inspector' }
  | { readonly kind: 'publish-to'; readonly exchange: number; readonly key: number }
  | { readonly kind: 'purge'; readonly queue: number }
  | { readonly kind: 'step'; readonly origin: 'key' | 'toolbar' }
  | { readonly kind: 'toggle'; readonly origin: 'key' | 'toolbar' }
  | { readonly kind: 'speed'; readonly choice: number }
  | { readonly kind: 'clear-messages' }
  | { readonly kind: 'reset-counters' }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'typed'; readonly step: number };

const index = fc.nat({ max: 20 });
const via = fc.constantFrom<LinkVia>('drag', 'click', 'keyboard');
const origin = fc.constantFrom<Origin>('gesture', 'key', 'menu', 'toolbar', 'inspector');
const by = fc.constantFrom<'pointer' | 'keyboard'>('pointer', 'keyboard');
const point = fc.record({ x: fc.integer({ min: -2_000, max: 2_000 }), y: fc.integer({ min: -2_000, max: 2_000 }) });

const arbAction: fc.Arbitrary<Action> = fc.oneof(
  {
    weight: 10,
    arbitrary: fc.record({
      kind: fc.constant('add' as const),
      item: index,
      at: fc.option(point, { nil: null }),
      origin,
    }),
  },
  { weight: 12, arbitrary: fc.record({ kind: fc.constant('link' as const), from: index, to: index, via, key: index }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('link-invalid' as const), from: index, to: index, via }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('picker' as const), from: index, choice: index, key: index }) },
  {
    weight: 6,
    arbitrary: fc.record({ kind: fc.constant('link-new' as const), from: index, node: index, at: point, key: index }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('rename' as const), node: index, name: index, origin }) },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('move' as const),
      node: index,
      x: fc.integer({ min: -3_000, max: 3_000 }),
      y: fc.integer({ min: -3_000, max: 3_000 }),
      by,
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('delete-node' as const), node: index, by }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('delete-edge' as const), edge: index, by }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('rekey' as const), binding: index, key: index }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('unbind' as const), binding: index }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('move-label' as const),
      edge: index,
      at: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('default-exchange' as const), on: fc.boolean() }) },
  {
    weight: 1,
    arbitrary: fc.record({ kind: fc.constant('set' as const), node: index, value: fc.nat({ max: 5_000 }) }),
  },
  { weight: 1, arbitrary: fc.constant({ kind: 'layout' as const }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('publish' as const),
      producer: index,
      origin: fc.constantFrom<'key' | 'toolbar' | 'inspector'>('key', 'toolbar', 'inspector'),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('publish-to' as const), exchange: index, key: index }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('purge' as const), queue: index }) },
  {
    weight: 10,
    arbitrary: fc.record({
      kind: fc.constant('step' as const),
      origin: fc.constantFrom<'key' | 'toolbar'>('key', 'toolbar'),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant('toggle' as const),
      origin: fc.constantFrom<'key' | 'toolbar'>('key', 'toolbar'),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('speed' as const), choice: index }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'clear-messages' as const }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'reset-counters' as const }) },
  { weight: 3, arbitrary: fc.constant({ kind: 'undo' as const }) },
  { weight: 2, arbitrary: fc.constant({ kind: 'redo' as const }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('typed' as const), step: index }) },
);

const arbSession = fc.array(arbAction, { minLength: 8, maxLength: 60 });

const QUIET = { announce: () => undefined, last: () => '', useSink: () => () => undefined } as unknown as Announcer;

const SERVICES: (Provider | EnvironmentProviders)[] = [
  DocumentStore,
  SelectionStore,
  StatusStore,
  CommandBus,
  CommandLog,
  FlowViewport,
  NewNodeFocus,
  LinkFlow,
  IntentHandler,
  EditorActions,
  CommandRunner,
  ...RUNTIME_SERVICES,
  // The flags are the root's unless an injector has its own, and the editor that is made here is one that has the simulation.
  FeatureFlags,
  { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation' } },
  // No frame ever runs, so that the clock moves only by `step`, which a line can say.
  { provide: FRAME_SOURCE, useValue: manualFrames() },
  { provide: Announcer, useValue: QUIET },
];

/** The keys that a message to an exchange is given: one that a direct exchange may match, and one that nothing does. */
const MESSAGE_KEYS = ['', 'a', 'order.created', 'x'];
const SPEEDS = [0.25, 0.5, 1, 2, 4];

/** The editor, without a canvas to draw: the services that make it, and a surface that answers what the learner would be asked from the numbers of the action. */
function editor() {
  const injector = createEnvironmentInjector(SERVICES, TestBed.inject(EnvironmentInjector));
  const answers = { key: 0, choice: 0, node: 0 };
  const links = injector.get(LinkFlow);
  links.surface = {
    askKey: (ask) => {
      // A key that is refused keeps the popover open, and the learner who does not know a better one gives up.
      if (!ask.submit(KEYS[answers.key % KEYS.length] as string).ok) {
        ask.cancel();
      }
    },
    askTarget: (ask) => {
      const option = ask.options[answers.choice % Math.max(1, ask.options.length)];
      if (option === undefined) {
        ask.cancel();
      } else {
        ask.choose(option.id);
      }
    },
    askNew: (ask) => {
      const node = ask.nodes[answers.node % Math.max(1, ask.nodes.length)];
      if (node === undefined) {
        ask.cancel();
      } else {
        ask.choose(node);
      }
    },
  };
  const intents = injector.get(IntentHandler);
  intents.surface = { openMenu: () => undefined, startRename: () => undefined, showPeek: () => undefined };
  const simulation = injector.get(Simulation);
  const heard: EngineEvent[] = [];
  simulation.onEvents((events) => heard.push(...events));
  return {
    simulation,
    heard,
    injector,
    answers,
    links,
    intents,
    actions: injector.get(EditorActions),
    bus: injector.get(CommandBus),
    store: injector.get(DocumentStore),
    log: injector.get(CommandLog),
    runner: injector.get(CommandRunner),
  };
}

type Editor = ReturnType<typeof editor>;

const pick = <T>(items: readonly T[], at: number): T | undefined =>
  items.length === 0 ? undefined : items[at % items.length];
const nodeIds = (document: CanvasDocument): Id[] => elements(document).map(({ id }) => id);

/** Every pair of nodes that the rules let a link join, from the one that a message leaves to the one that it goes to. */
const allowedPairs = (document: CanvasDocument): [Id, Id][] =>
  nodeIds(document).flatMap((source) => allowedTargets(document, source).map((target): [Id, Id] => [source, target]));

/** Does one thing of what a learner does, to what the canvas has now. What it did not find to do it to, it does not do. */
function play(e: Editor, action: Action): void {
  const document = e.store.document();
  const nodes = nodeIds(document);
  const node = (at: number) => pick(nodes, at);
  switch (action.kind) {
    case 'add': {
      const item = pick(TOOLBOX, action.item) as (typeof TOOLBOX)[number];
      e.intents.add(item.node, action.origin === 'menu' ? 'menu' : 'gesture', action.at ?? undefined);
      return;
    }
    case 'link': {
      e.answers.key = action.key;
      const pair = pick(allowedPairs(document), action.from * 21 + action.to);
      if (pair !== undefined) {
        e.intents.handle({ type: 'link', source: pair[0], target: pair[1], via: action.via });
      }
      return;
    }
    case 'link-invalid': {
      const [source, target] = [node(action.from), node(action.to)];
      if (source !== undefined && target !== undefined) {
        e.intents.handle({ type: 'link-invalid', source, target, via: action.via });
      }
      return;
    }
    case 'picker': {
      e.answers.key = action.key;
      e.answers.choice = action.choice;
      const source = pick(allowedPairs(document), action.from)?.[0];
      if (source !== undefined) {
        e.links.openPicker(source, 'menu');
      }
      return;
    }
    case 'link-new': {
      e.answers.key = action.key;
      e.answers.node = action.node;
      const source = node(action.from);
      if (source !== undefined) {
        e.intents.handle({ type: 'link-to-empty', source, at: action.at, client: action.at, via: 'drag' });
      }
      return;
    }
    case 'rename': {
      const id = node(action.node);
      if (id !== undefined) {
        e.intents.rename(id, NAMES[action.name % NAMES.length] as string, action.origin);
      }
      return;
    }
    case 'move': {
      const id = node(action.node);
      if (id !== undefined) {
        e.intents.handle({ type: 'move', moves: [{ id, x: action.x, y: action.y }], by: action.by });
      }
      return;
    }
    case 'delete-node': {
      const id = node(action.node);
      if (id !== undefined) {
        e.intents.handle({ type: 'delete', nodes: [id], edges: [], by: action.by });
      }
      return;
    }
    case 'delete-edge': {
      const key = pick([...edgeKeys(document)], action.edge);
      if (key !== undefined) {
        e.intents.handle({ type: 'delete', nodes: [], edges: [key], by: action.by });
      }
      return;
    }
    case 'rekey': {
      const row = pick(Object.keys(document.bindings), action.binding);
      const command =
        row === undefined ? undefined : rebindCommand(document, row, KEYS[action.key % KEYS.length] as string);
      if (command !== undefined) {
        e.bus.apply(command, 'inspector');
      }
      return;
    }
    case 'unbind': {
      const id = pick(Object.keys(document.bindings), action.binding);
      const command = id === undefined ? undefined : unbindCommand(document, id);
      if (command !== undefined) {
        e.bus.apply(command, 'inspector');
      }
      return;
    }
    case 'move-label': {
      const key = pick([...edgeKeys(document)], action.edge);
      if (key !== undefined) {
        const intent: CanvasIntent = { type: 'move-label', key, at: action.at };
        e.intents.handle(intent);
      }
      return;
    }
    case 'default-exchange':
      e.actions.setDefaultExchange(action.on);
      return;
    case 'set': {
      const id = node(action.node);
      const found = elements(document).find((element) => element.id === id);
      if (found?.kind === 'producer') {
        e.bus.apply(
          { type: 'set', kind: 'producer', name: found.name, changes: { burst: 1 + (action.value % 50) } },
          'inspector',
        );
      } else if (found?.kind === 'consumer') {
        e.bus.apply(
          { type: 'set', kind: 'consumer', name: found.name, changes: { prefetch: action.value } },
          'inspector',
        );
      } else if (found?.kind === 'exchange') {
        e.bus.apply(
          { type: 'set', kind: 'exchange', name: found.name, changes: { durable: action.value % 2 === 0 } },
          'inspector',
        );
      } else {
        e.bus.apply({ type: 'set', kind: 'canvas', changes: { seed: action.value } }, 'inspector');
      }
      return;
    }
    case 'layout':
      e.actions.layout();
      return;
    case 'publish': {
      const found = pick(
        elements(document).filter(({ kind }) => kind === 'producer'),
        action.producer,
      );
      if (found !== undefined) {
        e.bus.run({ type: 'publish', from: { kind: 'producer', name: found.name } }, action.origin);
      }
      return;
    }
    case 'publish-to': {
      const found = pick(
        elements(document).filter(({ kind }) => kind === 'exchange'),
        action.exchange,
      );
      if (found !== undefined) {
        e.bus.run(
          {
            type: 'publish',
            from: { kind: 'exchange', name: found.name },
            key: MESSAGE_KEYS[action.key % MESSAGE_KEYS.length] as string,
          },
          'inspector',
        );
      }
      return;
    }
    case 'purge': {
      const found = pick(
        elements(document).filter(({ kind }) => kind === 'queue'),
        action.queue,
      );
      if (found !== undefined) {
        e.bus.run({ type: 'purge', queue: found.name }, 'inspector');
      }
      return;
    }
    case 'step':
      e.actions.step(action.origin);
      return;
    case 'toggle':
      e.actions.togglePlay(action.origin);
      return;
    case 'speed':
      e.bus.run({ type: 'speed', factor: SPEEDS[action.choice % SPEEDS.length] as number }, 'toolbar');
      return;
    case 'clear-messages':
      e.bus.run({ type: 'clear-messages' }, 'toolbar');
      return;
    case 'reset-counters':
      e.bus.run({ type: 'reset-counters' }, 'toolbar');
      return;
    case 'undo':
      e.actions.undo('toolbar');
      return;
    case 'redo':
      e.actions.redo('toolbar');
      return;
    case 'typed': {
      const lines = [
        ...nextSteps(document),
        'undo',
        'redo',
        'layout',
        'set canvas default-exchange=true',
        'set canvas seed=7',
        'step',
        'pause',
        'play',
        'speed 2',
        'clear messages',
        'reset counters',
        ...elements(document)
          .filter(({ kind }) => kind === 'producer')
          .map(({ name }) => `publish ${name.includes(' ') ? `"${name}"` : name}`),
      ];
      e.runner.run(pick(lines, action.step) as string);
      return;
    }
  }
}

describe('a session replayed from its log (ADR-0046)', () => {
  it('makes the document that the session made, ids and places included, from the lines that the log has, for whatever the app can do', () => {
    fc.assert(
      fc.property(arbSession, (session) => {
        const first = editor();
        const second = editor();
        try {
          for (const action of session) {
            play(first, action);
          }
          const lines = first.log.entries().map(({ text }) => text);
          const made = first.store.document();

          for (const line of lines) {
            const outcome = second.runner.run(line);
            expect(
              outcome.kind === 'applied' ||
                (outcome.kind === 'undone' && outcome.done) ||
                (outcome.kind === 'redone' && outcome.done),
              `the line ${line} was not taken: ${JSON.stringify(outcome)}`,
            ).toBe(true);
          }

          expect(second.store.document()).toEqual(made);
          expect(second.log.entries().map(({ text }) => text)).toEqual(lines);
          // The simulation too: the same commands say the same events, in the same order, and leave the same engine.
          expect(second.heard).toEqual(first.heard);
          expect(second.simulation.view()).toEqual(first.simulation.view());
          expect(second.simulation.running()).toBe(first.simulation.running());
          expect(second.simulation.speed()).toBe(first.simulation.speed());
        } finally {
          first.injector.destroy();
          second.injector.destroy();
        }
      }),
    );
  }, 600_000);

  it('has sessions in which the simulation has something to do: messages are sent, routed and kept, and the commands that did it are in the log', () => {
    const said = new Set<string>();
    const logged = new Set<string>();
    for (const session of fc.sample(arbSession, { numRuns: 300, seed: 11 })) {
      const e = editor();
      try {
        for (const action of session) {
          play(e, action);
        }
        e.heard.forEach(({ type }) => said.add(type));
        e.log.entries().forEach(({ text }) => logged.add(text.split(' ')[0] as string));
      } finally {
        e.injector.destroy();
      }
    }

    expect([...said]).toEqual(expect.arrayContaining(['published', 'routed', 'enqueued']));
    expect([...logged]).toEqual(expect.arrayContaining(['publish', 'step', 'pause', 'play', 'speed', 'reset']));
  });

  it('replays a purge, which a random session seldom gets to: a queue that has messages ready, and a line that takes them', () => {
    const first = editor();
    const second = editor();
    try {
      for (const line of [
        'declare exchange orders type=direct',
        'declare queue billing',
        'bind orders -> billing key=new',
        'pause',
        'publish orders key=new payload=one',
        'publish orders key=new payload=two',
        'step',
        'step',
        'step',
        'step',
      ]) {
        expect(first.runner.run(line), line).toEqual({ kind: 'applied' });
      }
      expect(first.simulation.view().queues['billing']).toMatchObject({ ready: 2 });
      play(first, { kind: 'purge', queue: 0 });
      expect(first.simulation.view().queues['billing']).toMatchObject({ ready: 0 });

      const lines = first.log.entries().map(({ text }) => text);
      for (const line of lines) {
        expect(second.runner.run(line), line).toEqual({ kind: 'applied' });
      }

      expect(lines.at(-1)).toBe('purge billing');
      expect(second.heard).toEqual(first.heard);
      expect(second.heard.some(({ type }) => type === 'queue.purged')).toBe(true);
      expect(second.simulation.view()).toEqual(first.simulation.view());
    } finally {
      first.injector.destroy();
      second.injector.destroy();
    }
  });

  it('logs nothing for a session that changed nothing, and leaves the canvas that it began with', () => {
    const e = editor();
    try {
      play(e, { kind: 'undo' });
      play(e, { kind: 'redo' });
      play(e, { kind: 'link', from: 0, to: 1, via: 'drag', key: 0 });
      play(e, { kind: 'delete-node', node: 0, by: 'keyboard' });

      expect(e.log.entries()).toEqual([]);
    } finally {
      e.injector.destroy();
    }
  });
});
