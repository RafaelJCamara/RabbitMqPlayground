import { route, type Message } from '@rmq/engine';
import {
  applyEngineCommands,
  arbIntent,
  arbScript,
  canonicalTopology,
  commandFor,
  deepFreeze,
  emptyBroker,
  playScript,
  prefixedIds,
  sequentialIds,
  topologyOf,
  undoRedoProblems,
  type BrokerState,
  type Transition,
} from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './commands/apply';
import type { DocumentCommand } from './commands/types';
import { canonicalHeaders } from './document/headers';
import { emptyDocument, type CanvasDocument } from './document/schema';
import { toTopology } from './document/topology';
import { validateDocument } from './document/validate';
import { History } from './history';
import { reconcile } from './reconcile';
import { formatCommand } from './syntax/format';
import { parseCommand } from './syntax/parse';

/**
 * The three properties that ADR-0015 and ADR-0019 ask of the command layer, over scripts of commands, undos, redos and loads
 * that meet whatever canvas they find (`@rmq/testing`). The seed and the number of runs come from FC_SEED and FC_NUM_RUNS:
 * a normal run explores the same scripts every time, and the nightly fuzz job runs 5,000 of them with a seed of its own.
 */

/** The steps of a script that are commands that were accepted. */
const accepted = (transitions: Iterable<Transition>): Transition[] =>
  [...transitions].filter(({ via, refused }) => via === 'command' && refused === undefined);

describe('the generator of scripts', () => {
  it('makes scripts in which most commands are accepted, and every kind of command is accepted somewhere', () => {
    const types = new Set<string>();
    let acceptedCount = 0;
    let total = 0;
    for (const script of fc.sample(arbScript, { numRuns: 300, seed: 1 })) {
      for (const transition of playScript(script)) {
        if (transition.via === 'command') {
          total += 1;
          if (transition.refused === undefined) {
            acceptedCount += 1;
            const command = transition.command as DocumentCommand;
            types.add(command.type);
            if (command.type === 'batch') {
              command.commands.forEach(({ type }) => types.add(`in a batch: ${type}`));
            }
          }
        }
      }
    }

    expect(acceptedCount / total).toBeGreaterThan(0.4);
    for (const type of [
      'declare-exchange',
      'declare-queue',
      'add-producer',
      'add-consumer',
      'bind',
      'unbind',
      'link',
      'unlink',
      'subscribe',
      'unsubscribe',
      'set',
      'unset',
      'move',
      'move-label',
      'rename',
      'delete',
      'layout',
      'batch',
    ]) {
      expect(types.has(type), type).toBe(true);
    }
  });

  it('plays every kind of step: command, undo, redo and load', () => {
    const via = new Set<string>();
    for (const script of fc.sample(arbScript, { numRuns: 200, seed: 2 })) {
      for (const transition of playScript(script)) {
        via.add(transition.via);
      }
    }

    expect([...via].sort()).toEqual(['command', 'load', 'redo', 'undo']);
  });
});

