import { TestBed } from '@angular/core/testing';
import { emptyDocument, type CanvasDocument, type RuntimeCommand } from '@rmq/domain';
import type { HeaderArguments, HeaderEntry, HeaderValue } from '@rmq/engine';
import {
  bindingRecord,
  documentOf,
  entry,
  exchangeRecord,
  float,
  headerArguments,
  int,
  manualFrames,
  queueRecord,
  str,
} from '@rmq/testing';
import { screen, within } from '@testing-library/angular';
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
import { HeadersLive, RECENT_LIMIT } from './headers-live';

/** A headers exchange `docs`, an exchange `intake` that is bound to it, an exchange `other` that is not, and two queues. */
const canvas = (): CanvasDocument => ({
  ...documentOf({
    exchanges: {
      D: exchangeRecord('docs', 'headers'),
      I: exchangeRecord('intake', 'fanout'),
      O: exchangeRecord('other', 'fanout'),
    },
    queues: { Q: queueRecord('pdfs'), R: queueRecord('rest') },
    bindings: {
      B1: bindingRecord('D', { kind: 'queue', id: 'Q' }, '', headerArguments('all', entry('format', str('pdf')))),
      B2: bindingRecord('I', { kind: 'exchange', id: 'D' }),
    },
  }),
  settings: { ...emptyDocument().settings, timing: { publishMs: 100, brokerMs: 50, deliverMs: 100 } },
});

const MODE_ALL = headerArguments('all', entry('format', str('pdf')), entry('n', int(1)));

