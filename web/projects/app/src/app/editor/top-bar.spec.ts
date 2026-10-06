import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FlowViewport } from '../canvas/model/flow-viewport';
import { CanvasSession, type SaveState } from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { EditorActions } from './actions';
import { TopBar } from './top-bar';

async function renderBar() {
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
      { provide: CanvasSession, useValue: { save } },
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
  it('has the one heading of the page, which is the name of the product', async () => {
    await renderBar();

    expect(screen.getByRole('heading', { level: 1, name: 'RabbitMQ Playground' })).toBeInTheDocument();
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

      bus.undo();
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

  it('has a name in words for every button, so that none is only an icon', async () => {
    await renderBar();

    for (const button of screen.getAllByRole('button')) {
      expect(button, button.outerHTML).toHaveAccessibleName();
    }
  });
});