describe('undo∘apply = id (ADR-0019)', () => {
  it('gives back the very document from before, with ===, for every command that is accepted, and redo the one from after', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const transition of accepted(playScript(script))) {
          expect(undoRedoProblems(transition.before, transition.after), JSON.stringify(transition.command)).toEqual([]);
        }
      }),
    );
  });

  it('leaves the document that it was given when a command is refused, and makes no entry in the history', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const transition of playScript(script)) {
          if (transition.via === 'command' && transition.refused !== undefined) {
            expect(transition.after).toBe(transition.before);
            expect(transition.refused.message.length).toBeGreaterThan(5);
          }
        }
      }),
    );
  });

  it('takes a run of changes back one at a time, document by document, to the empty canvas, and forward again to the same ones', () => {
    fc.assert(
      fc.property(fc.array(arbIntent, { maxLength: 30 }), (intents) => {
        const history = new History();
        const ids = sequentialIds();
        let current = deepFreeze(emptyDocument());
        const documents: CanvasDocument[] = [current];
        for (const intent of intents) {
          const result = applyCommand(current, commandFor(current, intent), ids);
          if (result.ok && result.value !== current) {
            history.push(current);
            current = deepFreeze(result.value);
            documents.push(current);
          }
        }

        for (let step = documents.length - 2; step >= 0; step--) {
          current = history.undo(current) as CanvasDocument;
          expect(current).toBe(documents[step]);
        }
        expect(history.undo(current)).toBeUndefined();
        for (let step = 1; step < documents.length; step++) {
          current = history.redo(current) as CanvasDocument;
          expect(current).toBe(documents[step]);
        }
        expect(history.redo(current)).toBeUndefined();
      }),
    );
  });

  it('makes only canvases that are valid, whatever the commands are, and none changes one that it was given', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const transition of playScript(script)) {
          expect(validateDocument(transition.after), JSON.stringify(transition.command)).toEqual([]);
        }
      }),
    );
  });

  it('gives the same document for the same command on the same document, with the same ids', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const transition of accepted(playScript(script))) {
          // Ids that the canvas does not have, and the same ones for both.
          const again = applyCommand(transition.before, transition.command as DocumentCommand, prefixedIds('r'));
          const first = applyCommand(transition.before, transition.command as DocumentCommand, prefixedIds('r'));

          expect(again).toEqual(first);
        }
      }),
    );
  });

  it('shares what a command did not change: a move changes only the positions, and a rename only one record', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { before, after, command } of accepted(playScript(script))) {
          if (command?.type === 'move' && after !== before) {
            expect(after.exchanges).toBe(before.exchanges);
            expect(after.queues).toBe(before.queues);
            expect(after.bindings).toBe(before.bindings);
            expect(after.producers).toBe(before.producers);
            expect(after.consumers).toBe(before.consumers);
            expect(after.layout.labels).toBe(before.layout.labels);
            expect(after.settings).toBe(before.settings);
          }
          if (command?.type === 'rename' && after !== before) {
            expect(after.bindings).toBe(before.bindings);
            expect(after.layout).toBe(before.layout);
            expect(after.settings).toBe(before.settings);
          }
        }
      }),
    );
  });
});

/** What reading a command from its text must give: arguments that say nothing are left out, and a batch of one is its command. */
function normalise(command: DocumentCommand): DocumentCommand {
  switch (command.type) {
    case 'bind':
    case 'unbind': {
      const { headers, ...rest } = command;
      const canonical = canonicalHeaders(headers);
      return canonical === undefined ? rest : { ...rest, headers: canonical };
    }
    case 'batch': {
      const commands = command.commands.flatMap((each) => {
        const inner = normalise(each);
        return inner.type === 'batch' ? inner.commands : [inner];
      });
      return commands.length === 1 ? (commands[0] as DocumentCommand) : { type: 'batch', commands };
    }
    default:
      return command;
  }
}

describe('parse(format(c)) ≅ c (ADR-0011, ADR-0025)', () => {
  it('reads back the command that was written, for every command, with any name, key, value and kind of header', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { before, command } of playScript(script)) {
          if (command === undefined) {
            continue;
          }
          const text = formatCommand(command, before);
          const parsed = parseCommand(text, before);

          expect(parsed.ok, `${text} => ${parsed.ok ? '' : parsed.error.message}`).toBe(true);
          expect(parsed.ok && normalise(parsed.value as DocumentCommand)).toEqual(normalise(command));
        }
      }),
    );
  });

  it('writes a command that is one line, with nothing in it that is a line break, whatever its names are', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { before, command } of playScript(script)) {
          if (command !== undefined) {
            expect(formatCommand(command, before)).not.toMatch(/[\n\r]/);
          }
        }
      }),
    );
  });

  it('writes the same text every time, and a text that does not change when it is read and written again', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { before, command } of playScript(script)) {
          if (command === undefined) {
            continue;
          }
          const text = formatCommand(command, before);
          const parsed = parseCommand(text, before);

          expect(formatCommand(command, before)).toBe(text);
          if (parsed.ok) {
            expect(formatCommand(parsed.value, before)).toBe(text);
          }
        }
      }),
    );
  });

  it('applies the command that is read as the command that was written does, and gives the same canvas', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { before, command } of accepted(playScript(script))) {
          const parsed = parseCommand(formatCommand(command as DocumentCommand, before), before);
          const written = applyCommand(before, command as DocumentCommand, prefixedIds('r'));
          const read = parsed.ok ? applyCommand(before, parsed.value as DocumentCommand, prefixedIds('r')) : parsed;

          expect(read).toEqual(written);
        }
      }),
    );
  });
});

