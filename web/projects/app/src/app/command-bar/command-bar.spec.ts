import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type DocumentCommand } from '@rmq/domain';
import { documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { Announcer } from '../core/announcer';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { CommandBar } from './command-bar';
import { CommandHistory } from './command-history';

const SHOP = documentOf({
  exchanges: { x1: exchangeRecord('orders', 'direct') },
  queues: { q1: queueRecord('billing'), q2: queueRecord('archive') },
});

async function renderBar(
  document: CanvasDocument = emptyDocument(),
  options: { readonly flags?: string; readonly onShare?: () => void } = {},
) {
  const focused: string[] = [];
  const spoken: string[] = [];
  const onShare = options.onShare ?? vi.fn();
  const view = await render(CommandBar, {
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      FlowViewport,
      { provide: FLAG_SOURCES, useValue: { stored: null, query: options.flags ?? null } },
    ],
    inputs: { keys: '/ or Ctrl+K' },
    on: { share: onShare },
  });
  TestBed.inject(DocumentStore).load(document);
  TestBed.inject(FlowViewport).attach({
    transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
    host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    fit: () => undefined,
    zoomIn: () => undefined,
    zoomOut: () => undefined,
    resetZoom: () => undefined,
    select: () => undefined,
    focus: () => focused.push('canvas'),
    edgePath: () => null,
  });
  TestBed.inject(Announcer).useSink((message, politeness) => spoken.push(`${politeness}: ${message}`));
  view.fixture.detectChanges();
  return {
    ...view,
    focused,
    spoken,
    onShare,
    user: userEvent.setup(),
    store: TestBed.inject(DocumentStore),
    bus: TestBed.inject(CommandBus),
    log: TestBed.inject(CommandLog),
    status: TestBed.inject(StatusStore),
    history: TestBed.inject(CommandHistory),
  };
}

const toggle = () => screen.getByRole('button', { name: 'Commands' });
const field = () => screen.getByRole<HTMLInputElement>('combobox', { name: 'Command' });
const optionLabels = () =>
  screen.queryAllByRole('option').map((option) => option.querySelector('[data-testid="item-label"]')?.textContent);

/** Opens the bar with its button and waits for the cursor to be in the field. */
async function openBar(user: ReturnType<typeof userEvent.setup>) {
  await user.click(toggle());
  await waitFor(() => expect(field()).toHaveFocus());
}

/** Types into the field that already has the cursor, without clicking it again. */
const type = (user: ReturnType<typeof userEvent.setup>, text: string) => user.keyboard(text);

const declareQueue = (name: string): DocumentCommand => ({ type: 'declare-queue', name, durable: true });

beforeEach(() => {
  window.localStorage.clear();
});

