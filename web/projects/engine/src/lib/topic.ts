import { ROUTING_KEY_MAX_BYTES, utf8Length } from './keys';

/**
 * Topic matching (ADR-0008, rule 4). A key is split into words on `.`, and the empty key has no words, so `""` and `"."`
 * are different: the first has none and the second has two empty ones. In a pattern `*` is exactly one word, which may
 * be empty, and `#` is zero or more. They are wildcards only as a whole word, so `a*` is an ordinary word. Words are
 * compared byte for byte. A binding key may have at most two `#` words (ADR-0022), which the editors check, not this.
 */

/** The words of a routing key or a binding key. */
export function splitTopic(text: string): string[] {
  return text === '' ? [] : text.split('.');
}

/** A grid of yes and no, `rows` by `columns`. */
class Grid {
  private readonly cells: Uint8Array;

  constructor(
    rows: number,
    private readonly columns: number,
  ) {
    this.cells = new Uint8Array(rows * columns);
  }

  get(row: number, column: number): boolean {
    return this.cells[row * this.columns + column] === 1;
  }

  set(row: number, column: number): void {
    this.cells[row * this.columns + column] = 1;
  }
}

/** `grid.get(i, j)`: can the first `i` words of the pattern match exactly the first `j` words of the key? */
function reach(pattern: readonly string[], key: readonly string[]): Grid {
  const grid = new Grid(pattern.length + 1, key.length + 1);
  grid.set(0, 0);
  pattern.forEach((word, i) => {
    for (let j = 0; j <= key.length; j++) {
      if (word === '#') {
        // `#` has taken the first j words if it had taken the first j - 1 and takes one more, or took none.
        if (grid.get(i, j) || (j > 0 && grid.get(i + 1, j - 1))) {
          grid.set(i + 1, j);
        }
      } else if (j < key.length && grid.get(i, j) && (word === '*' || word === key[j])) {
        grid.set(i + 1, j + 1);
      }
    }
  });
  return grid;
}

export function topicMatches(pattern: string, key: string): boolean {
  const words = splitTopic(pattern);
  const keyWords = splitTopic(key);
  return reach(words, keyWords).get(words.length, keyWords.length);
}

/** One pattern word, with the key words that it took. A `#` takes any number of them, anything else takes one. */
export interface TopicSegment {
  readonly pattern: string;
  readonly words: readonly string[];
}

/** Why a pattern stopped short of a key. */
export type TopicMiss =
  /** The pattern word at `patternIndex` has no key word left to match. */
  | { readonly kind: 'key-ran-out'; readonly patternIndex: number }
  /** The pattern word at `patternIndex` is a word, and the key word at `keyIndex` is another. */
  | { readonly kind: 'word-differs'; readonly patternIndex: number; readonly keyIndex: number }
  /** The pattern is used up, and the key words from `keyIndex` on are left. */
  | { readonly kind: 'key-has-extra-words'; readonly keyIndex: number };

/** A pattern laid against a key, word by word, for an explanation to show (ADR-0010). */
export interface TopicAlignment {
  readonly matched: boolean;
  /**
   * For a match, every pattern word with the key words it took, which together are the whole key. For a miss, as many
   * pattern words as could be matched from the left, which is as far as the pattern got.
   */
  readonly segments: readonly TopicSegment[];
  /** Why a miss stopped where it did. Only for a miss. */
  readonly miss?: TopicMiss;
}

/**
 * Splits `key` between the words of `pattern`, given that the pattern matches it exactly. A `#` takes as few words as it
 * can, so that the words that come after it are matched first.
 */