function renderLive(headers: HeaderArguments | null = MODE_ALL, exchange = 'docs') {
  const frames = manualFrames();
  TestBed.configureTestingModule({
    providers: [
      DocumentStore,
      SelectionStore,
      StatusStore,
      CommandBus,
      CommandLog,
      ...RUNTIME_SERVICES,
      ...EXPLAIN_SERVICES,
      { provide: FRAME_SOURCE, useValue: frames },
      { provide: FLAG_SOURCES, useValue: { stored: null, query: 'simulation,explain' } },
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
  frames.frame(0);
  bus.run({ type: 'pause' }, 'toolbar');
  const fixture = TestBed.createComponent(HeadersLive);
  fixture.componentRef.setInput('headers', headers ?? undefined);
  fixture.componentRef.setInput('exchange', exchange);
  fixture.detectChanges();
  const publish = (to: string, ...sent: HeaderEntry<HeaderValue>[]): void => {
    const command: RuntimeCommand = { type: 'publish', from: { kind: 'exchange', name: to }, key: '', headers: sent };
    const result = bus.run(command, 'toolbar');
    if (!result.ok) {
      throw new Error(`refused: ${result.error.message}`);
    }
    log.flush();
    fixture.detectChanges();
  };
  return {
    fixture,
    publish,
    set: (name: string, value: unknown) => {
      fixture.componentRef.setInput(name, value);
      fixture.detectChanges();
    },
  };
}

const rows = () => screen.getAllByTestId('headers-live-row');
const wordsOf = (row: HTMLElement) =>
  within(row)
    .queryAllByTestId('headers-live-cell')
    .map((cell) => cell.textContent?.trim());

describe('HeadersLive, the table of recent messages (ADR-0070)', () => {
  it('says that nothing was published yet, and what to do, instead of an empty table', async () => {
    renderLive();

    expect(screen.getByTestId('headers-live-empty')).toHaveTextContent(
      'No message has been published to docs yet. Publish one from a producer, and it is checked here.',
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('is a real table, with a caption and headers for the columns and for each message, in a region that a keyboard can scroll', async () => {
    const { publish } = renderLive();
    publish('docs', entry('format', str('pdf')), entry('n', int(1)));

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Message' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'format=pdf' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'n=1' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Result' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader')).toHaveTextContent('#1 format=pdf n=1');
    expect(screen.getByTestId('headers-live-caption')).toHaveTextContent(
      'The message published to docs or to an exchange that leads to it, newest first.',
    );
    const region = screen.getByRole('region', { name: 'Recent messages against the conditions' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('heading', { name: 'Recent messages' })).toBeInTheDocument();
  });

  it('says in words, with an icon, whether each condition held and whether the binding matches, and the whole sentence as the title', async () => {
    const { publish } = renderLive();
    publish('docs', entry('format', str('pdf')), entry('n', int(1)));
    publish('docs', entry('format', str('doc')), entry('n', float(1)));

    const [newest, oldest] = rows() as [HTMLElement, HTMLElement];
    expect(wordsOf(newest)).toEqual(['differs', 'type differs']);
    expect(within(newest).getByTestId('headers-live-result')).toHaveTextContent('Does not match');
    expect(wordsOf(oldest)).toEqual(['holds', 'holds']);
    expect(within(oldest).getByTestId('headers-live-result')).toHaveTextContent('Matches');
    expect(
      within(newest)
        .getAllByTestId('headers-live-cell')
        .map((cell) => cell.getAttribute('title')),
    ).toEqual([
      'The header format is "doc", and the binding asks for "pdf".',
      'The header n is 1.0, a float, and the binding asks for 1, an integer: values of different types are never equal.',
    ]);
    expect(within(newest).getByTestId('headers-live-result')).toHaveAttribute(
      'title',
      'x-match=all: every condition has to hold, and format and n do not.',
    );
    expect(newest).toHaveAttribute('data-matched', 'false');
    expect(oldest).toHaveAttribute('data-matched', 'true');
  });

  it('tells a missing header, a message with no headers at all, and a condition that is not counted', async () => {
    const { publish } = renderLive(headerArguments('all', entry('format', str('pdf')), entry('x-trace', str('1'))));
    publish('docs');
    publish('docs', entry('format', str('pdf')));

    const [withFormat, bare] = rows() as [HTMLElement, HTMLElement];
    expect(wordsOf(withFormat)).toEqual(['holds', 'not counted']);
    expect(within(withFormat).getByTestId('headers-live-result')).toHaveTextContent('Matches');
    expect(wordsOf(bare)).toEqual(['missing', 'not counted']);
    expect(within(bare).getByRole('rowheader')).toHaveTextContent('#1 no headers');
    expect(within(bare).getByTestId('headers-live-result')).toHaveTextContent('Does not match');
  });

  it('shows the last messages first, and not more than the limit, and says how many there were', async () => {
    const { publish } = renderLive();
    for (let index = 0; index < RECENT_LIMIT + 2; index += 1) {
      publish('docs', entry('format', str('pdf')), entry('n', int(index)));
    }

    expect(rows()).toHaveLength(RECENT_LIMIT);
    expect(within(rows()[0] as HTMLElement).getByRole('rowheader')).toHaveTextContent(`#${RECENT_LIMIT + 2} `);
    expect(screen.getByTestId('headers-live-caption')).toHaveTextContent(
      `The last ${RECENT_LIMIT} of ${RECENT_LIMIT + 2} messages published to docs or to an exchange that leads to it, newest first.`,
    );
  });

  it('shows the messages published to the exchange and to one that leads to it, and none that were published elsewhere', async () => {
    const { publish } = renderLive();
    publish('docs', entry('format', str('pdf')));
    publish('intake', entry('format', str('pdf')));
    publish('other', entry('format', str('pdf')));

    expect(rows().map((row) => within(row).getByRole('rowheader').textContent?.trim().split(' ')[0])).toEqual([
      '#2',
      '#1',
    ]);
    expect(screen.getByTestId('headers-live-caption')).toHaveTextContent(
      'The 2 messages published to docs or to an exchange that leads to it, newest first.',
    );
  });

  it('follows the conditions that it is given, for the messages it has', async () => {
    const { publish, set } = renderLive();
    publish('docs', entry('format', str('pdf')), entry('n', int(1)));
    expect(wordsOf(rows()[0] as HTMLElement)).toEqual(['holds', 'holds']);

    set(
      'headers',
      headerArguments('all', entry('format', str('pdf')), entry('n', str('1')), entry('seen', { t: 'exists' })),
    );

    expect(wordsOf(rows()[0] as HTMLElement)).toEqual(['holds', 'type differs', 'missing']);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual([
      'Message',
      'format=pdf',
      'n="1"',
      'exists(seen)',
      'Result',
    ]);
  });

  it('has a row and no column of conditions for a binding that has none, which matches every message', async () => {
    const { publish } = renderLive(null);
    publish('docs', entry('format', str('pdf')));

    expect(wordsOf(rows()[0] as HTMLElement)).toEqual([]);
    expect(within(rows()[0] as HTMLElement).getByTestId('headers-live-result')).toHaveTextContent('Matches');
  });

  it('is read again when a message arrives, and not before the log has said so', async () => {
    const { publish, fixture } = renderLive();
    expect(screen.getByTestId('headers-live-empty')).toBeInTheDocument();

    publish('docs', entry('format', str('pdf')));
    fixture.detectChanges();

    expect(rows()).toHaveLength(1);
    expect(screen.queryByTestId('headers-live-empty')).not.toBeInTheDocument();
  });

  it('says the default exchange in words', async () => {
    renderLive(MODE_ALL, '');

    expect(screen.getByTestId('headers-live-empty')).toHaveTextContent(
      'No message has been published to the default exchange yet.',
    );
  });

  it('gives each table a title of its own, so that two on a page are two regions', async () => {
    renderLive();
    const first = screen.getByTestId('headers-live').getAttribute('aria-labelledby');

    const second = TestBed.createComponent(HeadersLive);
    second.componentRef.setInput('exchange', 'docs');
    second.detectChanges();

    expect(second.nativeElement.querySelector('section').getAttribute('aria-labelledby')).not.toBe(first);
  });
});

describe('HeadersLive, for an exchange that nothing leads to (ADR-0070)', () => {
  it('says only the exchange in its caption, and shows only what was published to it', () => {
    const { publish } = renderLive(MODE_ALL, 'other');
    publish('other', entry('format', str('pdf')));
    publish('docs', entry('format', str('pdf')));
    publish('intake', entry('format', str('pdf')));

    expect(rows()).toHaveLength(1);
    expect(screen.getByTestId('headers-live-caption')).toHaveTextContent(
      'The message published to other, newest first.',
    );
  });
});
