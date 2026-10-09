import { TestBed } from '@angular/core/testing';
import { ID_PATTERN, validateDocument, type DocumentCommand, type RuntimeCommand } from '@rmq/domain';
import { transientQueueReply } from '@rmq/engine';
import { documentOf, exchangeRecord, producerRecord, queueRecord } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../announcer';
import { CommandBus, type Applied, type RuntimeHost, type RuntimeOutcome } from './command-bus';
import { DocumentStore } from './document-store';
import { SelectionStore } from './selection-store';
import { StatusStore } from './status-store';

const declareQueue = (name: string, durable = true): DocumentCommand => ({ type: 'declare-queue', name, durable });

describe('CommandBus', () => {
  let bus: CommandBus;
  let store: DocumentStore;
  let selection: SelectionStore;
  let status: StatusStore;
  let announcer: Announcer;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DocumentStore, SelectionStore, StatusStore, CommandBus] });
    bus = TestBed.inject(CommandBus);
    store = TestBed.inject(DocumentStore);
    selection = TestBed.inject(SelectionStore);
    status = TestBed.inject(StatusStore);
    announcer = TestBed.inject(Announcer);
    vi.spyOn(announcer, 'announce');
  });

  describe('apply', () => {
    it('applies a command to the document, with an id that is valid, and answers the document that it made', () => {
      const result = bus.apply(declareQueue('billing'), 'gesture');

      expect(result.ok).toBe(true);
      expect(Object.values(store.document().queues).map((queue) => queue.name)).toEqual(['billing']);
      expect(Object.keys(store.document().queues).every((id) => ID_PATTERN.test(id))).toBe(true);
      expect(result.ok && result.value).toBe(store.document());
      expect(validateDocument(store.document())).toEqual([]);
    });

    it('keeps the document before it to undo, and says what it did, on the status line and in the live region', () => {
      bus.apply(declareQueue('billing'), 'gesture');

      expect(store.canUndo()).toBe(true);
      expect(store.undoLabel()).toBe('added queue billing');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue billing.' });
      expect(announcer.announce).toHaveBeenCalledWith('Added queue billing.');
    });

    it('does not say what it did when it is asked not to, because the canvas has said it, and still clears what was said before', () => {
      status.say('Something old.');
      bus.apply(declareQueue('billing'), 'key', { say: false });

      expect(announcer.announce).not.toHaveBeenCalled();
      expect(status.notice()).toBeNull();
      expect(store.canUndo()).toBe(true);
    });

    it('gives each new element an id that no other has, across a long run and across kinds', () => {
      for (let index = 0; index < 20; index += 1) {
        bus.apply(declareQueue(`q${index}`), 'gesture');
        bus.apply({ type: 'add-producer', name: `p${index}` }, 'gesture');
      }

      const ids = [...Object.keys(store.document().queues), ...Object.keys(store.document().producers)];
      expect(new Set(ids).size).toBe(40);
    });

    it('refuses a command that is wrong, changes nothing, keeps no step, and tells the learner the root cause, with the broker’s reply', () => {
      const before = store.document();
      const result = bus.apply(declareQueue('billing', false), 'inspector');

      expect(!result.ok && result.error.kind).toBe('transient-queue');
      expect(store.document()).toBe(before);
      expect(store.canUndo()).toBe(false);
      expect(status.refusal()).toMatchObject({
        origin: 'inspector',
        issue: { kind: 'transient-queue', refusal: transientQueueReply() },
      });
      expect(announcer.announce).toHaveBeenCalledWith(
        expect.stringContaining(`RabbitMQ would answer ${transientQueueReply().code}`),
        'assertive',
      );
      const [spoken] = vi.mocked(announcer.announce).mock.calls[0] ?? [''];
      expect(spoken.indexOf('not durable')).toBeLessThan(spoken.indexOf('RabbitMQ would answer'));
    });

    it('keeps no step and says nothing for a command that changes nothing, and answers the same document', () => {
      bus.apply(declareQueue('billing'), 'gesture');
      vi.mocked(announcer.announce).mockClear();
      const before = store.document();
      const depth = store.undoLabel();
      const result = bus.apply(
        { type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'billing' },
        'inspector',
      );

      expect(result.ok && result.value).toBe(before);
      expect(store.document()).toBe(before);
      expect(store.undoLabel()).toBe(depth);
      expect(announcer.announce).not.toHaveBeenCalled();
    });

    it('forgets what is selected when the command takes it away', () => {
      bus.apply(declareQueue('billing'), 'gesture');
      const id = Object.keys(store.document().queues)[0] ?? '';
      selection.select([id]);

      bus.apply({ type: 'delete', target: { kind: 'queue', name: 'billing' } }, 'key');

      expect(selection.selection().nodes).toEqual([]);
    });

    it('tells a listener of each command that was accepted and changed the canvas, with its origin and both documents', () => {
      const applied: Applied[] = [];
      bus.onApplied((entry) => applied.push(entry));
      const before = store.document();

      const command = declareQueue('billing');
      bus.apply(command, 'gesture');
      bus.apply(declareQueue('billing'), 'key'); // refused: the name is taken
      bus.apply({ type: 'rename', target: { kind: 'queue', name: 'billing' }, name: 'billing' }, 'inspector'); // changes nothing

      expect(applied).toHaveLength(1);
      expect(applied[0]).toEqual({ command, origin: 'gesture', before, after: store.document() });
    });

    it('does not spend an id on a command that is refused, so that what is made next has the id that a replay of the accepted commands makes', () => {
      const refusedBatch: DocumentCommand = {
        type: 'batch',
        commands: [
          declareQueue('made-then-refused'),
          { type: 'add-producer', name: 'sender' },
          { type: 'add-producer', name: 'sender' },
        ],
      };

      const result = bus.apply(refusedBatch, 'gesture');
      bus.apply(declareQueue('billing'), 'gesture');

      expect(result.ok).toBe(false);
      expect(Object.keys(store.document().queues)).toEqual(['q1']);
    });

    it('stops telling a listener that has been dropped', () => {
      const listener = vi.fn();
      const stop = bus.onApplied(listener);
      stop();

      bus.apply(declareQueue('billing'), 'gesture');

      expect(listener).not.toHaveBeenCalled();
    });

    it('is one step of undo for a batch, which is how drag-to-create is made', () => {
      bus.apply(
        {
          type: 'batch',
          commands: [
            declareQueue('billing'),
            { type: 'move', target: { kind: 'queue', name: 'billing' }, x: 90, y: 60 },
          ],
        },
        'gesture',
      );

      expect(store.undoLabel()).toBe('added queue billing');
      bus.undo('toolbar');
      expect(Object.keys(store.document().queues)).toEqual([]);
    });
  });

  describe('run', () => {
    /** A simulation that does what the spec says, and says what it was asked. */
    function host(outcome: RuntimeOutcome = { changed: true, said: 'Paused.' }) {
      const asked: RuntimeCommand[] = [];
      const stand: RuntimeHost = {
        execute: (command) => {
          asked.push(command);
          return outcome;
        },
        takeLost: () => 0,
      };
      return { asked, stand };
    }
    const pause: RuntimeCommand = { type: 'pause' };

    beforeEach(() => {
      store.load(
        documentOf({
          exchanges: { E: exchangeRecord('orders', 'direct', { internal: true }) },
          queues: { Q: queueRecord('billing') },
          producers: { P: producerRecord('sender'), L: producerRecord('linked', { kind: 'queue', id: 'Q' }) },
        }),
      );
      vi.mocked(announcer.announce).mockClear();
    });

    it('refuses, saying why, when there is no simulation to run it', () => {
      const result = bus.run(pause, 'key');

      expect(!result.ok && result.error.kind).toBe('unsupported');
      // The whole sentence, since it is what a learner reads: the cause, and what follows from it.
      expect(!result.ok && result.error.message).toBe(
        'There is no simulation on this canvas, so there is nothing to run.',
      );
      expect(status.refusal()).toMatchObject({ origin: 'key' });
      expect(announcer.announce).toHaveBeenCalledWith(
        expect.stringContaining('There is no simulation on this canvas, so there is nothing to run.'),
        'assertive',
      );
    });

    it('hands the command to the simulation, and says what it did, on the status line and aloud', () => {
      const { asked, stand } = host({ changed: true, said: 'Playing at 2×.' });
      bus.attach(stand);

      const result = bus.run({ type: 'play' }, 'toolbar');

      expect(asked).toEqual([{ type: 'play' }]);
      expect(result).toEqual({ ok: true, value: { changed: true, said: 'Playing at 2×.' } });
      expect(status.notice()).toEqual({ kind: 'message', text: 'Playing at 2×.' });
      expect(announcer.announce).toHaveBeenCalledWith('Playing at 2×.');
    });

    it('tells a listener of a command that changed the simulation, with its origin, and the canvas that was the same before and after', () => {
      const applied: Applied[] = [];
      bus.onApplied((entry) => applied.push(entry));
      bus.attach(host().stand);
      const document = store.document();

      bus.run(pause, 'key');

      expect(applied).toEqual([{ command: pause, origin: 'key', before: document, after: document }]);
    });

    it('does not tell a listener of one that changed nothing, which is still said, so that a key that did nothing is not silent', () => {
      const applied: Applied[] = [];
      bus.onApplied((entry) => applied.push(entry));
      bus.attach(host({ changed: false, said: 'It is paused already.' }).stand);

      const result = bus.run(pause, 'key');

      expect(result.ok && result.value.changed).toBe(false);
      expect(applied).toEqual([]);
      expect(status.notice()).toEqual({ kind: 'message', text: 'It is paused already.' });
    });

    it('does not say what it did when it is asked not to, and clears what was said before', () => {
      status.say('Something old.');
      bus.attach(host().stand);

      bus.run(pause, 'key', { say: false });

      expect(status.notice()).toBeNull();
      expect(announcer.announce).not.toHaveBeenCalled();
    });

    it('refuses what the canvas cannot do, saying the root cause first, and does not ask the simulation', () => {
      const { asked, stand } = host();
      bus.attach(stand);

      const nobody = bus.run({ type: 'publish', from: { kind: 'producer', name: 'nobody' } }, 'typed');
      const alone = bus.run({ type: 'publish', from: { kind: 'producer', name: 'sender' } }, 'typed');
      const internal = bus.run({ type: 'publish', from: { kind: 'exchange', name: 'orders' } }, 'typed');

      expect(!nobody.ok && nobody.error.kind).toBe('missing-element');
      expect(!alone.ok && alone.error.kind).toBe('not-linked');
      expect(!internal.ok && internal.error.kind).toBe('internal-exchange');
      expect(status.refusal()).toMatchObject({ origin: 'typed', issue: { kind: 'internal-exchange' } });
      expect(asked).toEqual([]);
    });

    it('lets the producer that is linked publish', () => {
      const { asked, stand } = host();
      bus.attach(stand);

      expect(bus.run({ type: 'publish', from: { kind: 'producer', name: 'linked' } }, 'key').ok).toBe(true);
      expect(asked).toHaveLength(1);
    });

    it('stops handing commands to a simulation that was detached, and keeps the one that took its place', () => {
      const first = host();
      const second = host();
      const detachFirst = bus.attach(first.stand);
      bus.attach(second.stand);

      detachFirst();
      bus.run(pause, 'key');

      expect(first.asked).toEqual([]);
      expect(second.asked).toEqual([pause]);
    });

    it('refuses again when the simulation that it had is detached', () => {
      const detach = bus.attach(host().stand);

      detach();

      expect(bus.run(pause, 'key').ok).toBe(false);
    });
  });

  describe('what a change of the canvas costs the simulation', () => {
    const lostOf = (count: number): RuntimeHost => ({
      execute: () => ({ changed: false, said: '' }),
      takeLost: () => count,
    });

    it('is told after what was done, in words, for one message and for several', () => {
      bus.attach(lostOf(1));
      bus.apply(declareQueue('one'), 'gesture');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue one. 1 message was lost.' });

      bus.attach(lostOf(5));
      bus.apply(declareQueue('five'), 'gesture');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue five. 5 messages were lost.' });
    });

    it('is told after an undo and after a redo as well', () => {
      bus.apply(declareQueue('billing'), 'gesture');
      bus.attach(lostOf(2));

      bus.undo('toolbar');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Undid: added queue billing. 2 messages were lost.' });
      bus.redo('toolbar');
      expect(status.notice()).toEqual({ kind: 'message', text: 'Redid: added queue billing. 2 messages were lost.' });
    });

    it('is told on its own when the canvas has said what was done already, and is not told when nothing was lost', () => {
      bus.attach(lostOf(3));
      bus.apply(declareQueue('billing'), 'key', { say: false });
      expect(status.notice()).toEqual({ kind: 'message', text: '3 messages were lost.' });

      bus.attach(lostOf(0));
      bus.apply(declareQueue('archive'), 'key', { say: false });
      expect(status.notice()).toBeNull();
    });

    it('says nothing of it when there is nothing to undo, since nothing was lost by it', () => {
      bus.attach(lostOf(4));

      bus.undo('toolbar');

      expect(status.notice()).toEqual({ kind: 'message', text: 'Nothing to undo.' });
    });
  });

  describe('refuse and say', () => {
    it('tells a refusal that no command made, such as a link that a rule forbids, as a command that is refused is told', () => {
      bus.refuse({ kind: 'invalid-link', message: 'Consumers subscribe to queues, not exchanges.' }, 'gesture');

      expect(status.refusal()).toMatchObject({
        origin: 'gesture',
        issue: { kind: 'invalid-link', message: 'Consumers subscribe to queues, not exchanges.' },
      });
      expect(announcer.announce).toHaveBeenCalledWith('Consumers subscribe to queues, not exchanges.', 'assertive');
      expect(store.canUndo()).toBe(false);
    });

    it('says something that was done, or not done, on the status line and aloud', () => {
      bus.say('Link cancelled.');

      expect(status.notice()).toEqual({ kind: 'message', text: 'Link cancelled.' });
      expect(announcer.announce).toHaveBeenCalledWith('Link cancelled.');
    });
  });

  describe('undo and redo', () => {
    it('take back and bring back the last change, and say what they did', () => {
      bus.apply(declareQueue('billing'), 'gesture');

      expect(bus.undo('toolbar')).toBe(true);
      expect(Object.keys(store.document().queues)).toEqual([]);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Undid: added queue billing.' });
      expect(announcer.announce).toHaveBeenLastCalledWith('Undid: added queue billing.');

      expect(bus.redo('toolbar')).toBe(true);
      expect(Object.values(store.document().queues).map((queue) => queue.name)).toEqual(['billing']);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Redid: added queue billing.' });
    });

    it('tell a listener, as a command is told, with what was used and the two documents, and say nothing when there was nothing to take back', () => {
      const applied: Applied[] = [];
      bus.onApplied((entry) => applied.push(entry));
      bus.undo('key');
      bus.apply(declareQueue('billing'), 'gesture');
      const withQueue = store.document();

      bus.undo('toolbar');
      const without = store.document();
      bus.redo('typed');
      bus.redo('typed');

      expect(applied.slice(1)).toEqual([
        { command: { type: 'undo' }, origin: 'toolbar', before: withQueue, after: without },
        { command: { type: 'redo' }, origin: 'typed', before: without, after: withQueue },
      ]);
    });

    it('say that there is nothing to undo or redo, and answer false', () => {
      expect(bus.undo('toolbar')).toBe(false);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Nothing to undo.' });
      expect(bus.redo('toolbar')).toBe(false);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Nothing to redo.' });
    });

    it('give back the very document from before, for every change that is accepted', () => {
      const original = store.document();
      bus.apply(declareQueue('a'), 'gesture');
      const afterA = store.document();
      bus.apply({ type: 'add-producer', name: 'sender' }, 'gesture');
      const afterB = store.document();

      bus.undo('toolbar');
      expect(store.document()).toBe(afterA);
      bus.undo('toolbar');
      expect(store.document()).toBe(original);
      bus.redo('toolbar');
      bus.redo('toolbar');
      expect(store.document()).toBe(afterB);
    });

    it('forget what is selected when the undo takes it away', () => {
      bus.apply(declareQueue('billing'), 'gesture');
      selection.select([Object.keys(store.document().queues)[0] ?? '']);

      bus.undo('toolbar');

      expect(selection.selection().nodes).toEqual([]);
    });

    it('never make an id again, so that redo cannot meet a new element that has the id that it brings back', () => {
      bus.apply(declareQueue('first'), 'gesture');
      const firstId = Object.keys(store.document().queues)[0];
      bus.undo('toolbar');
      bus.apply(declareQueue('second'), 'gesture');

      expect(Object.keys(store.document().queues)).not.toContain(firstId);
    });
  });

  describe('load', () => {
    it('opens a document without a past, and forgets what was selected and said', () => {
      bus.apply(declareQueue('old'), 'gesture');
      selection.select(['q1']);
      const document = documentOf({
        exchanges: { x9: exchangeRecord('orders') },
        queues: { q9: queueRecord('billing') },
        producers: { p9: producerRecord('sender') },
      });

      bus.load(document);

      expect(store.document()).toBe(document);
      expect(store.canUndo()).toBe(false);
      expect(selection.selection().nodes).toEqual([]);
      expect(status.notice()).toBeNull();
    });

    it('keeps the selection of what the opened document has, and drops the rest', () => {
      selection.select(['q9', 'gone']);

      bus.load(documentOf({ queues: { q9: queueRecord('billing') } }));

      expect(selection.selection().nodes).toEqual(['q9']);
    });

    it('does not make an id that the opened document has, whatever file it came from', () => {
      bus.load(documentOf({ queues: { q1: queueRecord('a'), q2: queueRecord('b') } }));

      bus.apply(declareQueue('c'), 'gesture');

      expect(Object.keys(store.document().queues).sort()).toEqual(['q1', 'q2', 'q3']);
    });
  });
});
