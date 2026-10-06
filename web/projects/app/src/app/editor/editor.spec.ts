import { render, screen, waitFor } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { transientQueueReply } from '@rmq/engine';
import { createMemoryRepository, type CanvasRepository } from '@rmq/persistence';
import { manualClock, manualTimer } from '@rmq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_NAME } from '../core/app-info';
import {
  AUTOSAVE_TIMER,
  NOW,
  REPOSITORIES,
  STORAGE_MANAGER,
  UNTITLED,
  type RepositoryFactories,
} from '../core/session/canvas-session';
import { CommandBus } from '../core/state/command-bus';
import { StatusStore } from '../core/state/status-store';
import { THEME_STORAGE_KEY } from '../core/theme/theme';
import { Editor } from './editor';

function harness(options: { readonly browser?: (memory: CanvasRepository) => CanvasRepository } = {}) {
  const clock = manualClock();
  const timer = manualTimer();
  const memory = createMemoryRepository({ now: clock.now, newId: () => 'canvas1' });
  const storage = {
    persist: vi.fn(async () => true),
    persisted: vi.fn(async () => false),
    estimate: vi.fn(async () => ({ usage: 1, quota: 1_000 })),
  };
  const factories: RepositoryFactories = {
    browser: () => options.browser?.(memory) ?? memory,
    memory: () => createMemoryRepository({ now: clock.now, newId: () => 'canvas2' }),
  };
  return {
    memory,
    timer,
    storage,
    providers: [
      { provide: REPOSITORIES, useValue: factories },
      { provide: AUTOSAVE_TIMER, useValue: timer },
      { provide: NOW, useValue: clock.now },
      { provide: STORAGE_MANAGER, useValue: storage },
    ],
  };
}

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('Editor', () => {
  it('has the one heading, which names the product, and the regions of the layout of ADR-0010', async () => {
    await render(Editor, { providers: harness().providers });

    expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Toolbox' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Canvas' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Status' })).toBeInTheDocument();
  });

  it('opens the one implicit canvas, and says that its changes are saved', async () => {
    const { providers, memory } = harness();
    await render(Editor, { providers });

    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));
    expect(screen.queryByTestId('opening')).not.toBeInTheDocument();
    const listed = await memory.list();
    expect(listed.ok && listed.value.canvases.map((canvas) => canvas.name)).toEqual([UNTITLED]);
  });

  it('says what each write came to, and says why when it failed', async () => {
    const { providers, timer } = harness({
      browser: (memory) => ({
        ...memory,
        save: async () => ({
          ok: false,
          error: { kind: 'quota-exceeded', message: 'The browser has no room left to keep this canvas.' },
        }),
      }),
    });
    const { fixture } = await render(Editor, { providers });
    await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

    const bus = fixture.debugElement.injector.get(CommandBus);
    bus.apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
    fixture.detectChanges();
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saving…');

    timer.advance(500);
    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('Not saved. The browser has no room left'),
    );
  });

  it('says that nothing is kept when the browser will not let the site keep canvases', async () => {
    const { providers } = harness({
      browser: (memory) => ({
        ...memory,
        list: async () => ({
          ok: false,
          error: { kind: 'unavailable', message: 'The browser does not let this site keep canvases here.' },
        }),
      }),
    });
    await render(Editor, { providers });

    await waitFor(() =>
      expect(screen.getByTestId('save-state')).toHaveTextContent('Not kept after you close this tab.'),
    );
    expect(screen.getByTestId('save-state')).toHaveTextContent('does not let this site keep canvases');
  });

  describe('canvases that cannot be opened', () => {
    const unreadable = (count: number) =>
      harness({
        browser: (memory) => ({
          ...memory,
          list: async () => {
            const listed = await memory.list();
            return listed.ok
              ? {
                  ok: true,
                  value: {
                    ...listed.value,
                    unreadable: Array.from({ length: count }, (_, index) => ({
                      id: `newer${index}`,
                      error: {
                        kind: 'newer-version' as const,
                        of: 'schema' as const,
                        found: 9,
                        understood: 1,
                        message: 'Newer.',
                      },
                    })),
                  },
                }
              : listed;
          },
        }),
      });

    it('are counted, with the reason that nothing was changed, and are left alone', async () => {
      await render(Editor, { providers: unreadable(1).providers });

      expect(await screen.findByTestId('unreadable')).toHaveTextContent(
        '1 saved canvas in this browser could not be opened, for example because a newer version of the app saved it. Nothing was changed.',
      );
    });

    it('are counted in the plural', async () => {
      await render(Editor, { providers: unreadable(3).providers });

      expect(await screen.findByTestId('unreadable')).toHaveTextContent(
        '3 saved canvases in this browser could not be opened, for example because a newer version of the app saved them.',
      );
    });

    it('are not mentioned when there are none', async () => {
      await render(Editor, { providers: harness().providers });
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      expect(screen.queryByTestId('unreadable')).not.toBeInTheDocument();
    });
  });

  describe('the theme', () => {
    it('is the system’s until the learner chooses, and the choice is applied and kept', async () => {
      const user = userEvent.setup();
      await render(Editor, { providers: harness().providers });
      const select = screen.getByRole('combobox', { name: 'Theme' });

      expect(select).toHaveValue('system');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

      await user.selectOptions(select, 'dark');
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');

      await user.selectOptions(select, 'light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');

      await user.selectOptions(select, 'system');
      expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    });

    it('offers the three choices, in words', async () => {
      await render(Editor, { providers: harness().providers });

      expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['System', 'Light', 'Dark']);
    });

    it('starts as the choice that was kept', async () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      await render(Editor, { providers: harness().providers });

      expect(screen.getByRole('combobox', { name: 'Theme' })).toHaveValue('dark');
    });
  });

  describe('the status strip', () => {
    it('says what was done', async () => {
      const { fixture } = await render(Editor, { providers: harness().providers });
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      fixture.detectChanges();

      expect(screen.getByTestId('status-message')).toHaveTextContent('Added queue billing.');
    });

    it('says why a refusal was made, the root cause first, and the broker’s reply after it', async () => {
      const { fixture } = await render(Editor, { providers: harness().providers });
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: false }, 'gesture');
      fixture.detectChanges();

      const notice = screen.getByTestId('refusal');
      const message = screen.getByTestId('refusal-message');
      const reply = screen.getByTestId('refusal-reply');
      expect(message).toHaveTextContent("Queue 'billing' is not durable.");
      // The broker's text has line breaks in it, which the notice keeps and the matcher folds.
      expect(reply).toHaveTextContent(
        `${transientQueueReply().code} ${transientQueueReply().text.replace(/\s+/g, ' ')}`,
      );
      expect(notice.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
      expect(message.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('does not repeat a refusal that the inspector shows beside the control that made it', async () => {
      const { fixture } = await render(Editor, { providers: harness().providers });
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: false }, 'inspector');
      fixture.detectChanges();

      expect(fixture.debugElement.injector.get(StatusStore).refusal()).not.toBeNull();
      expect(screen.queryByTestId('refusal')).not.toBeInTheDocument();
    });

    it('says when the browser is running out of room, and when it would not promise to keep the canvases', async () => {
      const { providers, timer, storage } = harness();
      storage.estimate.mockResolvedValue({ usage: 900, quota: 1_000 });
      storage.persist.mockResolvedValue(false);
      const { fixture } = await render(Editor, { providers });
      await waitFor(() => expect(screen.getByTestId('save-state')).toHaveTextContent('All changes saved'));

      fixture.debugElement.injector
        .get(CommandBus)
        .apply({ type: 'declare-queue', name: 'billing', durable: true }, 'gesture');
      timer.advance(500);

      expect(await screen.findByTestId('quota')).toHaveTextContent('90%');
      expect(await screen.findByTestId('persistence')).toHaveTextContent('backup');
    });
  });
});
