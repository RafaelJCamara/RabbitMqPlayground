import { routingKeyIssue, topicMatches } from '@rmq/engine';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { testTopicKey } from './topic-test';

const tested = (pattern: string) => {
  const result = testTopicKey(pattern);
  if (!result.ok) {
    throw new Error(`the key is refused: ${result.text}`);
  }
  return result;
};

describe('testTopicKey (ADR-0059, ADR-0064)', () => {
  it('lists the keys that a pattern matches, each with how it did, and the keys that it does not, each with the first thing that is wrong', () => {
    const { matching, nonMatching } = tested('*.error');

    expect(matching).toEqual([
      { key: 'x.error', text: 'The pattern "*.error" matches the key "x.error": * took "x".', short: '* took "x"' },
      {
        key: '.error',
        text: 'The pattern "*.error" matches the key ".error": * took an empty word.',
        short: '* took an empty word',
        note: expect.any(String),
      },
    ]);
    expect(nonMatching.map(({ key }) => key)).toEqual(['', 'x.error.extra', 'extra.x.error', 'x.errorx', 'x']);
    expect(nonMatching[0]?.text).toMatch(/^The pattern "\*\.error" does not match the empty key: /);
    expect(nonMatching[3]?.text).toBe(
      'The pattern "*.error" does not match the key "x.errorx": the last word of the key is "errorx", and the pattern asks for "error".',
    );
    expect(nonMatching[3]?.short).toBe('last word is "errorx", not "error"');
  });

  it('says that a star that took an empty word did, which is the sample that surprises, and only for that sample', () => {
    const { matching } = tested('*.b');

    expect(matching.find(({ key }) => key === '.b')?.note).toMatch(/^The \* took an empty word/);
    expect(matching.find(({ key }) => key === 'x.b')?.note).toBeUndefined();
  });

  it('says what the wildcards took in few words, and that a key with none matched word for word', () => {
    expect(tested('a.*.#').matching.map(({ short }) => short)).toEqual([
      '* took "x"; # took no words',
      '* took "x"; # took "y"',
      '* took "x"; # took "y.z"',
      '* took an empty word; # took no words',
    ]);
    expect(tested('a.b').matching.map(({ short }) => short)).toEqual(['word for word']);
  });

  it('has a sample of each way that a hash can match: no word, one and two', () => {
    const { matching } = tested('logs.#');

    expect(matching.map(({ key }) => key)).toEqual(['logs', 'logs.y', 'logs.y.z']);
    expect(matching[0]?.text).toBe('The pattern "logs.#" matches the key "logs": # took no words.');
  });

  it('is a key that matches the empty key and nothing else for the empty pattern, which a topic exchange accepts', () => {
    const { matching, nonMatching } = tested('');

    expect(matching.map(({ key }) => key)).toEqual(['']);
    expect(matching[0]?.text).toBe('The empty pattern is the empty key, word for word.');
    expect(nonMatching.length).toBeGreaterThan(0);
  });

  it('says why a pattern with three hash words cannot be a binding key, in the words of the check that the binding meets, and has no samples', () => {
    const result = testTopicKey('a.#.b.#.c.#');

    expect(result).toEqual({
      ok: false,
      text: expect.stringContaining("The binding key 'a.#.b.#.c.#' has 3 '#' words, and RabbitMQ allows at most 2"),
    });
    expect(result).not.toHaveProperty('matching');
  });

  it('says why a pattern over 255 bytes cannot be a binding key, with how many bytes it is', () => {
    expect(testTopicKey('x'.repeat(300))).toEqual({
      ok: false,
      text: 'A routing key is at most 255 bytes of UTF-8, and this one is 300.',
    });
  });

  it('says it of the bytes and not of the letters, so that a long key of two-byte letters is refused at a hundred and twenty-eight', () => {
    // A hundred and twenty-seven of them are 254 bytes, which a binding key may be, and a hundred and twenty-eight are 256.
    expect(testTopicKey('é'.repeat(127)).ok).toBe(true);
    expect(testTopicKey('é'.repeat(128))).toEqual({ ok: false, text: expect.stringContaining('this one is 256') });
  });
});

describe('testTopicKey, as a property', () => {
  const arbPattern: fc.Arbitrary<string> = fc.oneof(
    fc.string({ maxLength: 24 }),
    fc.array(fc.constantFrom('a', 'b', '*', '#', ''), { maxLength: 7 }).map((words) => words.join('.')),
    fc.string({ minLength: 250, maxLength: 300 }),
  );

  it('never throws, whatever is typed, and refuses exactly what the binding would refuse', () => {
    fc.assert(
      fc.property(arbPattern, (pattern) => {
        const result = testTopicKey(pattern);
        const hashes = pattern === '' ? 0 : pattern.split('.').filter((word) => word === '#').length;
        const refused = routingKeyIssue(pattern) !== null || hashes > 2;

        expect(result.ok).toBe(!refused);
      }),
    );
  });

  it('has samples that are what they are said to be: each key that matches matches, each that does not does not, each with a sentence', () => {
    fc.assert(
      fc.property(arbPattern, (pattern) => {
        const result = testTopicKey(pattern);
        fc.pre(result.ok);
        if (!result.ok) {
          return;
        }

        for (const { key, text } of result.matching) {
          expect(topicMatches(pattern, key)).toBe(true);
          expect(text).not.toBe('');
        }
        for (const { key, text } of result.nonMatching) {
          expect(topicMatches(pattern, key)).toBe(false);
          expect(text).toContain('does not match');
        }
      }),
    );
  });
});
