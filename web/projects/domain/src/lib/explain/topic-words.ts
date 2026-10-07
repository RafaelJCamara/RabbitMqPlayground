import type { TopicAlignment, TopicMiss } from '@rmq/engine';
import { plural, quoted, shorten, wordText } from './words';

/**
 * What a topic binding made of a key, in words (ADR-0059, ADR-0060): the sentence for the inspector and the short reason for the label of an edge. The alignment says what happened word by word,
 * and the first problem of a miss says which sentence to write.
 */

export interface TopicWords {
  readonly text: string;
  readonly short: string;
}

const patternPhrase = (bindingKey: string): string =>
  bindingKey === '' ? 'the empty pattern' : `the pattern ${quoted(bindingKey)}`;
const keyPhrase = (routingKey: string): string =>
  routingKey === '' ? 'the empty key' : `the key ${quoted(routingKey)}`;
const sentenceStart = (phrase: string): string => phrase.charAt(0).toUpperCase() + phrase.slice(1);

/** Which word of a key of `count` words is meant, as it is said: `the last word`, `word 2`. */
function ordinal(index: number, count: number): string {
  if (count === 1) {
    return 'the only word';
  }
  if (index === 0) {
    return 'the first word';
  }
  return index === count - 1 ? 'the last word' : `word ${index + 1}`;
}

/** What the wildcards of a pattern took, which is all that a match has to say beyond that it matched. */
export function wildcardWords(alignment: TopicAlignment): string[] {
  return alignment.segments.flatMap((segment) => {
    if (segment.pattern === '#') {
      return [segment.words.length === 0 ? '# took no words' : `# took ${quoted(segment.words.join('.'))}`];
    }
    return segment.pattern === '*' ? [`* took ${wordText(segment.words[0] as string)}`] : [];
  });
}

function missWords(
  miss: TopicMiss,
  bindingKey: string,
  routingKey: string,
  pattern: readonly string[],
  key: readonly string[],
): TopicWords {
  const start = `${sentenceStart(patternPhrase(bindingKey))} does not match ${keyPhrase(routingKey)}`;
  switch (miss.kind) {
    case 'word-differs': {
      const word = ordinal(miss.keyIndex, key.length);
      const [found, asked] = [wordText(key[miss.keyIndex] as string), wordText(pattern[miss.patternIndex] as string)];
      return {
        text: `${start}: ${word} of the key is ${found}, and the pattern asks for ${asked}.`,
        short: shorten(`${word.replace(/^the /, '')} is ${found}, not ${asked}`),
      };
    }
    case 'key-too-short': {
      const hasHash = pattern.includes('#');
      const emptyKey =
        miss.has === 0 && pattern.includes('*')
          ? ' An empty key has no words at all, and even a "*" needs a word (the key "a." has two, the second of them empty).'
          : '';
      return {
        text: hasHash
          ? `${start}: it needs at least ${plural(miss.needs, 'word')}, because a "#" can take any number of words but every other word of the pattern needs a word of the key, and the key has ${miss.has}.${emptyKey}`
          : `${start}: the pattern has ${plural(miss.needs, 'word')}, so the key needs ${miss.needs}, and it has ${miss.has}.${emptyKey}`,
        short: `needs ${miss.needs}${hasHash ? ' or more' : ''} words, has ${miss.has}`,
      };
    }
    case 'key-has-extra-words':
      return {
        text: `${start}: the pattern has ${plural(pattern.length, 'word')} and the key has ${key.length}, and without a "#" the key has to have as many words as the pattern.`,
        short: `key has ${key.length} words, pattern ${pattern.length}`,
      };
    case 'middle-not-found': {
      const next = pattern.indexOf('#', miss.patternIndex);
      const block = quoted(pattern.slice(miss.patternIndex, next).join('.'));
      return {
        text: `${start}: ${block} has to come between the two "#", after the start of the key and before its end, and it is not there.`,
        short: shorten(`${block} is nowhere between the ends`),
      };
    }
  }
}

/** The sentence and the short reason for a topic binding, whether it matched or not. */
export function topicWords(
  bindingKey: string,
  routingKey: string,
  pattern: readonly string[],
  key: readonly string[],
  alignment: TopicAlignment,
): TopicWords {
  if (alignment.matched) {
    const wildcards = wildcardWords(alignment);
    return {
      text:
        wildcards.length === 0
          ? `${sentenceStart(patternPhrase(bindingKey))} is ${keyPhrase(routingKey)}, word for word.`
          : `${sentenceStart(patternPhrase(bindingKey))} matches ${keyPhrase(routingKey)}: ${wildcards.join('; ')}.`,
      short: 'matches',
    };
  }
  return missWords(alignment.miss as TopicMiss, bindingKey, routingKey, pattern, key);
}
