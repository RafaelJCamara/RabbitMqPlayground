import { TestBed } from '@angular/core/testing';
import { transientQueueReply } from '@rmq/engine';
import { manualFrames, sampleDocument } from '@rmq/testing';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { Inspector } from './inspector';
import { IntentHandler } from './intents';
import { LinkFlow } from './link-flow';
import { NewNodeFocus } from './new-node-focus';

async function renderInspector(selected: { nodes?: string[]; edges?: string[] } = {}, flags: string | null = null) {
  const view = await render(Inspector, {
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      FlowViewport,
      NewNodeFocus,
      LinkFlow,
      IntentHandler,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
      { provide: FRAME_SOURCE, useValue: manualFrames() },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
    ],
  });
  // The editor has the simulation from the start, and with the flag it is what the parts of the inspector that are about it read.
  TestBed.inject(Simulation);
  const store = TestBed.inject(DocumentStore);
  const selection = TestBed.inject(SelectionStore);
  store.load(sampleDocument());
  const choose = (nodes: string[], edges: string[] = []) => {
    selection.select(nodes, edges);
    view.fixture.detectChanges();
  };
  choose(selected.nodes ?? [], selected.edges ?? []);
  return {
    ...view,
    store,
    selection,
    choose,
    status: TestBed.inject(StatusStore),
    viewport: TestBed.inject(FlowViewport),
    user: userEvent.setup(),
    document: () => store.document(),
  };
}

/** The element that describes a control: the one that its `aria-describedby` names, which has to be there, and hold the refusal. */
const describedBy = (control: HTMLElement) => {
  const id = control.getAttribute('aria-describedby');
  const description = id === null ? null : document.getElementById(id);
  expect(description, `what ${control.id} says that it is described by`).not.toBeNull();
  expect(description).toContainElement(screen.getByTestId('refusal'));
};

const nameField = () => screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
const xField = () => screen.getByRole('spinbutton', { name: 'X' }) as HTMLInputElement;
const yField = () => screen.getByRole('spinbutton', { name: 'Y' }) as HTMLInputElement;

