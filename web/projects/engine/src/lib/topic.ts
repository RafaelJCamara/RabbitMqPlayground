import { ROUTING_KEY_MAX_BYTES, utf8Length } from './keys';

/**
 * Topic matching (ADR-0008, rule 4). A key is split into words on `.`, and the empty key has no words, so `""` and `"."`
 * are different: the first has none and the second has two empty ones. In a pattern `*` is exactly one word, which may
 * be empty, and `#` is zero or more. They are wildcards only as a whole word, so `a*` is an ordinary word. Words are
 * compared byte for byte. A binding key may have at most two `#` words (ADR-0022): matching does not look at that, and
 * whoever makes a binding checks it with `hashWordCount`.
 */

/** The most `#` words that a binding key of a topic exchange may have (ADR-0022). */
export const TOPIC_MAX_HASH_WORDS = 2;

/** The words of a routing key or a binding key. */
export function splitTopic(text: string): string[] {
  return text === '' ? [] : text.split('.');
}

/** How many words of a binding key are exactly `#`. `##` is an ordinary word, and so is `a#`. */
export function hashWordCount(key: string): number {
  return splitTopic(key).filter((word) => word === '#').length;
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

/** What one pattern word made of the key (ADR-0059). */
export type SegmentOutcome =
  /** It took the key word that fits it. A `#` is always this: it takes what is between its neighbours. */
  | 'matched'
  /** A word of the pattern met another word, which is in `words`. */
  | 'differs'
  /** The key had no word left for it. */
  | 'missing';

/** One pattern word, with the key words that it took. A `#` takes any number of them, anything else takes one, or none when the key had no word left. */
export interface TopicSegment {
  readonly pattern: string;
  readonly words: readonly string[];
  readonly outcome: SegmentOutcome;
}

/** Why a pattern did not match a key: the first problem there is (ADR-0059). */
export type TopicMiss =
  /** A word of the pattern is not the key's word at its place. Before the first `#` it is counted from the start of the key, and after the last from its end. */
  | { readonly kind: 'word-differs'; readonly patternIndex: number; readonly keyIndex: number }
  /** The key has fewer words than the pattern has words that are not `#`, which no `#` makes up for. */
  | { readonly kind: 'key-too-short'; readonly needs: number; readonly has: number }
  /** The pattern has no `#` and is used up, and the key goes on from `keyIndex`. */
  | { readonly kind: 'key-has-extra-words'; readonly keyIndex: number }
  /** The words between two `#` that start at `patternIndex` are nowhere in the key, in order. */
  | { readonly kind: 'middle-not-found'; readonly patternIndex: number };

/** A pattern laid against a key, word by word, for an explanation to show (ADR-0010). */
export interface TopicAlignment {
  readonly matched: boolean;
  /** Every word of the pattern, with the key words that it took. For a match they are the whole key, in order. */
  readonly segments: readonly TopicSegment[];
  /** Why a miss is one. Only for a miss. */
  readonly miss?: TopicMiss;
}

const fits = (word: string, keyWord: string): boolean => word === '*' || word === keyWord;

/** A word of the pattern judged against the key word at its place, which may not be there. */
function judge(word: string, keyWord: string | undefined): TopicSegment {
  if (keyWord === undefined) {
    return { pattern: word, words: [], outcome: 'missing' };
  }
  return { pattern: word, words: [keyWord], outcome: fits(word, keyWord) ? 'matched' : 'differs' };
}

/**
 * Lays a pattern against a key (ADR-0059). The words before the first `#` are anchored to the start of the key and the words after the last `#` to its end, so a
 * pattern with no `#` is all anchor; the words between two `#` are looked for from left to right in what is left, each in the first place where it fits, which is
 * where it leaves the most room for what follows. Each word is judged on its own, and a `#` takes the words between what is anchored or found on either side.
 */
function alignWords(
  words: readonly string[],
  key: readonly string[],
): { segments: TopicSegment[]; lost: number | null } {
  const first = words.indexOf('#');
  const last = words.lastIndexOf('#');
  const segments: TopicSegment[] = [];
  const front = first === -1 ? words.length : first;
  for (let index = 0; index < front; index++) {
    segments[index] = judge(words[index] as string, key[index]);
  }
  if (first === -1) {
    return { segments, lost: null };
  }

  // The words after the last #, from the end of the key, and never into the key words that the front has used.
  const used = Math.min(front, key.length);
  const back = words.length - last - 1;
  for (let from = 0; from < back; from++) {
    const place = key.length - 1 - from;
    segments[words.length - 1 - from] = judge(
      words[words.length - 1 - from] as string,
      place >= used ? key[place] : undefined,
    );
  }
  const end = key.length - Math.min(back, key.length - used);

  // Between the first # and the last, the words that follow each # are looked for from where the last one ended.
  let at = used;
  let lost: number | null = null;
  for (let hash = first; hash < last;) {
    const next = words.indexOf('#', hash + 1);
    const block = words.slice(hash + 1, next);
    let place = at;
    while (place + block.length <= end && block.some((word, offset) => !fits(word, key[place + offset] as string))) {
      place += 1;
    }
    if (place + block.length <= end) {
      segments[hash] = { pattern: '#', words: key.slice(at, place), outcome: 'matched' };
      block.forEach((word, offset) => {
        segments[hash + 1 + offset] = judge(word, key[place + offset]);
      });
      at = place + block.length;
    } else {
      segments[hash] = { pattern: '#', words: [], outcome: 'matched' };
      block.forEach((word, offset) => {
        segments[hash + 1 + offset] = { pattern: word, words: [], outcome: 'missing' };
      });
      lost ??= hash + 1;
    }
    hash = next;
  }
  segments[last] = { pattern: '#', words: key.slice(at, end), outcome: 'matched' };
  return { segments, lost };
}

/** The first thing that is wrong with a pattern that does not match, in the order that ADR-0059 gives. */
function firstMiss(
  words: readonly string[],
  key: readonly string[],
  segments: readonly TopicSegment[],
  lost: number | null,
): TopicMiss {
  const first = words.indexOf('#');
  const front = first === -1 ? words.length : first;
  const needs = words.filter((word) => word !== '#').length;

  const wrongFront = segments.findIndex((segment, index) => index < front && segment.outcome === 'differs');
  if (wrongFront !== -1) {
    return { kind: 'word-differs', patternIndex: wrongFront, keyIndex: wrongFront };
  }
  if (key.length < needs) {
    return { kind: 'key-too-short', needs, has: key.length };
  }
  if (first === -1) {
    return { kind: 'key-has-extra-words', keyIndex: words.length };
  }
  const last = words.lastIndexOf('#');
  const wrongBack = segments.findIndex((segment, index) => index > last && segment.outcome === 'differs');
  if (wrongBack !== -1) {
    return { kind: 'word-differs', patternIndex: wrongBack, keyIndex: key.length - (words.length - wrongBack) };
  }
  return { kind: 'middle-not-found', patternIndex: lost as number };
}

export function alignTopic(pattern: string, key: string): TopicAlignment {
  const words = splitTopic(pattern);
  const keyWords = splitTopic(key);
  const matched = reach(words, keyWords).get(words.length, keyWords.length);
  const { segments, lost } = alignWords(words, keyWords);
  return matched ? { matched, segments } : { matched, segments, miss: firstMiss(words, keyWords, segments, lost) };
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
