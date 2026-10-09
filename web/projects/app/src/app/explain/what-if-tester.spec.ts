import { TestBed } from '@angular/core/testing';
import { type CanvasDocument } from '@rmq/domain';
import { bindingRecord, documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { render, screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WhatIf } from '../core/explain/what-if';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { WhatIfTester } from './what-if-tester';

/** An exchange `orders` that sends what has the key `new` to `billing` and what has the key `old` to `archive`, and a topic exchange `logs` that sends `#` to `archive`. */
const canvas = (): CanvasDocument =>
  documentOf({
    exchanges: { E: exchangeRecord('orders'), L: exchangeRecord('logs', 'topic') },
    queues: { Q: queueRecord('billing'), A: queueRecord('archive') },
    bindings: {
      B: bindingRecord('E', { kind: 'queue', id: 'Q' }, 'new'),
      B2: bindingRecord('E', { kind: 'queue', id: 'A' }, 'old'),
      B3: bindingRecord('L', { kind: 'queue', id: 'A' }, '#'),
    },
  });

async function renderTester(flags: string | null = 'explain,simulation') {
  const view = await render(WhatIfTester, {
    providers: [
      DocumentStore,
      SelectionStore,
      WhatIf,
      { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
    ],
  });
  TestBed.inject(DocumentStore).load(canvas());
  view.fixture.detectChanges();
  return {
    ...view,
    whatIf: TestBed.inject(WhatIf),
    store: TestBed.inject(DocumentStore),
    selection: TestBed.inject(SelectionStore),
    user: userEvent.setup(),
    settle: () => view.fixture.detectChanges(),
    toggle: () => screen.getByRole('button', { name: 'What if…?' }),
    message: () => screen.getByRole('textbox', { name: 'Message' }),
  };
}

describe('WhatIfTester (ADR-0064)', () => {
  it('is there with no flag, as a section with a name, shut', async () => {
    const { toggle } = await renderTester();

    expect(screen.getByRole('region', { name: 'What if…?' })).toBeVisible();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(toggle()).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('opens with its button, and says what is in it: an exchange to choose, a message to write, and that nothing is published', async () => {
    const { toggle, user, whatIf } = await renderTester();

    await user.click(toggle());

    expect(whatIf.isOpen()).toBe(true);
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    const body = document.getElementById(toggle().getAttribute('aria-controls') as string) as HTMLElement;
    expect(body).toHaveTextContent('Nothing is published');
    expect(within(body).getByRole('combobox', { name: 'Exchange' })).toBeVisible();
    expect(within(body).getByRole('textbox', { name: 'Message' })).toBeVisible();
  });

  it('lists the exchanges of the canvas and the default exchange, and asks about the first until another is chosen', async () => {
    const { toggle, user, whatIf } = await renderTester();
    await user.click(toggle());
    const select = screen.getByRole('combobox', { name: 'Exchange' }) as HTMLSelectElement;

    expect([...select.options].map((option) => option.textContent?.trim())).toEqual([
      'orders (direct)',
      'logs (topic)',
      'The default exchange',
    ]);
    expect(select.value).toBe('orders');

    await user.selectOptions(select, 'logs');
    expect(whatIf.exchange()).toBe('logs');
    await user.selectOptions(select, ['']);
    expect(whatIf.exchange()).toBe('');
  });

  it('asks about the exchange that is selected when it is opened', async () => {
    const { toggle, user, selection, settle } = await renderTester();
    selection.select(['L']);
    settle();

    await user.click(toggle());

    expect((screen.getByRole('combobox', { name: 'Exchange' }) as HTMLSelectElement).value).toBe('logs');
  });

  it('answers as the message is typed, answer first, with the route under it, folded, and the line that would send it for real', async () => {
    const { toggle, user, message, settle } = await renderTester();
    await user.click(toggle());

    await user.type(message(), 'key=new');
    settle();

    expect(screen.getByTestId('what-if-answer')).toHaveTextContent('Would reach billing.');
    expect(screen.getByTestId('what-if-answer')).toHaveAttribute('role', 'status');
    const route = screen.getByTestId('what-if-route') as HTMLDetailsElement;
    expect(route.open).toBe(false);
    expect(within(route).getByText('The route')).toBeVisible();
    expect(within(route).getByTestId('route-summary')).toHaveTextContent('Reached billing.');
    expect(screen.getByTestId('what-if-line')).toHaveTextContent('publish orders key=new');
  });

  it('answers from the first character, and again when another exchange is chosen, with no wait', async () => {
    const { toggle, user, message, settle } = await renderTester();
    await user.click(toggle());

    await user.type(message(), 'key=ol');
    settle();
    expect(screen.getByTestId('what-if-answer')).toHaveTextContent('No queue would get it.');
    await user.type(message(), 'd');
    settle();
    expect(screen.getByTestId('what-if-answer')).toHaveTextContent('Would reach archive.');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Exchange' }), 'logs');
    settle();

    expect(screen.getByTestId('what-if-answer')).toHaveTextContent('Would reach archive.');
    expect(screen.getByTestId('what-if-line')).toHaveTextContent('publish logs key=old');
  });

  it('says the refusal of the grammar under the field, cause first, and answers nothing, until what is typed can be read', async () => {
    const { toggle, user, message, settle } = await renderTester();
    await user.click(toggle());

    await user.type(message(), 'keyy=new');
    settle();

    expect(message()).toHaveAttribute('aria-invalid', 'true');
    const problem = screen.getByTestId('what-if-problem');
    expect(problem).toBeVisible();
    // The field is described by the hint and by the refusal, each by an id of its own that names an element.
    const described = (message().getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toHaveLength(2);
    expect(described[1]).toBe(problem.id);
    expect(new Set(described).size).toBe(2);
    for (const id of described) {
      expect(document.getElementById(id), id).not.toBeNull();
    }
    expect(screen.queryByTestId('what-if-answer')).toBeNull();

    await user.clear(message());
    await user.type(message(), 'key=new');
    settle();

    expect(message()).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('what-if-problem')).toBeNull();
    expect(screen.getByTestId('what-if-answer')).toBeVisible();
  });

  it('has no line for the default exchange', async () => {
    const { toggle, user, message, settle } = await renderTester();
    await user.click(toggle());
    await user.type(message(), 'key=new');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Exchange' }), ['']);
    settle();
    expect(screen.queryByTestId('what-if-line')).toBeNull();
  });

  it('says the cause first of a message that the broker refuses, and has the tree of the refusal in its route', async () => {
    const { toggle, user, store, settle } = await renderTester();
    store.load({
      ...canvas(),
      exchanges: { ...canvas().exchanges, H: exchangeRecord('hidden', 'direct', { internal: true }) },
    });
    await user.click(toggle());

    await user.selectOptions(screen.getByRole('combobox', { name: 'Exchange' }), 'hidden');
    settle();

    expect(screen.getByTestId('what-if-answer')).toHaveTextContent('internal exchange');
  });

  it('shuts with Escape from inside it, and gives the keyboard to its button', async () => {
    const { toggle, user, message, whatIf, settle } = await renderTester();
    await user.click(toggle());
    message().focus();

    await user.keyboard('{Escape}');
    settle();

    expect(whatIf.isOpen()).toBe(false);
    expect(toggle()).toHaveFocus();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('does nothing for Escape when it is shut', async () => {
    const { toggle, user, whatIf } = await renderTester();
    toggle().focus();

    await user.keyboard('{Escape}');

    expect(whatIf.isOpen()).toBe(false);
  });

  it('keeps what was typed when it is shut and opened again, and follows the canvas while it is open', async () => {
    const { toggle, user, message, store, settle } = await renderTester();
    await user.click(toggle());
    await user.type(message(), 'key=new');
    await user.click(toggle());
    await user.click(toggle());
    expect(message()).toHaveValue('key=new');

    store.load({ ...canvas(), bindings: {} });
    settle();

    expect(screen.getByTestId('what-if-answer')).toHaveTextContent('No queue would get it.');
  });
});
