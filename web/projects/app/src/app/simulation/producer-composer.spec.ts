import { TestBed } from '@angular/core/testing';
import { emptyDocument, LIMITS, type CanvasDocument } from '@rmq/domain';
import { bindingRecord, documentOf, exchangeRecord, manualFrames, producerRecord, queueRecord } from '@rmq/testing';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { ProducerComposer } from './producer-composer';

/** A producer `sender` that sends `hello` with the key `new` to `orders`, which sends it to `billing`, and one that is linked to nothing. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing') },
    bindings: { B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new') },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        {
          message: { payload: 'hello', key: 'new', headers: [{ key: 'n', value: { t: 'integer', v: 1 } }] },
          burst: 2,
          interval: { everyMs: 500, on: false },
        },
      ),
      L: producerRecord('lonely'),
    },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

async function renderComposer(id = 'P') {
  const view = await render(ProducerComposer, {
    inputs: { id },
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      { provide: FRAME_SOURCE, useValue: manualFrames() },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation' } },
    ],
  });
  const bus = TestBed.inject(CommandBus);
  // The log listens from the moment that it is made.
  const log = TestBed.inject(CommandLog);
  // The editor has the simulation from the start, which is what the commands of the runtime are run with.
  const simulation = TestBed.inject(Simulation);
  TestBed.inject(DocumentStore).load(canvas());
  // The canvas does not run by itself while a spec looks at it, and pausing it is not what the spec is about, so the log does not have it.
  simulation.execute({ type: 'pause' });
  view.fixture.detectChanges();
  return {
    ...view,
    bus,
    store: TestBed.inject(DocumentStore),
    status: TestBed.inject(StatusStore),
    log,
    user: userEvent.setup(),
    settle: () => view.fixture.detectChanges(),
    /** What the learner does to a field: the value is put in it, and it is left. */
    give: (field: HTMLElement, value: string) => {
      (field as HTMLInputElement).value = value;
      fireEvent.change(field);
      view.fixture.detectChanges();
    },
    producer: () => TestBed.inject(DocumentStore).document().producers['P'],
  };
}

