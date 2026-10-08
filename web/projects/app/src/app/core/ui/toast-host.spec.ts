import { TestBed } from '@angular/core/testing';
import { failure, succeed, type Outcome } from '@rmq/persistence';
import { manualTimer } from '@rmq/testing';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Announcer } from '../announcer';
import { ToastHost } from './toast-host';
import { TOAST_TIMER, Toasts } from './toasts';

async function renderHost() {
  const timer = manualTimer();
  const view = await render(ToastHost, { providers: [{ provide: TOAST_TIMER, useValue: timer }] });
  vi.spyOn(TestBed.inject(Announcer), 'announce').mockImplementation(() => undefined);
  return { ...view, timer, toasts: TestBed.inject(Toasts), user: userEvent.setup() };
}

const run = vi.fn(async (): Promise<Outcome<void, string>> => succeed(undefined));

describe('ToastHost (ADR-0074)', () => {
  it('draws nothing, not even an empty region, while there is no notice', async () => {
    await renderHost();

    expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument();
  });

  it('draws a region named Notices with a notice in it, with its message, its action and a button that dismisses it', async () => {
    const { toasts, fixture } = await renderHost();

    toasts.show({ message: 'Deleted “Orders”.', undo: { label: 'Undo', keys: 'Ctrl+Z', run } });
    fixture.detectChanges();

    const region = await screen.findByRole('region', { name: 'Notices' });
    expect(within(region).getByText('Deleted “Orders”.')).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('is not a live region, because the announcer says each notice and one that was both would be said twice', async () => {
    const { toasts, fixture } = await renderHost();

    toasts.show({ message: 'Deleted.', undo: { label: 'Undo', run } });
    fixture.detectChanges();

    const region = await screen.findByRole('region', { name: 'Notices' });
    expect(region.closest('[aria-live]')).toBeNull();
    expect(region.querySelector('[role="status"], [role="alert"]')).toBeNull();
  });

  it('has no button for an action on a notice that has none', async () => {
    const { toasts, fixture } = await renderHost();

    toasts.show({ message: 'Done.' });
    fixture.detectChanges();

    const region = await screen.findByRole('region', { name: 'Notices' });
    expect(within(region).getAllByRole('button')).toHaveLength(1);
  });

  it('runs the action when its button is pressed, and the notice goes', async () => {
    const { toasts, user, fixture } = await renderHost();
    const undo = vi.fn(async (): Promise<Outcome<void, string>> => succeed(undefined));
    toasts.show({ message: 'Deleted.', undo: { label: 'Undo', run: undo } });
    fixture.detectChanges();

    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(undo).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument());
  });

  it('says why the action did not work, as an alert in the notice, and keeps it', async () => {
    const { toasts, user, fixture } = await renderHost();
    toasts.show({
      message: 'Deleted.',
      undo: { label: 'Undo', run: async (): Promise<Outcome<void, string>> => failure('It is gone for good.') },
    });
    fixture.detectChanges();

    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('It is gone for good.');
    expect(screen.getByRole('region', { name: 'Notices' })).toBeInTheDocument();
  });

  it('is dismissed by its button, and by Escape when the focus is in it', async () => {
    const { toasts, user, fixture } = await renderHost();
    toasts.show({ message: 'First.' });
    toasts.show({ message: 'Second.' });
    fixture.detectChanges();

    await user.click((await screen.findAllByRole('button', { name: 'Dismiss' }))[0] as HTMLElement);
    expect(screen.queryByText('First.')).not.toBeInTheDocument();

    screen.getByRole('button', { name: 'Dismiss' }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument());
  });

  it('leaves the notices alone when Escape is pressed anywhere else', async () => {
    const { toasts, user, fixture } = await renderHost();
    const elsewhere = document.createElement('button');
    elsewhere.textContent = 'Elsewhere';
    document.body.append(elsewhere);
    toasts.show({ message: 'Deleted.' });
    fixture.detectChanges();
    await screen.findByRole('region', { name: 'Notices' });
    const dismiss = vi.spyOn(toasts, 'dismiss');

    elsewhere.focus();
    await user.keyboard('{Escape}');
    document.body.focus();
    await user.keyboard('{Escape}');

    expect(toasts.visible()).toHaveLength(1);
    expect(dismiss).not.toHaveBeenCalled();
  });

  it('stops its time while the pointer is on it, and starts again when the pointer leaves', async () => {
    const { toasts, timer, fixture } = await renderHost();
    toasts.show({ message: 'Deleted.' });
    fixture.detectChanges();
    const notice = await screen.findByTestId('toast');

    fireEvent.pointerEnter(notice);
    timer.advance(60_000);
    expect(toasts.visible()).toHaveLength(1);

    fireEvent.pointerLeave(notice);
    timer.advance(30_000);
    expect(toasts.visible()).toEqual([]);
  });

  it('keeps waiting when the pointer leaves but the focus is still in the notice', async () => {
    const { toasts, timer, fixture } = await renderHost();
    toasts.show({ message: 'Deleted.', undo: { label: 'Undo', run } });
    fixture.detectChanges();
    const notice = await screen.findByTestId('toast');
    screen.getByRole('button', { name: 'Undo' }).focus();
    fireEvent.pointerEnter(notice);

    fireEvent.pointerLeave(notice);
    timer.advance(60_000);

    expect(toasts.visible()).toHaveLength(1);
  });

  it('stops its time while the focus is in it, and starts again when the focus leaves it, and not when it moves inside it', async () => {
    const { toasts, timer, fixture } = await renderHost();
    toasts.show({ message: 'Deleted.', undo: { label: 'Undo', run } });
    fixture.detectChanges();
    const notice = await screen.findByTestId('toast');
    const undo = screen.getByRole('button', { name: 'Undo' });
    const dismiss = screen.getByRole('button', { name: 'Dismiss' });

    fireEvent.focusIn(undo);
    timer.advance(60_000);
    expect(toasts.visible()).toHaveLength(1);

    fireEvent.focusOut(undo, { relatedTarget: dismiss });
    timer.advance(60_000);
    expect(toasts.visible()).toHaveLength(1);

    fireEvent.focusOut(dismiss, { relatedTarget: null });
    expect(notice).toBeInTheDocument();
    timer.advance(30_000);
    expect(toasts.visible()).toEqual([]);
  });
});
