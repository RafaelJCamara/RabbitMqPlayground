import { TestBed } from '@angular/core/testing';
import { transientQueueReply } from '@rmq/engine';
import { bindingRecord, documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentStore } from './document-store';
import { NOTHING_SELECTED, SelectionStore } from './selection-store';
import { speakRefusal, StatusStore } from './status-store';

const doc = (name: string) => documentOf({ queues: { q1: queueRecord(name) } });

describe('DocumentStore', () => {
  let store: DocumentStore;
  beforeEach(() => {
    store = TestBed.runInInjectionContext(() => new DocumentStore());
  });

  it('starts with an empty canvas that has nothing to undo or redo', () => {
    expect(Object.keys(store.document().queues)).toEqual([]);
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
    expect(store.undoLabel()).toBeUndefined();
    expect(store.redoLabel()).toBeUndefined();
  });

  it('commits a change, and keeps the document before it, with what the change did, to undo', () => {
    const [a, b] = [doc('a'), doc('b')];
    store.load(a);
    store.commit(b, 'renamed queue a to b');

    expect(store.document()).toBe(b);
    expect(store.canUndo()).toBe(true);
    expect(store.undoLabel()).toBe('renamed queue a to b');
    expect(store.undo()).toEqual({ label: 'renamed queue a to b' });
    expect(store.document()).toBe(a);
    expect(store.canRedo()).toBe(true);
    expect(store.redoLabel()).toBe('renamed queue a to b');
    expect(store.redo()).toEqual({ label: 'renamed queue a to b' });
    expect(store.document()).toBe(b);
  });

  it('keeps nothing for a commit of the document that is already there', () => {
    const a = doc('a');
    store.load(a);
    store.commit(a, 'did nothing');

    expect(store.canUndo()).toBe(false);
  });

  it('has nothing to undo or redo at the start, and says so by answering nothing', () => {
    expect(store.undo()).toBeUndefined();
    expect(store.redo()).toBeUndefined();
  });

  it('opens a document without a past', () => {
    store.load(doc('a'));
    store.commit(doc('b'), 'one');
    store.undo();
    store.load(doc('c'));

    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it('tells a listener of every change, after it, and why, until the listener is dropped', () => {
    const seen: [string | undefined, string][] = [];
    const stop = store.subscribe((document, cause) => seen.push([document.queues['q1']?.name, cause]));

    store.load(doc('a'));
    store.commit(doc('b'), 'x');
    store.undo();
    store.redo();
    stop();
    store.commit(doc('c'), 'y');

    expect(seen).toEqual([
      ['a', 'load'],
      ['b', 'apply'],
      ['a', 'undo'],
      ['b', 'redo'],
    ]);
  });

  it('does not tell a listener of an undo or a redo that did nothing', () => {
    const listener = vi.fn();
    store.subscribe(listener);

    store.undo();
    store.redo();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('SelectionStore', () => {
  let selection: SelectionStore;
  beforeEach(() => {
    selection = TestBed.runInInjectionContext(() => new SelectionStore());
  });

  it('starts with nothing selected', () => {
    expect(selection.selection()).toBe(NOTHING_SELECTED);
    expect(selection.count()).toBe(0);
    expect(selection.only()).toBeUndefined();
  });

  it('holds nodes and edges, counts them, and says what the one thing is when there is one', () => {
    selection.select(['q1', 'x1'], ['x1>q1']);
    expect(selection.selection()).toEqual({ nodes: ['q1', 'x1'], edges: ['x1>q1'] });
    expect(selection.count()).toBe(3);
    expect(selection.only()).toBeUndefined();

    selection.select(['q1']);
    expect(selection.only()).toEqual({ kind: 'node', id: 'q1' });

    selection.select([], ['x1>q1']);
    expect(selection.only()).toEqual({ kind: 'edge', key: 'x1>q1' });
  });

  it('keeps the very same selection when it is told the same, so that nothing downstream is told twice', () => {
    selection.select(['q1'], ['x1>q1']);
    const before = selection.selection();

    selection.select(['q1'], ['x1>q1']);

    expect(selection.selection()).toBe(before);
  });

  it('changes when the order, the number or an id is different', () => {
    selection.select(['a', 'b']);
    const before = selection.selection();

    selection.select(['b', 'a']);
    expect(selection.selection()).not.toBe(before);
    selection.select(['b']);
    expect(selection.selection().nodes).toEqual(['b']);
    selection.select(['b'], ['a>b']);
    expect(selection.selection().edges).toEqual(['a>b']);
  });

  it('clears', () => {
    selection.select(['q1'], ['x1>q1']);
    selection.clear();

    expect(selection.selection()).toEqual({ nodes: [], edges: [] });
    expect(selection.count()).toBe(0);
  });

  it('forgets the nodes and the edges that the canvas does not have any more, and keeps the others', () => {
    const document = documentOf({
      exchanges: { x1: exchangeRecord('orders') },
      queues: { q1: queueRecord('billing') },
      bindings: { b1: bindingRecord('x1', { kind: 'queue', id: 'q1' }, 'k') },
    });
    selection.select(['x1', 'gone', 'q1'], ['x1>q1', 'x1>gone']);

    selection.prune(document);

    expect(selection.selection()).toEqual({ nodes: ['x1', 'q1'], edges: ['x1>q1'] });
  });

  it('keeps the very same selection when nothing was forgotten', () => {
    const document = documentOf({ queues: { q1: queueRecord('billing') } });
    selection.select(['q1']);
    const before = selection.selection();

    selection.prune(document);

    expect(selection.selection()).toBe(before);
  });
});

describe('StatusStore', () => {
  let status: StatusStore;
  beforeEach(() => {
    status = TestBed.runInInjectionContext(() => new StatusStore());
  });

  it('has nothing to say at the start', () => {
    expect(status.notice()).toBeNull();
    expect(status.refusal()).toBeNull();
  });

  it('says a message, and a refusal that comes after it replaces it, with the issue and where it came from', () => {
    const issue = {
      kind: 'transient-queue',
      message: 'The queue is not durable.',
      refusal: transientQueueReply(),
    } as const;

    status.say('Added queue billing.');
    expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue billing.' });
    expect(status.refusal()).toBeNull();

    status.refuse(issue, 'inspector');
    expect(status.notice()).toEqual({ kind: 'refusal', issue, origin: 'inspector' });
    expect(status.refusal()?.issue).toBe(issue);

    status.say('Undid: added queue billing.');
    expect(status.refusal()).toBeNull();
  });

  it('clears', () => {
    status.say('x');
    status.clear();

    expect(status.notice()).toBeNull();
  });

  it('clears a refusal from one origin and leaves a refusal from another, and a message, alone', () => {
    const issue = { kind: 'duplicate-name', message: 'Taken.' } as const;

    status.refuse(issue, 'inspector');
    status.clearRefusalFrom('gesture');
    expect(status.refusal()).not.toBeNull();
    status.clearRefusalFrom('inspector');
    expect(status.refusal()).toBeNull();

    status.say('Fine.');
    status.clearRefusalFrom('inspector');
    expect(status.notice()).toEqual({ kind: 'message', text: 'Fine.' });
  });
});

describe('speakRefusal', () => {
  it('says the message, and when the broker has an answer, says that after it', () => {
    expect(speakRefusal({ kind: 'duplicate-name', message: 'There is already a queue named q.' })).toBe(
      'There is already a queue named q.',
    );
    const reply = transientQueueReply();
    expect(speakRefusal({ kind: 'transient-queue', message: 'Not durable.', refusal: reply })).toBe(
      `Not durable. RabbitMQ would answer ${reply.code} ${reply.text}.`,
    );
  });
});
