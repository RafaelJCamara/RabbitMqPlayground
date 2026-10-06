import {
  consumerRecord,
  deepFreeze,
  documentOf,
  entry,
  exchangeRecord,
  int,
  producerRecord,
  queueRecord,
  sampleDocument,
  str,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import {
  Cursor,
  describeValue,
  Expectation,
  Stop,
  type Expected,
  type OptionSpec,
  type TailSpec,
  type ValueSpec,
} from './cursor';
import { isAtom, tokenize } from './tokenizer';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const twins = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('same') },
      queues: { Q: queueRecord('same') },
      producers: { P: producerRecord('same') },
      consumers: { C: consumerRecord('same') },
    }),
  );

/** A cursor over the words of some text. */
function cursorOver(text: string, document: CanvasDocument = sample(), probe = false): Cursor {
  const result = tokenize(text);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return new Cursor(result.tokens.filter(isAtom), document, probe, text.length);
}

/** What the cursor throws when it runs `read`, as an issue or as what it expected. */
function thrownBy(read: () => unknown): Stop | Expectation {
  try {
    read();
  } catch (error) {
    if (error instanceof Stop || error instanceof Expectation) {
      return error;
    }
    throw error;
  }
  throw new Error('nothing was thrown');
}
const stopped = (read: () => unknown) => {
  const thrown = thrownBy(read);
  if (!(thrown instanceof Stop)) {
    throw new Error('the cursor did not stop');
  }
  return thrown.issue;
};
const expected = (read: () => unknown): Expected => {
  const thrown = thrownBy(read);
  if (!(thrown instanceof Expectation)) {
    throw new Error('the cursor did not expect anything');
  }
  return thrown.expected;
};

const option = (name: string, value: ValueSpec, extra: Partial<OptionSpec> = {}): OptionSpec => ({
  name,
  value,
  summary: `the ${name}`,
  ...extra,
});

describe('describeValue', () => {
  it('says how each kind of value is written', () => {
    expect(describeValue({ kind: 'text' })).toBe('text');
    expect(describeValue({ kind: 'enum', values: ['a', 'b', 'c'] })).toBe('a, b or c');
    expect(describeValue({ kind: 'bool' })).toBe('true or false');
    expect(describeValue({ kind: 'int', min: 1, max: 9 })).toBe('a whole number from 1 to 9');
    expect(describeValue({ kind: 'number', min: -1, max: 1 })).toBe('a number from -1 to 1');
  });
});

describe('the classes that the cursor throws', () => {
  it('carry the issue, and are named', () => {
    const stop = new Stop({ kind: 'syntax', message: 'No.' });

    expect(stop).toBeInstanceOf(Error);
    expect(stop.message).toBe('No.');
    expect(stop.name).toBe('Stop');
    expect(new Expectation({ kind: 'arrow' }).name).toBe('Expectation');
    expect(new Expectation({ kind: 'arrow' }).expected).toEqual({ kind: 'arrow' });
  });
});

