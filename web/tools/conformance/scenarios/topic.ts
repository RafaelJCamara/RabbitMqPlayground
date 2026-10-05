import type { Scenario } from '../scenario';
import { bindKey, declareExchange, declareQueue, exchange, publish, queue, refused } from './helpers';

/**
 * Topic exchanges (ADR-0008, rule 4). Most of these are tables: one topic exchange `t`, one queue for every pattern
 * (named `p:<pattern>`, so the recording reads as "this key reached these patterns"), and one publish for every key
 * (with the body `k:<key>`).
 */

function topicTable(id: string, title: string, patterns: readonly string[], keys: readonly string[]): Scenario {
  return {
    id: `routing/${id}`,
    kind: 'routing',
    title,
    steps: [
      declareExchange('t', 'topic'),
      ...patterns.flatMap((pattern) => [declareQueue(`p:${pattern}`), bindKey('t', queue(`p:${pattern}`), pattern)]),
      ...keys.map((key) => publish('t', key, `k:${key}`)),
    ],
  };
}

/**
 * Every word sequence of up to `length` words over `words`, as the strings that they make. The string `""` is both no
 * words and one empty word, so it appears once.
 */
function sequences(words: readonly string[], length: number): string[] {
  const found = new Set<string>(['']);
  let level: string[][] = [[]];
  for (let size = 1; size <= length; size++) {
    level = level.flatMap((prefix) => words.map((word) => [...prefix, word]));
    for (const sequence of level) {
      found.add(sequence.join('.'));
    }
  }
  return [...found];
}

/** How many words of a pattern are `#`. A topic binding key may have at most two (ADR-0022). */
const hashWords = (pattern: string): number => pattern.split('.').filter((word) => word === '#').length;

/** 255 bytes in 128 words: `a.a. … .a`. */
const KEY_OF_128_WORDS = Array.from({ length: 128 }, () => 'a').join('.');
const STARS = (count: number) => Array.from({ length: count }, () => '*').join('.');

const LONG_KEY_PATTERNS: readonly { readonly name: string; readonly pattern: string }[] = [
  { name: 'hash', pattern: '#' },
  { name: 'star', pattern: '*' },
  { name: 'prefix', pattern: 'a.#' },
  { name: 'suffix', pattern: '#.a' },
  { name: 'middle', pattern: 'a.#.a' },
  { name: 'exact', pattern: KEY_OF_128_WORDS },
  { name: 'stars-128', pattern: STARS(128) },
  { name: 'stars-127', pattern: STARS(127) },
  { name: 'stars-127-and-hash', pattern: `${STARS(127)}.#` },
];

