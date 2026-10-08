import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import type { HeaderEntry, HeaderValue } from '@rmq/engine';
import {
  bindingRecord,
  bool,
  documentOf,
  entry,
  exchangeRecord,
  float,
  headerArguments,
  int,
  manualFrames,
  queueRecord,
  str,
} from '@rmq/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EventLog } from '../core/explain/event-log';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { FRAME_SOURCE } from '../core/runtime/frame-loop';
import { MOTION_QUERY } from '../core/runtime/motion';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { Simulation } from '../core/runtime/simulation';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { BindFromMessage } from './bind-from-message';

/** A headers exchange `docs` bound to `pdfs`, a second one, `reports`, a direct exchange `orders`, and two queues that nothing else is bound to. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: {
      D: exchangeRecord('docs', 'headers'),
      R: exchangeRecord('reports', 'headers'),
      O: exchangeRecord('orders', 'direct'),
    },
    queues: { Q: queueRecord('pdfs'), S: queueRecord('rest'), A: queueRecord('archive') },
    bindings: {
      B: bindingRecord('D', { kind: 'queue', id: 'Q' }, '', headerArguments('all', entry('format', str('pdf')))),
    },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const HEADERS: HeaderEntry<HeaderValue>[] = [
  entry('format', str('pdf')),
  entry('n', int(1)),
  entry('s', str('1')),
  entry('f', float(1)),
  entry('ok', bool(true)),
];

interface Options {
  readonly headers?: HeaderEntry<HeaderValue>[];
  readonly exchange?: string;
  readonly unreached?: string[];
  readonly document?: CanvasDocument;
  readonly number?: number;
}

function renderPanel(options: Options = {}) {
  const frames = manualFrames();
  TestBed.configureTestingModule({
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
      { provide: FRAME_SOURCE, useValue: frames },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation,explain' } },
      {
        provide: MOTION_QUERY,
        useValue: { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
      },
    ],
  });
  const bus = TestBed.inject(CommandBus);
  const log = TestBed.inject(EventLog);
  TestBed.inject(CommandLog);
  TestBed.inject(Simulation);
  const store = TestBed.inject(DocumentStore);
  store.load(options.document ?? canvas());
  bus.run({ type: 'pause' }, 'toolbar');
  const fixture = TestBed.createComponent(BindFromMessage);
  fixture.componentRef.setInput('number', options.number ?? 1);
  fixture.componentRef.setInput('headers', options.headers ?? HEADERS);
  fixture.componentRef.setInput('exchange', options.exchange ?? 'docs');
  fixture.componentRef.setInput('unreached', options.unreached ?? []);
  fixture.detectChanges();
  const user = userEvent.setup();
  const set = (name: string, value: unknown): void => {
    fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
  };
  const publish = (to: string, ...headers: HeaderEntry<HeaderValue>[]): void => {
    const command: RuntimeCommand = { type: 'publish', from: { kind: 'exchange', name: to }, key: '', headers };
    bus.run(command, 'toolbar');
    log.flush();
    fixture.detectChanges();
  };
  return {
    fixture,
    bus,
    store,
    user,
    set,
    publish,
    selection: TestBed.inject(SelectionStore),
    status: TestBed.inject(StatusStore),
    open: async () => {
      await user.click(screen.getByRole('button', { name: 'Bind from this message…' }));
    },
  };
}

const line = () => screen.getByTestId('bind-line');
const ticks = () => screen.getAllByTestId('bind-tick') as HTMLInputElement[];

describe('BindFromMessage (ADR-0070)', () => {
  it('is shut until its button is pressed, which says what it controls', async () => {
    const { open } = renderPanel();
    const button = screen.getByRole('button', { name: 'Bind from this message…' });

    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('bind-body')).not.toBeInTheDocument();

    await open();

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button.getAttribute('aria-controls')).toBe(screen.getByTestId('bind-body').id);
    expect(screen.getByTestId('bind-body').id).toMatch(/^rmq-bind-\d+-body$/u);
    expect(screen.getByRole('region', { name: 'Bind from this message…' })).toBeInTheDocument();
  });

  it('offers the four modes, as the editor of a binding does, with all chosen', async () => {
    const { open } = renderPanel();
    await open();

    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual([
      'all',
      'any',
      'all-with-x',
      'any-with-x',
    ]);
    expect(screen.getByRole('radio', { name: 'any-with-x' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'all' })).toBeChecked();
  });

  it('has no note of x-match and no list of notes for a message that has nothing to note', async () => {
    const { open } = renderPanel();
    await open();

    expect(screen.queryByTestId('bind-reserved')).not.toBeInTheDocument();
    expect(screen.queryByTestId('bind-notes')).not.toBeInTheDocument();
  });

  it('ticks a header again that was unticked, and makes it a condition again', async () => {
    const { open, user } = renderPanel();
    await open();
    const mark = screen.getByRole('checkbox', { name: 'Use the header n as a condition' });

    await user.click(mark);
    expect(line().textContent).not.toContain(' n=1');
    await user.click(mark);

    expect(mark).toBeChecked();
    expect(line()).toHaveTextContent('bind docs -> pdfs x-match=all format=pdf n=1 s="1" f=1.0 ok=true');
  });

  it('lists the headers of the message with a tick for each, all ticked, with their types and values exactly', async () => {
    const { open } = renderPanel();
    await open();

    const table = screen.getByTestId('bind-headers');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent?.trim()),
    ).toEqual(['Use', 'Name', 'Type', 'Value']);
    const rows = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole('cell')
          .slice(1)
          .map((cell) => cell.textContent?.trim()),
      );
    expect(rows).toEqual([
      ['format', 'string', '"pdf"'],
      ['n', 'integer', '1'],
      ['s', 'string', '"1"'],
      ['f', 'float', '1.0'],
      ['ok', 'boolean', 'true'],
    ]);
    expect(ticks().map((tick) => tick.checked)).toEqual([true, true, true, true, true]);
    expect(screen.getByRole('checkbox', { name: 'Use the header s as a condition' })).toBeChecked();
  });

  it('makes the one line that a learner would type from the ticked headers, with each type as the grammar writes it', async () => {
    const { open } = renderPanel();
    await open();

    expect(line()).toHaveTextContent('bind docs -> pdfs x-match=all format=pdf n=1 s="1" f=1.0 ok=true');
    expect(screen.getByTestId('bind-sentence')).toHaveTextContent(
      'x-match=all: a message matches when all 5 conditions hold (format, n, s, f and ok).',
    );
  });

  it('leaves out the header that is unticked, in the line and in the sentence, and the message still passes what is left', async () => {
    const { open, user } = renderPanel();
    await open();

    await user.click(screen.getByRole('checkbox', { name: 'Use the header n as a condition' }));
    await user.click(screen.getByRole('checkbox', { name: 'Use the header f as a condition' }));

    expect(line()).toHaveTextContent('bind docs -> pdfs x-match=all format=pdf s="1" ok=true');
    expect(screen.getByTestId('bind-sentence')).toHaveTextContent('all 3 conditions hold (format, s and ok)');
  });

  it('is a binding with no conditions when nothing is ticked, and says that it matches every message', async () => {
    const { open, user } = renderPanel({ headers: [entry('a', int(1))] });
    await open();

    await user.click(screen.getByRole('checkbox', { name: 'Use the header a as a condition' }));

    expect(line()).toHaveTextContent('bind docs -> pdfs x-match=all');
    expect(screen.getByTestId('bind-sentence')).toHaveTextContent('no condition counts, so it matches every message');
  });

  describe('the target', () => {
    it('starts from the exchange the message was published to when that reads headers, and lists the headers exchanges', async () => {
      const { open } = renderPanel({ exchange: 'reports' });
      await open();

      const from = screen.getByRole('combobox', { name: 'From the headers exchange' });
      expect(from).toHaveValue('reports');
      expect(
        within(from)
          .getAllByRole('option')
          .map((option) => option.textContent?.trim()),
      ).toEqual(['docs', 'reports']);
      expect(line()).toHaveTextContent('bind reports -> ');
    });

    it('lists what the rules allow, queues and exchanges, as the picker does, and not a consumer or a producer', async () => {
      const { open } = renderPanel();
      await open();

      const to = screen.getByRole('combobox', { name: 'To' });
      expect(
        within(to)
          .getAllByRole('option')
          .map((option) => option.textContent?.trim()),
      ).toEqual(['exchange docs', 'exchange reports', 'exchange orders', 'queue pdfs', 'queue rest', 'queue archive']);
    });

    it('starts from the first queue that did not get the message, so that the binding is one that would make a difference', async () => {
      const { open } = renderPanel({ unreached: ['rest', 'archive'] });
      await open();

      expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('queue:rest');
      expect(line()).toHaveTextContent('bind docs -> rest x-match=all');
    });

    it('starts from the first queue when the message got to every queue, and from the first target when there is no queue', async () => {
      const { open } = renderPanel({ unreached: [] });
      await open();
      expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('queue:pdfs');
    });

    it('starts from the first target, which is an exchange, when the canvas has no queue', async () => {
      const { open } = renderPanel({
        document: documentOf({ exchanges: { D: exchangeRecord('docs', 'headers'), O: exchangeRecord('orders') } }),
      });
      await open();

      expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('exchange:docs');
    });

    it('binds to the target that is chosen, and to another exchange', async () => {
      const { open, user } = renderPanel();
      await open();

      await user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'queue:archive');
      expect(line()).toHaveTextContent('bind docs -> archive x-match=all');
      await user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'exchange:reports');
      expect(line()).toHaveTextContent('bind docs -> reports x-match=all');
    });

    it('goes back to the first target when another exchange is chosen, which has targets of its own', async () => {
      const { open, user } = renderPanel({ unreached: ['archive'] });
      await open();
      await user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'queue:rest');

      await user.selectOptions(screen.getByRole('combobox', { name: 'From the headers exchange' }), 'reports');

      expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('queue:archive');
      expect(line()).toHaveTextContent('bind reports -> archive');
    });
  });

  describe('a message that does not suit', () => {
    it('says that a message with no headers has nothing to make a condition of, and what to do', async () => {
      const { open } = renderPanel({ headers: [] });
      await open();

      expect(screen.getByTestId('bind-no-headers')).toHaveTextContent(
        'This message has no headers, so there is nothing to make a condition of. Give the producer some in the table under its routing key',
      );
      expect(screen.queryByRole('button', { name: 'Create binding' })).not.toBeInTheDocument();
      expect(screen.queryByTestId('bind-headers')).not.toBeInTheDocument();
    });

    it('says that a canvas with no headers exchange has nothing to bind from', async () => {
      const { open } = renderPanel({
        document: documentOf({
          exchanges: { O: exchangeRecord('orders', 'direct') },
          queues: { Q: queueRecord('pdfs') },
        }),
      });
      await open();

      expect(screen.getByTestId('bind-no-exchange')).toHaveTextContent('There is no headers exchange on the canvas.');
      expect(screen.queryByRole('button', { name: 'Create binding' })).not.toBeInTheDocument();
    });

    it('says that the exchange the message went to does not read headers, and offers the headers exchanges', async () => {
      const { open } = renderPanel({ exchange: 'orders' });
      await open();

      expect(screen.getByTestId('bind-elsewhere')).toHaveTextContent(
        'This message was published to the direct exchange orders, which does not read headers. The binding is made on the headers exchange you choose, and a message published there is checked by it.',
      );
      expect(screen.getByRole('combobox', { name: 'From the headers exchange' })).toHaveValue('docs');
    });

    it('says the same of the default exchange, in those words', async () => {
      const { open } = renderPanel({ exchange: '' });
      await open();

      expect(screen.getByTestId('bind-elsewhere')).toHaveTextContent(
        'published to the default exchange, which does not read',
      );
    });

    it('says nothing of that for a message that was published to a headers exchange, or to one that is not on the canvas any more', async () => {
      const { open, set } = renderPanel();
      await open();
      expect(screen.queryByTestId('bind-elsewhere')).not.toBeInTheDocument();

      set('exchange', 'gone');
      expect(screen.queryByTestId('bind-elsewhere')).not.toBeInTheDocument();
    });

    it('does not let the header called x-match be a condition, and says why, because it is the mode of a binding', async () => {
      const { open } = renderPanel({ headers: [entry('x-match', str('any')), entry('format', str('pdf'))] });
      await open();

      const mark = screen.getByRole('checkbox', { name: 'Use the header x-match as a condition' });
      expect(mark).toBeDisabled();
      expect(mark).not.toBeChecked();
      expect(mark).toHaveAccessibleDescription(/^'x-match' is the mode of a headers binding/u);
      expect(screen.getByTestId('bind-reserved')).toHaveTextContent(
        "'x-match' is the mode of a headers binding (all, any, all-with-x or any-with-x), and not a condition. Choose the mode with the control below.",
      );
      expect(line()).toHaveTextContent('bind docs -> pdfs x-match=all format=pdf');
      expect(line().textContent).not.toContain('x-match=any');
    });
  });

  describe('what it says about the conditions', () => {
    it('is the mode that is chosen, in the line and in the sentence', async () => {
      const { open, user } = renderPanel();
      await open();

      await user.click(screen.getByRole('radio', { name: 'any' }));

      expect(line()).toHaveTextContent('x-match=any');
      expect(screen.getByTestId('bind-sentence')).toHaveTextContent(
        'x-match=any: a message matches when at least one of the 5',
      );
    });

    it('says that an x- header is not counted by all, and is by all-with-x, as the mode changes', async () => {
      const { open, user } = renderPanel({ headers: [entry('x-trace', str('1')), entry('format', str('pdf'))] });
      await open();
      expect(screen.getByTestId('bind-notes')).toHaveTextContent('The header x-trace is not counted');

      await user.click(screen.getByRole('radio', { name: 'all-with-x' }));

      expect(screen.getByTestId('bind-notes')).toHaveTextContent(
        'The header x-trace is counted, because x-match is all-with-x.',
      );
    });

    it('warns that any with nothing that counts matches no message, and does not stop the binding', async () => {
      const { open, user } = renderPanel({ headers: [entry('x-trace', str('1'))] });
      await open();

      await user.click(screen.getByRole('radio', { name: 'any' }));

      expect(screen.getByTestId('bind-lint')).toHaveTextContent('x-match=any and no condition that counts');
      expect(screen.getByRole('button', { name: 'Create binding' })).toBeEnabled();
    });

    it('shows the table of recent messages against the conditions that are ticked, the message itself among them', async () => {
      const { open, user, publish } = renderPanel();
      publish('docs', ...HEADERS);
      publish('docs', entry('format', str('doc')));
      await open();

      const table = screen.getByTestId('headers-live-table');
      expect(within(table).getAllByTestId('headers-live-row')).toHaveLength(2);
      const [newest, oldest] = within(table).getAllByTestId('headers-live-result');
      expect(newest).toHaveTextContent('Does not match');
      expect(oldest).toHaveTextContent('Matches');

      await user.click(screen.getByRole('checkbox', { name: 'Use the header n as a condition' }));
      await user.click(screen.getByRole('checkbox', { name: 'Use the header s as a condition' }));
      await user.click(screen.getByRole('checkbox', { name: 'Use the header f as a condition' }));
      await user.click(screen.getByRole('checkbox', { name: 'Use the header ok as a condition' }));

      expect(
        within(table)
          .getAllByRole('columnheader')
          .map((cell) => cell.textContent?.trim()),
      ).toEqual(['Message', 'format=pdf', 'Result']);
    });
  });

  describe('Create binding', () => {
    it('makes the one bind through the bus, as one step of undo with the line that the learner sees, with the inspector as its origin', async () => {
      const { open, user, bus, store } = renderPanel({ unreached: ['rest'] });
      const origins: string[] = [];
      bus.onApplied(({ origin, command }) => origins.push(`${origin}:${command.type}`));
      await open();

      await user.click(screen.getByRole('button', { name: 'Create binding' }));

      expect(origins).toEqual(['inspector:bind']);
      const made = Object.values(store.document().bindings).find(({ dest }) => dest.id === 'S');
      expect(made).toMatchObject({
        source: 'D',
        key: '',
        headers: headerArguments(
          'all',
          entry('format', str('pdf')),
          entry('n', int(1)),
          entry('s', str('1')),
          entry('f', float(1)),
          entry('ok', bool(true)),
        ),
      });
      expect(TestBed.inject(CommandLog).latest()?.text).toBe(
        'bind docs -> rest x-match=all format=pdf n=1 s="1" f=1.0 ok=true',
      );
      bus.undo('toolbar');
      expect(Object.values(store.document().bindings).find(({ dest }) => dest.id === 'S')).toBeUndefined();
    });

    it('selects the new edge, says so, and shuts, so that the inspector below it shows the binding', async () => {
      const { open, user, selection, status } = renderPanel({ unreached: ['rest'] });
      await open();

      await user.click(screen.getByRole('button', { name: 'Create binding' }));

      expect(selection.selection()).toEqual({ nodes: [], edges: ['D>S'] });
      expect(status.notice()).toEqual({ kind: 'message', text: 'Bound exchange docs to queue rest.' });
      expect(screen.queryByTestId('bind-body')).not.toBeInTheDocument();
    });

    it('says that a binding with those conditions is there already, and makes nothing, and stays open', async () => {
      const { open, user, status } = renderPanel({ headers: [entry('format', str('pdf'))], unreached: [] });
      await open();
      await user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'queue:pdfs');

      await user.click(screen.getByRole('button', { name: 'Create binding' }));

      expect(status.notice()).toEqual({ kind: 'message', text: 'Already bound with those conditions.' });
      expect(screen.getByTestId('bind-body')).toBeInTheDocument();
    });

    it('shows the refusal under the button, once, and keeps what was chosen', async () => {
      const { open, user, bus, status } = renderPanel({ unreached: ['rest'] });
      await open();
      vi.spyOn(bus, 'apply').mockReturnValueOnce({
        ok: false,
        error: { kind: 'canvas-full', message: 'This canvas has all the edges it can hold.' },
      });

      await user.click(screen.getByRole('button', { name: 'Create binding' }));

      expect(screen.getByTestId('bind-refusal')).toHaveTextContent('This canvas has all the edges it can hold.');
      expect(status.refusal()).toBeNull();
      expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('queue:rest');
    });

    it('forgets a refusal once the binding is made', async () => {
      const { open, user, bus } = renderPanel({ unreached: ['rest'] });
      await open();
      vi.spyOn(bus, 'apply').mockReturnValueOnce({ ok: false, error: { kind: 'canvas-full', message: 'Full.' } });
      await user.click(screen.getByRole('button', { name: 'Create binding' }));
      expect(screen.getByTestId('bind-refusal')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Create binding' }));

      expect(screen.queryByTestId('bind-refusal')).not.toBeInTheDocument();
    });
  });

  it('forgets what was ticked, chosen and opened when another message is open', async () => {
    const { open, user, set } = renderPanel();
    await open();
    await user.click(screen.getByRole('checkbox', { name: 'Use the header n as a condition' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'To' }), 'queue:archive');
    await user.click(screen.getByRole('radio', { name: 'any' }));

    set('number', 2);
    set('headers', [entry('n', int(1)), entry('m', int(2))]);

    expect(screen.queryByTestId('bind-body')).not.toBeInTheDocument();
    await open();
    expect(ticks().map((tick) => tick.checked)).toEqual([true, true]);
    expect(screen.getByRole('radio', { name: 'all' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('queue:pdfs');
  });

  it('forgets what was ticked when another message is open that has the very same headers, as a producer that sends one message twice makes', async () => {
    const { open, user, set } = renderPanel();
    await open();
    await user.click(screen.getByRole('checkbox', { name: 'Use the header n as a condition' }));
    expect(ticks().map((tick) => tick.checked)).toEqual([true, false, true, true, true]);

    // The headers are the same array, which the engine keeps for every message that a producer sends while its message is not changed.
    set('number', 2);

    await open();
    expect(ticks().map((tick) => tick.checked)).toEqual([true, true, true, true, true]);
  });

  it('gives each panel ids of its own, so that two on a page are not tied to one another', () => {
    const { fixture } = renderPanel();
    const second = TestBed.createComponent(BindFromMessage);
    second.componentRef.setInput('number', 1);
    second.componentRef.setInput('headers', HEADERS);
    second.componentRef.setInput('exchange', 'docs');
    second.detectChanges();

    const ids = [fixture, second].map((view) =>
      (view.nativeElement as HTMLElement).querySelector('section')?.getAttribute('aria-labelledby'),
    );
    expect(new Set(ids).size).toBe(2);
  });
});
