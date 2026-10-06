import { TestBed } from '@angular/core/testing';
import { transientQueueReply } from '@rmq/engine';
import { sampleDocument } from '@rmq/testing';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { Inspector } from './inspector';
import { IntentHandler } from './intents';

async function renderInspector(selected: { nodes?: string[]; edges?: string[] } = {}) {
  const view = await render(Inspector, {
    providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, FlowViewport, IntentHandler],
  });
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
