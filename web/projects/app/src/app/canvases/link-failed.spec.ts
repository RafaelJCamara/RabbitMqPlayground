import type { ShareError } from '@rmq/persistence';
import { createEvent, fireEvent, render, screen } from '@testing-library/angular';
import { describe, expect, it, vi } from 'vitest';
import { APP_DISCLAIMER, APP_NAME } from '../core/app-info';
import { LinkOpening } from '../core/share/link-opening';
import { PAGE_ADDRESS, type PageAddress } from '../core/share/page-address';
import { LinkFailed } from './link-failed';

const HOME = 'https://learner.test/app/?ff=editor,share';

const damaged: ShareError = {
  kind: 'damaged',
  message:
    'This link is cut short or was changed on the way: its text has a character that a link does not. Nothing was opened and nothing was changed.',
};

async function renderFailed(error: ShareError = damaged) {
  const leave = vi.fn();
  const view = await render(LinkFailed, {
    inputs: { error },
    providers: [
      { provide: PAGE_ADDRESS, useValue: { home: () => HOME } as PageAddress },
      { provide: LinkOpening, useValue: { leave } },
    ],
  });
  return { ...view, leave };
}

describe('LinkFailed (ADR-0078)', () => {
  it('has the name of the product as its one heading of the first level, and says what the page is', async () => {
    await renderFailed();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: APP_NAME })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'This link could not be opened' })).toBeInTheDocument();
  });

  it('says why in an alert, in the words of the check that refused the link, once', async () => {
    await renderFailed();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(damaged.message);
    expect(alert.textContent?.match(/Nothing was opened and nothing was changed\./g)).toHaveLength(1);
  });

  it('says that nothing was opened and nothing was changed when the words of the check do not', async () => {
    await renderFailed({ kind: 'damaged', message: 'This link is empty.' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This link is empty. Nothing was opened and nothing was changed.',
    );
  });

  it('does not say it twice when the words of the check say it in their own way', async () => {
    const message = 'This canvas was saved by a newer version of this app. Nothing was loaded and nothing was changed.';
    await renderFailed({ kind: 'damaged', message });

    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('alert').textContent).not.toContain('Nothing was opened');
  });

  it('has a link to the playground that is the page without the link and with the query that the learner came with', async () => {
    await renderFailed();

    expect(screen.getByRole('link', { name: 'Go to the playground' })).toHaveAttribute('href', HOME);
  });

  it('takes the fragment off and loads the page when the link is clicked, instead of following it', async () => {
    const { leave } = await renderFailed();
    const link = screen.getByRole('link', { name: 'Go to the playground' });
    const click = createEvent.click(link);

    fireEvent(link, click);

    expect(click.defaultPrevented).toBe(true);
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it('says that the product is not affiliated with Broadcom or the RabbitMQ project, as the other pages do', async () => {
    await renderFailed();

    expect(screen.getByText(APP_DISCLAIMER)).toBeInTheDocument();
  });

  it('shows what the message quotes as text: markup in it makes nothing', async () => {
    await renderFailed({
      kind: 'damaged',
      message:
        'The name <img src=x onerror="window.pwned=1"> is not a name. Nothing was opened and nothing was changed.',
    });

    expect(screen.getByRole('alert')).toHaveTextContent('The name <img src=x onerror="window.pwned=1"> is not a name.');
    expect(document.querySelector('img')).toBeNull();
    expect((window as unknown as Record<string, unknown>)['pwned']).toBeUndefined();
  });
});
