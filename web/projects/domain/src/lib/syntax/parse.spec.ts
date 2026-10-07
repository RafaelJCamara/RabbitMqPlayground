import {
  bool,
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  exists,
  float,
  headerArguments,
  int,
  producerRecord,
  queueRecord,
  sampleDocument,
  str,
} from '@rmq/testing';
import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../commands/types';
import type { Issue } from '../document/issue';
import type { CanvasDocument } from '../document/schema';
import { parseCommand } from './parse';
import { declareQueue } from './specs/declare';

/** The sample canvas: exchanges orders, docs and hidden, queues billing and archive, producer sender, consumer worker. */
const sample = (): CanvasDocument => deepFreeze(sampleDocument());

/** Both an exchange and a queue are called `same`, and so are a producer and a consumer. */
const twins = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('same'), F: exchangeRecord('other') },
      queues: { Q: queueRecord('same') },
      producers: { P: producerRecord('same') },
      consumers: { C: consumerRecord('same') },
    }),
  );

const read = (text: string, document: CanvasDocument = sample()): Command => {
  const result = parseCommand(text, document);
  if (!result.ok) {
    throw new Error(`"${text}" was not read: ${result.error.message}`);
  }
  return result.value;
};
const refused = (text: string, document: CanvasDocument = sample()): Issue => {
  const result = parseCommand(text, document);
  if (result.ok) {
    throw new Error(`"${text}" was read as ${JSON.stringify(result.value)}`);
  }
  return result.error;
};
/** The text that an issue points at. */
const pointedAt = (text: string, issue: Issue): string => text.slice(issue.at?.start, issue.at?.end);

