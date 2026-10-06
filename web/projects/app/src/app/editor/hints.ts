import { formatChord, SHORTCUTS, type SelectionFacts } from './keyboard';

/** One thing to tell the learner about the keys: `F2` and what it does. */
export interface Hint {
  readonly id: string;
  readonly keys: string;
  readonly label: string;
}

/**
 * What the keys do now (ADR-0035): the rows of the table of shortcuts that are worth showing for this selection, in the order of the
 * table. It is the hint bar's text, as a function of what is selected, so that it is tested, and so that a key that is added to the
 * table shows up in it.
 */
export function hintsFor(selection: SelectionFacts, mac?: boolean): Hint[] {
  return SHORTCUTS.filter((row) => row.shows(selection)).map((row) => ({
    id: row.id,
    keys: row.keys ?? formatChord(row.chords[0] ?? { key: '' }, mac),
    label: row.label,
  }));
}