describe('Cursor', () => {
  describe('ref', () => {
    it('takes the kind from the place when only one kind goes there, without looking at the canvas', () => {
      expect(cursorOver('anything').ref(['exchange'], 'an exchange')).toEqual({ kind: 'exchange', name: 'anything' });
      expect(cursorOver('"a b"').ref(['queue'], 'a queue')).toEqual({ kind: 'queue', name: 'a b' });
    });

    it('takes the kind from the canvas when several go there, and one of them has the name', () => {
      expect(cursorOver('billing').ref(['queue', 'exchange'], 'a destination')).toEqual({
        kind: 'queue',
        name: 'billing',
      });
      expect(cursorOver('orders').ref(['queue', 'exchange'], 'a destination')).toEqual({
        kind: 'exchange',
        name: 'orders',
      });
    });

    it('takes a qualifier at its word, whether or not there is such an element', () => {
      expect(cursorOver('queue:nope').ref(['queue', 'exchange'], 'a destination')).toEqual({
        kind: 'queue',
        name: 'nope',
      });
      expect(cursorOver('consumer:x').ref(['consumer', 'queue'], 'a')).toEqual({ kind: 'consumer', name: 'x' });
    });

    it('stops at a qualifier for a kind that does not go there, naming the kind with its article', () => {
      expect(stopped(() => cursorOver('exchange:x').ref(['queue'], 'the queue'))).toMatchObject({
        kind: 'syntax',
        message: "Here goes the queue, and 'exchange:' says an exchange.",
        at: { start: 0, end: 10 },
      });
      expect(stopped(() => cursorOver('queue:x').ref(['exchange'], 'the exchange')).message).toBe(
        "Here goes the exchange, and 'queue:' says a queue.",
      );
    });

    it('stops at a name that several kinds have, and lists the ways to say it in the order that kinds are listed in', () => {
      const issue = stopped(() =>
        cursorOver('same', twins()).ref(['consumer', 'queue', 'producer', 'exchange'], 'an element'),
      );

      expect(issue.kind).toBe('ambiguous-name');
      expect(issue.suggestions).toEqual(['exchange:same', 'queue:same', 'producer:same', 'consumer:same']);
      expect(issue.message).toBe(
        "'same' is an exchange, a queue, a producer and a consumer. Say which: exchange:same, queue:same, producer:same or consumer:same.",
      );
    });

    it('does not count a kind that does not go there when it asks which it is', () => {
      const issue = stopped(() => cursorOver('same', twins()).ref(['queue', 'consumer'], 'a queue or a consumer'));

      expect(issue.suggestions).toEqual(['queue:same', 'consumer:same']);
      expect(issue.message).toBe("'same' is a queue and a consumer. Say which: queue:same or consumer:same.");
      expect(cursorOver('same', twins()).ref(['consumer'], 'x').kind).toBe('consumer');
    });

    it('stops at a name that none has, and says what was probably meant, from any of the kinds that go there', () => {
      const issue = stopped(() => cursorOver('biling').ref(['queue', 'exchange'], 'a destination'));

      expect(issue).toMatchObject({ kind: 'missing-element', suggestions: ['billing'], at: { start: 0, end: 6 } });
      expect(issue.message).toBe("There is no queue or exchange named 'biling'. Did you mean 'billing'?");
      expect(stopped(() => cursorOver('zzzz').ref(['queue', 'exchange', 'consumer'], 'a')).message).toBe(
        "There is no queue, exchange or consumer named 'zzzz'.",
      );
    });

    it('stops at an arrow, and at the end, saying what was wanted and where', () => {
      expect(stopped(() => cursorOver('->').ref(['exchange'], 'the exchange')).message).toBe(
        "Expected the exchange, and not '->'.",
      );
      expect(stopped(() => cursorOver('').ref(['exchange'], 'the exchange'))).toEqual({
        kind: 'missing-argument',
        message: 'Expected the exchange.',
        at: { start: 0, end: 0 },
      });
    });

    it('reads one word at a time', () => {
      const cursor = cursorOver('orders billing');

      expect(cursor.ref(['exchange'], 'a').name).toBe('orders');
      expect(cursor.ref(['queue'], 'b').name).toBe('billing');
      expect(() => cursor.finish()).not.toThrow();
    });
  });

  describe('setTarget', () => {
    it('takes the word canvas as the canvas, and any element by its name', () => {
      expect(cursorOver('canvas').setTarget()).toEqual({ kind: 'canvas' });
      expect(cursorOver('billing').setTarget()).toEqual({ kind: 'queue', name: 'billing' });
      expect(cursorOver('queue:canvas').setTarget()).toEqual({ kind: 'queue', name: 'canvas' });
    });

    it('does not take canvas that is quoted or has a qualifier as the canvas', () => {
      const document = deepFreeze(documentOf({ queues: { Q: queueRecord('canvas') } }));

      expect(cursorOver('"canvas"', document).setTarget()).toEqual({ kind: 'queue', name: 'canvas' });
    });

    it('stops at a name that is not there, and at an ambiguous one, with every kind, which can be a producer or a consumer', () => {
      expect(stopped(() => cursorOver('nope').setTarget()).message).toBe(
        "There is no exchange, queue, producer or consumer named 'nope'.",
      );
      expect(stopped(() => cursorOver('same', twins()).setTarget()).kind).toBe('ambiguous-name');
    });

    it('stops at the end with what was wanted, and expects an element or the canvas when it probes', () => {
      expect(stopped(() => cursorOver('').setTarget()).message).toBe('Expected an element or canvas.');
      expect(expected(() => cursorOver('', sample(), true).setTarget())).toEqual({
        kind: 'ref',
        elements: ['exchange', 'queue', 'producer', 'consumer'],
        label: 'an element or canvas',
        canvas: true,
      });
    });
  });

  describe('name', () => {
    it('takes any word as a name, and its text whatever was quoted', () => {
      expect(cursorOver('queue:x').name('a name')).toBe('queue:x');
      expect(cursorOver('a"b c"').name('a name')).toBe('ab c');
      expect(cursorOver('""').name('a name')).toBe('');
    });

    it('stops at the end, and at an arrow', () => {
      expect(stopped(() => cursorOver('').name('the new name')).message).toBe('Expected the new name.');
      expect(stopped(() => cursorOver('->').name('the new name')).message).toBe("Expected the new name, and not '->'.");
    });
  });

  describe('arrow', () => {
    it('takes an arrow, and says what else it found, or that it found nothing', () => {
      expect(() => cursorOver('->').arrow()).not.toThrow();
      expect(stopped(() => cursorOver('orders').arrow())).toMatchObject({
        kind: 'syntax',
        message: "Expected '->' here, and not 'orders'.",
        at: { start: 0, end: 6 },
      });
      expect(stopped(() => cursorOver('').arrow()).message).toBe("Expected '->'.");
    });
  });

  describe('options', () => {
    const spec: TailSpec = {
      options: [
        option('mode', { kind: 'enum', values: ['fast', 'slow'] }, { required: true }),
        option('flag', { kind: 'bool' }),
        option('count', { kind: 'int', min: 1, max: 9 }),
        option('ratio', { kind: 'number', min: 0, max: 1 }),
        option('label', { kind: 'text' }),
      ],
    };

    it('reads each option that is given, once, in any order, with the type that it has', () => {
      const tail = cursorOver('count=3 label="a b" mode=fast flag=false ratio=0.5').options(spec);

      expect(tail.options).toEqual({ count: 3, label: 'a b', mode: 'fast', flag: false, ratio: 0.5 });
      expect(tail.conditions).toEqual([]);
      expect(tail.headers).toEqual([]);
      expect(tail.headerNames).toEqual([]);
    });

    it('reads a number in any form that is a number, and a whole number only as digits, and a zero with no sign', () => {
      expect(cursorOver('mode=fast ratio=1e-1').options(spec).options['ratio']).toBe(0.1);
      expect(cursorOver('mode=fast ratio=0').options(spec).options['ratio']).toBe(0);
      expect(Object.is(cursorOver('mode=fast ratio=-0').options(spec).options['ratio'], 0)).toBe(true);
      expect(stopped(() => cursorOver('mode=fast count=1e1').options(spec)).message).toBe(
        "count must be a whole number from 1 to 9, and '1e1' is not.",
      );
      expect(stopped(() => cursorOver('mode=fast count=2.0').options(spec)).kind).toBe('invalid-value');
      expect(stopped(() => cursorOver('mode=fast count=').options(spec)).kind).toBe('invalid-value');
      expect(stopped(() => cursorOver('mode=fast ratio=1,5').options(spec)).kind).toBe('invalid-value');
    });

    it('reads a value in quotes as the text that it says, for an option that takes any kind', () => {
      expect(cursorOver('mode="fast" flag="true" count="3"').options(spec).options).toEqual({
        mode: 'fast',
        flag: true,
        count: 3,
      });
    });

    it('stops at a value that is out of range, and at one that is not of the kind', () => {
      expect(stopped(() => cursorOver('mode=fast count=10').options(spec)).message).toBe(
        "count must be a whole number from 1 to 9, and '10' is not.",
      );
      expect(stopped(() => cursorOver('mode=fast ratio=2').options(spec)).message).toBe(
        "ratio must be a number from 0 to 1, and '2' is not.",
      );
      expect(stopped(() => cursorOver('mode=fast flag=yes').options(spec)).message).toBe(
        "flag must be true or false, and 'yes' is not.",
      );
      expect(stopped(() => cursorOver('mode=quick').options(spec)).message).toBe(
        "mode must be fast or slow, and 'quick' is not.",
      );
    });

    it('stops at an option that is not there, and says which there are', () => {
      expect(stopped(() => cursorOver('mode=fast colour=red').options(spec)).message).toBe(
        "There is no option 'colour' here. Its options are mode, flag, count, ratio and label.",
      );
    });

    it('stops at a missing required option, saying how to write it, whatever kind it is', () => {
      const required = (value: ValueSpec) =>
        stopped(() => cursorOver('', sample()).options({ options: [option('x', value, { required: true })] }));

      expect(required({ kind: 'enum', values: ['a', 'b'] }).message).toBe('Add x=a|b.');
      expect(required({ kind: 'bool' }).message).toBe('Add x=true|false.');
      expect(required({ kind: 'text' }).message).toBe('Add x=<text>.');
      expect(required({ kind: 'int', min: 0, max: 1 }).message).toBe('Add x=<number>.');
      expect(required({ kind: 'number', min: 0, max: 1 }).message).toBe('Add x=<number>.');
    });

    it('stops at a word that has no = and says how to write it, with the option that it is the name of or like', () => {
      expect(stopped(() => cursorOver('mode=fast flag').options(spec))).toMatchObject({
        kind: 'syntax',
        message: "Write 'flag' as name=value, for example flag=…. Did you mean 'flag='?",
        suggestions: ['flag='],
      });
      expect(stopped(() => cursorOver('mode=fast lable').options(spec)).message).toBe(
        "Write 'lable' as name=value, for example label=…. Did you mean 'label='?",
      );
      expect(stopped(() => cursorOver('mode=fast zzz').options(spec)).message).toBe(
        "Write 'zzz' as name=value, for example mode=….",
      );
    });

    it('says only that a word is not name=value when the command has no options to suggest', () => {
      expect(stopped(() => cursorOver('zzz').options({ options: [] })).message).toBe("Write 'zzz' as name=value.");
    });

    it('stops at an arrow among the options', () => {
      expect(stopped(() => cursorOver('mode=fast ->').options(spec))).toMatchObject({
        kind: 'syntax',
        message: "Unexpected '->' here.",
        at: { start: 10, end: 12 },
      });
    });

    it('stops at an option that is there twice, and at a word that starts with =', () => {
      expect(stopped(() => cursorOver('mode=fast mode=slow').options(spec)).message).toBe(
        'mode is there twice. Give it once.',
      );
      expect(stopped(() => cursorOver('mode=fast =x').options(spec)).kind).toBe('unknown-option');
    });

    it('does not read an option from a name that is quoted, which is how a header is told from an option', () => {
      expect(stopped(() => cursorOver('mode=fast "flag"=true').options(spec)).kind).toBe('unknown-option');
    });
  });

  describe('options with conditions on headers', () => {
    const spec: TailSpec = { options: [option('key', { kind: 'text' })], conditions: true };

    it('reads name=value as a condition, typed, and exists(name) as a header that has to be there, in order', () => {
      const tail = cursorOver('a=1 key=k b="1" exists(c) d=1.5 e=true f=x').options(spec);

      expect(tail.options).toEqual({ key: 'k' });
      expect(tail.conditions).toEqual([
        entry('a', int(1)),
        entry('b', str('1')),
        { key: 'c', value: { t: 'exists' } },
        { key: 'd', value: { t: 'float', v: 1.5 } },
        { key: 'e', value: { t: 'boolean', v: true } },
        entry('f', str('x')),
      ]);
    });

    it('stops at a header that cannot be, at the word that has it', () => {
      expect(stopped(() => cursorOver('a=9007199254740993').options(spec))).toMatchObject({
        kind: 'header',
        at: { start: 0, end: 18 },
      });
      expect(stopped(() => cursorOver('=1').options(spec)).message).toBe('A header needs a name.');
      expect(stopped(() => cursorOver('exists()').options(spec)).message).toBe('A header needs a name.');
      expect(stopped(() => cursorOver(`${'k'.repeat(256)}=1`).options(spec)).kind).toBe('header');
      expect(stopped(() => cursorOver(`exists(${'k'.repeat(256)})`).options(spec)).kind).toBe('header');
    });

    it('does not read exists( for a command that has no conditions, where it is an option that is not there', () => {
      expect(stopped(() => cursorOver('exists(a)').options({ options: [option('key', { kind: 'text' })] })).kind).toBe(
        'syntax',
      );
    });
  });

  describe('options with the headers of a message and the names of headers', () => {
    it('reads header:name=value as a header, typed, and keeps a bare word with = that is not an option for the error', () => {
      const spec: TailSpec = { options: [option('key', { kind: 'text' })], messageHeaders: true };
      const tail = cursorOver('header:a=1 header:"b c"=x key=k').options(spec);

      expect(tail.headers).toEqual([entry('a', int(1)), entry('b c', str('x'))]);
      expect(tail.options).toEqual({ key: 'k' });
      expect(stopped(() => cursorOver('colour=red').options(spec)).kind).toBe('unknown-option');
      expect(stopped(() => cursorOver('"header:a"=1').options(spec)).kind).toBe('unknown-option');
    });

    it('reads header:name as the name of a header, and refuses a word that is not written like that', () => {
      const spec: TailSpec = { options: [], headerNames: true };

      expect(cursorOver('header:a header:"b c"').options(spec).headerNames).toEqual(['a', 'b c']);
      expect(stopped(() => cursorOver('a').options(spec)).message).toBe(
        "Write the name of a header as header:name, for example header:format, and not 'a'.",
      );
      expect(stopped(() => cursorOver('header:').options(spec)).message).toBe('A header needs a name.');
      expect(stopped(() => cursorOver('"header:a"').options(spec)).kind).toBe('syntax');
    });
  });

  describe('finish', () => {
    it('is quiet when every word has been taken, and stops at a word that is left, or an arrow', () => {
      expect(() => cursorOver('').finish()).not.toThrow();
      expect(stopped(() => cursorOver('x').finish())).toMatchObject({
        kind: 'syntax',
        message: "Unexpected 'x': there is nothing more to say here.",
        at: { start: 0, end: 1 },
      });
      expect(stopped(() => cursorOver('->').finish()).message).toBe(
        "Unexpected '->': there is nothing more to say here.",
      );
    });
  });

  describe('stop', () => {
    it('refuses the command as a whole, at the end of the text', () => {
      expect(stopped(() => cursorOver('abc').stop({ kind: 'nothing-to-change', message: 'Say more.' }))).toEqual({
        kind: 'nothing-to-change',
        message: 'Say more.',
        at: { start: 3, end: 3 },
      });
    });
  });

  describe('probing, which says what would come next when the words run out', () => {
    it('expects the kinds of element that go there, with what they are called', () => {
      expect(expected(() => cursorOver('', sample(), true).ref(['queue', 'exchange'], 'a destination'))).toEqual({
        kind: 'ref',
        elements: ['queue', 'exchange'],
        label: 'a destination',
      });
    });

    it('expects a name, an arrow and the tail, which says which options have been used', () => {
      expect(expected(() => cursorOver('', sample(), true).name('a name'))).toEqual({ kind: 'name', label: 'a name' });
      expect(expected(() => cursorOver('', sample(), true).arrow())).toEqual({ kind: 'arrow' });
      const spec: TailSpec = { options: [option('a', { kind: 'bool' }), option('b', { kind: 'bool' })] };

      expect(expected(() => cursorOver('a=true', sample(), true).options(spec))).toEqual({
        kind: 'tail',
        spec,
        used: ['a'],
      });
      expect(expected(() => cursorOver('', sample(), true).options(spec))).toEqual({ kind: 'tail', spec, used: [] });
    });

    it('expects the tail even when a required option is missing, because it is where an option would be typed', () => {
      const spec: TailSpec = { options: [option('a', { kind: 'bool' }, { required: true })] };

      expect(expected(() => cursorOver('', sample(), true).options(spec)).kind).toBe('tail');
    });

    it('still stops at a mistake in the words that there are', () => {
      expect(stopped(() => cursorOver('nope', sample(), true).ref(['queue', 'exchange'], 'x')).kind).toBe(
        'missing-element',
      );
      expect(
        stopped(() => cursorOver('a=maybe', sample(), true).options({ options: [option('a', { kind: 'bool' })] })).kind,
      ).toBe('invalid-value');
    });
  });
});
