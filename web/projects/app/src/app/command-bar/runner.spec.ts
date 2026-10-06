import { TestBed } from '@angular/core/testing';
import { documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { Announcer } from '../core/announcer';
import { CommandBus } from '../core/state/command-bus';
import { CommandLog } from '../core/state/command-log';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { helpOutput } from './help';
import { CommandRunner, NOTHING_CHANGED } from './runner';

describe('CommandRunner (ADR-0045)', () => {
  let runner: CommandRunner;
  let store: DocumentStore;
  let bus: CommandBus;
  let status: StatusStore;
  let log: CommandLog;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DocumentStore, SelectionStore, StatusStore, CommandBus, CommandLog, CommandRunner],
    });
    runner = TestBed.inject(CommandRunner);
    store = TestBed.inject(DocumentStore);
    bus = TestBed.inject(CommandBus);
    status = TestBed.inject(StatusStore);
    log = TestBed.inject(CommandLog);
  });

  const queueNames = () => Object.values(store.document().queues).map(({ name }) => name);

  describe('a line that the canvas takes', () => {
    it('is applied through the bus, with the command bar as its origin, so that it is logged as a gesture is', () => {
      const outcome = runner.run('declare queue billing');

      expect(outcome).toEqual({ kind: 'applied' });
      expect(queueNames()).toEqual(['billing']);
      expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual(['typed: declare queue billing']);
    });

    it('says what was done on the status line, as a gesture does', () => {
      runner.run('declare queue billing');

      expect(status.notice()).toEqual({ kind: 'message', text: 'Added queue billing.' });
    });

    it('is one step of undo, and so is a line of several commands', () => {
      runner.run('declare queue a; declare queue b; declare queue c');

      expect(queueNames()).toEqual(['a', 'b', 'c']);
      bus.undo('toolbar');
      expect(queueNames()).toEqual([]);
    });

    it('can name what an earlier command of the same line declared', () => {
      runner.run('declare exchange orders type=direct; declare queue billing; bind orders -> billing key=k');

      expect(Object.values(store.document().bindings)).toHaveLength(1);
    });

    it('is read against the canvas as it is: a name that exists is found, and one that does not is not', () => {
      store.load(documentOf({ queues: { q1: queueRecord('billing') } }));

      expect(runner.run('delete billing')).toEqual({ kind: 'applied' });
      expect(runner.run('delete billing').kind).toBe('refused');
    });
  });

  describe('a line that changes nothing', () => {
    it('says so, because the bus leaves nothing to undo, and leaves the canvas as it was', () => {
      store.load(documentOf({ exchanges: { x1: exchangeRecord('orders', 'direct') } }));
      runner.run('set orders type=direct');
      const before = store.document();

      const outcome = runner.run('set orders type=direct');

      expect(outcome).toEqual({ kind: 'unchanged' });
      expect(store.document()).toBe(before);
      expect(status.notice()).toEqual({ kind: 'message', text: NOTHING_CHANGED });
      expect(log.entries()).toEqual([]);
    });

    it('says why, in plain words, because a learner who sees nothing happen has not been told that it was already so', () => {
      expect(NOTHING_CHANGED).toBe('Nothing changed, because the canvas already is as that command says.');
    });
  });

  describe('a line that cannot be read', () => {
    it('is refused with the issue of the parser, which says where and what to do, and changes nothing', () => {
      const before = store.document();

      const outcome = runner.run('bnd a -> b');

      expect(outcome.kind).toBe('refused');
      expect(outcome.kind === 'refused' && outcome.issue).toMatchObject({
        kind: 'unknown-command',
        at: { start: 0, end: 3 },
        suggestions: ['bind'],
      });
      expect(store.document()).toBe(before);
      expect(log.entries()).toEqual([]);
    });

    it('is told as a refusal that the bus would tell: on the status line, from the command bar, and aloud, assertively', () => {
      const spoken: string[] = [];
      TestBed.inject(Announcer).useSink((message, politeness) => spoken.push(`${politeness}: ${message}`));

      runner.run('frobnicate');

      expect(status.refusal()?.origin).toBe('typed');
      expect(status.refusal()?.issue.message).toContain("There is no command 'frobnicate'");
      expect(spoken).toEqual([expect.stringMatching(/^assertive: There is no command 'frobnicate'/)]);
    });

    it('asks for a command when there is no line, and for no more than one when it is help', () => {
      expect(runner.run('   ')).toMatchObject({ kind: 'refused', issue: { kind: 'syntax' } });
      expect(runner.run('declare queue a; help')).toMatchObject({ kind: 'refused', issue: { kind: 'batch' } });
    });
  });

  describe('a line that the canvas refuses', () => {
    it('is refused with the root cause first and the reply of the broker after it, and changes nothing', () => {
      const outcome = runner.run('declare exchange amq.mine type=direct');

      expect(outcome.kind).toBe('refused');
      if (outcome.kind !== 'refused') {
        return;
      }
      expect(outcome.issue.kind).toBe('reserved-name');
      expect(outcome.issue.message.length).toBeGreaterThan(0);
      expect(outcome.issue.refusal).toBeDefined();
      expect(status.refusal()).toEqual({ kind: 'refusal', issue: outcome.issue, origin: 'typed' });
      expect(Object.keys(store.document().exchanges)).toEqual([]);
    });

    it('spends no id, so that the line that follows it makes the id that it would have made without it', () => {
      runner.run('declare queue first');
      runner.run('declare queue amq.mine');

      runner.run('declare queue second');

      expect(Object.keys(store.document().queues)).toEqual(['q1', 'q2']);
    });
  });

  describe('undo and redo', () => {
    it('take back and put back the last change, as the buttons do, with the command bar as the origin', () => {
      runner.run('declare queue billing');

      expect(runner.run('undo')).toEqual({ kind: 'undone', done: true });
      expect(queueNames()).toEqual([]);
      expect(runner.run('redo')).toEqual({ kind: 'redone', done: true });
      expect(queueNames()).toEqual(['billing']);
      expect(log.entries().map(({ origin, text }) => `${origin}: ${text}`)).toEqual([
        'typed: declare queue billing',
        'typed: undo',
        'typed: redo',
      ]);
    });

    it('say that there was nothing to undo or redo, and say so on the status line', () => {
      expect(runner.run('undo')).toEqual({ kind: 'undone', done: false });
      expect(status.notice()).toEqual({ kind: 'message', text: 'Nothing to undo.' });
      expect(runner.run('redo')).toEqual({ kind: 'redone', done: false });
      expect(status.notice()).toEqual({ kind: 'message', text: 'Nothing to redo.' });
    });
  });

  describe('help', () => {
    it('answers from the registry, and changes nothing: no step of undo, no line in the log, and nothing said on the status line', () => {
      runner.run('declare queue billing');
      const before = store.document();
      const said = status.notice();

      const outcome = runner.run('help bind');

      expect(outcome).toEqual({ kind: 'help', output: helpOutput('bind') });
      expect(store.document()).toBe(before);
      expect(status.notice()).toBe(said);
      expect(log.entries()).toHaveLength(1);
    });

    it('lists the commands when it has no command, and has the parser refuse a command that is not one', () => {
      expect(runner.run('help')).toEqual({ kind: 'help', output: helpOutput() });
      expect(runner.run('help frobnicate')).toMatchObject({ kind: 'refused', issue: { kind: 'unknown-command' } });
    });
  });
});