describe('ProducerComposer (ADR-0056)', () => {
  it('has the fields of the message and of when it is sent, with the values that the document has, each with a label', async () => {
    await renderComposer();

    expect(screen.getByRole('heading', { name: 'What it sends' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'What it sends' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Payload' })).toHaveValue('hello');
    expect(screen.getByRole('textbox', { name: 'Routing key' })).toHaveValue('new');
    expect(screen.getByRole('spinbutton', { name: 'Messages at a time' })).toHaveValue(2);
    expect(screen.getByRole('switch', { name: 'Keeps sending' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('spinbutton', { name: 'Milliseconds between sends' })).toHaveValue(500);
    expect(screen.getByRole('button', { name: 'Publish now' })).toHaveAttribute('aria-keyshortcuts', 'P');
  });

  it('says how many headers the message has, and that the table for them comes with the headers exchange', async () => {
    await renderComposer();

    expect(screen.getByTestId('composer-headers')).toHaveTextContent(
      'The message has 1 header. The table to edit them is coming with the headers exchange.',
    );
  });

  it('says that there are none, and that there are several', async () => {
    const { bus, settle } = await renderComposer();

    bus.apply(
      {
        type: 'set',
        kind: 'producer',
        name: 'sender',
        changes: { headers: [{ key: 'm', value: { t: 'string', v: 'x' } }] },
      },
      'inspector',
    );
    settle();
    expect(screen.getByTestId('composer-headers')).toHaveTextContent(
      'The message has 2 headers. The table to edit them is coming with the headers exchange.',
    );

    bus.apply({ type: 'unset', kind: 'producer', name: 'sender', headers: ['n', 'm'] }, 'inspector');
    settle();
    expect(screen.getByTestId('composer-headers')).toHaveTextContent(
      'The message has no headers. A headers exchange looks at them, and the table to edit them is coming with it.',
    );
  });

  it('gives each number the limits that the grammar has for it, and the fields of text a name to be read with', async () => {
    await renderComposer();
    const burst = screen.getByRole('spinbutton', { name: 'Messages at a time' });
    const every = screen.getByRole('spinbutton', { name: 'Milliseconds between sends' });

    expect([burst.getAttribute('min'), burst.getAttribute('max'), burst.getAttribute('step')]).toEqual([
      '1',
      '1000',
      '1',
    ]);
    expect([every.getAttribute('min'), every.getAttribute('max')]).toEqual(['1', null]);
  });

  it('marks the field of text that was refused, and ties the reason to it, for a payload and for a key', async () => {
    const { give } = await renderComposer();
    const payload = screen.getByRole('textbox', { name: 'Payload' });
    const key = screen.getByRole('textbox', { name: 'Routing key' });

    give(key, 'k'.repeat(300));
    expect(key).toHaveAttribute('aria-invalid', 'true');
    expect(key).toHaveAccessibleDescription(/255/);
    expect(payload).not.toHaveAttribute('aria-invalid');

    give(payload, 'p'.repeat(LIMITS.textLength + 1));
    expect(payload).toHaveAttribute('aria-invalid', 'true');
    expect(payload).toHaveAccessibleDescription(/\d/);
  });

  it('forgets what was refused when another producer is shown', async () => {
    const { give, fixture, settle } = await renderComposer();
    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '0');
    expect(screen.getByTestId('refusal')).toBeVisible();

    fixture.componentRef.setInput('id', 'L');
    settle();
    settle();

    expect(screen.queryByTestId('refusal')).toBeNull();
  });

  it('sets the payload and the key with the command that sets them, logs the line that does the same, and says what it did', async () => {
    const { give, producer, log, status } = await renderComposer();

    give(screen.getByRole('textbox', { name: 'Payload' }), 'goodbye');
    give(screen.getByRole('textbox', { name: 'Routing key' }), 'old');

    expect(producer()?.message).toMatchObject({ payload: 'goodbye', key: 'old' });
    expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual([
      'inspector: set sender payload=goodbye',
      'inspector: set sender key=old',
    ]);
    expect(status.notice()).toEqual({ kind: 'message', text: 'Changed the routing key of producer sender.' });
  });

  it('does nothing for a value that is the one that the document has, and says nothing', async () => {
    const { give, log, status } = await renderComposer();

    give(screen.getByRole('textbox', { name: 'Payload' }), 'hello');

    expect(log.entries()).toEqual([]);
    expect(status.notice()).toBeNull();
  });

  it('forgets the refusal, under the field and on the status line, when the learner gives what the document has again', async () => {
    const { give, status } = await renderComposer();
    const key = screen.getByRole('textbox', { name: 'Routing key' });
    give(key, 'k'.repeat(300));
    expect(screen.getByTestId('refusal')).toBeVisible();
    expect(status.refusal()).not.toBeNull();

    give(key, 'new');

    expect(screen.queryByTestId('refusal')).toBeNull();
    expect(status.refusal()).toBeNull();
  });

  it('does nothing for a number that is the one that the document has, and says nothing', async () => {
    const { give, log, status } = await renderComposer();

    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '2');

    expect(log.entries()).toEqual([]);
    expect(status.notice()).toBeNull();
    expect(screen.queryByTestId('refusal')).toBeNull();
  });

  it('sets the burst and the time between sends, and a switch turns the repeat on and off', async () => {
    const { give, producer, user, settle } = await renderComposer();

    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '5');
    give(screen.getByRole('spinbutton', { name: 'Milliseconds between sends' }), '250');
    await user.click(screen.getByRole('switch', { name: 'Keeps sending' }));
    settle();

    expect(producer()).toMatchObject({ burst: 5, interval: { everyMs: 250, on: true } });
    expect(screen.getByRole('switch', { name: 'Keeps sending' })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('switch', { name: 'Keeps sending' }));
    settle();

    expect(producer()?.interval.on).toBe(false);
  });

  it('puts back what the document has, and says under the field why, when a value is refused', async () => {
    const { give, producer, log } = await renderComposer();
    const burst = screen.getByRole('spinbutton', { name: 'Messages at a time' });

    give(burst, '0');

    expect(producer()?.burst).toBe(2);
    expect(burst).toHaveValue(2);
    expect(burst).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('refusal-message')).toHaveTextContent(/burst/i);
    expect(burst).toHaveAttribute('aria-describedby', screen.getByTestId('refusal').closest('[id]')?.id ?? 'x');
    expect(burst).toHaveAccessibleDescription(/burst/i);
    expect(log.entries()).toEqual([]);
  });

  it('refuses a key that no client could send, with the words of the grammar, and puts the old one back', async () => {
    const { give, producer } = await renderComposer();
    const key = screen.getByRole('textbox', { name: 'Routing key' });

    give(key, 'k'.repeat(300));

    expect(producer()?.message.key).toBe('new');
    expect(key).toHaveValue('new');
    expect(screen.getByTestId('refusal-message')).toHaveTextContent('255');
  });

  it('refuses a payload that is too long', async () => {
    const { give, producer } = await renderComposer();

    give(screen.getByRole('textbox', { name: 'Payload' }), 'p'.repeat(LIMITS.textLength + 1));

    expect(producer()?.message.payload).toBe('hello');
    expect(screen.getByTestId('refusal')).toBeVisible();
  });

  it('says that a number has to be one, and leaves the field as it was', async () => {
    const { give, producer } = await renderComposer();
    const every = screen.getByRole('spinbutton', { name: 'Milliseconds between sends' });

    give(every, '');

    expect(producer()?.interval.everyMs).toBe(500);
    expect(every).toHaveValue(500);
    expect(screen.getByTestId('refusal-message')).toHaveTextContent(
      'The time between sends has to be a number. It stays as it was.',
    );
  });

  it('forgets a refusal when something is changed that is not refused', async () => {
    const { give } = await renderComposer();
    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '0');
    expect(screen.getByTestId('refusal')).toBeVisible();

    give(screen.getByRole('spinbutton', { name: 'Messages at a time' }), '3');

    expect(screen.queryByTestId('refusal')).toBeNull();
  });

  it('publishes now, with the command, and says how many it sent', async () => {
    const { user, status, log, settle } = await renderComposer();

    await user.click(screen.getByRole('button', { name: 'Publish now' }));
    settle();

    expect(status.notice()).toEqual({ kind: 'message', text: 'Published 2 messages from sender.' });
    expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual(['inspector: publish sender']);
  });

  it('says why a producer that is linked to nothing cannot publish, under the button, and forgets it when the click is another', async () => {
    const { user, settle, bus } = await renderComposer('L');

    await user.click(screen.getByRole('button', { name: 'Publish now' }));
    settle();

    expect(screen.getByTestId('publish-problem')).toHaveTextContent("The producer 'lonely' is not linked to anything");

    bus.apply({ type: 'link', producer: 'lonely', target: { kind: 'queue', name: 'billing' } }, 'inspector');
    await user.click(screen.getByRole('button', { name: 'Publish now' }));
    settle();

    expect(screen.queryByTestId('publish-problem')).toBeNull();
  });

  it('shows nothing for what is not a producer, or for one that is gone', async () => {
    const { container } = await renderComposer('Q');

    expect(container.querySelector('[data-testid="producer-composer"]')).toBeNull();
  });
});