describe('CommandBar, closed (ADR-0045)', () => {
  it('is a region with a button, which says that it is closed, and the keys that open it', async () => {
    await renderBar();

    const region = screen.getByRole('region', { name: 'Command bar' });
    expect(within(region).getByRole('button', { name: 'Commands' })).toHaveAttribute('aria-expanded', 'false');
    expect(within(region).getByText('/ or Ctrl+K')).toBeVisible();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('says what it is for while nothing has changed', async () => {
    await renderBar();

    expect(screen.getByText('Each change you make appears here as the command that does the same.')).toBeVisible();
  });

  it('shows the latest equivalent command of a change that was made, and says what it is to a screen reader', async () => {
    const { bus, fixture } = await renderBar();

    bus.apply(declareQueue('billing'), 'gesture');
    fixture.detectChanges();

    const latest = screen.getByTestId('latest-command');
    expect(latest).toHaveTextContent('Latest equivalent command: ↳ declare queue billing');
    expect(within(latest).getByText('declare queue billing')).toBeVisible();
    expect(screen.queryByText('Each change you make appears here as the command that does the same.')).toBeNull();
  });

  it('says the latest equivalent command once: while the bar is closed, and not above its own log when it is open', async () => {
    const { user, bus, fixture } = await renderBar();
    bus.apply(declareQueue('billing'), 'gesture');
    fixture.detectChanges();
    expect(screen.getByTestId('latest-command')).toBeVisible();

    await openBar(user);

    expect(screen.queryByTestId('latest-command')).not.toBeInTheDocument();
  });

  it('hides from a screen reader what is only drawn for the eyes: the arrow before the latest line, the prompt and the words that its groups are named by', async () => {
    const { user, bus, fixture } = await renderBar(SHOP);
    bus.apply(declareQueue('extra'), 'gesture');
    fixture.detectChanges();
    expect(within(screen.getByTestId('latest-command')).getByText('↳')).toHaveAttribute('aria-hidden', 'true');

    await openBar(user);

    expect(screen.getByText('›')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText('Try')).toHaveAttribute('aria-hidden', 'true');
    await type(user, 'bnd orders -> billing{Enter}');
    expect(screen.getByText('Did you mean')).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens with its button, with the cursor in the field, and closes with it, which leaves the cursor where the pointer put it', async () => {
    const { user, focused } = await renderBar();

    await openBar(user);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(toggle()).toHaveAttribute('aria-controls');

    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(focused).toEqual([]);
  });

  it('does not show the list again when it is opened again with what was typed still in the field', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(toggle());
    await openBar(user);

    expect(field()).toHaveValue('bi');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens when it is asked to, as the key that is for it asks, and puts the cursor in the field', async () => {
    const { fixture } = await renderBar();

    fixture.componentInstance.open();
    fixture.detectChanges();

    await waitFor(() => expect(field()).toHaveFocus());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
  });

  it('puts the cursor back in the field when it is asked to open while it is open', async () => {
    const { user, fixture } = await renderBar();
    await openBar(user);
    await user.click(screen.getByRole('button', { name: 'Run' }));
    expect(field()).not.toHaveFocus();

    fixture.componentInstance.open();

    await waitFor(() => expect(field()).toHaveFocus());
  });

  it('does nothing with Escape while it is closed, so that the key stays with the canvas', async () => {
    const { user, focused } = await renderBar();
    toggle().focus();

    await user.keyboard('{Escape}');

    expect(focused).toEqual([]);
    expect(toggle()).toHaveFocus();
  });

  it('keeps what was being typed when it is closed and opened again, because Escape by mistake must not lose a long line', async () => {
    const { user } = await renderBar();
    await openBar(user);
    await type(user, 'declare queue jobs');

    await user.click(toggle());
    await user.click(toggle());

    expect(field()).toHaveValue('declare queue jobs');
  });
});

describe('CommandBar, the log of equivalent commands (ADR-0046)', () => {
  it('says that there is nothing yet when nothing has changed', async () => {
    const { user } = await renderBar();

    await openBar(user);

    expect(screen.getByRole('region', { name: 'Equivalent commands' })).toHaveTextContent(
      'Nothing yet. Each change you make appears here as the command that does the same.',
    );
    expect(screen.queryByTestId('command-log')).not.toBeInTheDocument();
  });

  it('lists the commands that the changes were equivalent to, oldest first, each with what the learner used', async () => {
    const { user, bus, fixture } = await renderBar();
    bus.apply(declareQueue('a'), 'gesture');
    bus.apply({ type: 'add-producer', name: 'sender' }, 'menu');
    bus.apply(declareQueue('b'), 'typed');
    bus.apply(declareQueue('c'), 'key');
    bus.apply(declareQueue('d'), 'inspector');
    bus.apply(declareQueue('e'), 'toolbar');
    await openBar(user);
    fixture.detectChanges();

    const rows = within(screen.getByTestId('command-log')).getAllByRole('listitem');

    expect(rows.map((row) => row.querySelector('code')?.textContent)).toEqual([
      'declare queue a',
      'add producer sender',
      'declare queue b',
      'declare queue c',
      'declare queue d',
      'declare queue e',
    ]);
    expect(rows.map((row) => row.querySelector('[data-testid="origin"]')?.textContent?.trim())).toEqual([
      'gesture',
      'menu',
      'typed',
      'key',
      'inspector',
      'toolbar',
    ]);
  });

  it('scrolls to its latest line when it opens and when a line is added, because that is the one that was just made', async () => {
    const height = vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(480);
    try {
      const { user, bus, fixture } = await renderBar();
      bus.apply(declareQueue('a'), 'gesture');
      await openBar(user);
      fixture.detectChanges();
      await waitFor(() => expect(screen.getByTestId('command-log').scrollTop).toBe(480));

      height.mockReturnValue(520);
      bus.apply(declareQueue('b'), 'gesture');
      fixture.detectChanges();

      await waitFor(() => expect(screen.getByTestId('command-log').scrollTop).toBe(520));
    } finally {
      height.mockRestore();
    }
  });

  it('grows as the learner works, while it is open', async () => {
    const { user, bus, fixture } = await renderBar();
    await openBar(user);

    bus.apply(declareQueue('billing'), 'key');
    fixture.detectChanges();

    expect(within(screen.getByTestId('command-log')).getByText('declare queue billing')).toBeVisible();
    expect(screen.queryByText(/Nothing yet/)).not.toBeInTheDocument();
  });

  it('writes an undo that changed the canvas as a line like the others', async () => {
    const { user, bus, fixture } = await renderBar();
    bus.apply(declareQueue('billing'), 'toolbar');
    bus.undo('key');
    await openBar(user);
    fixture.detectChanges();

    const texts = within(screen.getByTestId('command-log'))
      .getAllByRole('listitem')
      .map((row) => row.querySelector('code')?.textContent);

    expect(texts).toEqual(['declare queue billing', 'undo']);
  });

  it('puts a line in the field to be run again or changed, with the cursor in it, and does not run it', async () => {
    const { user, bus, store, fixture } = await renderBar();
    bus.apply(declareQueue('billing'), 'gesture');
    await openBar(user);
    fixture.detectChanges();

    await user.click(screen.getByRole('button', { name: 'Use again: declare queue billing' }));

    expect(field()).toHaveValue('declare queue billing');
    expect(field()).toHaveFocus();
    expect(Object.keys(store.document().queues)).toHaveLength(1);
    expect(screen.queryByRole('listbox'), 'a line that is put there is not being typed').not.toBeInTheDocument();
  });

  it('offers no completions for a line that was put in the field even when one could be, and offers them again when the learner types', async () => {
    const { user, bus, fixture } = await renderBar();
    bus.apply(declareQueue('billing'), 'gesture');
    bus.undo('key');
    await openBar(user);
    fixture.detectChanges();

    await user.click(screen.getByRole('button', { name: 'Use again: undo' }));

    expect(field()).toHaveValue('undo');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await type(user, '{Backspace}');
    expect(optionLabels()).toContain('undo');
  });
});

describe('CommandBar, completion (ADR-0045)', () => {
  it('says what to type in the colour of muted text, which is readable, and not in the colour that the browser chooses', async () => {
    const { user } = await renderBar(SHOP);

    await openBar(user);

    expect(field()).toHaveAttribute('placeholder', 'Type a command, or help');
    expect(field()).toHaveClass('placeholder:text-muted');
  });

  it('is a combobox that has no list while nothing is typed, and says so', async () => {
    const { user } = await renderBar(SHOP);

    await openBar(user);

    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveAttribute('aria-autocomplete', 'list');
    expect(field()).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('offers what the parser would accept at the cursor, the commands that the typed letters start', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);

    await type(user, 'bi');

    expect(optionLabels()).toEqual(['bind']);
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('offers the elements of the canvas that fit where the cursor is, with their kinds', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);

    await type(user, 'bind ');
    expect(optionLabels()).toEqual(['orders']);
    expect(within(screen.getByRole('option')).getByText('exchange')).toBeVisible();

    await type(user, 'orders -> ');
    expect(optionLabels()).toEqual(['orders', 'billing', 'archive']);
  });

  it('says which option the arrow keys are on, through the field, and only one at a time', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bind orders -> ');
    expect(field()).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    const [first, second] = screen.getAllByRole('option');
    expect(field()).toHaveAttribute('aria-activedescendant', first?.id);
    expect(first).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', second?.id);
    expect(first).toHaveAttribute('aria-selected', 'false');
    expect(
      screen.getAllByRole('option').filter((option) => option.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
  });

  it('goes round the ends with the arrow keys: down from the last to the first, and up from nothing to the last', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bind orders -> ');
    const options = screen.getAllByRole('option');

    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveAttribute('aria-activedescendant', options.at(-1)?.id);

    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveAttribute('aria-activedescendant', options[0]?.id);
  });

  it('takes the first option with Tab when none was chosen, with a space after a name, and keeps the cursor in the field', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');

    await user.keyboard('{Tab}');

    expect(field()).toHaveValue('bind ');
    expect(field()).toHaveFocus();
  });

  it('takes the option that was chosen with Tab, and goes on to what comes next: the list is for the next word', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bind ');

    await user.keyboard('{Tab}');

    expect(field()).toHaveValue('bind orders ');
    expect(optionLabels()).toEqual(['->']);
    await user.keyboard('{Tab}');
    expect(field()).toHaveValue('bind orders -> ');
    await user.keyboard('{ArrowDown}{ArrowDown}{Tab}');
    expect(field()).toHaveValue('bind orders -> billing ');
  });

  it('writes nothing after what goes on in the same word: the value of an option comes next', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bind orders -> billing ke');

    await user.keyboard('{Tab}');

    expect(field()).toHaveValue('bind orders -> billing key=');
  });

  it('leaves Tab to the page when there is nothing to take, so that the keyboard is never trapped in the field', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'zzz');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.keyboard('{Tab}');

    expect(field()).not.toHaveFocus();
  });

  it('takes the option that was chosen with the arrow keys when Enter is pressed, and does not run the line', async () => {
    const { user, history, log } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');

    await user.keyboard('{ArrowDown}{Enter}');

    expect(field()).toHaveValue('bind ');
    expect(history.lines()).toEqual([]);
    expect(log.entries()).toEqual([]);
  });

  it('runs the line when Enter is pressed and no option was chosen, even though a list is open', async () => {
    const { user, history } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'help');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Enter}');

    expect(history.lines()).toEqual(['help']);
    expect(screen.getByRole('region', { name: 'Help: the commands' })).toBeVisible();
  });

  it('takes an option that is pressed, and puts the cursor back in the field', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');

    await user.click(screen.getByRole('option', { name: /bind/ }));

    expect(field()).toHaveValue('bind ');
    expect(field()).toHaveFocus();
  });

  it('closes the list with Escape and leaves the bar open, and then closes the bar and gives the focus to the canvas', async () => {
    const { user, focused } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(field()).toBeInTheDocument();
    expect(focused).toEqual([]);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(focused).toEqual(['canvas']);
  });

  it('closes the bar with Escape from anywhere in it, such as a button of the log', async () => {
    const { user, bus, fixture, focused } = await renderBar(SHOP);
    bus.apply(declareQueue('jobs'), 'gesture');
    await openBar(user);
    fixture.detectChanges();
    screen.getByRole('button', { name: 'Use again: declare queue jobs' }).focus();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(focused).toEqual(['canvas']);
  });

  it('shuts the list when the cursor is moved, because it is for what is being typed', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{ArrowLeft}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await type(user, '{End}n');
    expect(optionLabels()).toEqual(['bind']);
  });

  it.each(['ArrowRight', 'Home', 'End'])('shuts the list when %s moves the cursor too', async (key) => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard(`{${key}}`);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('keeps the option that the arrow keys are on in view, in a list that scrolls', async () => {
    const scrolled: Element[] = [];
    const scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { user } = await renderBar(SHOP);
      await openBar(user);
      await type(user, 'un');

      await user.keyboard('{ArrowDown}{ArrowDown}');

      await waitFor(() => expect(scrolled.at(-1)).toBe(screen.getAllByRole('option')[1]));
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrolled[0]).toBe(screen.getAllByRole('option')[0]);
    } finally {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('has a list that is named, whose options are reached by the arrow keys and not by Tab, and a press in it does not take the cursor from the field', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'un');

    const list = screen.getByRole('listbox', { name: 'Completions' });
    for (const option of within(list).getAllByRole('option')) {
      expect(option).toHaveAttribute('tabindex', '-1');
    }
    // A press that is not given up leaves the field with the cursor: the page's default for it, which is to move the focus, is stopped.
    expect(fireEvent.mouseDown(list)).toBe(false);
  });

  it('takes an option with Enter when the option has the cursor, as a button would', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'un');

    fireEvent.keyDown(screen.getAllByRole('option')[0]!, { key: 'Enter' });

    expect(field()).toHaveValue('unbind ');
  });

  it('points the parts of the bar at one another by id: its button at its panel, its field at its list and at the option that is chosen', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    expect(document.getElementById(toggle().getAttribute('aria-controls') as string)).toContainElement(field());
    await type(user, 'bi');

    await user.keyboard('{ArrowDown}');

    expect(document.getElementById(field().getAttribute('aria-controls') as string)).toBe(screen.getByRole('listbox'));
    const options = screen.getAllByRole('option');
    expect(document.getElementById(field().getAttribute('aria-activedescendant') as string)).toBe(options[0]);
    expect(new Set(options.map((option) => option.id)).size).toBe(options.length);
  });

  it('leaves a key that is pressed with Ctrl, Cmd or Alt to the browser, which has undo of the typing and moving by words', async () => {
    const { user, history } = await renderBar(SHOP);
    history.add('declare queue a');
    await openBar(user);
    await type(user, 'bind orders -> ');

    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await user.keyboard('{Control>}{ArrowDown}{/Control}');
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(field()).not.toHaveAttribute('aria-activedescendant');
    expect(field()).toHaveValue('bind orders -> ');
    expect(history.lines()).toEqual(['declare queue a']);
  });

  it('shuts the list when the field is pressed, because that moves the cursor too', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'bi');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.click(field());

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('has no list for a field that has been emptied, because it suggests what to do next instead', async () => {
    const { user } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'b');
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    await user.keyboard('{Backspace}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('CommandBar, running a line (ADR-0045)', () => {
  it('applies it through the bus as a typed command, clears the field, keeps the cursor in it, and says what was done', async () => {
    const { user, store, log, status, history } = await renderBar();
    await openBar(user);

    await type(user, 'declare queue billing{Enter}');

    expect(Object.values(store.document().queues).map(({ name }) => name)).toEqual(['billing']);
    expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual(['typed: declare queue billing']);
    expect(field()).toHaveValue('');
    expect(field()).toHaveFocus();
    expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue billing.' });
    expect(history.lines()).toEqual(['declare queue billing']);
  });

  it('does nothing for a line that is empty or has only spaces, and keeps it out of the history', async () => {
    const { user, history, store } = await renderBar();
    await openBar(user);
    const before = store.document();

    await type(user, '{Enter}');
    await type(user, '   {Enter}');

    expect(store.document()).toBe(before);
    expect(history.lines()).toEqual([]);
    expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
  });

  it('runs a line with the button too, for a pointer and a touch that has no Enter key', async () => {
    const { user, store } = await renderBar();
    await openBar(user);
    await type(user, 'declare queue billing');

    await user.click(screen.getByRole('button', { name: 'Run' }));

    expect(Object.keys(store.document().queues)).toHaveLength(1);
    expect(field()).toHaveValue('');
  });

  it('runs undo and redo, which are lines like the others', async () => {
    const { user, store } = await renderBar();
    await openBar(user);
    await type(user, 'declare queue billing{Enter}');

    await type(user, 'undo{Enter}');
    expect(Object.keys(store.document().queues)).toEqual([]);

    await type(user, 'redo{Enter}');
    expect(Object.keys(store.document().queues)).toHaveLength(1);
  });

  it('leaves a line that changes nothing as accepted: the field is emptied and the status line says why nothing changed', async () => {
    const { user, status } = await renderBar(SHOP);
    await openBar(user);
    await type(user, 'set orders type=direct{Enter}');

    expect(field()).toHaveValue('');
    expect(status.notice()).toEqual({
      kind: 'message',
      text: 'Nothing changed, because the canvas already is as that command says.',
    });
  });

  describe('a line that cannot be read', () => {
    it('keeps its text, selects the words at fault, and says where and what to do, with the root cause first', async () => {
      const { user } = await renderBar(SHOP);
      await openBar(user);

      await type(user, 'bnd orders -> billing{Enter}');

      expect(field()).toHaveValue('bnd orders -> billing');
      expect(field().selectionStart).toBe(0);
      expect(field().selectionEnd).toBe(3);
      expect(screen.getByTestId('refusal-message')).toHaveTextContent(
        "There is no command 'bnd'. Did you mean 'bind'?",
      );
      expect(screen.queryByTestId('refusal-reply')).not.toBeInTheDocument();
      // The field is described by the answer, which it points at by id.
      expect(document.getElementById(field().getAttribute('aria-describedby') as string)).toBe(
        screen.getByTestId('command-answer'),
      );
      expect(field()).toHaveAttribute('aria-invalid', 'true');
      await type(user, 'x');
      expect(field()).not.toHaveAttribute('aria-invalid');
      expect(field()).not.toHaveAttribute('aria-describedby');
    });

    it('leaves the list shut, because the line was run and is not being typed any more', async () => {
      const { user } = await renderBar(SHOP);
      await openBar(user);
      await type(user, 'bind ord');
      expect(screen.getByRole('listbox')).toBeInTheDocument();

      await type(user, '{Enter}');

      expect(screen.getByTestId('refusal')).toBeVisible();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });

    it('is spoken once, assertively, as a refusal is, and a line is kept in the history to be mended', async () => {
      const { user, spoken, history } = await renderBar(SHOP);
      await openBar(user);

      await type(user, 'bnd orders -> billing{Enter}');

      expect(spoken.filter((message) => message.startsWith('assertive:'))).toEqual([
        "assertive: There is no command 'bnd'. Did you mean 'bind'?",
      ]);
      expect(history.lines()).toEqual(['bnd orders -> billing']);
    });

    it('has the names that were probably meant as buttons that put the name in place of the words at fault', async () => {
      const { user } = await renderBar(SHOP);
      await openBar(user);
      await type(user, 'bnd orders -> billing{Enter}');

      await user.click(
        within(screen.getByRole('group', { name: 'Did you mean' })).getByRole('button', { name: 'bind' }),
      );

      expect(field()).toHaveValue('bind orders -> billing');
      expect(field()).toHaveFocus();
      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });

    it('puts a name that has a space in quotes, as the grammar reads it, and keeps what was around it', async () => {
      const { user } = await renderBar(
        documentOf({
          exchanges: { x1: exchangeRecord('orders', 'direct') },
          queues: { q1: queueRecord('my queue') },
        }),
      );
      await openBar(user);
      await type(user, 'bind orders -> "my quue"{Enter}');

      await user.click(
        within(screen.getByRole('group', { name: 'Did you mean' })).getByRole('button', { name: 'my queue' }),
      );

      expect(field()).toHaveValue('bind orders -> "my queue"');
    });

    it('is taken away when the learner types again, because it is about the line that was typed and not the one that is', async () => {
      const { user } = await renderBar(SHOP);
      await openBar(user);
      await type(user, 'bnd orders -> billing{Enter}');
      expect(screen.getByTestId('refusal')).toBeVisible();

      await type(user, 'x');

      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });
  });

  describe('a line that the canvas refuses', () => {
    it('keeps its text and shows the root cause first and what RabbitMQ answers after it, never the reply alone', async () => {
      const { user, store } = await renderBar();
      await openBar(user);
      const before = store.document();

      await type(user, 'declare exchange amq.mine type=direct{Enter}');

      expect(store.document()).toBe(before);
      expect(field()).toHaveValue('declare exchange amq.mine type=direct');
      expect(
        screen.queryByRole('group', { name: 'Did you mean' }),
        'a refusal that has no name to offer',
      ).not.toBeInTheDocument();
      const message = screen.getByTestId('refusal-message');
      const reply = screen.getByTestId('refusal-reply');
      expect(message.textContent?.length).toBeGreaterThan(0);
      expect(message.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });
});

describe('CommandBar, help (ADR-0045)', () => {
  it('lists the commands, and says so aloud, without changing what is typed or the canvas', async () => {
    const { user, spoken, store } = await renderBar();
    await openBar(user);
    const before = store.document();

    await type(user, 'help{Enter}');

    expect(screen.getByRole('region', { name: 'Help: the commands' })).toBeVisible();
    expect(spoken).toEqual(['polite: The commands are listed above the field.']);
    expect(field()).toHaveValue('');
    expect(store.document()).toBe(before);
  });

  it('says what one command does, with its examples, and says so aloud', async () => {
    const { user, spoken } = await renderBar();
    await openBar(user);

    await type(user, 'help bind{Enter}');

    expect(screen.getByRole('region', { name: 'Help: bind' })).toBeVisible();
    expect(spoken).toEqual(['polite: Help for bind is shown above the field.']);
  });

  it('is shown for the name of a command that is pressed in the list, and does not touch what is being typed', async () => {
    const { user } = await renderBar();
    await openBar(user);
    await type(user, 'help{Enter}');
    await type(user, 'decl');

    await user.click(screen.getByRole('button', { name: 'declare queue' }));

    expect(screen.getByRole('region', { name: 'Help: declare queue' })).toBeVisible();
    expect(field()).toHaveValue('decl');
  });

  it('has an example that puts its line in the field, to be run or changed, and the way back to the list', async () => {
    const { user } = await renderBar();
    await openBar(user);
    await type(user, 'help declare queue{Enter}');

    await user.click(screen.getByRole('button', { name: 'Put declare queue jobs in the field' }));
    expect(field()).toHaveValue('declare queue jobs');
    expect(field()).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'All the commands' }));
    expect(screen.getByRole('region', { name: 'Help: the commands' })).toBeVisible();
  });

  it('goes when a line is run that the canvas accepts', async () => {
    const { user } = await renderBar();
    await openBar(user);
    await type(user, 'help bind{Enter}');
    expect(screen.getByRole('region', { name: 'Help: bind' })).toBeVisible();

    await type(user, 'declare queue jobs{Enter}');

    expect(screen.queryByRole('region', { name: 'Help: bind' })).not.toBeInTheDocument();
  });

  it('stays while the learner types the command that it is about, and goes when another answer takes its place', async () => {
    const { user } = await renderBar();
    await openBar(user);
    await type(user, 'help bind{Enter}');

    await type(user, 'bind');
    expect(screen.getByRole('region', { name: 'Help: bind' })).toBeVisible();

    await type(user, ' a -> b{Enter}');
    expect(screen.queryByRole('region', { name: 'Help: bind' })).not.toBeInTheDocument();
  });

  it('is refused for a command that is not one, with the names that were meant', async () => {
    const { user } = await renderBar();
    await openBar(user);

    await type(user, 'help bnid{Enter}');

    expect(screen.getByTestId('refusal-message')).toHaveTextContent("There is no command 'bnid'.");
  });
});

