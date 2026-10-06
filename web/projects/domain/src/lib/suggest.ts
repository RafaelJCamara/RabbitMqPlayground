/**
 * "Did you mean": the names that are close to one that was typed. It is deterministic, so that the same mistake always
 * gets the same suggestions, and it is case-blind, because `Orders` for `orders` is the commonest slip.
 */

/**
 * The number of edits that turn one text into the other, where an edit is a character added, removed or changed, or two
 * neighbouring characters swapped (the optimal string alignment distance). Case counts as no difference.
 */
export function editDistance(a: string, b: string): number {
  const left = [...a.toLowerCase()];
  const right = [...b.toLowerCase()];
  // distance[i][j] is the distance between the first i characters of one text and the first j of the other.
  const distance: number[][] = Array.from({ length: left.length + 1 }, (_, i) =>
    Array.from({ length: right.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  const at = (i: number, j: number): number => (distance[i] as number[])[j] as number;
  for (let i = 1; i <= left.length; i++) {
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      let best = Math.min(
        at(i - 1, j) + 1, // a character removed
        at(i, j - 1) + 1, // a character added
        at(i - 1, j - 1) + cost, // a character changed
      );
      if (i > 1 && j > 1 && left[i - 1] === right[j - 2] && left[i - 2] === right[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1); // two neighbours swapped
      }
      (distance[i] as number[])[j] = best;
    }
  }
  return at(left.length, right.length);
}

/** How many edits away a candidate may be: none for a very short word, and one more for every three characters. */
const allowedEdits = (input: string): number => Math.min(3, Math.floor([...input].length / 3));

/**
 * The candidates that `input` was probably meant to be, closest first and then in alphabetical order, at most `limit`.
 * A candidate is probably meant when a few edits turn the input into it, or when it starts with what was typed (two
 * characters or more). The input itself is not a suggestion, unless it differs from the candidate in case.
 */
export function suggest(input: string, candidates: readonly string[], limit = 3): string[] {
  if (input === '') {
    return [];
  }
  const typed = input.toLowerCase();
  const allowed = allowedEdits(input);
  return [...new Set(candidates)]
    .filter((candidate) => candidate !== '' && candidate !== input)
    .map((candidate) => ({ candidate, distance: editDistance(input, candidate) }))
    .filter(
      ({ candidate, distance }) =>
        distance <= allowed || (typed.length >= 2 && candidate.toLowerCase().startsWith(typed)),
    )
    .sort((a, b) => a.distance - b.distance || (a.candidate < b.candidate ? -1 : 1))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}