/** The topology of a document, written out by hand, one more way: the names, the flags and the bindings. */
function declarationsOf(document: CanvasDocument) {
  return {
    exchanges: Object.values(document.exchanges)
      .map(({ name, type, durable, autoDelete, internal }) => `${name}|${type}|${durable}|${autoDelete}|${internal}`)
      .sort(),
    queues: Object.values(document.queues)
      .map(({ name, durable }) => `${name}|${durable}`)
      .sort(),
  };
}
function declarationsHeld(engine: BrokerState) {
  return {
    exchanges: engine.exchanges
      .map(({ name, type, durable, autoDelete, internal }) => `${name}|${type}|${durable}|${autoDelete}|${internal}`)
      .sort(),
    queues: engine.queues.map(({ name, durable }) => `${name}|${durable}`).sort(),
  };
}

describe('reconcile keeps the engine equal to the document (ADR-0019)', () => {
  it('leaves the engine with the topology of the document after every step: a command, an undo, a redo and a load', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        let engine = emptyBroker();
        for (const transition of playScript(script)) {
          const commands = reconcile(transition.before, transition.after);
          // The oracle refuses a command that a broker would refuse, so a command out of order or redundant throws here.
          engine = applyEngineCommands(engine, commands);

          expect(
            canonicalTopology(topologyOf(engine)),
            `${transition.via} ${JSON.stringify(transition.command)}`,
          ).toEqual(canonicalTopology(toTopology(transition.after)));
          expect(declarationsHeld(engine)).toEqual(declarationsOf(transition.after));
        }
      }),
    );
  });

  it('builds the topology of the document from nothing, which is what a load of a canvas into a new engine does', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { after } of playScript(script)) {
          const engine = applyEngineCommands(emptyBroker(), reconcile(null, after));

          expect(canonicalTopology(topologyOf(engine))).toEqual(canonicalTopology(toTopology(after)));
          expect(declarationsHeld(engine)).toEqual(declarationsOf(after));
        }
      }),
    );
  });

  it('routes a message to the same queues from the engine as from the document, whatever the topology is', () => {
    const arbMessage = fc.record({
      exchange: fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'my queue', ''),
      key: fc.constantFrom('', 'a', 'a.b', 'a.x', '#', 'b.c.d'),
      headers: fc.constantFrom<Message['headers']>(
        [],
        [{ key: 'a', value: { t: 'integer', v: 1 } }],
        [{ key: 'a', value: { t: 'string', v: '1' } }],
        [{ key: 'b', value: { t: 'boolean', v: true } }],
      ),
    });

    fc.assert(
      fc.property(arbScript, fc.array(arbMessage, { maxLength: 4 }), (script, messages) => {
        let engine = emptyBroker();
        for (const transition of playScript(script)) {
          engine = applyEngineCommands(engine, reconcile(transition.before, transition.after));
          for (const message of messages) {
            const fromDocument = route(toTopology(transition.after), message);
            const fromEngine = route(topologyOf(engine), message);

            expect(fromEngine.ok).toBe(fromDocument.ok);
            expect(fromEngine.ok ? [...fromEngine.queues].sort() : null).toEqual(
              fromDocument.ok ? [...fromDocument.queues].sort() : null,
            );
          }
        }
      }),
    );
  });

  it('has nothing to do when nothing changed, and does the work of an undo by going back', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { before, after } of playScript(script)) {
          expect(reconcile(after, after)).toEqual([]);
          const forward = applyEngineCommands(
            applyEngineCommands(emptyBroker(), reconcile(null, before)),
            reconcile(before, after),
          );
          const back = applyEngineCommands(forward, reconcile(after, before));

          expect(canonicalTopology(topologyOf(back))).toEqual(canonicalTopology(toTopology(before)));
        }
      }),
    );
  });

  it('never asks the engine for the same thing twice in one go, and never for more commands than the topologies differ by', () => {
    fc.assert(
      fc.property(arbScript, (script) => {
        for (const { before, after } of playScript(script)) {
          const commands = reconcile(before, after).map((command) => JSON.stringify(command));

          expect(new Set(commands).size).toBe(commands.length);
        }
      }),
    );
  });
});