describe('CommandBar, the history (ADR-0045)', () => {
  it('walks back through the lines that were given with the up arrow, oldest last, and forward with the down arrow, to what was being typed', async () => {
    const { user, history } = await renderBar();
    history.add('declare queue a');
    history.add('declare queue b');
    await openBar(user);

    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('declare queue b');
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('declare queue a');
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('declare queue a');

    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveValue('declare queue b');
    await user.keyboard('{ArrowDown}');
    expect(field()).toHaveValue('');
  });

  it('gives back what was typed before the walk when the walk comes back to its end', async () => {
    const { user, history } = await renderBar();
    history.add('declare queue a');
    await openBar(user);
    await type(user, 'zzz');

    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('declare queue a');
    await user.keyboard('{ArrowDown}');

    expect(field()).toHaveValue('zzz');
  });

  it('keeps the list shut for a line that was taken from it, so that the arrow keys go on walking, and opens it again when the learner types', async () => {
    const { user, history } = await renderBar(SHOP);
    history.add('bind orders -> billing');
    history.add('bind orders -> archive');
    await openBar(user);

    await user.keyboard('{ArrowUp}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.keyboard('{ArrowUp}');
    expect(field()).toHaveValue('bind orders -> billing');

    await type(user, ' k');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('has the arrow keys choose in the list while it is open, and not walk the history', async () => {
    const { user, history } = await renderBar(SHOP);
    history.add('declare queue a');
    await openBar(user);
    await type(user, 'bi');

    await user.keyboard('{ArrowUp}');

    expect(field()).toHaveValue('bi');
    expect(field()).toHaveAttribute('aria-activedescendant');
  });

  it('starts with the lines that an earlier visit kept', async () => {
    window.localStorage.setItem('rmq.command-history', JSON.stringify(['declare queue old']));
    const { user } = await renderBar();
    await openBar(user);

    await user.keyboard('{ArrowUp}');

    expect(field()).toHaveValue('declare queue old');
  });
});

describe('CommandBar, what to do next (ADR-0045)', () => {
  it('suggests lines made from the canvas while the field is empty, as buttons that put the line in the field and do not run it', async () => {
    const { user, store } = await renderBar();
    await openBar(user);
    const before = store.document();

    const group = screen.getByRole('group', { name: 'Try one of these' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual([
      'declare exchange orders type=direct',
      'declare queue billing',
      'add producer sender',
      'add consumer worker',
    ]);
    await user.click(within(group).getByRole('button', { name: 'Put declare queue billing in the field' }));

    expect(field()).toHaveValue('declare queue billing');
    expect(field()).toHaveFocus();
    expect(store.document()).toBe(before);
  });

  it('goes while there is something in the field, and comes back when the field is empty', async () => {
    const { user } = await renderBar();
    await openBar(user);

    await type(user, 'd');
    expect(screen.queryByRole('group', { name: 'Try one of these' })).not.toBeInTheDocument();

    await user.keyboard('{Backspace}');
    expect(screen.getByRole('group', { name: 'Try one of these' })).toBeVisible();
  });

  it('suggests what is next after each line that was run, until the canvas is wired from one end to the other', async () => {
    const { user } = await renderBar();
    await openBar(user);
    for (const line of [
      'declare exchange orders type=direct',
      'declare queue billing',
      'add producer sender',
      'add consumer worker',
    ]) {
      await type(user, `${line}{Enter}`);
    }

    const group = screen.getByRole('group', { name: 'Try one of these' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['bind orders -> billing key=billing', 'link sender -> orders', 'subscribe worker billing']);
    for (const line of ['bind orders -> billing key=billing', 'link sender -> orders', 'subscribe worker billing']) {
      await user.click(screen.getByRole('button', { name: `Put ${line} in the field` }));
      await type(user, '{Enter}');
    }

    expect(screen.queryByRole('group', { name: 'Try one of these' })).not.toBeInTheDocument();
  });
});

describe('CommandBar, share (ADR-0078)', () => {
  it('asks the editor that hosts it to open the panel, and has nothing to show of its own, when the flag is on', async () => {
    const onShare = vi.fn();
    const { user, log, history } = await renderBar(emptyDocument(), { flags: 'editor,share', onShare });
    await openBar(user);

    await type(user, 'share{Enter}');

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(field()).toHaveValue('');
    expect(screen.queryByTestId('command-answer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('help')).not.toBeInTheDocument();
    expect(log.entries()).toEqual([]);
    expect(history.lines()).toEqual(['share']);
  });

  it('is not asked for by any other command, which does what it says and leaves the panel shut', async () => {
    const { user, store, onShare, log } = await renderBar(emptyDocument(), { flags: 'editor,share' });
    await openBar(user);

    await type(user, 'declare queue jobs{Enter}');

    expect(Object.values(store.document().queues).map(({ name }) => name)).toEqual(['jobs']);
    expect(log.entries()).toHaveLength(1);
    expect(onShare).not.toHaveBeenCalled();
  });

  it('changes nothing: the canvas is the same one, and there is no step of undo', async () => {
    const { user, store, onShare } = await renderBar(SHOP, { flags: 'editor,share' });
    const before = store.document();
    await openBar(user);

    await type(user, 'share{Enter}');

    expect(onShare).toHaveBeenCalledTimes(1);
    expect(store.document()).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  it('is refused, saying why and how to try it, when the flag is off, and the panel is not asked for', async () => {
    const { user, onShare, status, spoken } = await renderBar(emptyDocument(), { flags: 'editor' });
    await openBar(user);

    await type(user, 'share{Enter}');

    expect(onShare).not.toHaveBeenCalled();
    const answer = await screen.findByTestId('command-answer');
    expect(answer).toHaveTextContent('Sharing is not switched on yet, so there is no link to make.');
    expect(answer).toHaveTextContent('add ?ff=share to the address to try it');
    expect(status.refusal()).toMatchObject({ origin: 'typed' });
    expect(spoken.some((line) => line.includes('Sharing is not switched on yet'))).toBe(true);
    expect(field()).toHaveValue('share');
  });
});
