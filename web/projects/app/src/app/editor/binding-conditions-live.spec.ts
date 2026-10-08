import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import type { HeaderEntry, HeaderValue } from '@rmq/engine';
import {
  bindingRecord,
  documentOf,
  entry,
  exchangeRecord,
  headerArguments,
  int,
  manualFrames,
  queueRecord,
  str,
} from '@rmq/testing';
import { screen, within } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EventLog } from '../core/explain/event-log';
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
import { BindingConditions } from './binding-conditions';

const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: { D: exchangeRecord('docs', 'headers') },
    queues: { Q: queueRecord('pdfs') },
    bindings: {
      B: bindingRecord('D', { kind: 'queue', id: 'Q' }, '', headerArguments('all', entry('format', str('pdf')))),
    },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

async function renderEditor(flags: string) {
  TestBed.configureTestingModule({
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
      { provide: FRAME_SOURCE, useValue: manualFrames() },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
      {
        provide: MOTION_QUERY,
        useValue: { matches: false, addEventListener: () => undefined, removeEventListener: () => undefined },
      },
    ],
  });
  const bus = TestBed.inject(CommandBus);
  const log = TestBed.inject(EventLog);
  TestBed.inject(CommandLog);
  TestBed.inject(Simulation);
  TestBed.inject(DocumentStore).load(canvas());
  bus.run({ type: 'pause' }, 'toolbar');
  const fixture = TestBed.createComponent(BindingConditions);
  fixture.componentRef.setInput('title', 'Conditions');
  fixture.componentRef.setInput('purpose', 'edit');
  fixture.componentRef.setInput('exchange', 'docs');
  fixture.componentRef.setInput('destination', { kind: 'queue', name: 'pdfs' });
  fixture.componentRef.setInput('headers', headerArguments('all', entry('format', str('pdf'))));
  fixture.detectChanges();
  const publish = (...headers: HeaderEntry<HeaderValue>[]): void => {
    const command: RuntimeCommand = { type: 'publish', from: { kind: 'exchange', name: 'docs' }, key: '', headers };
    bus.run(command, 'toolbar');
    log.flush();
    fixture.detectChanges();
  };
  return { fixture, publish, user: userEvent.setup() };
}

describe('BindingConditions, with the table of recent messages (ADR-0069, ADR-0070)', () => {
  it('has the table when the simulation and the explanation are on, with the conditions of the draft as its columns', async () => {
    const { publish } = await renderEditor('simulation,explain');
    publish(entry('format', str('pdf')), entry('n', int(1)));

    const table = screen.getByTestId('headers-live');
    expect(within(table).getByRole('columnheader', { name: 'format=pdf' })).toBeInTheDocument();
    expect(within(table).getByTestId('headers-live-result')).toHaveTextContent('Matches');
  });

  it('follows the draft as it is typed, and the document is as it was', async () => {
    const { publish, user, fixture } = await renderEditor('simulation,explain');
    publish(entry('format', str('pdf')), entry('n', int(1)));

    await user.click(screen.getByRole('button', { name: 'Add condition' }));
    await user.type(screen.getByRole('textbox', { name: 'Name of condition 2' }), 'n');
    await user.type(screen.getByRole('textbox', { name: 'Value of condition 2' }), '"1"');
    fixture.detectChanges();

    const table = screen.getByTestId('headers-live');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent?.trim()),
    ).toEqual(['Message', 'format=pdf', 'n="1"', 'Result']);
    expect(
      within(table)
        .getAllByTestId('headers-live-cell')
        .map((cell) => cell.textContent?.trim()),
    ).toEqual(['holds', 'type differs']);
    expect(within(table).getByTestId('headers-live-result')).toHaveTextContent('Does not match');
    expect(TestBed.inject(DocumentStore).document().bindings['B']?.headers?.args).toHaveLength(1);
  });

  it('is not there without the simulation, because it needs the log', async () => {
    await renderEditor('editor');

    expect(screen.queryByTestId('headers-live')).not.toBeInTheDocument();
  });
});