export const TOPIC_SCENARIOS: readonly Scenario[] = [
  topicTable(
    'topic-the-empty-key-has-no-words',
    'The empty routing key has zero words: # matches it and * does not, and "." is two empty words (ADR-0008, rule 4)',
    ['', '#', '*', '#.#', '*.#', '#.*', '*.*', 'a', 'a.#', '#.a', '.', '.#', '#.', '*.', '.*'],
    ['', '.', '..'],
  ),
  topicTable(
    'topic-star-matches-exactly-one-word-and-the-word-may-be-empty',
    'A * matches exactly one word, and that word may be empty (ADR-0008, rule 4)',
    ['*', '*.*', 'a.*', '*.b', 'a.*.b', '*.*.*', '*.a', '*.'],
    ['', 'a', 'b', '.', 'a.', '.b', 'a.b', 'a..b', 'a.x.b', 'a.b.c', '..', '...'],
  ),
  topicTable(
    'topic-hash-matches-zero-or-more-words-wherever-it-is',
    'A # matches zero or more words, at the start, in the middle or at the end (ADR-0008, rule 4)',
    ['#', 'a.#', '#.b', 'a.#.b', '#.a.#', '#.#', 'a.#.#', '#.a', 'a.b.#', '#.a.b'],
    ['', 'a', 'b', 'a.b', 'b.a', 'a.x.b', 'a.x.y.b', 'x.a.y', 'a.b.c', 'x.y.a.b', 'a..b', '.a', 'a.'],
  ),
  topicTable(
    'topic-a-wildcard-inside-a-word-is-an-ordinary-character',
    'A * or # is a wildcard only as a whole word: in a* it is an ordinary character (ADR-0008, rule 4)',
    ['a*', '*a', '**', 'a#', '#a', '##', 'a.b*', '*b.a', 'a*.b', '#.a*'],
    ['a*', '*a', '**', 'a#', '#a', '##', 'a', 'ab', 'aa', 'a.b*', 'x.a*', 'ba', 'a.bb', 'a*.b'],
  ),
  topicTable(
    'topic-leading-and-trailing-dots-make-empty-words',
    'A leading or trailing dot makes an empty word, and an empty word is a word (ADR-0008, rule 4)',
    ['.', 'a.', '.a', '*.', '.*', '#.', '.#', '*.*', 'a.a', '#.#'],
    ['.', 'a.', '.a', '..', 'a..', '..a', '.a.', 'a.a'],
  ),
  topicTable(
    'topic-matching-is-case-sensitive-and-compares-bytes',
    'Words are compared byte for byte: case, a composed and a decomposed é, and spaces all count (ADR-0008, rule 4)',
    ['a.b', 'A.b', 'a.B', 'A.B', 'é', 'é', 'é.*', '*.é', 'a. b', 'a.b '],
    ['a.b', 'A.b', 'a.B', 'A.B', 'é', 'é', 'é.x', 'x.é', 'a. b', 'a.b '],
  ),
  {
    id: 'routing/topic-a-queue-gets-one-copy-however-many-patterns-match',
    kind: 'routing',
    title:
      'A queue that is bound with several patterns that all match still gets one copy of the message (ADR-0008, rule 7)',
    steps: [
      declareExchange('t', 'topic'),
      declareQueue('one'),
      declareQueue('two'),
      declareQueue('three'),
      bindKey('t', queue('one'), 'a.#'),
      bindKey('t', queue('one'), '#'),
      bindKey('t', queue('one'), 'a.b'),
      bindKey('t', queue('one'), '*.b'),
      bindKey('t', queue('one'), '*.*'),
      bindKey('t', queue('two'), 'a.b'),
      bindKey('t', queue('two'), 'a.b'),
      bindKey('t', queue('three'), '#'),
      publish('t', 'a.b', 'm1'),
      publish('t', 'x', 'm2'),
      publish('t', 'a.c', 'm3'),
    ],
  },
  topicTable(
    'topic-every-pattern-of-up-to-three-words-against-every-key-of-up-to-three-words',
    'Every pattern of up to three words (a, *, # or empty) that the broker accepts against every key of up to three words (a, b or empty): the whole truth table of the topic matcher (ADR-0008, rule 4)',
    // `#.#.#` is the one pattern of three words that is left out: a topic binding key may have at most two # words.
    sequences(['a', '*', '#', ''], 3).filter((pattern) => hashWords(pattern) <= 2),
    sequences(['a', 'b', ''], 3),
  ),
  {
    id: 'routing/a-topic-binding-key-with-three-hash-wildcards-is-refused',
    kind: 'routing',
    title:
      'A topic binding key may have at most two # words: a third is refused with 406, and only a topic exchange minds (ADR-0022)',
    steps: [
      declareExchange('t', 'topic'),
      declareExchange('d', 'direct'),
      declareExchange('other', 'fanout'),
      declareQueue('wild'),
      declareQueue('literal'),
      refused(bindKey('t', queue('wild'), '#.#.#')),
      refused(bindKey('t', queue('wild'), 'a.#.b.#.c.#')),
      refused(bindKey('t', queue('wild'), '#.*.#.*.#')),
      // Between exchanges too, and the count is of whole words: ## is an ordinary word.
      refused(bindKey('t', exchange('other'), '#.#.#')),
      bindKey('t', queue('wild'), '#.#'),
      bindKey('t', queue('wild'), 'a.#.b.#.c'),
      bindKey('t', queue('literal'), '##.#.#'),
      // On any other exchange type the same key is an ordinary key, or is not looked at.
      bindKey('d', queue('literal'), '#.#.#'),
      publish('t', 'a.b.c', 'm1'),
      publish('t', '##.x.y', 'm2'),
      publish('d', '#.#.#', 'm3'),
      publish('d', 'a', 'm4'),
    ],
  },
  {
    id: 'routing/topic-a-key-of-255-bytes-and-128-words',
    kind: 'routing',
    title: 'A routing key of 255 bytes and 128 words matches the patterns that it should (ADR-0008, rule 4)',
    steps: [
      declareExchange('t', 'topic'),
      // A binding key is limited to 255 bytes too, so 128 stars (255 bytes) is the most that one pattern can have.
      ...LONG_KEY_PATTERNS.flatMap(({ name, pattern }) => [declareQueue(name), bindKey('t', queue(name), pattern)]),
      publish('t', KEY_OF_128_WORDS, 'm1'),
      publish('t', `${KEY_OF_128_WORDS.slice(0, -1)}b`, 'm2'),
    ],
  },
];
