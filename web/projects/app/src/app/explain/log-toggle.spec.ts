import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ExplainState } from '../core/explain/explain-state';
import { EXPLAIN_SERVICES } from '../core/explain/services';
import { RUNTIME_SERVICES } from '../core/runtime/services';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { LogToggle } from './log-toggle';

async function renderToggle(inputs: { keys?: string } = {}) {
  const view = await render(LogToggle, {
    inputs,
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
    ],
  });
  return { ...view, explain: TestBed.inject(ExplainState), user: userEvent.setup() };
}

describe('LogToggle (ADR-0061)', () => {
  it('is a button with a name in words, that says that the log is closed and which keys open it', async () => {
    await renderToggle();

    const button = screen.getByRole('button', { name: 'Event log' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'E');
    expect(button).toHaveAttribute('title', 'Show or hide the event log (E)');
    expect(button.querySelector('rmq-icon svg')).not.toBeNull();
  });

  it('says the keys that it is given, which are the table’s and not its own', async () => {
    await renderToggle({ keys: 'Ctrl+E' });

    const button = screen.getByRole('button', { name: 'Event log' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Ctrl+E');
    expect(button).toHaveAttribute('title', 'Show or hide the event log (Ctrl+E)');
  });

  it('opens the log, and says that it is open and what it controls, and closes it', async () => {
    const { user, explain } = await renderToggle();
    const button = screen.getByRole('button', { name: 'Event log' });

    await user.click(button);

    expect(explain.logOpen()).toBe(true);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAttribute('aria-controls', 'event-log');

    await user.click(button);

    expect(explain.logOpen()).toBe(false);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).not.toHaveAttribute('aria-controls');
  });

  it('follows the log when it is opened by another way, such as a key', async () => {
    const { explain, fixture } = await renderToggle();

    explain.openLog();
    fixture.detectChanges();

    expect(screen.getByRole('button', { name: 'Event log' })).toHaveAttribute('aria-expanded', 'true');
  });
});
