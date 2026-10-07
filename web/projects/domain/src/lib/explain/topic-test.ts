import { alignTopic, routingKeyIssue, splitTopic, topicSamples } from '@rmq/engine';
import { topicKeyIssue } from '../document/rules';
import { topicWords, wildcardWords } from './topic-words';

/**
 * What a topic binding key matches, tried on sample keys (ADR-0059, ADR-0064): the keys that it matches, each with how, and the keys that it does not, each with the first thing that is wrong, in the words that the explanation of a
 * route uses. It is what a learner is shown while typing a key, so it runs on any text and never throws. A text that cannot be a binding key says why in the words of the checks that the binding would meet, and has no samples.
 */

/** A sample key, and what the pattern made of it. */
export interface TopicSample {
  readonly key: string;
  /** How it matched, or why it did not: the sentence of the explanation. */
  readonly text: string;
  /** The same in few words: what the wildcards took, or "word for word", for a key that matches, and the short reason for one that does not. */
  readonly short: string;
  /** A note on what may surprise, for a key that matches: a star that took an empty word. */
  readonly note?: string;
}

export type TopicTest =
  | { readonly ok: false; readonly text: string }
  | { readonly ok: true; readonly matching: readonly TopicSample[]; readonly nonMatching: readonly TopicSample[] };

const EMPTY_WORD_NOTE =
  'The * took an empty word: a key can have an empty word between two dots, and a * takes one word, even an empty one.';

function sampleOf(pattern: string, key: string): TopicSample {
  const alignment = alignTopic(pattern, key);
  const { text, short: reason } = topicWords(pattern, key, splitTopic(pattern), splitTopic(key), alignment);
  const wildcards = wildcardWords(alignment);
  const short = alignment.matched ? (wildcards.length === 0 ? 'word for word' : wildcards.join('; ')) : reason;
  const emptyStar = alignment.segments.some(
    (segment) => segment.pattern === '*' && segment.outcome === 'matched' && segment.words[0] === '',
  );
  return emptyStar ? { key, text, short, note: EMPTY_WORD_NOTE } : { key, text, short };
}

/** Tries a binding key on the keys that show what it matches and what it does not. */
export function testTopicKey(pattern: string): TopicTest {
  const tooLong = routingKeyIssue(pattern);
  if (tooLong !== null) {
    return { ok: false, text: `${tooLong}.` };
  }
  const wildcards = topicKeyIssue(pattern);
  if (wildcards !== null) {
    return { ok: false, text: wildcards.message };
  }
  const { matching, nonMatching } = topicSamples(pattern);
  return {
    ok: true,
    matching: matching.map((key) => sampleOf(pattern, key)),
    nonMatching: nonMatching.map((key) => sampleOf(pattern, key)),
  };
}
