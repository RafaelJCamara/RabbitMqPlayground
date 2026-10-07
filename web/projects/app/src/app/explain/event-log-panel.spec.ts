import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import {
  bindingRecord,
  consumerRecord,
  documentOf,
  exchangeRecord,
  manualFrames,
  producerRecord,
  queueRecord,
} from '@rmq/testing';
import { fireEvent, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { EventLog, LOG_CAP } from '../core/explain/event-log';
import { ExplainState } from '../core/explain/explain-state';
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
import { EventLogPanel } from './event-log-panel';

/** A producer `sender` that sends `burst` messages at a time to `orders`, which sends what has the key `new` to `billing` and nothing to `archive`. */
const traffic = (burst = 2): CanvasDocument => ({
  ...documentOf({
    exchanges: { E: exchangeRecord('orders') },
    queues: { Q: queueRecord('billing'), A: queueRecord('archive') },
    bindings: {
      B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new'),
      B2: bindingRecord('E', { kind: 'queue', id: 'A' }, 'old'),
    },
    producers: {
      P: producerRecord(
        'sender',
        { kind: 'exchange', id: 'E' },
        { message: { payload: 'hi', key: 'new', headers: [] }, burst, interval: { everyMs: 1_000, on: false } },
      ),
    },
    consumers: { C: consumerRecord('worker', ['Q'], { ack: 'manual', prefetch: 1, processingMs: 100 }) },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const PUBLISH: RuntimeCommand = { type: 'publish', from: { kind: 'producer', name: 'sender' } };

/** The sizes that a browser would give, which jsdom does not lay out: a list that is 140 pixels tall, whose rows are 28 pixels tall, and whose height is that of its rows and of the spaces round them. */
function lay(list = 140, row = 28): void {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'listbox' ? list : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'option' ? row : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'listbox'
      ? Number.parseFloat(this.style.paddingTop || '0') +
          Number.parseFloat(this.style.paddingBottom || '0') +
          this.querySelectorAll('[role="option"]').length * row
      : 0;
  });
}

/**
 * The panel, opened on a canvas where `publish` messages of `burst` each were published before it was opened, so that what it finds is a log that has rows. A test has no layout, so the sizes of a browser are given
 * (`lay`), and the services are the ones that the editor provides.
 */
async function renderPanel(
  options: { readonly burst?: number; readonly publish?: number; readonly layout?: boolean } = {},
) {
  if (options.layout !== false) {
    lay();
  }
  const frames = manualFrames();
  TestBed.configureTestingModule({
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      FlowViewport,
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
  const store = TestBed.inject(DocumentStore);
  const log = TestBed.inject(EventLog);
  const bus = TestBed.inject(CommandBus);
  TestBed.inject(CommandLog);
  TestBed.inject(Simulation);
  store.load(traffic(options.burst));
  frames.frame(0);
  const focus = vi.fn();
  TestBed.inject(FlowViewport).attach({
    transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
    host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    fit: () => undefined,
    zoomIn: () => undefined,
    zoomOut: () => undefined,
    resetZoom: () => undefined,
    select: () => undefined,
    focus,
    edgePath: () => null,
  });
  const announce = vi.spyOn(TestBed.inject(Announcer), 'announce');
  const run = (command: RuntimeCommand): void => {
    const result = bus.run(command, 'toolbar');
    if (!result.ok) {
      throw new Error(`refused: ${result.error.message}`);
    }
    log.flush();
  };
  for (let times = 0; times < (options.publish ?? 0); times += 1) {
    run(PUBLISH);
  }
  // What the bus said of the commands that made the log is not what a test of the panel listens for.
  announce.mockClear();
  const fixture = TestBed.createComponent(EventLogPanel);
  fixture.detectChanges();
  const settle = (): void => {
    log.flush();
    fixture.detectChanges();
  };
  return {
    fixture,
    log,
    store,
    settle,
    /** Runs a command, and gives the screen what it made. */
    run: (command: RuntimeCommand): void => {
      run(command);
      fixture.detectChanges();
    },
    focus,
    explain: TestBed.inject(ExplainState),
    announce,
    selection: TestBed.inject(SelectionStore),
    user: userEvent.setup(),
    list: () => screen.getByRole('listbox', { name: 'Events' }),
    /** What holds the rows that are drawn, whose padding is the space over them and under them. */
    spaces: () => screen.getByTestId('event-log-rows'),
    rows: () => screen.queryAllByTestId('event-log-row'),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EventLogPanel (ADR-0061)', () => {
  it('is a region with a name, with its count and its filters, and a list of the events that is one stop for the keyboard', async () => {
    const { list } = await renderPanel({ publish: 1 });

    const region = screen.getByRole('region', { name: 'Event log' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Event log' })).toBeVisible();
    expect(screen.getByTestId('event-log-count')).toHaveTextContent('3 events');
    expect(within(region).getByRole('group', { name: 'Kinds of events to show' })).toBeVisible();
    expect(list()).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: 'Close' })).toBeVisible();
    // The filters are named, so that none of them is a field with no name.
    expect(screen.getByLabelText('Node')).toBeVisible();
    expect(screen.getByLabelText('Message')).toBeVisible();
    expect(screen.getByLabelText('Search')).toBeVisible();
  });

  it('says that nothing has happened yet when there are no events, and what to do, and has no list', async () => {
    const { list, rows } = await renderPanel();

    expect(screen.getByTestId('event-log-count')).toHaveTextContent('No events yet');
    expect(screen.getByTestId('event-log-empty')).toHaveTextContent(
      'Nothing has happened yet. Publish a message from a producer, or play the simulation.',
    );
    expect(() => list()).toThrow();
    expect(rows()).toHaveLength(0);
  });

  it('has a row for each event, with its time, the name of its kind as a word, its sentence and a mark of its family', async () => {
    const { rows } = await renderPanel({ publish: 1 });

    const [command, first, second] = rows();
    expect(rows()).toHaveLength(3);
    expect(command).toHaveAttribute('data-kind', 'command');
    expect(command).toHaveAttribute('data-family', 'commands');
    expect(command).toHaveTextContent('0.000 s command publish sender');
    expect(first).toHaveAttribute('data-family', 'publishing');
    expect(first).toHaveAttribute('data-kind', 'published');
    expect(first).toHaveTextContent('published Sender published message 1 to orders with key "new"');
    expect(second).toHaveTextContent('Sender published message 2');
    // The mark is an icon, which is in the colour of the family and is not read; the word is what says what it is.
    expect(first?.querySelector('rmq-icon svg')).not.toBeNull();
    expect(first?.querySelector('rmq-icon')?.getAttribute('style')).toContain('var(--rmq-producer)');
    expect(command?.querySelector('rmq-icon')?.getAttribute('style')).toContain('var(--rmq-accent)');
  });

  it('sets a line of a command in letters of a fixed width, and sentences in the others, with the whole sentence in the title', async () => {
    const { rows } = await renderPanel({ publish: 1 });

    const command = rows()[0] as HTMLElement;
    const event = rows()[1] as HTMLElement;
    expect(within(command).getByText('publish sender')).toHaveClass('font-mono');
    const sentence = within(event).getByText(/Sender published message 1/);
    expect(sentence).not.toHaveClass('font-mono');
    // The row has a line and cuts the sentence, so the sentence is whole in its title.
    expect(sentence).toHaveAttribute('title', 'Sender published message 1 to orders with key "new"');
  });

  it('draws only the rows that the scroll shows and a few over, and says where each is in the whole list', async () => {
    const { rows, spaces, log } = await renderPanel({ burst: 100, publish: 1 });
    const total = log.shown().length;

    expect(total).toBe(101);
    // The list follows the newest row: five rows show in 140 pixels, and four are drawn over.
    expect(rows().length).toBe(9);
    const last = rows().at(-1) as HTMLElement;
    expect(last).toHaveAttribute('aria-posinset', String(total));
    expect(last).toHaveAttribute('aria-setsize', String(total));
    // The spaces make the scrollbar the size of the whole list.
    const first = Number((rows()[0] as HTMLElement).getAttribute('aria-posinset')) - 1;
    expect(first).toBe(total - 9);
    expect(spaces().style.paddingTop).toBe(first * 28 + 'px');
    expect(spaces().style.paddingBottom).toBe('0px');
  });

  it('shows the rows that the learner scrolled to, stops following the newest while it is scrolled away, and says how to go back', async () => {
    const { rows, list, spaces, settle, user } = await renderPanel({ burst: 100, publish: 1 });
    expect(screen.queryByTestId('event-log-latest')).toBeNull();

    list().scrollTop = 0;
    fireEvent.scroll(list());
    settle();

    expect(rows()[0]).toHaveAttribute('aria-posinset', '1');
    expect(rows()).toHaveLength(9);
    expect(spaces().style.paddingTop).toBe('0px');
    expect(spaces().style.paddingBottom).toBe((101 - 9) * 28 + 'px');
    const latest = screen.getByTestId('event-log-latest');
    expect(latest).toHaveTextContent('Go to the newest');

    await user.click(latest);
    settle();

    expect(rows().at(-1)).toHaveAttribute('aria-posinset', '101');
    expect(screen.queryByTestId('event-log-latest')).toBeNull();
    expect(list()).toHaveFocus();
  });

  it('stays where it is when rows arrive while it is scrolled away, and follows them when it is at the end', async () => {
    const { rows, list, settle, run } = await renderPanel({ burst: 20, publish: 1 });
    expect(rows().at(-1)).toHaveAttribute('aria-posinset', '21');

    run(PUBLISH);
    expect(rows().at(-1)).toHaveAttribute('aria-posinset', '42');

    list().scrollTop = 0;
    fireEvent.scroll(list());
    settle();
    run(PUBLISH);

    expect(rows()[0]).toHaveAttribute('aria-posinset', '1');
    expect(rows().at(-1)).toHaveAttribute('aria-posinset', '9');
    expect(rows()[0]).toHaveAttribute('aria-setsize', '63');
  });

  it('gives the focus to its list when it opens, and to its name when there is nothing to list', async () => {
    const { list } = await renderPanel({ publish: 1 });
    expect(list()).toHaveFocus();

    TestBed.resetTestingModule();
    document.body.replaceChildren();
    await renderPanel();

    expect(screen.getByRole('heading', { name: 'Event log' })).toHaveFocus();
  });

  describe('the keyboard', () => {
    it('starts on the newest row when it is followed, and points at it with aria-activedescendant', async () => {
      const { list, rows } = await renderPanel({ publish: 1 });

      const newest = rows().at(-1) as HTMLElement;
      expect(list()).toHaveAttribute('aria-activedescendant', newest.id);
      expect(newest).toHaveAttribute('data-active', 'true');
      expect(rows()[0]).toHaveAttribute('data-active', 'false');
    });

    it('stays on the newest row while the list follows it, and on the row that the learner moved to when they have moved', async () => {
      const { list, rows, run, user } = await renderPanel({ burst: 20, publish: 1 });
      const activeSeq = () =>
        rows()
          .find((row) => row.getAttribute('data-active') === 'true')
          ?.getAttribute('data-seq');
      expect(activeSeq()).toBe('21');

      run(PUBLISH);
      expect(activeSeq()).toBe('42');

      list().focus();
      await user.keyboard('{ArrowUp}');
      expect(activeSeq()).toBe('41');
      run(PUBLISH);

      expect(activeSeq()).toBe('41');
    });

    it('goes back to the newest row with the button that goes to it', async () => {
      const { list, rows, settle, user } = await renderPanel({ burst: 40, publish: 1 });
      list().focus();
      await user.keyboard('{Home}');
      expect(rows()[0]).toHaveAttribute('data-active', 'true');

      await user.click(screen.getByTestId('event-log-latest'));
      settle();

      expect(rows().at(-1)).toHaveAttribute('data-active', 'true');
      expect(rows()[0]).toHaveAttribute('data-active', 'false');
    });

    it('starts on the first row that shows when it is given the focus away from the newest', async () => {
      const { list, rows, settle } = await renderPanel({ burst: 60, publish: 1 });
      list().scrollTop = 28 * 20;
      fireEvent.scroll(list());
      settle();
      expect(list()).not.toHaveAttribute('aria-activedescendant');

      list().blur();
      list().focus();
      settle();

      expect(rows().find((row) => row.getAttribute('data-active') === 'true')).toHaveAttribute('data-seq', '21');
    });

    it('starts on the row that was chosen when it is given the focus away from the newest and that row shows', async () => {
      const { list, rows, settle, explain } = await renderPanel({ burst: 60, publish: 1 });
      explain.chooseRow(22);
      list().scrollTop = 28 * 20;
      fireEvent.scroll(list());
      settle();

      list().blur();
      list().focus();
      settle();

      expect(rows().find((row) => row.getAttribute('data-active') === 'true')).toHaveAttribute('data-seq', '22');
    });

    it('moves with the arrow keys, Home, End, Page Up and Page Down, and stops at both ends', async () => {
      const { list, rows, user, log } = await renderPanel({ burst: 40, publish: 1 });
      const active = () => rows().find((row) => row.getAttribute('data-active') === 'true');
      const seqOf = (row: HTMLElement | undefined) => Number(row?.getAttribute('data-seq'));
      const newest = log.shown().length;
      expect(seqOf(active())).toBe(newest);
      list().focus();

      await user.keyboard('{ArrowUp}');
      expect(seqOf(active())).toBe(newest - 1);
      await user.keyboard('{ArrowDown}');
      expect(seqOf(active())).toBe(newest);
      await user.keyboard('{ArrowDown}');
      expect(seqOf(active())).toBe(newest);
      await user.keyboard('{Home}');
      expect(seqOf(active())).toBe(1);
      await user.keyboard('{ArrowUp}');
      expect(seqOf(active())).toBe(1);
      await user.keyboard('{PageDown}');
      expect(seqOf(active())).toBe(1 + 4);
      await user.keyboard('{PageUp}');
      expect(seqOf(active())).toBe(1);
      await user.keyboard('{End}');
      expect(seqOf(active())).toBe(newest);
    });

    it('keeps the key for the list when it uses it, so that the page is not scrolled and the shortcuts of the canvas are not run', async () => {
      const { list } = await renderPanel({ publish: 1 });
      const press = (key: string): boolean => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        list().dispatchEvent(event);
        return event.defaultPrevented;
      };

      expect(press('ArrowUp')).toBe(true);
      expect(press('Enter')).toBe(true);
      expect(press(' ')).toBe(true);
      expect(press('Escape')).toBe(true);
      expect(press('a')).toBe(false);
      expect(press('Tab')).toBe(false);
    });

    it('leaves a key with Ctrl, Cmd or Alt held to the browser', async () => {
      const { list } = await renderPanel({ publish: 1 });

      for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
        const event = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true, ...init });
        list().dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
      }
    });

    it('scrolls to the row that it moves to when that row does not show, and follows the newest again at the end', async () => {
      const { list, user, rows } = await renderPanel({ burst: 100, publish: 1 });
      list().focus();

      await user.keyboard('{Home}');

      expect(list().scrollTop).toBe(0);
      expect(rows()[0]).toHaveAttribute('aria-posinset', '1');
      expect(list()).toHaveAttribute('aria-activedescendant', (rows()[0] as HTMLElement).id);
      expect(screen.getByTestId('event-log-latest')).toBeVisible();

      await user.keyboard('{End}');

      expect(list().scrollTop).toBeGreaterThan(0);
      expect(rows().at(-1)).toHaveAttribute('aria-posinset', '101');
      expect(screen.queryByTestId('event-log-latest')).toBeNull();
    });

    it('does not point at a row that the scroll has left, because it has no element', async () => {
      const { list, settle } = await renderPanel({ burst: 100, publish: 1 });
      expect(list()).toHaveAttribute('aria-activedescendant');

      list().scrollTop = 0;
      fireEvent.scroll(list());
      settle();

      expect(list()).not.toHaveAttribute('aria-activedescendant');
    });

    it('chooses the row that it is on with Enter and with Space, and says so, once', async () => {
      const { list, rows, user, explain, announce } = await renderPanel({ publish: 1 });
      list().focus();
      await user.keyboard('{ArrowUp}');
      const row = rows().find((candidate) => candidate.getAttribute('data-active') === 'true') as HTMLElement;
      const seq = Number(row.getAttribute('data-seq'));

      await user.keyboard('{Enter}');

      expect(explain.chosenRow()).toBe(seq);
      expect(row).toHaveAttribute('aria-selected', 'true');
      expect(announce).toHaveBeenCalledTimes(1);

      await user.keyboard('{ArrowUp}');
      await user.keyboard(' ');

      expect(explain.chosenRow()).toBe(seq - 1);
    });

    it('lets go of what a row lit on Escape, and when nothing is lit it closes the log and gives the focus back to the canvas', async () => {
      const { list, user, explain, announce, focus } = await renderPanel({ publish: 1 });
      explain.openLog();
      list().focus();
      await user.keyboard('{Enter}');
      expect(explain.focus()).not.toBeNull();

      await user.keyboard('{Escape}');

      expect(explain.focus()).toBeNull();
      expect(explain.logOpen()).toBe(true);
      expect(announce).toHaveBeenLastCalledWith('Let go of what the event showed.');
      expect(focus).not.toHaveBeenCalled();

      await user.keyboard('{Escape}');

      expect(explain.logOpen()).toBe(false);
      expect(focus).toHaveBeenCalledOnce();
    });
  });

  describe('the mouse', () => {
    it('chooses a row when it is clicked, and lights what it is about, and says so', async () => {
      const { rows, user, explain, announce, list } = await renderPanel({ publish: 1 });
      const published = rows()[1] as HTMLElement;
      const seq = Number(published.getAttribute('data-seq'));

      await user.click(within(published).getByText(/Sender published message 1/));

      expect(explain.chosenRow()).toBe(seq);
      expect(published).toHaveAttribute('aria-selected', 'true');
      expect(list()).toHaveAttribute('aria-activedescendant', published.id);
      expect(announce).toHaveBeenCalledWith(
        'Sender published message 1 to orders with key "new". Showing it on the canvas.',
      );
    });

    it('says, when a row that is about no path is chosen, that there is nothing to show, and chooses it like any other', async () => {
      const { rows, user, explain, announce } = await renderPanel({ publish: 1 });

      await user.click(rows()[0] as HTMLElement);

      expect(explain.chosenRow()).toBe(1);
      expect(announce).toHaveBeenCalledWith('publish sender. There is nothing of it to show on the canvas.');
    });

    it('does nothing for a click on the space between rows', async () => {
      const { list, user, explain } = await renderPanel({ publish: 1 });

      await user.click(list());

      expect(explain.chosenRow()).toBeNull();
    });

    it('closes with its button, and gives the focus back to the canvas', async () => {
      const { user, explain, focus } = await renderPanel({ publish: 1 });
      explain.openLog();

      await user.click(screen.getByRole('button', { name: 'Close' }));

      expect(explain.logOpen()).toBe(false);
      expect(focus).toHaveBeenCalledOnce();
    });
  });

  describe('the filters', () => {
    it('leave out a family when its button is pressed, say how many events are shown, and bring it back when it is pressed again', async () => {
      const { user, rows, announce } = await renderPanel({ publish: 1 });
      const commands = screen.getByRole('button', { name: 'Commands' });
      expect(commands).toHaveAttribute('aria-pressed', 'true');

      await user.click(commands);

      expect(commands).toHaveAttribute('aria-pressed', 'false');
      expect(rows()).toHaveLength(2);
      expect(screen.getByTestId('event-log-count')).toHaveTextContent('Showing 2 of 3 events');
      expect(announce).toHaveBeenLastCalledWith('Showing 2 of 3 events.');

      await user.click(commands);

      expect(commands).toHaveAttribute('aria-pressed', 'true');
      expect(rows()).toHaveLength(3);
      expect(screen.getByTestId('event-log-count')).toHaveTextContent(/^3 events$/);
    });

    it('have a button for each family, with its name in words and its mark', async () => {
      await renderPanel();

      const group = screen.getByRole('group', { name: 'Kinds of events to show' });
      expect(
        within(group)
          .getAllByRole('button')
          .map((button) => button.textContent?.trim()),
      ).toEqual(['Commands', 'Publishing', 'Routing', 'Problems', 'Queues', 'Delivery', 'Consumers', 'Simulation']);
      for (const button of within(group).getAllByRole('button')) {
        expect(button.querySelector('rmq-icon svg')).not.toBeNull();
      }
    });

    it('ask for the events of one node, from a list of the nodes of the canvas, and say so when the node has gone', async () => {
      const { user, rows, store, settle, log } = await renderPanel({ publish: 1 });
      const select = screen.getByLabelText('Node') as HTMLSelectElement;
      expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
        'All nodes',
        'Exchange orders',
        'Queue billing',
        'Queue archive',
        'Producer sender',
        'Consumer worker',
      ]);

      await user.selectOptions(select, 'Producer sender');

      expect(log.filter().node).toBe('producer:P');
      expect(rows()).toHaveLength(2);
      expect(screen.getByTestId('event-log-count')).toHaveTextContent('Showing 2 of 3 events');

      store.load({ ...traffic(), producers: {} });
      settle();
      log.setFilter({ node: 'producer:P' });
      settle();

      const options = [...(screen.getByLabelText('Node') as HTMLSelectElement).options];
      expect(options.at(-1)?.textContent?.trim()).toBe('Producer P (not on the canvas now)');
      expect(options.at(-1)?.selected).toBe(true);

      await user.selectOptions(screen.getByLabelText('Node'), 'All nodes');
      expect(log.filter().node).toBeNull();
    });

    it('ask for the events of one message, by its number, and for no message when the field is empty or is not a number', async () => {
      const { user, rows, announce } = await renderPanel({ publish: 1 });
      const field = screen.getByLabelText('Message');

      await user.type(field, '2');
      fireEvent.change(field);

      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveTextContent('message 2');
      expect(announce).toHaveBeenLastCalledWith('Showing 1 of 3 events.');

      await user.clear(field);
      expect(rows()).toHaveLength(3);
      await user.type(field, '0');
      expect(rows()).toHaveLength(3);
    });

    it('ask for the events that have some words in their sentence, in any case, and say how many there are when the learner is done typing', async () => {
      const { user, rows, announce } = await renderPanel({ publish: 1 });
      const field = screen.getByLabelText('Search');

      await user.type(field, 'MESSAGE 1');

      expect(rows()).toHaveLength(1);
      expect(announce).not.toHaveBeenCalled();
      fireEvent.change(field);
      expect(announce).toHaveBeenCalledOnce();
      expect(announce).toHaveBeenLastCalledWith('Showing 1 of 3 events.');
    });

    it('say that no event matches, with a button that clears the filters, and bring the events back when it is pressed', async () => {
      const { user, rows, announce } = await renderPanel({ publish: 1 });
      await user.type(screen.getByLabelText('Search'), 'no such sentence');

      expect(rows()).toHaveLength(0);
      expect(screen.getByTestId('event-log-empty')).toHaveTextContent('No event matches the filters.');
      expect(screen.getByTestId('event-log-count')).toHaveTextContent('Showing 0 of 3 events');

      await user.click(within(screen.getByTestId('event-log-empty')).getByRole('button', { name: 'Clear filters' }));

      expect(rows()).toHaveLength(3);
      expect(screen.getByLabelText('Search')).toHaveValue('');
      expect(announce).toHaveBeenLastCalledWith('Showing 3 of 3 events.');
    });

    it('say that no event matches when a filter leaves none, in the words of the announcement', async () => {
      const { user, announce } = await renderPanel({ publish: 1 });

      await user.type(screen.getByLabelText('Search'), 'no such sentence');
      fireEvent.change(screen.getByLabelText('Search'));

      expect(announce).toHaveBeenLastCalledWith('No event matches the filters.');
    });

    it('have a button that clears them, which is there only while the log is filtered', async () => {
      const { user } = await renderPanel({ publish: 1 });
      expect(screen.queryByTestId('event-log-clear')).toBeNull();

      await user.click(screen.getByRole('button', { name: 'Routing' }));
      expect(screen.getByTestId('event-log-clear')).toBeVisible();
      await user.click(screen.getByTestId('event-log-clear'));

      expect(screen.queryByTestId('event-log-clear')).toBeNull();
      expect(screen.getByRole('button', { name: 'Routing' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('are the log’s, so that closing the panel does not lose them', async () => {
      const { user, log } = await renderPanel({ publish: 1 });

      await user.type(screen.getByLabelText('Search'), 'sender');

      expect(log.filter().text).toBe('sender');
    });

    it('say that there are no events when the log is empty and a filter is changed', async () => {
      const { user, announce } = await renderPanel();

      await user.click(screen.getByRole('button', { name: 'Commands' }));

      expect(announce).toHaveBeenLastCalledWith('There are no events yet.');
    });
  });

  describe('what it says of the events that were dropped', () => {
    it('says how many went when the log is full, and that it keeps the last five thousand', async () => {
      const { log } = await renderPanel({ burst: 1000, publish: 6 });

      expect(log.dropped()).toBe(6 * 1001 - LOG_CAP);
      expect(screen.getByTestId('event-log-dropped')).toHaveTextContent(
        '1,006 earlier events were dropped: the log keeps the last 5,000.',
      );
      expect(screen.getByTestId('event-log-count')).toHaveTextContent('5,000 events');
    });

    it('says it of one event in the singular, and says nothing when none went', async () => {
      const { log } = await renderPanel({ burst: 1666, publish: 3 });

      expect(log.dropped()).toBe(1);
      expect(screen.getByTestId('event-log-dropped')).toHaveTextContent(
        '1 earlier event was dropped: the log keeps the last 5,000.',
      );

      TestBed.resetTestingModule();
      document.body.replaceChildren();
      await renderPanel({ burst: 10, publish: 1 });

      expect(screen.queryByTestId('event-log-dropped')).toBeNull();
    });
  });
});