function segmentsOf(pattern: readonly string[], key: readonly string[]): TopicSegment[] {
  // From the end, `rest.get(a, b)` says that the last `a` pattern words match the last `b` key words, which is the
  // question "do the words that follow match what is left?" asked from the front.
  const rest = reach([...pattern].reverse(), [...key].reverse());
  const canFinish = (patternIndex: number, keyIndex: number): boolean =>
    rest.get(pattern.length - patternIndex, key.length - keyIndex);

  const segments: TopicSegment[] = [];
  let at = 0;
  pattern.forEach((word, index) => {
    let taken = 1;
    if (word === '#') {
      taken = 0;
      while (!canFinish(index + 1, at + taken)) {
        taken += 1;
      }
    }
    segments.push({ pattern: word, words: key.slice(at, at + taken) });
    at += taken;
  });
  return segments;
}

export function alignTopic(pattern: string, key: string): TopicAlignment {
  const words = splitTopic(pattern);
  const keyWords = splitTopic(key);
  const grid = reach(words, keyWords);

  if (grid.get(words.length, keyWords.length)) {
    return { matched: true, segments: segmentsOf(words, keyWords) };
  }

  // The most that the pattern could match: its longest prefix that matches a prefix of the key, and of those prefixes
  // the longest key one. Every pattern has at least the empty prefix, which matches the empty one.
  let patternIndex = words.length;
  let keyIndex = keyWords.length;
  while (!grid.get(patternIndex, keyIndex)) {
    if (keyIndex === 0) {
      patternIndex -= 1;
      keyIndex = keyWords.length;
    } else {
      keyIndex -= 1;
    }
  }

  const segments = segmentsOf(words.slice(0, patternIndex), keyWords.slice(0, keyIndex));
  if (patternIndex === words.length) {
    return { matched: false, segments, miss: { kind: 'key-has-extra-words', keyIndex } };
  }
  if (keyIndex === keyWords.length) {
    return { matched: false, segments, miss: { kind: 'key-ran-out', patternIndex } };
  }
  return { matched: false, segments, miss: { kind: 'word-differs', patternIndex, keyIndex } };
}

/** Keys that a pattern matches and keys that it does not, for a person who is writing the pattern to see. */
export interface TopicSamples {
  readonly matching: readonly string[];
  readonly nonMatching: readonly string[];
}

const MOST_MATCHING_SAMPLES = 4;
const MOST_NON_MATCHING_SAMPLES = 5;

function unique(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

/**
 * Sample keys for a pattern, the same every time. The matching ones fill in each `*` with a word, or with an empty one,
 * and each `#` with no word, one or two. The ones that do not match are a matching key with something wrong: an extra
 * word at either end, a word of the pattern misspelt, a word short, and the empty key. A sample that is not what it is
 * meant to be, for example the extra word after a trailing `#`, is left out, and so is one that no client could send
 * because it is over 255 bytes.
 */
export function topicSamples(pattern: string): TopicSamples {
  const words = splitTopic(pattern);
  const fill = (star: string, hash: readonly string[]): string =>
    words.flatMap((word) => (word === '*' ? [star] : word === '#' ? hash : [word])).join('.');
  const sendable = (key: string): boolean => utf8Length(key) <= ROUTING_KEY_MAX_BYTES;

  const matching = unique([fill('x', []), fill('x', ['y']), fill('x', ['y', 'z']), fill('', [])])
    .filter((key) => sendable(key) && topicMatches(pattern, key))
    .slice(0, MOST_MATCHING_SAMPLES);

  // A word for each word of the pattern, so that the misspelt ones line up with it.
  const base = splitTopic(fill('x', ['y']));
  const misspelt = words.flatMap((word, index) =>
    word === '*' || word === '#' ? [] : [base.map((other, at) => (at === index ? `${word}x` : other)).join('.')],
  );
  const joined = base.join('.');
  const nonMatching = unique(['', `${joined}.extra`, `extra.${joined}`, ...misspelt, base.slice(0, -1).join('.')])
    .filter((key) => sendable(key) && !topicMatches(pattern, key))
    .slice(0, MOST_NON_MATCHING_SAMPLES);

  return { matching, nonMatching };
}
