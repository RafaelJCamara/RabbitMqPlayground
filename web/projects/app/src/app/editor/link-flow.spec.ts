import { TestBed } from '@angular/core/testing';
import { NODE_SIZE, type CanvasDocument } from '@rmq/domain';
import { documentOf, exchangeRecord, producerRecord, queueRecord, sampleDocument } from '@rmq/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { CommandBus, type Applied } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { LinkFlow, type CreateAsk, type KeyAsk, type LinkSurface, type TargetAsk } from './link-flow';
import { NewNodeFocus } from './new-node-focus';

/** What the editor would show, written down: the last of each thing that `LinkFlow` asked it to show. */
class FakeSurface implements LinkSurface {
  key: KeyAsk | undefined;
  target: TargetAsk | undefined;
  create: CreateAsk | undefined;
  askKey(ask: KeyAsk): void {
    this.key = ask;
  }
  askTarget(ask: TargetAsk): void {
    this.target = ask;
  }
  askNew(ask: CreateAsk): void {
    this.create = ask;
  }
}

describe('LinkFlow (ADR-0041, ADR-0042)', () => {
  let flow: LinkFlow;
  let store: DocumentStore;
  let bus: CommandBus;
  let status: StatusStore;
  let selection: SelectionStore;
  let announcer: Announcer;
  let surface: FakeSurface;
  let applied: Applied[];

  const start = (document: CanvasDocument = sampleDocument()): void => store.load(document);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, FlowViewport, NewNodeFocus, LinkFlow],
    });
    flow = TestBed.inject(LinkFlow);
    store = TestBed.inject(DocumentStore);
    bus = TestBed.inject(CommandBus);
    status = TestBed.inject(StatusStore);
    selection = TestBed.inject(SelectionStore);
    announcer = TestBed.inject(Announcer);
    vi.spyOn(announcer, 'announce');
    surface = new FakeSurface();
    flow.surface = surface;
    applied = [];
    bus.onApplied((change) => applied.push(change));
    start();
  });

  describe('request: the one function that every way to link ends in', () => {
    it('subscribes at once, with the origin that the caller gives, which is how the log says what the learner used', () => {
      flow.request('Q2', 'C1', 'key');

      expect(store.document().consumers['C1']?.queues).toEqual(['Q1', 'Q2']);
      expect(applied.map(({ origin, command }) => [origin, command.type])).toEqual([['key', 'subscribe']]);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Subscribed consumer worker to queue archive.' });
    });

    it('links a producer to an exchange or to a queue at once', () => {
      flow.request('P1', 'E2', 'gesture');
      expect(store.document().producers['P1']?.target).toEqual({ kind: 'exchange', id: 'E2' });

      flow.request('P1', 'Q2', 'menu');
      expect(store.document().producers['P1']?.target).toEqual({ kind: 'queue', id: 'Q2' });
      expect(applied.map(({ origin }) => origin)).toEqual(['gesture', 'menu']);
    });

    it('binds at once from an exchange that ignores the key, with no key, and from a headers exchange, with no conditions', () => {
      flow.request('E3', 'Q2', 'gesture');
      flow.request('E2', 'Q1', 'gesture');

      expect(surface.key).toBeUndefined();
      const bindings = Object.values(store.document().bindings);
      expect(bindings.find(({ source, dest }) => source === 'E3' && dest.id === 'Q2')?.key).toBe('');
      expect(bindings.find(({ source, dest }) => source === 'E2' && dest.id === 'Q1')).toBeDefined();
    });

    it('asks for the key first when the exchange is a topic or a direct one, and makes nothing until the key is given', () => {
      flow.request('E1', 'Q2', 'gesture');

      expect(applied).toEqual([]);
      expect(surface.key).toMatchObject({
        title: 'Binding key from exchange orders to queue archive',
        exchangeType: 'topic',
      });
      expect(surface.key?.help).toContain('* matches one word');
      const bindings = Object.keys(store.document().bindings);
      expect(bindings).toHaveLength(3);
    });

    it('says what the key of a direct exchange has to be', () => {
      start(
        documentOf({
          exchanges: { x: exchangeRecord('d', 'direct') },
          queues: { q: queueRecord('billing') },
        }),
      );

      flow.request('x', 'q', 'gesture');

      expect(surface.key?.help).toBe('A message is routed to this queue when its routing key is exactly this key.');
    });

    it('binds with the key that is given, as one command, and the equivalent of what a learner would type', () => {
      flow.request('E1', 'Q2', 'gesture');

      const result = surface.key?.submit('order.archive');

      expect(result?.ok).toBe(true);
      expect(applied).toHaveLength(1);
      expect(applied[0]).toMatchObject({
        origin: 'gesture',
        command: {
          type: 'bind',
          source: 'orders',
          destination: { kind: 'queue', name: 'archive' },
          key: 'order.archive',
        },
      });
    });

    it('binds with an empty key when the field is empty, which is a key', () => {
      flow.request('E1', 'Q2', 'gesture');

      surface.key?.submit('');

      expect(applied[0]?.command).toMatchObject({ type: 'bind', key: '' });
    });

    it('answers a key that is refused with the refusal, and changes nothing, so that the popover stays open with the reason', () => {
      flow.request('E1', 'Q2', 'gesture');

      const result = surface.key?.submit('#.#.#');

      expect(result?.ok).toBe(false);
      expect(!result?.ok && result?.error.kind).toBe('topic-wildcards');
      expect(store.canUndo()).toBe(false);
      expect(status.refusal()?.issue.refusal).toMatchObject({ code: 406 });
    });

    it('says that it was given up when the popover is, and makes nothing', () => {
      flow.request('E1', 'Q2', 'key');

      surface.key?.cancel();

      expect(applied).toEqual([]);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Link cancelled.' });
      expect(announcer.announce).toHaveBeenCalledWith('Link cancelled.');
    });

    it('says that a binding is there already, because binding it again would change nothing and be silent', () => {
      flow.request('E1', 'Q1', 'gesture');
      surface.key?.submit('order.*');

      expect(applied).toEqual([]);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Already bound with that key.' });
    });

    it('says that a producer publishes there already, and that a consumer consumes from there already', () => {
      flow.request('P1', 'E1', 'gesture');
      expect(status.notice()).toEqual({ kind: 'message', text: 'That producer already publishes there.' });

      flow.request('Q1', 'C1', 'gesture');
      expect(status.notice()).toEqual({ kind: 'message', text: 'That consumer already consumes from that queue.' });
    });

    it('refuses a link that the rules do not allow, in the words of the rule, and makes nothing', () => {
      flow.request('E1', 'C1', 'gesture');

      expect(status.refusal()).toMatchObject({
        origin: 'gesture',
        issue: {
          kind: 'invalid-link',
          message:
            'Consumers subscribe to queues, not exchanges. Bind the exchange to a queue, and subscribe the consumer to it.',
        },
      });
      expect(announcer.announce).toHaveBeenCalledWith(
        expect.stringContaining('Consumers subscribe to queues'),
        'assertive',
      );
      expect(applied).toEqual([]);
      expect(surface.key).toBeUndefined();
    });

    it('refuses a link to an internal exchange from a producer, which the rules do not allow', () => {
      flow.request('P1', 'E3', 'gesture');

      expect(status.refusal()?.issue.message).toContain('internal');
    });

    it('binds at once, with no key, when there is nobody to ask', () => {
      flow.surface = undefined;

      flow.request('E1', 'Q2', 'gesture');

      expect(applied.map(({ command }) => command)).toEqual([
        { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'archive' }, key: '' },
      ]);
    });

    it('is one step of undo for the binding, with its key', () => {
      flow.request('E1', 'Q2', 'gesture');
      surface.key?.submit('order.archive');

      expect(store.undoLabel()).toBe('bound exchange orders to queue archive');
      bus.undo('toolbar');
      expect(Object.keys(store.document().bindings)).toEqual(['B1', 'B2', 'B3']);
    });
  });

  describe('explainInvalid', () => {
    it('says why in the words of the rule', () => {
      flow.explainInvalid('E1', 'P1', 'gesture');

      expect(status.refusal()?.issue.message).toBe(
        'Nothing is bound to a producer: a producer publishes, and does not receive.',
      );
    });

    it('has its own sentence for a drop on the default exchange, which is not a node of the document', () => {
      flow.explainInvalid('P1', '~default', 'gesture');

      expect(status.refusal()?.issue.message).toContain('Nothing is linked to the default exchange');
      expect(status.refusal()?.issue.message).toContain('Link the producer to the queue itself');
    });

    it('says nothing when the link would be allowed after all, because the rules changed since the drop', () => {
      flow.explainInvalid('P1', 'E1', 'gesture');

      expect(status.refusal()).toBeNull();
    });
  });

  describe('openPicker', () => {
    it('lists the nodes that the rules allow, with what the link would do, and not the others', () => {
      flow.openPicker('P1', 'inspector');

      expect(surface.target?.title).toBe('Link producer sender to…');
      expect(surface.target?.options.map(({ name }) => name)).toEqual(['orders', 'docs', 'billing', 'archive']);
      expect(surface.target?.options[2]).toMatchObject({
        id: 'Q1',
        kind: 'queue',
        summary: "Publishes from producer 'sender' to queue 'billing', through the default exchange.",
      });
      expect(surface.target?.reason).toBeNull();
    });

    it('lists an exchange for the exchanges and the queues that it may be bound to, itself included', () => {
      flow.openPicker('E1', 'menu');

      expect(surface.target?.options.map(({ name }) => name)).toEqual([
        'orders',
        'docs',
        'hidden',
        'billing',
        'archive',
      ]);
    });

    it('makes the link, with the origin of the one who opened it, when something is chosen', () => {
      flow.openPicker('Q2', 'menu');

      surface.target?.choose('C1');

      expect(applied.map(({ origin, command }) => [origin, command.type])).toEqual([['menu', 'subscribe']]);
    });

    it('goes through the popover for a binding that has a key, as every way does', () => {
      flow.openPicker('E1', 'inspector');

      surface.target?.choose('Q2');

      expect(surface.key?.title).toBe('Binding key from exchange orders to queue archive');
      expect(applied).toEqual([]);
    });

    it('says why there is nothing to choose, when there is nothing, in the words of what is needed', () => {
      start(documentOf({ producers: { p: producerRecord('lonely') } }));
      flow.openPicker('p', 'inspector');
      expect(surface.target?.options).toEqual([]);
      expect(surface.target?.reason).toBe('Add an exchange or a queue first: a producer publishes to one of them.');

      start(documentOf({ exchanges: { x: exchangeRecord('a', 'fanout') } }));
      flow.openPicker('x', 'inspector');
      expect(surface.target?.options.map(({ name }) => name)).toEqual(['a']);

      start(documentOf({ queues: { q: queueRecord('q') } }));
      flow.openPicker('q', 'inspector');
      expect(surface.target?.reason).toBe('Add a consumer first: a queue is consumed by consumers.');

      start(documentOf({ consumers: { c: { ...sampleDocument().consumers['C1']!, queues: [] } } }));
      flow.openPicker('c', 'inspector');
      expect(surface.target?.reason).toContain('A consumer is where a message ends');
    });

    it('says that it was given up, and does nothing for a node that is not on the canvas', () => {
      flow.openPicker('P1', 'inspector');
      surface.target?.cancel();
      expect(status.notice()).toEqual({ kind: 'message', text: 'Link cancelled.' });

      surface.target = undefined;
      flow.openPicker('gone', 'inspector');
      expect(surface.target).toBeUndefined();
    });
  });

  describe('a drop on nothing (ADR-0042)', () => {
    it('opens a menu at the point where the link was let go, of the nodes that could be made and linked', () => {
      flow.dropOnNothing('Q1', { x: 400, y: 300 }, { x: 640, y: 480 }, 'gesture');

      expect(surface.create).toMatchObject({
        title: 'Create and link from queue billing',
        client: { x: 640, y: 480 },
      });
      expect(surface.create?.nodes).toEqual([{ kind: 'consumer' }]);
    });

    it('says why nothing can be made, in the words of the rule, when there is nothing to offer', () => {
      flow.dropOnNothing('C1', { x: 0, y: 0 }, { x: 1, y: 1 }, 'gesture');

      expect(surface.create).toBeUndefined();
      expect(status.refusal()?.issue.message).toContain('A consumer is where a message ends');
    });

    it('makes the node and the link as one batch, where the link was let go, with its middle there, and selects the node', () => {
      flow.dropOnNothing('Q1', { x: 400, y: 300 }, { x: 640, y: 480 }, 'gesture');

      surface.create?.choose({ kind: 'consumer' });

      expect(applied).toHaveLength(1);
      expect(applied[0]?.command.type).toBe('batch');
      const consumer = Object.entries(store.document().consumers).find(([, { name }]) => name === 'consumer1');
      expect(consumer?.[1].queues).toEqual(['Q1']);
      expect(store.document().layout.nodes[consumer?.[0] ?? '']).toEqual({ x: 330, y: 272 });
      expect(selection.selection().nodes).toEqual([consumer?.[0]]);
    });

    it('is one step of undo, whose words say both things', () => {
      flow.dropOnNothing('Q1', { x: 400, y: 300 }, { x: 640, y: 480 }, 'gesture');
      surface.create?.choose({ kind: 'consumer' });

      expect(store.undoLabel()).toBe('added consumer consumer1 and subscribed consumer consumer1 to queue billing');
      bus.undo('toolbar');
      expect(store.document().consumers['c1']).toBeUndefined();
      expect(Object.keys(store.document().consumers)).toEqual(['C1']);
    });

    it('asks for the key before it makes anything when the link is a binding with a key, and makes the whole batch with it', () => {
      flow.dropOnNothing('E1', { x: 100, y: 100 }, { x: 10, y: 10 }, 'gesture');
      surface.create?.choose({ kind: 'queue' });

      expect(applied).toEqual([]);
      expect(surface.key?.title).toBe('Binding key from exchange orders to queue queue1');

      const result = surface.key?.submit('order.new');

      expect(result?.ok).toBe(true);
      expect(applied).toHaveLength(1);
      const queue = Object.values(store.document().queues).find(({ name }) => name === 'queue1');
      expect(queue).toBeDefined();
      expect(Object.values(store.document().bindings).some(({ key }) => key === 'order.new')).toBe(true);
    });

    it('puts the popover of the key where the new node will be, with its middle at the point, and not by another node', () => {
      TestBed.inject(FlowViewport).attach({
        transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 2 }),
        host: () => ({ x: 10, y: 20, width: 800, height: 600 }),
        fit: () => undefined,
        zoomIn: () => undefined,
        zoomOut: () => undefined,
        resetZoom: () => undefined,
        select: () => undefined,
        focus: () => undefined,
        edgePath: () => null,
      });
      const { width, height } = NODE_SIZE.queue;

      flow.dropOnNothing('E1', { x: 100, y: 100 }, { x: 10, y: 10 }, 'gesture');
      surface.create?.choose({ kind: 'queue' });

      // The canvas is at 200%, so the box of the node is twice as big, and its corner twice as far from the corner of the host.
      expect(surface.key?.anchor).toEqual({
        x: (100 - width / 2) * 2,
        y: (100 - height / 2) * 2,
        width: width * 2,
        height: height * 2,
      });
    });

    it('shows the new node only once the binding is made: a key that is refused makes nothing to show', () => {
      const focus = TestBed.inject(NewNodeFocus);
      const show = vi.spyOn(focus, 'show');
      flow.dropOnNothing('E1', { x: 100, y: 100 }, { x: 10, y: 10 }, 'gesture');
      surface.create?.choose({ kind: 'queue' });

      expect(surface.key?.submit('#.#.#').ok).toBe(false);
      expect(show).not.toHaveBeenCalled();

      expect(surface.key?.submit('order.new').ok).toBe(true);
      expect(show).toHaveBeenCalledExactlyOnceWith('queue', 'queue1');
    });

    it('makes nothing when the key is given up, and not even the node', () => {
      flow.dropOnNothing('E1', { x: 100, y: 100 }, { x: 10, y: 10 }, 'gesture');
      surface.create?.choose({ kind: 'queue' });

      surface.key?.cancel();

      expect(Object.keys(store.document().queues)).toEqual(['Q1', 'Q2']);
      expect(status.notice()).toEqual({ kind: 'message', text: 'Link cancelled.' });
    });

    it('makes the batch at once for a producer, which has no key to ask for', () => {
      flow.dropOnNothing('P1', { x: 50, y: 50 }, { x: 5, y: 5 }, 'gesture');

      surface.create?.choose({ kind: 'exchange', exchangeType: 'direct' });

      expect(surface.key).toBeUndefined();
      expect(applied).toHaveLength(1);
      expect(Object.values(store.document().exchanges).some(({ name }) => name === 'exchange1')).toBe(true);
      expect(store.document().producers['P1']?.target).toMatchObject({ kind: 'exchange' });
    });

    it('makes the batch at once from a fanout exchange, which ignores the key', () => {
      flow.dropOnNothing('E3', { x: 50, y: 50 }, { x: 5, y: 5 }, 'gesture');

      surface.create?.choose({ kind: 'queue' });

      expect(surface.key).toBeUndefined();
      expect(applied).toHaveLength(1);
    });

    it('refuses, and makes nothing, when the node cannot be made, as a canvas that is full cannot', () => {
      flow.dropOnNothing('Q1', { x: 400, y: 300 }, { x: 640, y: 480 }, 'gesture');
      const choose = surface.create?.choose;
      start(documentOf());

      choose?.({ kind: 'consumer' });

      expect(applied).toEqual([]);
      expect(status.refusal()).not.toBeNull();
    });

    it('does nothing when the menu is given up', () => {
      flow.dropOnNothing('Q1', { x: 400, y: 300 }, { x: 640, y: 480 }, 'gesture');

      surface.create?.cancel();

      expect(applied).toEqual([]);
    });
  });
});
