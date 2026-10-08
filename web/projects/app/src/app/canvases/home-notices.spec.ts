import { signal } from '@angular/core';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import type { PersistResult, QuotaWarning, StorageUsage } from '@rmq/persistence';
import { describe, expect, it, vi } from 'vitest';
import { HomeNotices } from './home-notices';
import { CanvasLibrary } from './library';
import type { Reminder } from './reminder';

function fakeLibrary() {
  const memoryReason = signal<string | undefined>(undefined);
  const quota = signal<QuotaWarning | null>(null);
  const persistence = signal<PersistResult | null>(null);
  const reminder = signal<Reminder>({ due: false });
  const usage = signal<StorageUsage | null>(null);
  return {
    memoryReason,
    quota,
    persistence,
    reminder,
    usage,
    exportBackup: vi.fn(async () => undefined),
    snoozeReminder: vi.fn(async () => undefined),
  };
}

async function renderNotices() {
  const library = fakeLibrary();
  const view = await render(HomeNotices, { providers: [{ provide: CanvasLibrary, useValue: library }] });
  return { ...view, library, user: userEvent.setup() };
}

describe('HomeNotices (ADR-0075)', () => {
  it('says nothing when there is nothing to say', async () => {
    const { container } = await renderNotices();

    expect(container.textContent?.trim()).toBe('');
  });

  describe('when the browser keeps nothing', () => {
    it('says that nothing is kept after the tab is closed, the reason, and what to do', async () => {
      const { library, fixture } = await renderNotices();

      library.memoryReason.set('The browser does not let this site keep canvases here.');
      fixture.detectChanges();

      const note = await screen.findByTestId('memory-note');
      expect(note).toHaveTextContent('Nothing here is kept after you close this tab.');
      expect(note).toHaveTextContent('The browser does not let this site keep canvases here.');
      expect(note).toHaveTextContent('Save a canvas as a file, or back up everything, to keep your work.');
    });
  });

  describe('when the room is running out', () => {
    it('says it in words in the colour of a warning at 80%, and of an error at 95%', async () => {
      const { library, fixture } = await renderNotices();

      library.quota.set({ level: 'low', message: 'The browser has used 85% of the room.' });
      fixture.detectChanges();
      const low = await screen.findByTestId('quota');
      expect(low).toHaveTextContent('The browser has used 85% of the room.');
      expect(low.className).toContain('text-warning');
      expect(low.className).not.toContain('text-danger');

      library.quota.set({ level: 'critical', message: 'The browser has almost no room left.' });
      fixture.detectChanges();
      const critical = await screen.findByTestId('quota');
      expect(critical).toHaveTextContent('The browser has almost no room left.');
      expect(critical.className).toContain('text-danger');
    });
  });

  describe('when the browser has not promised to keep the canvases', () => {
    it('says what it said, in a warning', async () => {
      const { library, fixture } = await renderNotices();

      library.persistence.set({ status: 'denied', message: 'The browser did not promise to keep the canvases.' });
      fixture.detectChanges();

      const note = await screen.findByTestId('persistence-note');
      expect(note).toHaveTextContent('The browser did not promise to keep the canvases.');
      expect(note.className).toContain('text-warning');
    });
  });

  describe('the reminder to make a backup', () => {
    const due: Reminder = {
      due: true,
      text: 'You have never backed up your canvases. This browser keeps them on this device only.',
    };

    it('is a group with a name, the reason in words, and two buttons', async () => {
      const { library, fixture } = await renderNotices();

      library.reminder.set(due);
      fixture.detectChanges();

      const group = await screen.findByRole('group', { name: 'Reminder to make a backup' });
      expect(group).toHaveTextContent('You have never backed up your canvases.');
      expect(within(group).getByRole('button', { name: 'Back up everything' })).toBeEnabled();
      expect(within(group).getByRole('button', { name: 'Remind me in a week' })).toBeEnabled();
    });

    it('is not there when it is not due', async () => {
      await renderNotices();

      expect(screen.queryByRole('group', { name: 'Reminder to make a backup' })).not.toBeInTheDocument();
    });

    it('makes the backup with the first button and puts it off with the second', async () => {
      const { library, fixture, user } = await renderNotices();
      library.reminder.set(due);
      fixture.detectChanges();

      await user.click(await screen.findByRole('button', { name: 'Back up everything' }));
      await user.click(screen.getByRole('button', { name: 'Remind me in a week' }));

      expect(library.exportBackup).toHaveBeenCalledOnce();
      expect(library.snoozeReminder).toHaveBeenCalledOnce();
    });
  });

  describe('the room that the canvases take', () => {
    it('says it quietly when the browser says and the room is not running out', async () => {
      const { library, fixture } = await renderNotices();

      library.usage.set({ usage: 1_258_291, quota: 2_254_857_830, fraction: 0.0005 });
      fixture.detectChanges();

      expect(await screen.findByTestId('usage')).toHaveTextContent(
        'The canvases take 1.2 MB of the 2.1 GB that the browser allows.',
      );
    });

    it('leaves it to the warning when the room is running out', async () => {
      const { library, fixture } = await renderNotices();

      library.usage.set({ usage: 850, quota: 1_000, fraction: 0.85 });
      library.quota.set({ level: 'low', message: 'The browser has used 85% of the room.' });
      fixture.detectChanges();

      expect(await screen.findByTestId('quota')).toBeInTheDocument();
      expect(screen.queryByTestId('usage')).not.toBeInTheDocument();
    });

    it('says nothing when the browser does not say', async () => {
      await renderNotices();

      expect(screen.queryByTestId('usage')).not.toBeInTheDocument();
    });
  });
});