describe('the table of headers, with the flag headers (ADR-0069)', () => {
  /** The composer of the producer `sender`, with the flags `simulation` and `headers`. */
  async function renderTable(flags = 'simulation,headers', id = 'P') {
    const view = await render(ProducerComposer, {
      inputs: { id },
      providers: [
        DocumentStore,
        SelectionStore,
        StatusStore,
        CommandBus,
        CommandLog,
        ...RUNTIME_SERVICES,
        { provide: FRAME_SOURCE, useValue: manualFrames() },
        { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
      ],
    });
    const bus = TestBed.inject(CommandBus);
    TestBed.inject(CommandLog);
    const simulation = TestBed.inject(Simulation);
    const store = TestBed.inject(DocumentStore);
    store.load(canvas());
    simulation.execute({ type: 'pause' });
    view.fixture.detectChanges();
    const applied: string[] = [];
    bus.onApplied(({ command }) => applied.push(command.type));
    return {
      ...view,
      bus,
      store,
      applied,
      user: userEvent.setup(),
      settle: () => view.fixture.detectChanges(),
      headers: () => store.document().producers['P']?.message.headers,
    };
  }

  const name = (index: number) => screen.getByRole('textbox', { name: `Name of header ${index}` });
  const value = (index: number) => screen.getByRole('textbox', { name: `Value of header ${index}` });
  const type = (index: number) => screen.getByRole('combobox', { name: `Type of header ${index}` });

  it('shows a row for each header of the message, with its type, in place of the sentence about the table that is coming', async () => {
    await renderTable();

    expect(screen.queryByTestId('composer-headers')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Headers' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Headers' })).toBeInTheDocument();
    expect(name(1)).toHaveValue('n');
    expect(value(1)).toHaveValue('1');
    expect(type(1)).toHaveValue('integer');
    expect(screen.getByRole('button', { name: 'Add header' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Help: Headers' })).toBeInTheDocument();
  });

  it('has no exists among the types, because a header of a message has a value', async () => {
    await renderTable();

    const options = Array.from(type(1).querySelectorAll('option')).map((option) => option.textContent?.trim());
    expect(options).toEqual(['string', 'integer', 'float', 'boolean']);
  });

  it('is not there without the flag, and the composer says how many headers there are', async () => {
    await renderTable('simulation');

    expect(screen.queryByTestId('composer-headers-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('composer-headers')).toHaveTextContent('The message has 1 header.');
  });

  it('explains how a value gets its type, in the help', async () => {
    const { user } = await renderTable();

    await user.click(screen.getByRole('button', { name: 'Help: Headers' }));

    expect(screen.getByTestId('help-text')).toHaveTextContent(
      'A number is an integer: 1. With a point it is a float: 1.0.',
    );
    expect(screen.getByTestId('help-text')).toHaveTextContent('"1" is not 1');
  });

  describe('applying it, row by row', () => {
    it('sets a header that is new when its row is complete and its control is left, as the line that a learner would type', async () => {
      const { user, headers, applied } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));
      await user.type(name(2), 'format');
      await user.tab();
      expect(headers()).toHaveLength(1);

      await user.type(value(2), 'pdf');
      await user.tab();

      expect(headers()).toEqual([
        { key: 'n', value: { t: 'integer', v: 1 } },
        { key: 'format', value: { t: 'string', v: 'pdf' } },
      ]);
      expect(applied).toEqual(['set']);
      expect(TestBed.inject(CommandLog).latest()?.text).toBe('set sender header:format=pdf');
    });

    it('sets the value that was typed with the type that it reads as, and the new text is the one that the document has', async () => {
      const { user, headers } = await renderTable();

      await user.clear(value(1));
      await user.type(value(1), '2.5');
      await user.tab();

      expect(headers()).toEqual([{ key: 'n', value: { t: 'float', v: 2.5 } }]);
      expect(type(1)).toHaveValue('float');
    });

    it('turns 1 into "1" when the type string is chosen, which is the lesson of a headers exchange, and applies it at once', async () => {
      const { user, headers } = await renderTable();

      await user.selectOptions(type(1), 'string');

      expect(value(1)).toHaveValue('"1"');
      expect(headers()).toEqual([{ key: 'n', value: { t: 'string', v: '1' } }]);
      expect(TestBed.inject(CommandLog).latest()?.text).toBe('set sender header:n="1"');
    });

    it('takes a header off with the button of its row, as an unset', async () => {
      const { user, headers, applied } = await renderTable();

      await user.click(screen.getByRole('button', { name: 'Remove header 1, n' }));

      expect(headers()).toEqual([]);
      expect(applied).toEqual(['unset']);
      expect(TestBed.inject(CommandLog).latest()?.text).toBe('unset sender header:n');
    });

    it('is one step of undo, an unset and a set, for a name that was changed', async () => {
      const { user, headers, store, bus } = await renderTable();

      await user.clear(name(1));
      await user.type(name(1), 'm');
      await user.tab();

      expect(headers()).toEqual([{ key: 'm', value: { t: 'integer', v: 1 } }]);
      expect(TestBed.inject(CommandLog).latest()?.text).toBe('unset sender header:n; set sender header:m=1');
      bus.undo('toolbar');
      expect(store.document().producers['P']?.message.headers).toEqual([{ key: 'n', value: { t: 'integer', v: 1 } }]);
    });

    it('applies nothing when a control is left and nothing was changed, so that there is no step of undo for it', async () => {
      const { user, applied } = await renderTable();

      await user.click(value(1));
      await user.tab();

      expect(applied).toEqual([]);
    });

    it('applies nothing when an empty row is taken off, because the message has the headers it had', async () => {
      const { user, applied, headers } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));

      await user.click(screen.getByRole('button', { name: 'Remove header 2' }));

      expect(applied).toEqual([]);
      expect(headers()).toEqual([{ key: 'n', value: { t: 'integer', v: 1 } }]);
      expect(screen.getAllByTestId('header-row')).toHaveLength(1);
    });

    it('applies what is typed before Publish now is pressed, because leaving the field comes first', async () => {
      const { user, headers } = await renderTable();

      await user.clear(value(1));
      await user.type(value(1), '9');
      await user.click(screen.getByRole('button', { name: 'Publish now' }));

      expect(headers()).toEqual([{ key: 'n', value: { t: 'integer', v: 9 } }]);
    });
  });

  describe('a row that is not finished', () => {
    it('stays in the table, says what it needs, and applies nothing, so that the message keeps the headers it had', async () => {
      const { user, headers, applied } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));

      await user.type(name(2), 'format');
      await user.tab();

      expect(headers()).toEqual([{ key: 'n', value: { t: 'integer', v: 1 } }]);
      expect(applied).toEqual([]);
      expect(name(2)).toHaveValue('format');
      expect(screen.getByTestId('header-value-problem')).toHaveTextContent('A header needs a value');
    });

    it('is applied with everything else when it is finished, as one set', async () => {
      const { user, headers, applied } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));
      await user.type(name(2), 'format');
      await user.tab();
      await user.clear(value(1));
      await user.type(value(1), '5');
      await user.tab();
      // The other row is not finished, so the table applies nothing.
      expect(applied).toEqual([]);

      await user.type(value(2), 'pdf');
      await user.tab();

      expect(headers()).toEqual([
        { key: 'n', value: { t: 'integer', v: 5 } },
        { key: 'format', value: { t: 'string', v: 'pdf' } },
      ]);
      expect(applied).toEqual(['set']);
    });

    it('is not lost when the row before it is applied, because an empty row is not a problem and a table keeps itself through its own commands', async () => {
      const { user, headers } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));

      await user.clear(value(1));
      await user.type(value(1), '3');
      await user.tab();

      expect(headers()).toEqual([{ key: 'n', value: { t: 'integer', v: 3 } }]);
      expect(screen.getAllByTestId('header-row')).toHaveLength(2);
    });

    it('says that a name is there twice, on both rows, and applies nothing', async () => {
      const { user, headers, applied } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));

      await user.type(name(2), 'n');
      await user.type(value(2), '2');
      await user.tab();

      expect(applied).toEqual([]);
      expect(headers()).toEqual([{ key: 'n', value: { t: 'integer', v: 1 } }]);
      expect(name(1)).toHaveAttribute('aria-invalid', 'true');
      expect(name(2)).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getAllByTestId('header-key-problem')[0]).toHaveTextContent("The header 'n' is there twice");
    });

    it('says why a value cannot be read, and does not apply it', async () => {
      const { user, headers } = await renderTable();

      await user.clear(value(1));
      await user.type(value(1), '9007199254740993');
      await user.tab();

      expect(headers()).toEqual([{ key: 'n', value: { t: 'integer', v: 1 } }]);
      expect(screen.getByTestId('header-value-problem')).toHaveTextContent('An integer header must be a whole number');
    });

    it('says what is wrong with a row under the row, and not again under the table', async () => {
      const { user } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));
      await user.type(name(2), 'n');
      await user.type(value(2), '2');

      expect(screen.getAllByTestId('header-key-problem')).toHaveLength(2);
      expect(screen.queryByTestId('composer-headers-count')).not.toBeInTheDocument();
    });

    it('says what the bus refused when it applied the table, under the table', async () => {
      const { user, bus } = await renderTable();
      vi.spyOn(bus, 'apply').mockReturnValueOnce({ ok: false, error: { kind: 'canvas-full', message: 'Full.' } });

      await user.click(screen.getByRole('button', { name: 'Remove header 1, n' }));

      expect(within(screen.getByTestId('composer-headers-problem')).getByText('Full.')).toBeInTheDocument();
    });

    it('says that there are too many headers, under the table, when no row has the problem', async () => {
      const { store, settle } = await renderTable();
      const many = Array.from({ length: 101 }, (_, index) => ({ key: `h${index}`, value: { t: 'integer', v: index } }));
      store.load({
        ...canvas(),
        producers: {
          ...canvas().producers,
          P: {
            ...(canvas().producers['P'] as NonNullable<CanvasDocument['producers'][string]>),
            message: { payload: '', key: '', headers: many },
          },
        },
      } as CanvasDocument);
      settle();

      expect(screen.getByTestId('composer-headers-count')).toHaveTextContent(
        'The headers of one message are at most 100, and there are 101. Take some off.',
      );
    });
  });

  describe('where it starts from', () => {
    it('starts again from the message when its headers change from somewhere else, and drops what was not finished', async () => {
      const { user, bus, settle } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));
      await user.type(name(2), 'half');

      bus.apply(
        {
          type: 'set',
          kind: 'producer',
          name: 'sender',
          changes: { headers: [{ key: 'm', value: { t: 'string', v: 'x' } }] },
        },
        'typed',
      );
      settle();

      expect(screen.getAllByTestId('header-row')).toHaveLength(2);
      expect(name(1)).toHaveValue('n');
      expect(name(2)).toHaveValue('m');
      expect(value(2)).toHaveValue('x');
    });

    it('follows an undo', async () => {
      const { user, bus, settle } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Remove header 1, n' }));
      expect(screen.queryAllByTestId('header-row')).toHaveLength(0);

      bus.undo('toolbar');
      settle();

      expect(name(1)).toHaveValue('n');
    });

    it('starts again when another producer is shown that has the very same headers, which is another table', async () => {
      const { user, fixture, store, settle } = await renderTable();
      store.load({
        ...canvas(),
        producers: {
          ...canvas().producers,
          L: {
            ...(canvas().producers['L'] as NonNullable<CanvasDocument['producers'][string]>),
            message: { payload: '', key: '', headers: [{ key: 'n', value: { t: 'integer', v: 1 } }] },
          },
        },
      } as CanvasDocument);
      settle();
      await user.click(screen.getByRole('button', { name: 'Add header' }));
      await user.type(name(2), 'half');
      expect(screen.getAllByTestId('header-row')).toHaveLength(2);

      fixture.componentRef.setInput('id', 'L');
      fixture.detectChanges();

      expect(screen.getAllByTestId('header-row')).toHaveLength(1);
      expect(name(1)).toHaveValue('n');
    });

    it('starts again when another producer is shown, whatever the first had in the table', async () => {
      const { user, fixture } = await renderTable();
      await user.click(screen.getByRole('button', { name: 'Add header' }));
      await user.type(name(2), 'half');

      fixture.componentRef.setInput('id', 'L');
      fixture.detectChanges();

      expect(screen.queryAllByTestId('header-row')).toHaveLength(0);
    });
  });

  describe('the routing key of a producer that publishes to a headers exchange (ADR-0009)', () => {
    const NOTE = 'Not used by this exchange; still carried for exchange-to-exchange hops and dead-lettering.';

    async function publishingToHeaders(flags = 'simulation,headers') {
      const view = await renderTable(flags);
      view.store.load({
        ...canvas(),
        exchanges: { ...canvas().exchanges, H: exchangeRecord('docs', 'headers') },
        producers: {
          ...canvas().producers,
          P: {
            ...(canvas().producers['P'] as NonNullable<CanvasDocument['producers'][string]>),
            target: { kind: 'exchange', id: 'H' },
          },
        },
      } as CanvasDocument);
      view.settle();
      return view;
    }

    it('says that the exchange does not use it, and that it is still carried, and does not grey the field out', async () => {
      await publishingToHeaders();

      const field = screen.getByRole('textbox', { name: 'Routing key' });
      expect(screen.getByTestId('composer-key-note')).toHaveTextContent(NOTE);
      expect(field).toBeEnabled();
      expect(field).not.toHaveAttribute('readonly');
      expect(field).toHaveAccessibleDescription(NOTE);
      expect(field).toHaveValue('new');
    });

    it('is still a field that sets the key', async () => {
      const { user, producer } = {
        ...(await publishingToHeaders()),
        producer: () => TestBed.inject(DocumentStore).document().producers['P'],
      };

      await user.clear(screen.getByRole('textbox', { name: 'Routing key' }));
      await user.type(screen.getByRole('textbox', { name: 'Routing key' }), 'a.b');
      await user.tab();

      expect(producer()?.message.key).toBe('a.b');
    });

    it('is described by the note and the refusal both, when the key is refused', async () => {
      await publishingToHeaders();

      const field = screen.getByRole('textbox', { name: 'Routing key' });
      field.focus();
      (field as HTMLInputElement).value = 'k'.repeat(256);
      fireEvent.change(field);

      await waitForRefusal();
      expect(field).toHaveAccessibleDescription(new RegExp(`${NOTE.slice(0, 20)}.*`, 'u'));
    });

    it('says nothing for an exchange that reads the key, or a producer that publishes to a queue, or with no target', async () => {
      await renderTable();
      expect(screen.queryByTestId('composer-key-note')).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Routing key' })).not.toHaveAttribute('aria-describedby');
    });

    it('is described by its refusal alone when the exchange reads the key, and the note is not named', async () => {
      await renderTable();
      const field = screen.getByRole('textbox', { name: 'Routing key' });
      field.focus();
      (field as HTMLInputElement).value = 'k'.repeat(256);
      fireEvent.change(field);

      await waitForRefusal();
      const ids = (field.getAttribute('aria-describedby') ?? '').split(' ');
      expect(ids).toHaveLength(1);
      expect(document.getElementById(ids[0] as string)).toContainElement(screen.getByTestId('refusal'));
    });

    it('is described by the note alone when the key is fine, and the refusal is not named', async () => {
      await publishingToHeaders();

      const field = screen.getByRole('textbox', { name: 'Routing key' });
      const ids = (field.getAttribute('aria-describedby') ?? '').split(' ');
      expect(ids).toHaveLength(1);
      expect(document.getElementById(ids[0] as string)).toBe(screen.getByTestId('composer-key-note'));
    });

    it('says nothing without the flag, even for a headers exchange', async () => {
      await publishingToHeaders('simulation');

      expect(screen.queryByTestId('composer-key-note')).not.toBeInTheDocument();
    });
  });
});

/** A refusal is drawn when the next change detection has run. */
async function waitForRefusal(): Promise<void> {
  await screen.findByTestId('refusal');
}
