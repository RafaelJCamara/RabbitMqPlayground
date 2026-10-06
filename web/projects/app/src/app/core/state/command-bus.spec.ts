import { TestBed } from '@angular/core/testing';
import { ID_PATTERN, validateDocument, type DocumentCommand } from '@rmq/domain';
import { transientQueueReply } from '@rmq/engine';
import { documentOf, exchangeRecord, producerRecord, queueRecord } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Announcer } from '../announcer';
import { CommandBus, type Applied } from './command-bus';
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
        commands: [declareQueue('made-then-refused'), declareQueue('made-then-refused')],
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
