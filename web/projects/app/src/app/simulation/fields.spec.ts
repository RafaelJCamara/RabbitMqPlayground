import { runInInjectionContext, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { DocumentCommand } from '@rmq/domain';
import { documentOf, producerRecord } from '@rmq/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandBus } from '../core/state/command-bus';
import { DocumentStore } from '../core/state/document-store';
import { SelectionStore } from '../core/state/selection-store';
import { StatusStore } from '../core/state/status-store';
import { Fields } from './fields';

/** What the learner did to a field of text: the text is in it, and the field was left. */
function given(text: string): { readonly input: HTMLInputElement; readonly event: Event } {
  const input = document.createElement('input');
  input.value = text;
  return { input, event: { target: input } as unknown as Event };
}

const burst =
  (name = 'sender') =>
  (value: number): DocumentCommand => ({ type: 'set', kind: 'producer', name, changes: { burst: value } });

describe('Fields (ADR-0056)', () => {
  let fields: Fields;
  let store: DocumentStore;
  let status: StatusStore;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [DocumentStore, SelectionStore, StatusStore, CommandBus] });
    store = TestBed.inject(DocumentStore);
    status = TestBed.inject(StatusStore);
    store.load(documentOf({ producers: { P: producerRecord('sender') } }));
    fields = runInInjectionContext(TestBed.inject(Injector), () => new Fields());
  });

  const burstOfSender = () => store.document().producers['P']?.burst;

  describe('number', () => {
    it('applies the command for a number that was given, and refuses nothing', () => {
      const { event } = given('7');

      fields.number('burst', 'The burst', event, 1, burst());

      expect(burstOfSender()).toBe(7);
      expect(fields.problems()).toEqual({});
    });

    it('does nothing for the number that the document has, and forgets what was refused before', () => {
      fields.number('burst', 'The burst', given('0').event, 1, burst());
      expect(Object.keys(fields.problems())).toEqual(['burst']);

      const { event } = given('1');
      fields.number('burst', 'The burst', event, 1, burst());

      expect(store.canUndo()).toBe(false);
      expect(fields.problems()).toEqual({});
    });

    it('says that a number has to be one, for a field that is empty, and puts back the number that the document has', () => {
      const { input, event } = given('');

      fields.number('burst', 'The burst', event, 4, burst());

      expect(fields.problems()['burst']).toEqual({
        kind: 'invalid-value',
        message: 'The burst has to be a number. It stays as it was.',
      });
      expect(input.value).toBe('4');
      expect(store.canUndo()).toBe(false);
    });

    it('says it for what is not a number that a command could take, and for a number that is too big to be one', () => {
      for (const text of ['soon', 'Infinity', '-Infinity', '1e999']) {
        const { input, event } = given(text);

        fields.number('burst', 'The burst', event, 4, burst());

        expect(fields.problems()['burst']?.message, text).toContain('has to be a number');
        expect(input.value).toBe('4');
      }
    });

    it('keeps the refusal of the command for the field, and puts back the number that the document has', () => {
      const { input, event } = given('0');

      fields.number('burst', 'The burst', event, 1, burst());

      expect(fields.problems()['burst']?.kind).toBe('invalid-value');
      expect(input.value).toBe('1');
      expect(burstOfSender()).toBe(1);
      expect(status.refusal()).toMatchObject({ origin: 'inspector' });
    });

    it('forgets the refusal of another field when a number is accepted, because what is shown is about the last thing that was done', () => {
      fields.number('burst', 'The burst', given('0').event, 1, burst());
      fields.refuse('other', 'Something else.');

      fields.number('burst', 'The burst', given('3').event, 1, burst());

      expect(fields.problems()).toEqual({});
    });
  });

  describe('apply', () => {
    it('answers whether the command was accepted, and keeps what it was refused for under the name of the field', () => {
      expect(fields.apply('burst', burst()(0))).toBe(false);
      expect(Object.keys(fields.problems())).toEqual(['burst']);

      expect(fields.apply('burst', burst()(2))).toBe(true);
      expect(fields.problems()).toEqual({});
    });
  });

  describe('keep and refuse', () => {
    it('keeps what something that is not a command of the document was refused for, and lets go of it when told that nothing was', () => {
      const issue = { kind: 'not-linked', message: 'It goes nowhere.' } as const;

      fields.keep('publish', issue);
      expect(fields.problems()).toEqual({ publish: issue });
      fields.keep('publish', undefined);

      expect(fields.problems()).toEqual({});
    });

    it('says what is wrong in words, as an invalid value', () => {
      fields.refuse('x', 'No.');

      expect(fields.problems()['x']).toEqual({ kind: 'invalid-value', message: 'No.' });
    });
  });

  describe('reset', () => {
    it('forgets what was refused, and the refusal of the inspector on the status line, and not another origin’s', () => {
      fields.apply('burst', burst()(0));
      expect(status.refusal()).not.toBeNull();

      fields.reset();

      expect(fields.problems()).toEqual({});
      expect(status.refusal()).toBeNull();

      status.refuse({ kind: 'invalid-link', message: 'Not that.' }, 'gesture');
      fields.reset();
      expect(status.refusal()).not.toBeNull();
    });
  });

  describe('id', () => {
    it('is the same for the same part, and another for another part, and another for another set of fields', () => {
      const other = runInInjectionContext(TestBed.inject(Injector), () => new Fields());

      expect(fields.id('payload')).toBe(fields.id('payload'));
      expect(fields.id('payload')).not.toBe(fields.id('key'));
      expect(fields.id('payload')).not.toBe(other.id('payload'));
    });
  });
});
