import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { CANVAS_HOST } from '../core/session/canvas-host';
import { CanvasSession, type SaveState } from '../core/session/canvas-session';
import { ICONS } from '../core/ui/icons';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { EditorActions } from './actions';
import { TopBar } from './top-bar';

async function renderBar(options: { readonly flags?: string } = {}) {
  const save = signal<SaveState>({ kind: 'saved' });
  const calls: string[] = [];
  const view = await render(TopBar, {
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      FlowViewport,
      EditorActions,
      ...RUNTIME_SERVICES,
      { provide: CanvasSession, useValue: { save } },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: options.flags ?? null } },
    ],
  });
  const viewport = TestBed.inject(FlowViewport);
  viewport.attach({
    transform: () => ({ position: { x: 0, y: 0 }, scaledPosition: { x: 0, y: 0 }, scale: 1 }),
    host: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    fit: () => calls.push('fit'),
    zoomIn: () => calls.push('zoomIn'),
    zoomOut: () => calls.push('zoomOut'),
    resetZoom: () => calls.push('resetZoom'),
    select: () => undefined,
    focus: () => undefined,
    edgePath: () => null,
  });
  return {
    ...view,
    calls,
    viewport,
    bus: TestBed.inject(CommandBus),
    store: TestBed.inject(DocumentStore),
    save,
    user: userEvent.setup(),
  };
}