describe('Inspector', () => {
  describe('when nothing is selected', () => {
    it('says so, and says what to do', async () => {
      await renderInspector();

      expect(screen.getByRole('heading', { name: 'Inspector' })).toBeInTheDocument();
      expect(screen.getByTestId('inspector-empty')).toHaveTextContent('Nothing is selected.');
    });

    it('has no field to change', async () => {
      await renderInspector();

      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    });
  });

  describe('a node', () => {
    it('says what kind it is, what it is joined to, what it is called, and where it is', async () => {
      await renderInspector({ nodes: ['Q1'] });

      expect(screen.getByRole('heading', { name: 'queue' })).toBeInTheDocument();
      expect(screen.getByTestId('inspector-joins')).toHaveTextContent('Receives from exchange orders.');
      expect(screen.getByTestId('inspector-joins')).toHaveTextContent('Sends to consumer worker.');
      expect(nameField()).toHaveValue('billing');
      expect(xField()).toHaveValue(300);
      expect(yField()).toHaveValue(0);
    });

    it('has a label on every field, so that each has a name', async () => {
      await renderInspector({ nodes: ['E1'] });

      for (const control of [...screen.getAllByRole('textbox'), ...screen.getAllByRole('spinbutton')]) {
        expect(control).toHaveAccessibleName();
      }
      expect(screen.getByRole('combobox', { name: 'Type' })).toBeInTheDocument();
      for (const name of ['Durable', 'Auto-delete', 'Internal']) {
        expect(screen.getByRole('switch', { name })).toBeInTheDocument();
      }
    });

    it('has no fields of an exchange or a queue on a producer or a consumer', async () => {
      const { choose } = await renderInspector({ nodes: ['P1'] });
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();

      choose(['C1']);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });

    it('shows what the document says for an exchange: its type, and each flag', async () => {
      await renderInspector({ nodes: ['E3'] });

      expect(screen.getByRole('combobox', { name: 'Type' })).toHaveValue('fanout');
      expect(screen.getByRole('switch', { name: 'Durable' })).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByRole('switch', { name: 'Auto-delete' })).toHaveAttribute('aria-checked', 'false');
      expect(screen.getByRole('switch', { name: 'Internal' })).toHaveAttribute('aria-checked', 'true');
    });

    it('offers the four types of exchange, in words', async () => {
      await renderInspector({ nodes: ['E1'] });

      const type = screen.getByRole('combobox', { name: 'Type' });
      expect(
        within(type)
          .getAllByRole('option')
          .map((option) => option.textContent),
      ).toEqual(['Direct', 'Fanout', 'Topic', 'Headers']);
    });

    it('follows the selection', async () => {
      const { choose } = await renderInspector({ nodes: ['Q1'] });
      expect(nameField()).toHaveValue('billing');

      choose(['P1']);

      expect(nameField()).toHaveValue('sender');
      expect(screen.getByRole('heading', { name: 'producer' })).toBeInTheDocument();
    });
  });

  describe('the name', () => {
    it('is changed with a command, and says so, when the field is left', async () => {
      const { user, document, status } = await renderInspector({ nodes: ['Q1'] });

      await user.clear(nameField());
      await user.type(nameField(), 'payments');
      await user.tab();

      expect(document().queues['Q1']?.name).toBe('payments');
      expect(status.notice()).toMatchObject({ kind: 'message' });
      expect(nameField()).toHaveValue('payments');
    });

    it('is a step of undo that has the name that it had', async () => {
      const { user, store } = await renderInspector({ nodes: ['Q1'] });

      await user.clear(nameField());
      await user.type(nameField(), 'payments');
      await user.tab();

      expect(store.canUndo()).toBe(true);
      TestBed.inject(CommandBus).undo('toolbar');
      expect(store.document().queues['Q1']?.name).toBe('billing');
    });

    it('is refused when another queue has it, and the field goes back to what the document says, and says why', async () => {
      const { user, document } = await renderInspector({ nodes: ['Q1'] });
      const before = document();

      await user.clear(nameField());
      await user.type(nameField(), 'archive');
      await user.tab();

      expect(document()).toBe(before);
      expect(nameField()).toHaveValue('billing');
      expect(nameField()).toHaveAttribute('aria-invalid', 'true');
      expect(nameField().getAttribute('aria-describedby')).toBe(screen.getByTestId('refusal').closest('[id]')?.id);
      expect(screen.getByTestId('refusal-message')).toHaveTextContent('archive');
    });

    it('is refused when it is empty', async () => {
      const { user, document } = await renderInspector({ nodes: ['Q1'] });

      await user.clear(nameField());
      await user.tab();

      expect(document().queues['Q1']?.name).toBe('billing');
      expect(nameField()).toHaveValue('billing');
      expect(screen.getByTestId('refusal')).toBeInTheDocument();
    });

    it('is left alone, with no command, when it was not changed', async () => {
      const { user, store } = await renderInspector({ nodes: ['Q1'] });

      await user.click(nameField());
      await user.tab();

      expect(store.canUndo()).toBe(false);
    });

    it('sends no command, and forgets an earlier refusal, when it is given the name that the document has', async () => {
      const { user, fixture } = await renderInspector({ nodes: ['Q1'] });
      await user.clear(nameField());
      await user.type(nameField(), 'archive');
      await user.tab();
      expect(screen.getByTestId('refusal')).toBeInTheDocument();
      const apply = vi.spyOn(TestBed.inject(CommandBus), 'apply');

      fireEvent.change(nameField());
      fixture.detectChanges();

      expect(apply).not.toHaveBeenCalled();
      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });

    it('does not keep a refusal when something else is selected', async () => {
      const { user, choose } = await renderInspector({ nodes: ['Q1'] });
      await user.clear(nameField());
      await user.type(nameField(), 'archive');
      await user.tab();
      expect(screen.getByTestId('refusal')).toBeInTheDocument();

      choose(['P1']);

      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });

    it('clears the refusal from the status line when something else is selected, so that it is not shown there later', async () => {
      const { user, choose, status } = await renderInspector({ nodes: ['Q1'] });
      await user.clear(nameField());
      await user.type(nameField(), 'archive');
      await user.tab();
      expect(status.refusal()).not.toBeNull();

      choose(['P1']);

      expect(status.refusal()).toBeNull();
    });
  });

  describe('the position', () => {
    it('moves the node when X is changed, which is how a node is moved without dragging', async () => {
      const { user, document } = await renderInspector({ nodes: ['Q1'] });

      await user.clear(xField());
      await user.type(xField(), '640');
      await user.tab();

      expect(document().layout.nodes['Q1']).toEqual({ x: 640, y: 0 });
    });

    it('moves the node when Y is changed', async () => {
      const { user, document } = await renderInspector({ nodes: ['Q1'] });

      await user.clear(yField());
      await user.type(yField(), '-80');
      await user.tab();

      expect(document().layout.nodes['Q1']).toEqual({ x: 300, y: -80 });
    });

    it('says what is wrong when what was typed is not a number, and puts back the number that was there', async () => {
      const { user, store } = await renderInspector({ nodes: ['Q1'] });

      await user.clear(xField());
      await user.tab();

      expect(store.canUndo()).toBe(false);
      expect(xField()).toHaveValue(300);
      expect(xField()).toHaveAttribute('aria-invalid', 'true');
      describedBy(xField());
      expect(screen.getByTestId('refusal-message')).toHaveTextContent(
        'X has to be a number. The node stays where it is.',
      );
    });

    it('steps by ten in both fields, as the arrow keys of the canvas move a node', async () => {
      await renderInspector({ nodes: ['Q1'] });

      expect(xField()).toHaveAttribute('step', '10');
      expect(yField()).toHaveAttribute('step', '10');
    });

    it('is refused, in the words of the domain, when it is further out than a canvas goes', async () => {
      const { user, document } = await renderInspector({ nodes: ['Q1'] });

      await user.clear(yField());
      await user.type(yField(), '99999999');
      await user.tab();

      expect(document().layout.nodes['Q1']?.y).toBe(0);
      expect(yField()).toHaveValue(0);
      expect(yField()).toHaveAttribute('aria-invalid', 'true');
      describedBy(yField());
      expect(screen.getByTestId('refusal-message')).toHaveTextContent(
        'The y position of a node must be a number from -1000000 to 1000000, and 99999999 is not.',
      );
    });

    it('sends no command, and forgets an earlier refusal, when it is given the number that the document has', async () => {
      const { user, fixture } = await renderInspector({ nodes: ['Q1'] });
      await user.clear(xField());
      await user.tab();
      expect(screen.getByTestId('refusal')).toBeInTheDocument();
      const apply = vi.spyOn(TestBed.inject(CommandBus), 'apply');

      fireEvent.change(xField());
      fixture.detectChanges();

      expect(apply).not.toHaveBeenCalled();
      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });

    it('does nothing, with no command, when the number is the one that was there', async () => {
      const { user, store } = await renderInspector({ nodes: ['Q1'] });

      await user.click(xField());
      await user.tab();

      expect(store.canUndo()).toBe(false);
    });
  });

  describe('what the simulation adds (ADR-0056)', () => {
    const sections = ['queue-messages', 'producer-composer', 'consumer-settings'];
    const shown = () => sections.filter((id) => screen.queryByTestId(id) !== null);

    it('is not there without the flag: a queue, a producer and a consumer have the fields that they had', async () => {
      const { choose } = await renderInspector();

      for (const node of ['Q1', 'P1', 'C1']) {
        choose([node]);
        expect(shown()).toEqual([]);
      }
    });

    it('has the messages of a queue, the composer of a producer and the settings of a consumer, each for its own kind and for no other', async () => {
      const { choose } = await renderInspector({}, 'simulation');

      choose(['Q1']);
      expect(shown()).toEqual(['queue-messages']);
      choose(['P1']);
      expect(shown()).toEqual(['producer-composer']);
      choose(['C1']);
      expect(shown()).toEqual(['consumer-settings']);
      choose(['E1']);
      expect(shown()).toEqual([]);
    });

    it('has them before the button that deletes, so that the button stays the last thing of a node', async () => {
      const { choose } = await renderInspector({}, 'simulation');

      for (const [node, section] of [
        ['Q1', 'queue-messages'],
        ['P1', 'producer-composer'],
        ['C1', 'consumer-settings'],
      ] as const) {
        choose([node]);
        const position = screen
          .getByTestId(section)
          .compareDocumentPosition(screen.getByRole('button', { name: /^Delete/ }));
        expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
    });

    it('is not there for an edge, or for several things', async () => {
      const { choose } = await renderInspector({}, 'simulation');

      choose([], ['E1>Q1']);
      expect(shown()).toEqual([]);
      choose(['Q1', 'P1']);
      expect(shown()).toEqual([]);
    });

    it('forgets what a field was refused for when another node is selected', async () => {
      const { choose } = await renderInspector({ nodes: ['P1'] }, 'simulation');
      const burst = screen.getByRole('spinbutton', { name: 'Messages at a time' }) as HTMLInputElement;
      burst.value = '0';
      fireEvent.change(burst);
      expect(screen.getByTestId('refusal')).toBeVisible();

      choose(['C1']);
      choose(['P1']);

      expect(screen.queryByTestId('refusal')).toBeNull();
    });
  });

  describe('an exchange', () => {
    it('changes its type', async () => {
      const { user, document } = await renderInspector({ nodes: ['E1'] });

      await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'fanout');

      expect(document().exchanges['E1']?.type).toBe('fanout');
    });

    it('goes back to the type that the document has, and says why, when a change of type is refused', async () => {
      const { user, document } = await renderInspector({ nodes: ['E1'] });
      const before = document().exchanges['E1']?.type;
      vi.spyOn(TestBed.inject(CommandBus), 'apply').mockReturnValueOnce({
        ok: false,
        error: { kind: 'invalid-value', message: 'A topic exchange cannot be a fanout while it has keys.' },
      });
      const type = screen.getByRole('combobox', { name: 'Type' });

      await user.selectOptions(type, 'fanout');

      expect(type).toHaveValue(before);
      expect(type).toHaveAttribute('aria-invalid', 'true');
      describedBy(type);
      expect(screen.getByTestId('refusal-message')).toHaveTextContent('cannot be a fanout while it has keys');
    });

    it('describes a switch by the refusal under it, when its flag cannot be turned on', async () => {
      // The exchange called orders has a producer that publishes to it, which the broker would not allow once it is internal.
      const { user, document } = await renderInspector({ nodes: ['E1'] });

      await user.click(screen.getByRole('switch', { name: 'Internal' }));

      expect(document().exchanges['E1']?.internal).toBe(false);
      describedBy(screen.getByRole('switch', { name: 'Internal' }));
    });

    it('turns the internal flag on, and leaves the others as they were', async () => {
      // The exchange called orders has a producer that publishes to it, which the broker would not allow once it is internal.
      const { user, document } = await renderInspector({ nodes: ['E2'] });
      const before = document().exchanges['E2'];
      expect(before?.internal).toBe(false);

      await user.click(screen.getByRole('switch', { name: 'Internal' }));

      expect(document().exchanges['E2']).toEqual({ ...before, internal: true });
    });

    it('turns a flag on and off with its switch, and the switch shows what the document says', async () => {
      const { user, document } = await renderInspector({ nodes: ['E1'] });
      const autoDelete = () => screen.getByRole('switch', { name: 'Auto-delete' });

      await user.click(autoDelete());
      expect(document().exchanges['E1']?.autoDelete).toBe(true);
      expect(autoDelete()).toHaveAttribute('aria-checked', 'true');

      await user.click(autoDelete());
      expect(document().exchanges['E1']?.autoDelete).toBe(false);
      expect(autoDelete()).toHaveAttribute('aria-checked', 'false');
    });

    it('can be not durable, which a broker accepts for an exchange', async () => {
      const { user, document } = await renderInspector({ nodes: ['E1'] });

      await user.click(screen.getByRole('switch', { name: 'Durable' }));

      expect(document().exchanges['E1']?.durable).toBe(false);
    });

    it.each([
      ['Durable', 'A durable exchange is still there after the broker restarts.'],
      ['Auto-delete', 'The exchange goes away when the last queue or exchange is unbound from it.'],
      ['Internal', 'Producers cannot publish to an internal exchange. Only another exchange can send messages to it.'],
    ])('explains %s when its help is opened, in a sentence and not a tooltip', async (field, sentence) => {
      const { user } = await renderInspector({ nodes: ['E1'] });

      await user.click(screen.getByRole('button', { name: `Help: ${field}` }));

      expect(screen.getByText(sentence)).toBeVisible();
    });
  });

  describe('the durable switch of a queue (ADR-0024)', () => {
    it('is on, and says why, before anything is pressed, so that it reads as an explanation', async () => {
      await renderInspector({ nodes: ['Q1'] });

      const durable = screen.getByRole('switch', { name: 'Durable' });
      expect(durable).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('durable-why')).toHaveTextContent(
        'It is on, and stays on: RabbitMQ 4.3 does not accept a queue that is not durable.',
      );
      expect(durable.getAttribute('aria-describedby')).toBe(screen.getByTestId('durable-why').id);
    });

    it('is refused when it is turned off, with the root cause first and the broker’s reply after it', async () => {
      const { user, document } = await renderInspector({ nodes: ['Q1'] });
      const before = document();

      await user.click(screen.getByRole('switch', { name: 'Durable' }));

      expect(document()).toBe(before);
      const block = screen.getByTestId('durable-problem');
      const message = within(block).getByTestId('refusal-message');
      const reply = within(block).getByTestId('refusal-reply');
      expect(message).toHaveTextContent("Queue 'billing' is not durable.");
      expect(message).toHaveTextContent('RabbitMQ 4.3 no longer allows a queue that is neither durable nor exclusive');
      expect(within(block).getByTestId('refusal-code')).toHaveTextContent(String(transientQueueReply().code));
      expect(reply).toHaveTextContent(transientQueueReply().text.replace(/\s+/g, ' '));
      expect(message.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('stays on after it was refused, and is described by the refusal, which is under it', async () => {
      const { user } = await renderInspector({ nodes: ['Q1'] });

      await user.click(screen.getByRole('switch', { name: 'Durable' }));

      const durable = screen.getByRole('switch', { name: 'Durable' });
      expect(durable).toHaveAttribute('aria-checked', 'true');
      expect(durable.getAttribute('aria-describedby')).toBe(screen.getByTestId('durable-problem').id);
    });

    it('keeps the refusal off the status line, which would show the same thing twice', async () => {
      const { user, status } = await renderInspector({ nodes: ['Q1'] });

      await user.click(screen.getByRole('switch', { name: 'Durable' }));

      expect(status.refusal()).toMatchObject({ origin: 'inspector', issue: { kind: 'transient-queue' } });
    });

    it('goes when the learner changes something else that works, or selects something else', async () => {
      const { user, choose } = await renderInspector({ nodes: ['Q1'] });
      await user.click(screen.getByRole('switch', { name: 'Durable' }));
      expect(screen.getByTestId('durable-problem')).toBeInTheDocument();

      await user.clear(xField());
      await user.type(xField(), '500');
      await user.tab();
      expect(screen.queryByTestId('durable-problem')).not.toBeInTheDocument();

      await user.click(screen.getByRole('switch', { name: 'Durable' }));
      expect(screen.getByTestId('durable-problem')).toBeInTheDocument();
      choose(['E1']);
      expect(screen.queryByTestId('durable-problem')).not.toBeInTheDocument();
    });
  });

  describe('linking from a node (ADR-0041)', () => {
    it('has a button that opens the picker for the selected node, with the inspector as the origin, for a node that can be linked from', async () => {
      const { user } = await renderInspector({ nodes: ['E1'] });
      const open = vi.spyOn(TestBed.inject(LinkFlow), 'openPicker');

      await user.click(screen.getByRole('button', { name: 'Link exchange orders to…' }));

      expect(open).toHaveBeenCalledWith('E1', 'inspector');
    });

    it('has the button for a producer and for a queue, and not for a consumer, where a message ends', async () => {
      const { choose } = await renderInspector({ nodes: ['P1'] });
      expect(screen.getByRole('button', { name: 'Link producer sender to…' })).toBeInTheDocument();

      choose(['Q1']);
      expect(screen.getByRole('button', { name: 'Link queue billing to…' })).toBeInTheDocument();

      choose(['C1']);
      expect(screen.queryByRole('button', { name: /^Link .* to…$/ })).not.toBeInTheDocument();
    });

    it('says which key does the same, which is L on the canvas', async () => {
      await renderInspector({ nodes: ['E1'] });

      expect(screen.getByRole('button', { name: 'Link exchange orders to…' })).toHaveAttribute(
        'aria-keyshortcuts',
        'L',
      );
    });
  });

  describe('what is wrong with a node (ADR-0044)', () => {
    it('is said under its name, in the sentence of the lint, for an exchange that nothing is bound from', async () => {
      const { store, choose } = await renderInspector();
      TestBed.inject(CommandBus).apply(
        {
          type: 'declare-exchange',
          name: 'lonely',
          exchangeType: 'fanout',
          durable: true,
          autoDelete: false,
          internal: false,
        },
        'toolbar',
      );
      const id = Object.entries(store.document().exchanges).find(([, { name }]) => name === 'lonely')![0];

      choose([id]);

      expect(screen.getByTestId('inspector-warnings')).toHaveTextContent("Nothing is bound from the exchange 'lonely'");
      expect(within(screen.getByTestId('inspector-warnings')).getAllByRole('listitem')).toHaveLength(1);
    });

    it('is not said for a node that has no lint', async () => {
      await renderInspector({ nodes: ['E1'] });

      expect(screen.queryByTestId('inspector-warnings')).not.toBeInTheDocument();
    });
  });

  describe('delete', () => {
    it('deletes a node, and says which one in the name of the button', async () => {
      const { user, document } = await renderInspector({ nodes: ['Q2'] });

      await user.click(screen.getByRole('button', { name: 'Delete queue archive' }));

      expect(document().queues['Q2']).toBeUndefined();
      expect(screen.getByTestId('inspector-empty')).toBeInTheDocument();
    });

    it('is a step of undo, and says that the key does the same', async () => {
      const { user, store } = await renderInspector({ nodes: ['Q2'] });
      const button = screen.getByRole('button', { name: 'Delete queue archive' });
      expect(button).toHaveAttribute('aria-keyshortcuts', 'Delete');

      await user.click(button);

      expect(store.canUndo()).toBe(true);
    });

    it('applies the delete with the inspector as its origin, and not a gesture', async () => {
      const { user } = await renderInspector({ nodes: ['Q2'] });
      const seen: string[] = [];
      TestBed.inject(CommandBus).onApplied(({ origin }) => seen.push(origin));

      await user.click(screen.getByRole('button', { name: 'Delete queue archive' }));

      expect(seen).toEqual(['inspector']);
    });
  });

  describe('an edge', () => {
    it('says what it is, in the words of the canvas, and can be deleted', async () => {
      const { user, document } = await renderInspector({ edges: ['E1>Q1'] });

      expect(screen.getByRole('heading', { name: 'Binding' })).toBeInTheDocument();
      expect(screen.getByTestId('inspector-edge')).toHaveTextContent(
        'Binding from exchange orders to queue billing, key order.*',
      );
      expect(screen.getByRole('button', { name: 'Delete this binding' })).toHaveAttribute(
        'aria-keyshortcuts',
        'Delete',
      );
      await user.click(screen.getByRole('button', { name: 'Delete this binding' }));

      expect(Object.keys(document().bindings)).toEqual(['B2', 'B3']);
    });

    it('is named for what it is when it is a link or a subscription', async () => {
      const { choose, user, document } = await renderInspector({ edges: ['P1>E1'] });
      expect(screen.getByRole('heading', { name: 'Link from a producer' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Delete this link from a producer' }));
      expect(document().producers['P1']?.target).toBeNull();

      choose([], ['Q1>C1']);
      expect(screen.getByRole('heading', { name: 'Subscription' })).toBeInTheDocument();
    });
  });

  describe('the bindings of an edge (ADR-0044)', () => {
    const twoKeys = async () => {
      const view = await renderInspector({ edges: ['E1>Q1'] });
      TestBed.inject(CommandBus).apply(
        { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'invoice.#' },
        'toolbar',
      );
      view.choose([], ['E1>Q1']);
      return view;
    };
    const rows = () => screen.getAllByRole('group', { name: /^Binding \d+ of \d+$/ });

    it('has a row for each of the bindings between the two ends, with its key in a field', async () => {
      await twoKeys();

      expect(rows().map((row) => row.getAttribute('aria-label'))).toEqual(['Binding 1 of 2', 'Binding 2 of 2']);
      expect(
        rows().map((row) => (within(row).getByRole('textbox', { name: 'Key' }) as HTMLInputElement).value),
      ).toEqual(['order.*', 'invoice.#']);
      // Nothing is wrong with these, and they have no header arguments, so neither is said.
      expect(screen.queryByTestId('inspector-warnings')).not.toBeInTheDocument();
      expect(screen.queryByTestId('binding-headers')).not.toBeInTheDocument();
    });

    it('gives a binding another key when the field is left, as one step of undo that a typed line can say', async () => {
      const { user, store } = await twoKeys();
      const seen: string[] = [];
      TestBed.inject(CommandBus).onApplied(({ origin, command }) => seen.push(`${origin} ${command.type}`));
      const field = within(rows()[0]!).getByRole('textbox', { name: 'Key' });

      await user.clear(field);
      await user.type(field, 'order.new');
      await user.tab();

      expect(Object.values(store.document().bindings).map(({ key }) => key)).toEqual([
        '',
        '#',
        'invoice.#',
        'order.new',
      ]);
      expect(seen).toEqual(['inspector batch']);
      TestBed.inject(CommandBus).undo('toolbar');
      expect(Object.values(store.document().bindings).map(({ key }) => key)).toEqual(['order.*', '', '#', 'invoice.#']);
    });

    it('says why a key is refused, under the field, and puts back the key that the binding has', async () => {
      const { user, store } = await twoKeys();
      const field = within(rows()[0]!).getByRole('textbox', { name: 'Key' }) as HTMLInputElement;

      await user.clear(field);
      await user.type(field, '#.#.#');
      await user.tab();

      expect(field).toHaveValue('order.*');
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(within(rows()[0]!).getByTestId('refusal-message')).toHaveTextContent('#');
      expect(document.getElementById(field.getAttribute('aria-describedby') as string)).toContainElement(
        within(rows()[0]!).getByTestId('refusal-message'),
      );
      expect(store.document().bindings['B1']?.key).toBe('order.*');
    });

    it('does nothing when the key is the one that the binding has, and forgets an earlier refusal', async () => {
      const { user } = await twoKeys();
      const seen: string[] = [];
      const field = within(rows()[0]!).getByRole('textbox', { name: 'Key' });
      await user.clear(field);
      await user.type(field, '#.#.#');
      await user.tab();
      TestBed.inject(CommandBus).onApplied(({ command }) => seen.push(command.type));

      fireEvent.change(field, { target: { value: 'order.*' } });

      expect(seen).toEqual([]);
      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
      expect(field).not.toHaveAttribute('aria-invalid');
    });

    it('takes one binding off with its own button, which says which, and leaves the others', async () => {
      const { user, store } = await twoKeys();
      const seen: string[] = [];
      TestBed.inject(CommandBus).onApplied(({ origin, command }) => seen.push(`${origin} ${command.type}`));

      await user.click(screen.getByRole('button', { name: 'Delete the binding with key invoice.#' }));

      expect(Object.keys(store.document().bindings)).toEqual(['B1', 'B2', 'B3']);
      expect(seen).toEqual(['inspector unbind']);
      expect(rows()).toHaveLength(1);
    });

    it('names the button of a binding that has an empty key by saying so', async () => {
      const { choose } = await renderInspector();
      TestBed.inject(CommandBus).apply(
        { type: 'bind', source: 'hidden', destination: { kind: 'queue', name: 'billing' }, key: '' },
        'toolbar',
      );

      choose([], ['E3>Q1']);

      expect(screen.getByRole('button', { name: 'Delete the binding with an empty key' })).toBeInTheDocument();
    });

    it('opens the popover for another binding between the same two, which asks for its key, with the inspector as the origin', async () => {
      const { user } = await twoKeys();
      const request = vi.spyOn(TestBed.inject(LinkFlow), 'request');

      await user.click(screen.getByRole('button', { name: 'Add another binding' }));

      expect(request).toHaveBeenCalledWith('E1', 'Q1', 'inspector');
    });

    it('says that a binding has header arguments, which are not edited here', async () => {
      await renderInspector({ edges: ['E2>Q2'] });

      expect(within(rows()[0]!).getByTestId('binding-headers')).toHaveTextContent('header arguments');
    });

    it('has no rows for a link or a subscription, which are not bindings, and no button that adds one', async () => {
      const { choose } = await renderInspector({ edges: ['P1>E1'] });
      expect(screen.queryByRole('group', { name: /^Binding \d+ of/ })).not.toBeInTheDocument();
      expect(screen.queryByTestId('binding-rows')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-binding')).not.toBeInTheDocument();

      choose([], ['Q1>C1']);
      expect(screen.queryByRole('group', { name: /^Binding \d+ of/ })).not.toBeInTheDocument();
      expect(screen.queryByTestId('binding-rows')).not.toBeInTheDocument();
      expect(screen.queryByTestId('add-binding')).not.toBeInTheDocument();
    });
  });

  describe('the tester of a topic key, under the field that is typed in (ADR-0064)', () => {
    const rows = () => screen.getAllByRole('group', { name: /^Binding \d+ of \d+$/ });
    const keyField = (row = 0) => within(rows()[row]!).getByRole('textbox', { name: 'Key' }) as HTMLInputElement;
    /** Two bindings from the topic exchange `orders` to `billing`, so that there are two fields for the cursor to go between. */
    const twoKeys = async (flags: string | null = 'explain') => {
      const view = await renderInspector({ edges: ['E1>Q1'] }, flags);
      TestBed.inject(CommandBus).apply(
        { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'billing' }, key: 'invoice.#' },
        'toolbar',
      );
      view.choose([], ['E1>Q1']);
      return view;
    };

    it('is under the field of a binding of a topic exchange while the cursor is in it, with what the key matches, and is gone when the cursor leaves', async () => {
      const { user } = await renderInspector({ edges: ['E1>Q1'] }, 'explain');
      expect(screen.queryByTestId('topic-tester')).not.toBeInTheDocument();

      await user.click(keyField());

      const tester = within(rows()[0]!).getByTestId('topic-tester');
      expect(tester).toHaveTextContent('order.x');
      expect(keyField().compareDocumentPosition(tester) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      await user.tab();

      expect(screen.queryByTestId('topic-tester')).not.toBeInTheDocument();
    });

    it('follows what is typed, while the key that the binding has is the one that it had, which it changes when the field is left', async () => {
      const { user, store } = await renderInspector({ edges: ['E1>Q1'] }, 'explain');
      await user.click(keyField());

      await user.clear(keyField());
      expect(screen.getByTestId('topic-tester-empty')).toBeVisible();
      await user.type(keyField(), 'a.#');

      expect(within(screen.getByTestId('topic-matching')).getAllByTestId('topic-sample')[1]).toHaveTextContent('a.y');
      expect(store.document().bindings['B1']?.key).toBe('order.*');

      await user.type(keyField(), '.#.#');
      expect(screen.getByTestId('topic-tester-refusal')).toHaveTextContent("has 3 '#' words");
    });

    it('moves with the cursor, from the field of one binding to the field of the next, so that there is one at a time', async () => {
      const { user } = await twoKeys();

      await user.click(keyField(0));
      expect(within(rows()[0]!).getByTestId('topic-tester')).toBeVisible();

      await user.click(keyField(1));

      expect(screen.getAllByTestId('topic-tester')).toHaveLength(1);
      expect(within(rows()[1]!).getByTestId('topic-tester')).toHaveTextContent('invoice');
      expect(within(rows()[0]!).queryByTestId('topic-tester')).not.toBeInTheDocument();
    });

    it('is not there for the bindings of an exchange that is not a topic exchange, which has no wildcards to try', async () => {
      const { user } = await renderInspector({ edges: ['E2>Q2'] }, 'explain');

      await user.click(keyField());

      expect(screen.queryByTestId('topic-tester')).not.toBeInTheDocument();
    });

    it('is not there without the flag of the explanation, whatever else is on', async () => {
      for (const flags of [null, 'simulation']) {
        TestBed.resetTestingModule();
        document.body.replaceChildren();
        const { user } = await renderInspector({ edges: ['E1>Q1'] }, flags);

        await user.click(keyField());

        expect(screen.queryByTestId('topic-tester'), String(flags)).not.toBeInTheDocument();
      }
    });

    it('does not stop the cursor from reaching the buttons of the row, or the key from being changed with the tester under it', async () => {
      const { user, store } = await renderInspector({ edges: ['E1>Q1'] }, 'explain');
      await user.click(keyField());

      await user.clear(keyField());
      await user.type(keyField(), 'order.new');
      await user.tab();

      expect(Object.values(store.document().bindings).map(({ key }) => key)).toContain('order.new');
      expect(screen.queryByTestId('topic-tester')).not.toBeInTheDocument();
    });
  });

  describe('the label of an edge (ADR-0044)', () => {
    it('has a field for where it is along the edge, which is how it is moved without dragging, empty while the app places it', async () => {
      await renderInspector({ edges: ['E1>E3'] });

      const field = screen.getByRole('spinbutton', {
        name: 'Label position (percent along the edge)',
      }) as HTMLInputElement;
      expect(field.value).toBe('');
      expect(field).toHaveAttribute('min', '0');
      expect(field).toHaveAttribute('max', '100');
      expect(field).toHaveAttribute('step', '5');
    });

    it('shows where the document keeps it, as a percentage', async () => {
      await renderInspector({ edges: ['E1>Q1'] });

      expect(
        (screen.getByRole('spinbutton', { name: 'Label position (percent along the edge)' }) as HTMLInputElement).value,
      ).toBe('50');
    });

    it('moves the label when the field is changed, as one command that says the fraction, and is one step of undo', async () => {
      const { user, store } = await renderInspector({ edges: ['E1>Q1'] });
      const seen: string[] = [];
      TestBed.inject(CommandBus).onApplied(({ origin, command }) => seen.push(`${origin} ${command.type}`));
      const field = screen.getByRole('spinbutton', { name: 'Label position (percent along the edge)' });

      await user.clear(field);
      await user.type(field, '25');
      await user.tab();

      expect(store.document().layout.labels['E1>Q1']).toEqual({ at: 0.25 });
      expect(seen).toEqual(['inspector move-label']);
      TestBed.inject(CommandBus).undo('toolbar');
      expect(store.document().layout.labels['E1>Q1']).toEqual({ at: 0.5 });
    });

    it('says what is wrong with a place that is not between 0 and 100, and puts back the one that the document has', async () => {
      const { user, store } = await renderInspector({ edges: ['E1>Q1'] });
      const field = screen.getByRole('spinbutton', {
        name: 'Label position (percent along the edge)',
      }) as HTMLInputElement;

      await user.clear(field);
      await user.type(field, '140');
      await user.tab();

      expect(field).toHaveValue(50);
      expect(field).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByTestId('refusal-message')).toHaveTextContent('A label sits from 0');
      expect(document.getElementById(field.getAttribute('aria-describedby') as string)).toContainElement(
        screen.getByTestId('refusal-message'),
      );
      expect(store.document().layout.labels['E1>Q1']).toEqual({ at: 0.5 });
    });

    it('says what is wrong with something that is not a number', async () => {
      const { user } = await renderInspector({ edges: ['E1>Q1'] });
      const field = screen.getByRole('spinbutton', {
        name: 'Label position (percent along the edge)',
      }) as HTMLInputElement;

      fireEvent.change(field, { target: { value: '' } });
      await user.tab();

      expect(screen.getByTestId('refusal-message')).toHaveTextContent('The place of a label has to be a number');
    });

    it('has no field for an edge that has no label, a subscription', async () => {
      await renderInspector({ edges: ['Q1>C1'] });

      expect(screen.queryByRole('spinbutton', { name: /Label position/ })).not.toBeInTheDocument();
    });
  });

  describe('the link of a producer (ADR-0041)', () => {
    it('can be changed to another target, which opens the picker for the producer with the inspector as the origin', async () => {
      const { user } = await renderInspector({ edges: ['P1>E1'] });
      const open = vi.spyOn(TestBed.inject(LinkFlow), 'openPicker');

      await user.click(screen.getByRole('button', { name: 'Change the target of this link…' }));

      expect(open).toHaveBeenCalledWith('P1', 'inspector');
    });

    it('has no such button for a binding or a subscription', async () => {
      const { choose } = await renderInspector({ edges: ['E1>Q1'] });
      expect(screen.queryByRole('button', { name: /Change the target/ })).not.toBeInTheDocument();

      choose([], ['Q1>C1']);
      expect(screen.queryByRole('button', { name: /Change the target/ })).not.toBeInTheDocument();
    });
  });

  describe('what is wrong with a binding (ADR-0044)', () => {
    it('is said, in the sentence of the lint, for a headers binding that matches nothing', async () => {
      const { choose } = await renderInspector();
      TestBed.inject(CommandBus).apply(
        {
          type: 'bind',
          source: 'docs',
          destination: { kind: 'queue', name: 'billing' },
          key: '',
          headers: { xMatch: 'any', args: [] },
        },
        'toolbar',
      );

      choose([], ['E2>Q1']);

      expect(screen.getByTestId('inspector-warnings')).toHaveTextContent('x-match=any');
    });
  });

  describe('the default exchange (ADR-0043)', () => {
    const show = (flag: boolean) =>
      TestBed.inject(CommandBus).apply(
        { type: 'set', kind: 'canvas', changes: { showDefaultExchange: flag } },
        'toolbar',
      );

    it('says what it is and that it cannot be changed, with nothing to change, for the node', async () => {
      const { choose } = await renderInspector();
      show(true);

      choose(['~default']);

      expect(screen.getByRole('heading', { name: 'Default exchange' })).toBeInTheDocument();
      expect(screen.getByTestId('inspector-default')).toHaveTextContent(
        'every virtual host has an exchange with no name',
      );
      expect(screen.getByTestId('inspector-default')).toHaveTextContent('cannot be changed or deleted');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    });

    it('can be hidden from there, which is the same setting as the switch of the top bar, with the inspector as the origin', async () => {
      const { choose, user, store } = await renderInspector();
      show(true);
      choose(['~default']);
      const seen: string[] = [];
      TestBed.inject(CommandBus).onApplied(({ origin, command }) => seen.push(`${origin} ${command.type}`));

      await user.click(screen.getByRole('button', { name: 'Hide the default exchange' }));

      expect(store.document().settings.showDefaultExchange).toBe(false);
      expect(seen).toEqual(['inspector set']);
      expect(screen.getByTestId('inspector-empty')).toBeInTheDocument();
    });

    it('says why an implicit binding is there, which key it has, and that it cannot be changed or deleted, with nothing to change', async () => {
      const { choose } = await renderInspector();
      show(true);

      choose([], ['~default>Q1']);

      expect(screen.getByRole('heading', { name: 'Implicit binding' })).toBeInTheDocument();
      expect(screen.getByTestId('inspector-edge')).toHaveTextContent(
        'Implicit binding from the default exchange to queue billing, key billing',
      );
      expect(screen.getByTestId('inspector-default')).toHaveTextContent('with the name of the queue as its key');
      expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('spinbutton', { name: /Label position/ })).not.toBeInTheDocument();
    });
  });

  describe('several things', () => {
    it('counts them, and deletes them together as one step of undo', async () => {
      const { user, document, store } = await renderInspector({ nodes: ['Q2', 'C1'] });

      expect(screen.getByRole('heading', { name: '2 items selected' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete 2 items' })).toHaveAttribute('aria-keyshortcuts', 'Delete');
      await user.click(screen.getByRole('button', { name: 'Delete 2 items' }));

      expect(document().queues['Q2']).toBeUndefined();
      expect(document().consumers['C1']).toBeUndefined();
      TestBed.inject(CommandBus).undo('toolbar');
      expect(store.document().consumers['C1']).toBeDefined();
    });
  });

  describe('the keyboard', () => {
    it('gives the focus to the first field, for the key that edits what is selected', async () => {
      const { fixture } = await renderInspector({ nodes: ['Q1'] });

      expect((fixture.componentInstance as Inspector).focusFirst()).toBe(true);

      expect(nameField()).toHaveFocus();
    });

    it('says that it has no field to focus when nothing is selected', async () => {
      const { fixture } = await renderInspector();

      expect((fixture.componentInstance as Inspector).focusFirst()).toBe(false);
    });

    it('leaves for the canvas on Escape, which keeps what was not kept out of the document', async () => {
      const { user, viewport, document } = await renderInspector({ nodes: ['Q1'] });
      const focus = vi.spyOn(viewport, 'focus');

      await user.click(nameField());
      await user.type(nameField(), 'xyz');
      await user.keyboard('{Escape}');

      expect(focus).toHaveBeenCalledOnce();
      expect(document().queues['Q1']?.name).toBe('billing');
    });
  });
});