describe('parseCommand', () => {
  describe('the name of a command', () => {
    it('is needed, and an empty line says what to type', () => {
      for (const text of ['', '   ', '\t\n']) {
        expect(refused(text)).toEqual({
          kind: 'syntax',
          message: 'Type a command, for example bind orders -> billing.',
          at: { start: 0, end: 0 },
        });
      }
    });

    it('may be one word or two: declare exchange, declare queue, add producer, add consumer, move label', () => {
      expect(read('declare queue q')).toMatchObject({ type: 'declare-queue' });
      expect(read('declare exchange e type=direct')).toMatchObject({ type: 'declare-exchange' });
      expect(read('add producer p')).toMatchObject({ type: 'add-producer' });
      expect(read('add consumer c')).toMatchObject({ type: 'add-consumer' });
      expect(read('move label orders -> billing at=0.5')).toMatchObject({ type: 'move-label' });
    });

    it('finds move label before move, and move when the second word is not label', () => {
      expect(read('move billing x=1')).toMatchObject({ type: 'move' });
      expect(read('move label orders -> billing at=1')).toMatchObject({ type: 'move-label' });
    });

    it('is refused when it is not a command, with the closest commands as suggestions', () => {
      const text = 'bnd orders -> billing';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'unknown-command', suggestions: ['bind'] });
      expect(issue.message).toBe("There is no command 'bnd'. Did you mean 'bind'?");
      expect(pointedAt(text, issue)).toBe('bnd');
    });

    it('is refused with no suggestion when nothing is close', () => {
      const issue = refused('frobnicate now');

      expect(issue.message).toBe("There is no command 'frobnicate'.");
      expect('suggestions' in issue).toBe(false);
    });

    it('is refused when it is quoted, because a name that is quoted is a name and not a command', () => {
      expect(refused('"bind" orders -> billing')).toMatchObject({
        kind: 'syntax',
        message: 'A command starts with its name, for example bind orders -> billing.',
      });
      expect(refused('-> a')).toMatchObject({ kind: 'syntax' });
    });

    it('is refused when it is partly quoted, which is a name too, and points at the first word only', () => {
      for (const [text, word] of [
        ['bi"nd" orders -> billing', 'bi"nd"'],
        ['"bi"nd orders -> billing', '"bi"nd'],
        ['"bind" orders -> billing', '"bind"'],
        ['-> a', '->'],
      ] as const) {
        const issue = refused(text);

        expect(issue, text).toMatchObject({
          kind: 'syntax',
          message: 'A command starts with its name, for example bind orders -> billing.',
        });
        expect(pointedAt(text, issue), text).toBe(word);
      }
    });

    it('needs a second word when the first starts several commands, and offers them', () => {
      expect(refused('declare')).toMatchObject({
        kind: 'unknown-command',
        message: "'declare' needs a second word: declare exchange or declare queue.",
        suggestions: ['declare exchange', 'declare queue'],
      });
      expect(refused('add')).toMatchObject({
        message: "'add' needs a second word: add producer or add consumer.",
      });
    });

    it('offers the close second word first when a second word that is not one was typed, and all of them when none is close', () => {
      const text = 'declare queu x';
      const issue = refused(text);

      expect(issue.message).toBe("'declare queu' is not a command: declare queue.");
      expect(issue.suggestions).toEqual(['declare queue']);
      expect(pointedAt(text, issue)).toBe('declare queu');
      expect(refused('declare zzz').suggestions).toEqual(['declare exchange', 'declare queue']);
    });

    it.each<[string, string]>([
      ['declare exchange', 'Expected the name of the exchange.'],
      ['declare exchange events', 'Add type=direct|fanout|topic|headers.'],
      ['declare queue', 'Expected the name of the queue.'],
      ['add producer', 'Expected the name of the producer.'],
      ['add consumer', 'Expected the name of the consumer.'],
      ['bind', 'Expected the exchange to bind from.'],
      ['bind orders', "Expected '->'."],
      ['bind orders ->', 'Expected the queue or exchange to bind to.'],
      ['unbind', 'Expected the exchange to bind from.'],
      ['unbind orders ->', 'Expected the queue or exchange to bind to.'],
      ['link', 'Expected the producer.'],
      ['link sender', "Expected '->'."],
      ['link sender ->', 'Expected the exchange or queue it publishes to.'],
      ['unlink', 'Expected the producer.'],
      ['subscribe', 'Expected the consumer.'],
      ['subscribe worker', 'Expected the queue to consume from.'],
      ['unsubscribe', 'Expected the consumer.'],
      ['unsubscribe worker', 'Expected the queue to stop consuming from.'],
      ['set', 'Expected an element or canvas.'],
      ['unset', 'Expected the producer.'],
      ['move', 'Expected the element to move.'],
      ['move label', 'Expected the element that the edge starts at.'],
      ['move label orders', "Expected '->'."],
      ['move label orders ->', 'Expected the element that the edge ends at.'],
      ['move label orders -> billing', 'Add at=<number>.'],
      ['rename', 'Expected the element to rename.'],
      ['rename billing', 'Expected the new name.'],
      ['delete', 'Expected the element to delete.'],
    ])('says what is wanted when the words of %j run out', (text, message) => {
      expect(refused(text)).toMatchObject({ kind: 'missing-argument', message, at: { start: text.length } });
    });

    it('points at the first word when it needs a second and the next thing is not a word', () => {
      const text = 'declare -> x';

      expect(pointedAt(text, refused(text))).toBe('declare');
      expect(pointedAt('declare', refused('declare'))).toBe('declare');
    });
  });

  describe('declare exchange', () => {
    it('reads the name and the type, with the flags at their defaults', () => {
      expect(read('declare exchange events type=topic')).toEqual({
        type: 'declare-exchange',
        name: 'events',
        exchangeType: 'topic',
        durable: true,
        autoDelete: false,
        internal: false,
      });
    });

    it('reads every flag, in any order, and the types that RabbitMQ has', () => {
      expect(read('declare exchange e internal=true auto-delete=true durable=false type=headers')).toEqual({
        type: 'declare-exchange',
        name: 'e',
        exchangeType: 'headers',
        durable: false,
        autoDelete: true,
        internal: true,
      });
      for (const type of ['direct', 'fanout', 'topic', 'headers']) {
        expect(read(`declare exchange e type=${type}`)).toMatchObject({ exchangeType: type });
      }
    });

    it('reads a name in quotes, and the empty name, which the broker refuses when it is applied', () => {
      expect(read('declare exchange "my exchange" type=direct')).toMatchObject({ name: 'my exchange' });
      expect(read('declare exchange "" type=direct')).toMatchObject({ name: '' });
      expect(read('declare exchange amq.mine type=direct')).toMatchObject({ name: 'amq.mine' });
    });

    it('reads a name that has an = or a qualifier in it only when it is quoted', () => {
      expect(read('declare exchange "a=b" type=direct')).toMatchObject({ name: 'a=b' });
      expect(read('declare exchange "queue:x" type=direct')).toMatchObject({ name: 'queue:x' });
    });

    it('is refused without a type, and says what to add', () => {
      const issue = refused('declare exchange e');

      expect(issue).toMatchObject({ kind: 'missing-argument', message: 'Add type=direct|fanout|topic|headers.' });
      expect(issue.at).toEqual({ start: 18, end: 18 });
    });

    it('is refused without a name', () => {
      expect(refused('declare exchange')).toMatchObject({
        kind: 'missing-argument',
        message: 'Expected the name of the exchange.',
        at: { start: 16, end: 16 },
      });
    });

    it('is refused with a type that RabbitMQ does not have, with the close one as a suggestion, and points at the word', () => {
      const text = 'declare exchange e type=topik';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'invalid-value', suggestions: ['topic'] });
      expect(issue.message).toBe(
        "type must be direct, fanout, topic or headers, and 'topik' is not. Did you mean 'topic'?",
      );
      expect(pointedAt(text, issue)).toBe('type=topik');
    });

    it('is refused with a flag that is not true or false, with a suggestion', () => {
      expect(refused('declare exchange e type=direct durable=ture')).toMatchObject({
        kind: 'invalid-value',
        message: "durable must be true or false, and 'ture' is not. Did you mean 'true'?",
      });
      expect(refused('declare exchange e type=direct durable=maybe').suggestions).toBeUndefined();
    });

    it('is refused with an option that it does not have, and offers the options that are close, or lists them all', () => {
      expect(refused('declare exchange e type=direct durble=false')).toMatchObject({
        kind: 'unknown-option',
        message:
          "There is no option 'durble' here. Its options are type, durable, auto-delete and internal. Did you mean 'durable'?",
        suggestions: ['durable'],
      });
      expect(refused('declare exchange e type=direct colour=red').message).toBe(
        "There is no option 'colour' here. Its options are type, durable, auto-delete and internal.",
      );
    });

    it('is refused with an option twice', () => {
      const text = 'declare exchange e type=direct type=fanout';
      const issue = refused(text);

      expect(issue.message).toBe('type is there twice. Give it once.');
      expect(pointedAt(text, issue)).toBe('type=fanout');
    });

    it('is refused with a word that is not name=value, and says how to write it, with the option it looks like', () => {
      expect(refused('declare exchange e type=direct durable')).toMatchObject({
        kind: 'syntax',
        message: "Write 'durable' as name=value, for example durable=…. Did you mean 'durable='?",
      });
      expect(refused('declare exchange e type=direct zzz').message).toBe(
        "Write 'zzz' as name=value, for example type=….",
      );
    });

    it('is refused with an arrow or a separator where an option goes', () => {
      expect(refused('declare exchange e type=direct ->').message).toBe("Unexpected '->' here.");
    });

    it('is refused when the quoted text is not closed', () => {
      expect(refused('declare exchange "e type=direct')).toMatchObject({ kind: 'syntax' });
    });
  });

  describe('declare queue', () => {
    it('reads the name, and is durable unless it says otherwise', () => {
      expect(read('declare queue jobs')).toEqual({ type: 'declare-queue', name: 'jobs', durable: true });
      expect(read('declare queue jobs durable=true')).toEqual({ type: 'declare-queue', name: 'jobs', durable: true });
    });

    it('reads durable=false, which it leaves for applying the command to refuse, with the broker’s 541', () => {
      expect(read('declare queue jobs durable=false')).toEqual({ type: 'declare-queue', name: 'jobs', durable: false });
    });

    it('takes the classic type, and refuses quorum and stream as arriving in M4, pointing at the option', () => {
      expect(read('declare queue jobs type=classic')).toEqual({ type: 'declare-queue', name: 'jobs', durable: true });

      const quorum = 'declare queue jobs type=quorum';
      const refusedQuorum = refused(quorum);

      expect(refusedQuorum).toMatchObject({
        kind: 'unsupported',
        message: 'Quorum queues arrive in M4. Only classic queues are available now.',
      });
      expect(pointedAt(quorum, refusedQuorum)).toBe('type=quorum');
      expect(refused('declare queue jobs type=stream').message).toBe(
        'Streams arrive in M4. Only classic queues are available now.',
      );
    });

    it('refuses a type that is not a type of queue, saying that classic is the one', () => {
      expect(refused('declare queue jobs type=lazy')).toMatchObject({
        kind: 'invalid-value',
        message: "type must be classic, and 'lazy' is not.",
      });
      expect(refused('declare queue jobs type=toString').message).toBe("type must be classic, and 'toString' is not.");
    });

    it('is refused without a name, and with a word it does not know', () => {
      expect(refused('declare queue')).toMatchObject({ message: 'Expected the name of the queue.' });
      expect(refused('declare queue jobs auto-delete=true')).toMatchObject({ kind: 'unknown-option' });
    });
  });

  describe('add producer and add consumer', () => {
    it('read a name, and nothing else', () => {
      expect(read('add producer clock')).toEqual({ type: 'add-producer', name: 'clock' });
      expect(read('add consumer "the logger"')).toEqual({ type: 'add-consumer', name: 'the logger' });
    });

    it('are refused with a word after the name, which has nothing to say, and with no name', () => {
      const text = 'add producer clock burst=3';
      const issue = refused(text);

      expect(issue.message).toBe("Unexpected 'burst=3': there is nothing more to say here.");
      expect(pointedAt(text, issue)).toBe('burst=3');
      expect(refused('add consumer')).toMatchObject({ message: 'Expected the name of the consumer.' });
      expect(refused('add consumer a ->').message).toBe("Unexpected '->': there is nothing more to say here.");
    });
  });

  describe('bind and unbind', () => {
    it('reads an exchange, an arrow and a queue', () => {
      expect(read('bind orders -> billing')).toEqual({
        type: 'bind',
        source: 'orders',
        destination: { kind: 'queue', name: 'billing' },
        key: '',
      });
      expect(read('unbind orders -> billing key=order.*')).toEqual({
        type: 'unbind',
        source: 'orders',
        destination: { kind: 'queue', name: 'billing' },
        key: 'order.*',
      });
    });

    it('reads an exchange as the destination when the name is an exchange', () => {
      expect(read('bind orders -> hidden key=#')).toMatchObject({
        destination: { kind: 'exchange', name: 'hidden' },
        key: '#',
      });
    });

    it('reads the arrow with or without spaces', () => {
      expect(read('bind orders->billing')).toEqual(read('bind orders -> billing'));
      expect(read('bind orders ->billing')).toEqual(read('bind orders->billing'));
    });

    it('reads the source as an exchange whatever it is called, and leaves it to apply to refuse one that is not there', () => {
      expect(read('bind nope -> billing')).toMatchObject({ source: 'nope' });
      expect(read('bind "" -> billing')).toMatchObject({ source: '' });
      expect(read('bind billing -> archive')).toMatchObject({ source: 'billing' });
    });

    it('reads a binding key in any form, with the characters that mean something to a topic', () => {
      for (const key of ['a.b', 'a.#.b', '*', '#', '#.#.#', '', 'é', 'a b', 'a=b', 'a;b', 'a"b']) {
        const written = key === '' ? 'key=""' : `key=${/^[^\s;"=()]+$/.test(key) ? key : JSON.stringify(key)}`;

        expect(read(`bind orders -> billing ${written}`), key).toMatchObject({ key });
      }
    });

    it('reads x-match, and each of its four values', () => {
      for (const mode of ['all', 'any', 'all-with-x', 'any-with-x']) {
        expect(read(`bind docs -> archive x-match=${mode}`)).toMatchObject({ headers: { xMatch: mode, args: [] } });
      }
    });

    it('has no arguments at all when it is given none, and none for an x-match that is not there', () => {
      expect('headers' in read('bind docs -> archive')).toBe(false);
      expect(read('bind docs -> archive format=pdf')).toMatchObject({ headers: { xMatch: null } });
    });

    it('reads conditions typed as the editor types them: "1" a string, 1 an integer, 1.0 a float, true a boolean', () => {
      expect(read('bind docs -> archive s="1" i=1 f=1.0 b=true w=pdf neg=-5 sci=1e3')).toMatchObject({
        headers: {
          xMatch: null,
          args: [
            entry('s', str('1')),
            entry('i', int(1)),
            entry('f', float(1)),
            entry('b', bool(true)),
            entry('w', str('pdf')),
            entry('neg', int(-5)),
            entry('sci', float(1000)),
          ],
        },
      });
    });

    it('reads exists(name) as a header that has to be there, with the name in quotes if it has a space', () => {
      expect(read('bind docs -> archive exists(format) exists("my header") a=1')).toMatchObject({
        headers: { args: [entry('format', exists), entry('my header', exists), entry('a', int(1))] },
      });
    });

    it('keeps the conditions in the order that they were written, and options among them', () => {
      expect(read('bind docs -> archive b=1 x-match=any a=2 key=k c=3')).toMatchObject({
        key: 'k',
        headers: { xMatch: 'any', args: [entry('b', int(1)), entry('a', int(2)), entry('c', int(3))] },
      });
    });

    it('tells a header called key or x-match from the option by the name in quotes', () => {
      expect(read('bind docs -> archive "key"=1 "x-match"=a key=k x-match=all')).toMatchObject({
        key: 'k',
        headers: { xMatch: 'all', args: [entry('key', int(1)), entry('x-match', str('a'))] },
      });
    });

    it('reads a header that has a name that is quoted, and a value that is', () => {
      expect(read('bind docs -> archive "a b"="c d" k=""')).toMatchObject({
        headers: { args: [entry('a b', str('c d')), entry('k', str(''))] },
      });
    });

    it('reads a header whose name begins like an exists( but is not one', () => {
      expect(read('bind docs -> archive exists=1')).toMatchObject({ headers: { args: [entry('exists', int(1))] } });
    });

    describe('with a name that is a queue and an exchange', () => {
      it('is refused for the destination, and says which spellings to use', () => {
        const text = 'bind other -> same';
        const issue = refused(text, twins());

        expect(issue.kind).toBe('ambiguous-name');
        expect(issue.message).toBe("'same' is an exchange and a queue. Say which: exchange:same or queue:same.");
        expect(issue.suggestions).toEqual(['exchange:same', 'queue:same']);
        expect(pointedAt(text, issue)).toBe('same');
      });

      it('is read when the destination says which, with the qualifier, quoted or not', () => {
        expect(read('bind other -> queue:same', twins())).toMatchObject({
          destination: { kind: 'queue', name: 'same' },
        });
        expect(read('bind other -> exchange:same', twins())).toMatchObject({
          destination: { kind: 'exchange', name: 'same' },
        });
        expect(read('bind other -> queue:"same"', twins())).toMatchObject({
          destination: { kind: 'queue', name: 'same' },
        });
      });

      it('is read for the source, which is an exchange by its place, and needs no qualifier', () => {
        expect(read('bind same -> queue:same', twins())).toMatchObject({ source: 'same' });
      });

      it('is read with the qualifier for a name that has none, and is refused when the qualifier says a kind that does not go there', () => {
        expect(read('bind orders -> queue:nope')).toMatchObject({ destination: { kind: 'queue', name: 'nope' } });
        const text = 'bind queue:billing -> archive';
        const issue = refused(text);

        expect(issue.message).toBe("Here goes the exchange to bind from, and 'queue:' says a queue.");
        expect(pointedAt(text, issue)).toBe('queue:billing');
        expect(refused('bind orders -> producer:sender').message).toBe(
          "Here goes the queue or exchange to bind to, and 'producer:' says a producer.",
        );
      });
    });

    it('is refused with a destination that is not there, in either kind, with what was probably meant', () => {
      const text = 'bind orders -> biling';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'missing-element', suggestions: ['billing'] });
      expect(issue.message).toBe("There is no queue or exchange named 'biling'. Did you mean 'billing'?");
      expect(pointedAt(text, issue)).toBe('biling');
      expect(refused('bind orders -> nowhere').message).toBe("There is no queue or exchange named 'nowhere'.");
    });

    it('is refused without an arrow, and with something else where the arrow goes, and says what was found', () => {
      expect(refused('bind orders billing')).toMatchObject({
        kind: 'syntax',
        message: "Expected '->' here, and not 'billing'.",
        at: { start: 12, end: 19 },
      });
      expect(refused('bind orders')).toMatchObject({ kind: 'missing-argument', message: "Expected '->'." });
      expect(refused('bind orders ;')).not.toBeNull();
    });

    it('is refused without a destination, and without a source', () => {
      expect(refused('bind orders ->')).toMatchObject({ message: 'Expected the queue or exchange to bind to.' });
      expect(refused('bind')).toMatchObject({ message: 'Expected the exchange to bind from.' });
      expect(refused('bind -> billing')).toMatchObject({
        kind: 'syntax',
        message: "Expected the exchange to bind from, and not '->'.",
      });
      expect(refused('bind orders -> ->')).toMatchObject({
        message: "Expected the queue or exchange to bind to, and not '->'.",
      });
    });

    it('is refused with a second arrow among the conditions', () => {
      expect(refused('bind orders -> billing -> archive').message).toBe("Unexpected '->' here.");
    });

    it('is refused with an x-match that is not one of the four, with the close one as a suggestion', () => {
      const issue = refused('bind docs -> archive x-match=anyy');

      expect(issue.message).toBe(
        "x-match must be all, any, all-with-x or any-with-x, and 'anyy' is not. Did you mean 'any'?",
      );
      expect(issue.suggestions).toEqual(['any']);
      expect(refused('bind docs -> archive x-match=some').message).toBe(
        "x-match must be all, any, all-with-x or any-with-x, and 'some' is not.",
      );
    });

    it('is refused with the key or the x-match twice', () => {
      expect(refused('bind orders -> billing key=a key=b').message).toBe('key is there twice. Give it once.');
      expect(refused('bind docs -> archive x-match=all x-match=any').message).toBe(
        'x-match is there twice. Give it once.',
      );
    });

    it('is refused with a condition that no broker could take, at the word that has it, with the engine’s words', () => {
      const unsafe = 'bind docs -> archive n=9007199254740993';
      const issue = refused(unsafe);

      expect(issue.kind).toBe('header');
      expect(issue.message).toContain(
        "The header 'n': An integer header must be a whole number from -9007199254740991",
      );
      expect(pointedAt(unsafe, issue)).toBe('n=9007199254740993');
      expect(refused('bind docs -> archive f=1e999').message).toBe(
        "The header 'f': A float header must be a finite number.",
      );
      expect(refused(`bind docs -> archive ${'k'.repeat(256)}=1`)).toMatchObject({ kind: 'header' });
    });

    it('is refused with a header that has no name, and with exists() that has none', () => {
      expect(refused('bind docs -> archive =1').message).toBe('A header needs a name.');
      expect(refused('bind docs -> archive exists()').message).toBe('A header needs a name.');
      expect(refused('bind docs -> archive exists("")').message).toBe('A header needs a name.');
    });

    it('leaves to apply a condition that is there twice, and an x-match among the conditions, which it can say better', () => {
      expect(read('bind docs -> archive a=1 a=2')).toMatchObject({
        headers: { args: [entry('a', int(1)), entry('a', int(2))] },
      });
      expect(read('bind docs -> archive "x-match"=any')).toMatchObject({
        headers: { args: [entry('x-match', str('any'))] },
      });
    });

    it('is refused with a word that is neither an option nor a condition', () => {
      expect(refused('bind orders -> billing keyy')).toMatchObject({
        kind: 'syntax',
        message: "Write 'keyy' as name=value, for example key=…. Did you mean 'key='?",
      });
    });
  });

  describe('link, unlink, subscribe and unsubscribe', () => {
    it('read a producer and where it publishes to, an exchange or a queue, and say which', () => {
      expect(read('link sender -> orders')).toEqual({
        type: 'link',
        producer: 'sender',
        target: { kind: 'exchange', name: 'orders' },
      });
      expect(read('link sender -> billing')).toEqual({
        type: 'link',
        producer: 'sender',
        target: { kind: 'queue', name: 'billing' },
      });
      expect(read('link sender->billing')).toEqual(read('link sender -> billing'));
    });

    it('are refused with a target that is not there, an ambiguous one, and with qualifiers', () => {
      expect(refused('link sender -> nowhere').message).toBe("There is no exchange or queue named 'nowhere'.");
      expect(refused('link same -> same', twins())).toMatchObject({ kind: 'ambiguous-name' });
      expect(read('link same -> queue:same', twins())).toEqual({
        type: 'link',
        producer: 'same',
        target: { kind: 'queue', name: 'same' },
      });
      expect(read('link producer:same -> exchange:same', twins())).toMatchObject({
        target: { kind: 'exchange', name: 'same' },
      });
    });

    it('read unlink, subscribe and unsubscribe', () => {
      expect(read('unlink sender')).toEqual({ type: 'unlink', producer: 'sender' });
      expect(read('subscribe worker archive')).toEqual({ type: 'subscribe', consumer: 'worker', queue: 'archive' });
      expect(read('unsubscribe worker billing')).toEqual({ type: 'unsubscribe', consumer: 'worker', queue: 'billing' });
    });

    it('are refused without what they need, with a word too many, and without an arrow', () => {
      expect(refused('link sender')).toMatchObject({ message: "Expected '->'." });
      expect(refused('link')).toMatchObject({ message: 'Expected the producer.' });
      expect(refused('unlink')).toMatchObject({ message: 'Expected the producer.' });
      expect(refused('subscribe worker')).toMatchObject({ message: 'Expected the queue to consume from.' });
      expect(refused('unsubscribe worker')).toMatchObject({ message: 'Expected the queue to stop consuming from.' });
      expect(refused('unlink sender now').message).toBe("Unexpected 'now': there is nothing more to say here.");
      expect(refused('subscribe worker archive extra').message).toBe(
        "Unexpected 'extra': there is nothing more to say here.",
      );
    });

    it('leave a producer or a queue that is not there to apply, which says what it is', () => {
      expect(read('unlink nobody')).toMatchObject({ producer: 'nobody' });
      expect(read('subscribe nobody nowhere')).toMatchObject({ consumer: 'nobody', queue: 'nowhere' });
    });
  });

  describe('set', () => {
    it('reads the attributes of an exchange, of a queue, of a producer, of a consumer and of the canvas', () => {
      expect(read('set orders type=direct durable=false auto-delete=true internal=true')).toEqual({
        type: 'set',
        kind: 'exchange',
        name: 'orders',
        changes: { exchangeType: 'direct', durable: false, autoDelete: true, internal: true },
      });
      expect(read('set billing durable=true')).toEqual({
        type: 'set',
        kind: 'queue',
        name: 'billing',
        changes: { durable: true },
      });
      expect(read('set sender payload="hi there" key=a.b burst=3 every=500 repeat=false')).toEqual({
        type: 'set',
        kind: 'producer',
        name: 'sender',
        changes: { payload: 'hi there', key: 'a.b', burst: 3, everyMs: 500, repeat: false },
      });
      expect(read('set worker ack=manual prefetch=5 processing=250')).toEqual({
        type: 'set',
        kind: 'consumer',
        name: 'worker',
        changes: { ack: 'manual', prefetch: 5, processingMs: 250 },
      });
      expect(read('set canvas default-exchange=true seed=7 publish-ms=1 broker-ms=2 deliver-ms=3')).toEqual({
        type: 'set',
        kind: 'canvas',
        changes: { showDefaultExchange: true, seed: 7, publishMs: 1, brokerMs: 2, deliverMs: 3 },
      });
    });

    it('only has the attributes that it was given, and no key for one that it was not', () => {
      expect(read('set sender burst=2')).toStrictEqual({
        type: 'set',
        kind: 'producer',
        name: 'sender',
        changes: { burst: 2 },
      });
      expect(read('set orders durable=false')).toStrictEqual({
        type: 'set',
        kind: 'exchange',
        name: 'orders',
        changes: { durable: false },
      });
      expect(read('set worker prefetch=0')).toStrictEqual({
        type: 'set',
        kind: 'consumer',
        name: 'worker',
        changes: { prefetch: 0 },
      });
      expect(read('set canvas seed=9')).toStrictEqual({ type: 'set', kind: 'canvas', changes: { seed: 9 } });
      expect(read('set billing durable=true')).toStrictEqual({
        type: 'set',
        kind: 'queue',
        name: 'billing',
        changes: { durable: true },
      });
    });

    it.each(['direct', 'fanout', 'topic', 'headers'] as const)('reads %s as the type of an exchange', (type) => {
      expect(read(`set orders type=${type}`)).toStrictEqual({
        type: 'set',
        kind: 'exchange',
        name: 'orders',
        changes: { exchangeType: type },
      });
    });

    it('reads the headers of a message as header:name=value, typed as in bind, and leaves out the headers when there are none', () => {
      expect(read('set sender header:format=pdf header:n=1 header:"my key"=1.5 header:ok=true')).toEqual({
        type: 'set',
        kind: 'producer',
        name: 'sender',
        changes: {
          headers: [
            entry('format', str('pdf')),
            entry('n', int(1)),
            entry('my key', float(1.5)),
            entry('ok', bool(true)),
          ],
        },
      });
      expect('headers' in (read('set sender burst=1') as { changes: object }).changes).toBe(false);
    });

    it('reads a header that is called payload or key, because the header: says what it is', () => {
      expect(read('set sender header:key=1 key=k')).toMatchObject({
        changes: { key: 'k', headers: [entry('key', int(1))] },
      });
    });

    it('reads the zero attribute values: prefetch 0 for no limit, and a processing time of 0', () => {
      expect(read('set worker prefetch=0 processing=0')).toMatchObject({ changes: { prefetch: 0, processingMs: 0 } });
    });

    it('reads an element that is called canvas only with its kind, since the word alone is the canvas', () => {
      const document = deepFreeze(documentOf({ queues: { Q: queueRecord('canvas') } }));

      expect(read('set queue:canvas durable=true', document)).toMatchObject({ kind: 'queue', name: 'canvas' });
      expect(read('set canvas seed=1', document)).toMatchObject({ kind: 'canvas' });
    });

    it('reads a name that is a queue and an exchange once it says which, and refuses it before', () => {
      expect(refused('set same durable=true', twins())).toMatchObject({ kind: 'ambiguous-name' });
      expect(read('set queue:same durable=true', twins())).toMatchObject({ kind: 'queue', name: 'same' });
      expect(read('set exchange:same type=fanout', twins())).toMatchObject({ kind: 'exchange', name: 'same' });
      expect(read('set producer:same burst=2', twins())).toMatchObject({ kind: 'producer' });
      expect(refused('set same burst=2', twins()).suggestions).toEqual([
        'exchange:same',
        'queue:same',
        'producer:same',
        'consumer:same',
      ]);
    });

    it('is refused for an element that is not there, offering names of every kind that are close', () => {
      const issue = refused('set ordrs durable=true');

      expect(issue.message).toBe(
        "There is no exchange, queue, producer or consumer named 'ordrs'. Did you mean 'orders'?",
      );
      expect(issue.suggestions).toEqual(['orders']);
    });

    it('is refused without anything to set, and says what to write, at the end', () => {
      expect(refused('set billing')).toEqual({
        kind: 'nothing-to-change',
        message: 'Say what to set, for example durable=true.',
        at: { start: 11, end: 11 },
      });
      for (const text of ['set orders', 'set sender', 'set worker', 'set canvas']) {
        expect(refused(text).kind).toBe('nothing-to-change');
      }
    });

    it('is refused without a target', () => {
      expect(refused('set')).toMatchObject({ kind: 'missing-argument', message: 'Expected an element or canvas.' });
    });

    it('is refused with an attribute that the element does not have, listing the ones that it has', () => {
      expect(refused('set billing burst=2').message).toBe("There is no option 'burst' here. Its options are durable.");
      expect(refused('set sender prefech=2').message).toContain(
        'Its options are payload, key, burst, every and repeat.',
      );
      expect(refused('set worker proccesing=2')).toMatchObject({ kind: 'unknown-option', suggestions: ['processing'] });
      expect(refused('set canvas seeed=1')).toMatchObject({ suggestions: ['seed'] });
    });

    it('is refused with a value out of range or of the wrong kind, saying the range, and points at the word', () => {
      const text = 'set sender burst=0';
      const issue = refused(text);

      expect(issue.message).toBe("burst must be a whole number from 1 to 1000, and '0' is not.");
      expect(pointedAt(text, issue)).toBe('burst=0');
      expect(refused('set sender burst=1001').message).toContain("and '1001' is not");
      expect(refused('set sender burst=2.5').message).toContain("and '2.5' is not");
      expect(refused('set sender burst=many').message).toContain("and 'many' is not");
      expect(refused('set sender every=0').message).toBe(
        "every must be a whole number from 1 to 3600000, and '0' is not.",
      );
      expect(refused('set worker prefetch=65536').message).toBe(
        "prefetch must be a whole number from 0 to 65535, and '65536' is not.",
      );
      expect(refused('set worker ack=sometimes')).toMatchObject({
        message: "ack must be auto or manual, and 'sometimes' is not.",
      });
      expect(refused('set canvas seed=-1').message).toContain('seed must be a whole number from 0 to 4294967295');
    });

    it('is refused with a header that no broker could take, and with a header word that has no =', () => {
      expect(refused('set sender header:n=9007199254740993').kind).toBe('header');
      expect(refused('set sender header:=1').message).toBe('A header needs a name.');
      expect(refused('set sender header:format')).toMatchObject({ kind: 'syntax' });
    });

    it('is refused with a header whose text is longer than a canvas keeps, in the words of the rule (ADR-0029)', () => {
      const header = (length: number) => `set sender header:n=${'x'.repeat(length)}`;

      expect(read(header(10_000))).toMatchObject({ type: 'set', kind: 'producer' });
      const issue = refused(header(10_001));
      expect(issue).toMatchObject({
        kind: 'header',
        message: "The header 'n': a value that is text is at most 10,000 characters, and this one has 10,001.",
      });
      expect(pointedAt(header(10_001), issue)).toBe(`header:n=${'x'.repeat(10_001)}`);
    });

    it('is refused with a header: where the element has no message', () => {
      expect(refused('set billing header:a=1')).toMatchObject({ kind: 'unknown-option' });
    });
  });

  describe('unset', () => {
    it('reads the names of the headers to take off', () => {
      expect(read('unset sender header:n')).toEqual({
        type: 'unset',
        kind: 'producer',
        name: 'sender',
        headers: ['n'],
      });
      expect(read('unset sender header:a header:"b c"')).toMatchObject({ headers: ['a', 'b c'] });
    });

    it('is refused without a header, and with a word that is not header:name, which it explains', () => {
      expect(refused('unset sender')).toEqual({
        kind: 'nothing-to-change',
        message: 'Say which headers to take off, for example header:format.',
        at: { start: 12, end: 12 },
      });
      expect(refused('unset sender format').message).toBe(
        "Write the name of a header as header:name, for example header:format, and not 'format'.",
      );
      expect(refused('unset sender header:').message).toBe('A header needs a name.');
      expect(refused('unset sender header:a=1').kind).toBe('unknown-option');
      expect(refused('unset')).toMatchObject({ message: 'Expected the producer.' });
    });
  });

  describe('move and move label', () => {
    it('read where to put a node: one coordinate or both, whole or not, and negative', () => {
      expect(read('move billing x=640 y=120')).toEqual({
        type: 'move',
        target: { kind: 'queue', name: 'billing' },
        x: 640,
        y: 120,
      });
      expect(read('move billing x=-10.5')).toEqual({
        type: 'move',
        target: { kind: 'queue', name: 'billing' },
        x: -10.5,
      });
      expect(read('move sender y=0')).toEqual({ type: 'move', target: { kind: 'producer', name: 'sender' }, y: 0 });
      expect(read('move billing x=1e2')).toMatchObject({ x: 100 });
    });

    it('has the coordinates that it was given and no key for the other', () => {
      expect(read('move billing x=5')).toStrictEqual({
        type: 'move',
        target: { kind: 'queue', name: 'billing' },
        x: 5,
      });
      expect(read('move billing y=5')).toStrictEqual({
        type: 'move',
        target: { kind: 'queue', name: 'billing' },
        y: 5,
      });
    });

    it('reads -0 as 0', () => {
      expect(Object.is((read('move billing x=-0') as { x: number }).x, 0)).toBe(true);
    });

    it('finds the element of any kind by its name, and needs the kind for a name that two kinds have', () => {
      expect(read('move worker x=1')).toMatchObject({ target: { kind: 'consumer' } });
      expect(read('move orders x=1')).toMatchObject({ target: { kind: 'exchange' } });
      expect(refused('move same x=1', twins())).toMatchObject({ kind: 'ambiguous-name' });
      expect(refused('move same x=1', twins()).suggestions).toHaveLength(4);
      expect(read('move consumer:same x=1', twins())).toMatchObject({ target: { kind: 'consumer', name: 'same' } });
    });

    it('are refused without a coordinate, outside the range and with something that is not a number', () => {
      expect(refused('move billing')).toEqual({
        kind: 'nothing-to-change',
        message: 'Say where to move it, for example x=200 y=80.',
        at: { start: 12, end: 12 },
      });
      expect(refused('move billing x=2000000').message).toBe(
        "x must be a number from -1000000 to 1000000, and '2000000' is not.",
      );
      expect(refused('move billing y=far').message).toContain("and 'far' is not");
      expect(refused('move billing x=1,5').message).toContain("and '1,5' is not");
      expect(refused('move nowhere x=1')).toMatchObject({ kind: 'missing-element' });
      expect(refused('move billing z=1')).toMatchObject({ kind: 'unknown-option' });
      expect('suggestions' in refused('move billing z=1')).toBe(false);
    });

    it('read a label and where it goes along its edge', () => {
      expect(read('move label orders -> billing at=0.25')).toEqual({
        type: 'move-label',
        from: { kind: 'exchange', name: 'orders' },
        to: { kind: 'queue', name: 'billing' },
        at: 0.25,
      });
      expect(read('move label sender->orders at=1')).toMatchObject({
        from: { kind: 'producer' },
        to: { kind: 'exchange' },
        at: 1,
      });
    });

    it('is refused for a label without a place, and with a place off the edge', () => {
      expect(refused('move label orders -> billing')).toMatchObject({
        kind: 'missing-argument',
        message: 'Add at=<number>.',
      });
      expect(refused('move label orders -> billing at=2').message).toBe(
        "at must be a number from 0 to 1, and '2' is not.",
      );
      expect(refused('move label orders billing at=1').message).toBe("Expected '->' here, and not 'billing'.");
      expect(refused('move label orders -> nowhere at=1')).toMatchObject({ kind: 'missing-element' });
    });
  });

  describe('rename, delete, clear, layout, undo and redo', () => {
    it('read rename and delete with the element of any kind', () => {
      expect(read('rename billing invoices')).toEqual({
        type: 'rename',
        target: { kind: 'queue', name: 'billing' },
        name: 'invoices',
      });
      expect(read('rename sender "the sender"')).toMatchObject({ target: { kind: 'producer' }, name: 'the sender' });
      expect(read('delete archive')).toEqual({ type: 'delete', target: { kind: 'queue', name: 'archive' } });
      expect(read('delete worker')).toMatchObject({ target: { kind: 'consumer' } });
    });

    it('read a new name that is anything, including one that looks like a qualifier or an option', () => {
      expect(read('rename billing queue:x')).toMatchObject({ name: 'queue:x' });
      expect(read('rename billing a=b')).toMatchObject({ name: 'a=b' });
      expect(read('rename billing ""')).toMatchObject({ name: '' });
    });

    it('need the kind for a name that two kinds have, and refuse an element that is not there', () => {
      expect(refused('delete same', twins())).toMatchObject({
        kind: 'ambiguous-name',
        message:
          "'same' is an exchange, a queue, a producer and a consumer. Say which: exchange:same, queue:same, producer:same or consumer:same.",
      });
      expect(read('delete producer:same', twins())).toMatchObject({ target: { kind: 'producer', name: 'same' } });
      expect(refused('delete archiv')).toMatchObject({ kind: 'missing-element', suggestions: ['archive'] });
      expect(refused('rename nowhere x')).toMatchObject({ kind: 'missing-element' });
    });

    it('are refused without what they need, and with a word too many', () => {
      expect(refused('rename billing')).toMatchObject({ message: 'Expected the new name.' });
      expect(refused('rename')).toMatchObject({ message: 'Expected the element to rename.' });
      expect(refused('delete')).toMatchObject({ message: 'Expected the element to delete.' });
      expect(refused('rename billing a b').message).toBe("Unexpected 'b': there is nothing more to say here.");
      expect(refused('delete archive now').message).toBe("Unexpected 'now': there is nothing more to say here.");
    });

    it('read clear, layout, undo and redo, which take nothing', () => {
      expect(read('clear')).toEqual({ type: 'clear' });
      expect(read('layout')).toEqual({ type: 'layout' });
      expect(read('undo')).toEqual({ type: 'undo' });
      expect(read('redo')).toEqual({ type: 'redo' });
    });

    it('refuse a word after them, as `clear messages`, which is a command of the simulation that comes later', () => {
      const text = 'clear messages';
      const issue = refused(text);

      expect(issue.message).toBe("Unexpected 'messages': there is nothing more to say here.");
      expect(pointedAt(text, issue)).toBe('messages');
      expect(refused('layout fast').kind).toBe('syntax');
      expect(refused('undo twice').kind).toBe('syntax');
      expect(refused('redo -> x').message).toBe("Unexpected '->': there is nothing more to say here.");
    });
  });

  describe('help', () => {
    it('reads help with no command, and with the name of one, of one word or of two', () => {
      expect(read('help')).toStrictEqual({ type: 'help' });
      expect(read('help bind')).toEqual({ type: 'help', command: 'bind' });
      expect(read('help declare queue')).toEqual({ type: 'help', command: 'declare queue' });
      expect(read('help move')).toEqual({ type: 'help', command: 'move' });
      expect(read('help move label')).toEqual({ type: 'help', command: 'move label' });
      expect(read('help help')).toEqual({ type: 'help', command: 'help' });
    });

    it('refuses a name that is not a command, with the names that are close to it', () => {
      const text = 'help bnid';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'unknown-command', suggestions: ['bind'] });
      expect(issue.message).toBe("There is no command 'bnid'. Did you mean 'bind'?");
      expect(pointedAt(text, issue)).toBe('bnid');
    });

    it('says that a word that starts several commands needs a second word, and which', () => {
      const text = 'help declare';
      const issue = refused(text);

      expect(issue).toMatchObject({
        kind: 'unknown-command',
        suggestions: ['declare exchange', 'declare queue'],
      });
      expect(pointedAt(text, issue)).toBe('declare');
      expect(refused('help declare queu')).toMatchObject({ suggestions: ['declare queue'] });
      expect(pointedAt('help declare queu', refused('help declare queu'))).toBe('declare queu');
    });

    it('is about one command, and a word after the name of one is refused', () => {
      const text = 'help bind orders';
      const issue = refused(text);

      expect(issue).toMatchObject({
        kind: 'syntax',
        message: "Unexpected 'orders': help takes the name of one command, as in help bind or help declare queue.",
      });
      expect(pointedAt(text, issue)).toBe('orders');
      expect(pointedAt('help declare queue jobs', refused('help declare queue jobs'))).toBe('jobs');
    });

    it('takes the name of a command bare, with no quotes and no arrow', () => {
      expect(refused('help "bind"')).toMatchObject({ kind: 'syntax' });
      expect(refused('help bind -> x')).toMatchObject({ kind: 'syntax' });
      expect(pointedAt('help -> bind', refused('help -> bind'))).toBe('->');
    });

    it('says why, in plain words, and where, for a name that has a quote in it, whether the whole word is quoted or only a part of it', () => {
      const why =
        'Write the name of a command as it is typed, with no quotes and no arrow, as in help bind or help declare queue.';

      for (const text of ['help "bind"', 'help "bi"nd', 'help bi"nd"']) {
        const issue = refused(text);
        expect(issue, text).toMatchObject({ kind: 'syntax', message: why });
        expect(pointedAt(text, issue), text).toBe(text.slice('help '.length));
      }
    });

    it('says what is wrong with the first word, and not with the ones after it, when the words are no command', () => {
      const text = 'help frobnicate one two';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'unknown-command' });
      expect(issue.message).toBe("There is no command 'frobnicate'.");
      expect(pointedAt(text, issue)).toBe('frobnicate');
    });

    it('cannot be one of several commands, because it answers a question and changes nothing', () => {
      const text = 'declare queue a; help';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'batch', batchIndex: 1 });
      expect(issue.message).toBe(
        'help answers a question and does not change the canvas, so it cannot be one of several commands. Type it by itself.',
      );
      expect(pointedAt(text, issue)).toBe('help');
      expect(refused('help; declare queue a')).toMatchObject({ kind: 'batch', batchIndex: 0 });
    });
  });

  describe('several commands with ;', () => {
    it('are a batch, and each is read against the canvas that the ones before it made', () => {
      const result = read('declare queue jobs; bind orders -> jobs key=job.#; move jobs x=1 y=2');

      expect(result).toEqual({
        type: 'batch',
        commands: [
          { type: 'declare-queue', name: 'jobs', durable: true },
          { type: 'bind', source: 'orders', destination: { kind: 'queue', name: 'jobs' }, key: 'job.#' },
          { type: 'move', target: { kind: 'queue', name: 'jobs' }, x: 1, y: 2 },
        ],
      });
    });

    it('can name an element that an earlier command made, which a command read alone could not', () => {
      expect(refused('bind orders -> jobs key=job.#').kind).toBe('missing-element');
      expect(read('declare queue jobs; bind orders -> jobs').type).toBe('batch');
    });

    it('can give a qualifier to what an earlier command made, so that it is read as one of two with the same name', () => {
      const result = read('declare queue other; bind same -> queue:other', twins());

      expect(result).toMatchObject({ type: 'batch' });
    });

    it('is one command when there is only one, with a ; after it or none', () => {
      expect(read('declare queue jobs;')).toEqual({ type: 'declare-queue', name: 'jobs', durable: true });
      expect(read('declare queue jobs ;  ')).toEqual({ type: 'declare-queue', name: 'jobs', durable: true });
    });

    it('is refused when a command is empty, which is a mistake except at the end', () => {
      const text = 'declare queue a;; declare queue b';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'syntax', message: "Expected a command before ';'." });
      expect(pointedAt(text, issue)).toBe(';');
      expect(refused(';')).toMatchObject({ message: "Expected a command before ';'." });
      expect(refused('; declare queue a').message).toBe("Expected a command before ';'.");
    });

    it('says which command could not be read, counting from 0, with where it is in the whole text', () => {
      const text = 'declare queue a; bnd orders -> a';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'unknown-command', batchIndex: 1 });
      expect(pointedAt(text, issue)).toBe('bnd');
      expect(refused('foo; declare queue a').batchIndex).toBe(0);
    });

    it('says which command the canvas refuses, with the broker’s reply, since each is applied to the canvas on the way', () => {
      const text = 'declare queue a; add producer sender; declare queue c';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'duplicate-name', batchIndex: 1 });
      expect(pointedAt(text, issue)).toBe('add producer sender');
      expect(refused('declare queue jobs durable=false; declare queue b')).toMatchObject({
        kind: 'transient-queue',
        batchIndex: 0,
        refusal: { code: 541 },
      });
      expect(refused('declare queue a; bind orders -> a key=#.#.#').refusal).toMatchObject({ code: 406 });
    });

    it('is refused when it holds undo or redo, which are about the history and not the canvas', () => {
      const text = 'declare queue a; undo';
      const issue = refused(text);

      expect(issue).toMatchObject({ kind: 'batch', batchIndex: 1 });
      expect(issue.message).toBe(
        'undo is about the history and not the canvas, so it cannot be one of several commands. Type it by itself.',
      );
      expect(pointedAt(text, issue)).toBe('undo');
      expect(refused('redo; declare queue a')).toMatchObject({ kind: 'batch', batchIndex: 0 });
    });

    it('does not take an id that the canvas has for the canvases that it steps through on the way', () => {
      const document = deepFreeze(
        documentOf({ queues: { scratch1: queueRecord('taken'), scratch2: queueRecord('also') } }),
      );

      expect(read('declare queue a; declare queue b; declare queue c', document).type).toBe('batch');
    });

    it('does not change the canvas it is given', () => {
      const document = sample();
      parseCommand('declare queue a; delete billing; clear; declare exchange e type=fanout', document);

      expect(document).toEqual(sampleDocument());
    });
  });

  it('refuses text that has a quoted text that is not closed, wherever it is, and says where it starts', () => {
    const text = 'declare queue a; declare queue "b';

    expect(refused(text)).toMatchObject({ kind: 'syntax', at: { start: 31, end: 33 } });
  });

  it('does not hide a bug in a command: an error that is not a refusal of the text passes through', () => {
    const broken = vi.spyOn(declareQueue, 'parse').mockImplementation(() => {
      throw new Error('a bug');
    });

    try {
      expect(() => parseCommand('declare queue q', sample())).toThrow('a bug');
    } finally {
      broken.mockRestore();
    }
    expect(read('declare queue q')).toMatchObject({ type: 'declare-queue' });
  });

  it('does not change the canvas, and gives the same answer every time', () => {
    const document = sample();

    expect(parseCommand('bind orders -> billing key=a', document)).toEqual(
      parseCommand('bind orders -> billing key=a', document),
    );
    expect(document).toEqual(sampleDocument());
    expect(headerArguments(null)).toEqual({ xMatch: null, args: [] });
  });
});