describe('TopBar', () => {
  describe('sharing (ADR-0078, ADR-0079)', () => {
    it('has neither button without the flag, so that a visitor who has not asked for it sees nothing of it', async () => {
      await renderBar();

      expect(screen.queryByRole('button', { name: 'Share…' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Export…' })).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Share' })).not.toBeInTheDocument();
    });

    it('has a Share button and an Export button with the flag, in a group, each of which says that it opens a dialog', async () => {
      await renderBar({ flags: 'editor,share' });

      const group = screen.getByRole('group', { name: 'Share' });
      for (const name of ['Share…', 'Export…']) {
        const button = within(group).getByRole('button', { name });
        expect(button).toHaveAttribute('aria-haspopup', 'dialog');
        expect(button).toHaveAttribute('type', 'button');
      }
    });

    it('asks the editor for the panel that makes a link when Share is pressed, and for the dialog that exports when Export is', async () => {
      const { user } = await renderBar({ flags: 'editor,share' });
      const actions = TestBed.inject(EditorActions);
      const share = vi.spyOn(actions, 'share').mockImplementation(() => undefined);
      const exporting = vi.spyOn(actions, 'exportDefinitions').mockImplementation(() => undefined);

      await user.click(screen.getByRole('button', { name: 'Share…' }));
      expect([share.mock.calls.length, exporting.mock.calls.length]).toEqual([1, 0]);
      await user.click(screen.getByRole('button', { name: 'Export…' }));

      expect([share.mock.calls.length, exporting.mock.calls.length]).toEqual([1, 1]);
    });

    it('says in words, when the pointer rests on them, what each of them does', async () => {
      await renderBar({ flags: 'editor,share' });

      expect(screen.getByRole('button', { name: 'Share…' })).toHaveAttribute('title', 'Make a link to this canvas');
      expect(screen.getByRole('button', { name: 'Export…' })).toHaveAttribute(
        'title',
        'Export this canvas as a RabbitMQ definitions file',
      );
    });
  });
  describe('help (ADR-0047)', () => {
    it('has a button, with its name in words, that asks for the cheat-sheet and says that it opens a dialog', async () => {
      await renderBar();
      const open = vi.spyOn(TestBed.inject(EditorActions), 'openCheatSheet').mockImplementation(() => undefined);

      const help = screen.getByRole('button', { name: 'Help' });
      expect(help).toHaveAttribute('aria-haspopup', 'dialog');
      expect(help).toHaveAttribute('aria-keyshortcuts', '?');
      // It is an icon, so what it is is also said when the pointer rests on it, with the key.
      expect(help).toHaveAttribute('title', 'Help: keyboard shortcuts and commands (?)');
      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveAttribute('title', 'Theme');
      // The icon in front of the choice of a theme is a picture of what the choice says, which the choice says in words.
      expect(screen.getByRole('combobox', { name: 'Theme' }).previousElementSibling).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      await userEvent.setup().click(help);

      expect(open).toHaveBeenCalledOnce();
    });
  });

  it('has the one heading of the page, which is the name of the product', async () => {
    await renderBar();

    expect(screen.getByRole('heading', { level: 1, name: 'RabbitMQ Playground' })).toBeInTheDocument();
  });

  it('has no heading of its own in a workspace, where the strip of open canvases has the name of the product (ADR-0072)', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: CANVAS_HOST, useValue: { canvasToOpen: () => undefined, attach: () => () => undefined } }],
    });

    await renderBar();

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Edit' })).toBeInTheDocument();
  });

  describe('clear (ADR-0074)', () => {
    it('is not there outside a workspace, where nothing offers to bring the canvas back', async () => {
      await renderBar();

      expect(screen.queryByRole('button', { name: 'Clear canvas' })).not.toBeInTheDocument();
    });

    it('is a button of the group Edit in a workspace, named in words, that takes everything off the canvas', async () => {
      TestBed.configureTestingModule({
        providers: [
          { provide: CANVAS_HOST, useValue: { canvasToOpen: () => undefined, attach: () => () => undefined } },
        ],
      });
      const { user } = await renderBar();
      const clear = vi.spyOn(TestBed.inject(EditorActions), 'clear').mockImplementation(() => undefined);

      const button = within(screen.getByRole('group', { name: 'Edit' })).getByRole('button', { name: 'Clear canvas' });
      expect(button).toHaveTextContent('Clear');
      await user.click(button);

      expect(clear).toHaveBeenCalledExactlyOnceWith('toolbar');
    });
  });

  it('has two groups of buttons, each with a name: what is done to the canvas, and how it is looked at', async () => {
    await renderBar();

    const edit = screen.getByRole('group', { name: 'Edit' });
    const view = screen.getByRole('group', { name: 'View' });
    expect(
      within(edit)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Undo', 'Redo', 'Auto-layout']);
    expect(within(view).getAllByRole('button')).toHaveLength(4);
  });

  describe('undo and redo', () => {
    it('are not available when there is nothing to take back or to put back', async () => {
      await renderBar();

      expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Redo' })).toBeDisabled();
    });

    it('say what they would take back and put back, in their names', async () => {
      const { bus, fixture } = await renderBar();

      bus.apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      fixture.detectChanges();
      expect(screen.getByRole('button', { name: 'Undo: added queue billing' })).toBeEnabled();

      bus.undo('toolbar');
      fixture.detectChanges();
      expect(screen.getByRole('button', { name: 'Redo: added queue billing' })).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    });

    it('undo and redo when they are pressed', async () => {
      const { bus, store, user, fixture } = await renderBar();
      bus.apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      fixture.detectChanges();

      await user.click(screen.getByRole('button', { name: /^Undo/ }));
      expect(Object.keys(store.document().queues)).toEqual([]);

      await user.click(screen.getByRole('button', { name: /^Redo/ }));
      expect(Object.values(store.document().queues).map((queue) => queue.name)).toEqual(['billing']);
    });

    it('say which keys do the same, so that nothing is hidden', async () => {
      await renderBar();

      expect(screen.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-keyshortcuts', 'Control+Z Meta+Z');
      expect(screen.getByRole('button', { name: 'Redo' })).toHaveAttribute(
        'aria-keyshortcuts',
        'Control+Shift+Z Control+Y Meta+Shift+Z',
      );
      expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('title')).toMatch(/^Undo \((Ctrl|Cmd)\+Z\)$/);
      expect(screen.getByRole('button', { name: 'Redo' }).getAttribute('title')).toMatch(
        /^Redo \((Ctrl|Cmd)\+Shift\+Z\)$/,
      );
    });
  });

  describe('auto-layout', () => {
    it('arranges the canvas as one step, and fits it', async () => {
      const { bus, store, user, calls, fixture } = await renderBar();
      bus.apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      bus.apply({ type: 'add-producer', name: 'sender' }, 'gesture');
      fixture.detectChanges();

      await user.click(screen.getByRole('button', { name: 'Auto-layout' }));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(store.undoLabel()).toBe('arranged the canvas');
      expect(calls).toEqual(['fit']);
    });
  });

  describe('the default exchange (ADR-0043)', () => {
    it('has a switch, named for what it shows, that is off while the canvas does not show it', async () => {
      await renderBar();

      const toggle = screen.getByRole('switch', { name: 'Default exchange' });

      expect(toggle).toHaveAttribute('aria-checked', 'false');
      expect(within(screen.getByRole('group', { name: 'View' })).getByRole('switch')).toBe(toggle);
    });

    it('turns the setting of the canvas on, with the top bar as the origin, as a command that is saved and undone like any other', async () => {
      const { user, store, bus } = await renderBar();
      const seen: string[] = [];
      bus.onApplied(({ origin, command }) => seen.push(`${origin} ${command.type}`));

      await user.click(screen.getByRole('switch', { name: 'Default exchange' }));

      expect(store.document().settings.showDefaultExchange).toBe(true);
      expect(seen).toEqual(['toolbar set']);
      expect(screen.getByRole('switch', { name: 'Default exchange' })).toHaveAttribute('aria-checked', 'true');
      expect(
        screen.getByRole('button', { name: 'Undo: changed the default exchange setting of the canvas' }),
      ).toBeEnabled();
    });

    it('turns it off again, and follows an undo, which puts the setting back', async () => {
      const { user, store, bus, fixture } = await renderBar();
      await user.click(screen.getByRole('switch', { name: 'Default exchange' }));

      await user.click(screen.getByRole('switch', { name: 'Default exchange' }));
      expect(store.document().settings.showDefaultExchange).toBe(false);

      await user.click(screen.getByRole('switch', { name: 'Default exchange' }));
      bus.undo('toolbar');
      fixture.detectChanges();

      expect(screen.getByRole('switch', { name: 'Default exchange' })).toHaveAttribute('aria-checked', 'false');
    });
  });

  describe('the view', () => {
    it('zooms out and in, resets, and fits, when the buttons are pressed', async () => {
      const { user, calls } = await renderBar();

      await user.click(screen.getByRole('button', { name: 'Zoom out' }));
      await user.click(screen.getByRole('button', { name: 'Zoom in' }));
      await user.click(screen.getByRole('button', { name: /^Reset the zoom to 100%/ }));
      await user.click(screen.getByRole('button', { name: 'Fit' }));

      expect(calls).toEqual(['zoomOut', 'zoomIn', 'resetZoom', 'fit']);
    });

    it('says how far it is zoomed, in the button that resets it, in its name as well as its text', async () => {
      const { viewport, fixture } = await renderBar();
      expect(screen.getByRole('button', { name: 'Reset the zoom to 100%, now 100%' })).toHaveTextContent('100%');

      viewport.setZoom(0.687);
      fixture.detectChanges();

      expect(screen.getByRole('button', { name: 'Reset the zoom to 100%, now 69%' })).toHaveTextContent('69%');
    });

    it('says which key fits the canvas', async () => {
      await renderBar();

      expect(screen.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-keyshortcuts', 'F');
      expect(screen.getByRole('button', { name: 'Fit' }).getAttribute('title')).toBe('Fit the canvas (F)');
    });
  });

  describe('keeping the canvas', () => {
    it('says what each write came to, in words', async () => {
      const { save, fixture } = await renderBar();
      expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved');

      save.set({ kind: 'saving' });
      fixture.detectChanges();
      expect(screen.getByTestId('save-state')).toHaveTextContent('Saving…');

      save.set({
        kind: 'failed',
        error: { kind: 'quota-exceeded', message: 'The browser has no room left to keep this canvas.' },
      });
      fixture.detectChanges();
      expect(screen.getByTestId('save-state')).toHaveTextContent('Not saved. The browser has no room left');
    });
  });

  describe('the sign of what a write came to', () => {
    const signOf = () => screen.getByTestId('save-state').querySelector('svg path')?.getAttribute('d');

    it.each<[string, SaveState, keyof typeof ICONS, string]>([
      ['is saved', { kind: 'saved' }, 'check', 'text-muted'],
      ['is being saved', { kind: 'saving' }, 'info', 'text-muted'],
      ['is being opened', { kind: 'opening' }, 'info', 'text-muted'],
      [
        'could not be saved',
        { kind: 'failed', error: { kind: 'quota-exceeded', message: 'The browser has no room left.' } },
        'alert',
        'text-danger',
      ],
      ['is not kept at all', { kind: 'memory', reason: 'The browser keeps nothing.' }, 'alert', 'text-warning'],
    ])('has the sign and the colour that say so when the canvas %s', async (_what, state, icon, colour) => {
      const { save, fixture } = await renderBar();

      save.set(state);
      fixture.detectChanges();

      expect(signOf()).toBe(ICONS[icon]);
      expect(screen.getByTestId('save-state')).toHaveClass(colour);
      for (const other of ['text-muted', 'text-danger', 'text-warning'].filter((name) => name !== colour)) {
        expect(screen.getByTestId('save-state')).not.toHaveClass(other);
      }
    });
  });

  it('lets the words on Undo and Redo be their names until there is something to say about what they do', async () => {
    const { bus, fixture } = await renderBar();

    expect(screen.getByRole('button', { name: 'Undo' })).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('button', { name: 'Redo' })).not.toHaveAttribute('aria-label');
    bus.apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
    fixture.detectChanges();
    expect(screen.getByRole('button', { name: 'Undo: added queue billing' })).toHaveAttribute(
      'aria-label',
      'Undo: added queue billing',
    );
  });

  it('has a name in words for every button, so that none is only an icon', async () => {
    await renderBar();

    for (const button of screen.getAllByRole('button')) {
      expect(button, button.outerHTML).toHaveAccessibleName();
    }
  });
});
