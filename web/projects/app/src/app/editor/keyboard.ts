import { inject, Injectable } from '@angular/core';
import type { ElementKind } from '@rmq/domain';
import { FeatureFlags } from '../core/flags/feature-flags';
import type { FlagName } from '../core/flags/flags';
import { EditorActions } from './actions';

/**
 * The shortcuts of the editor (ADR-0017, ADR-0035), as a table that the keyboard service reads and the hint bar, and later the
 * cheat-sheet, are made from. A slice that adds a key adds a row.
 *
 * A row is owned by the app, which handles it (it has `run`), or by the library inside the canvas, which handles it itself and is
 * listed so that the hints can say what the keys do. The service never matches a row that has no `run`.
 */

/** `canvas` works while the focus is on the canvas, `app` anywhere in the editor. */
export type Scope = 'canvas' | 'app';

export interface Chord {
  /** The `key` of the event, as it is written for a letter in lower case, and `F2` or `Enter` for a key with a name. */
  readonly key: string;
  /** Ctrl, or Cmd on a Mac. */
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

/** What is selected, as far as a shortcut cares about it. */
export interface SelectionFacts {
  readonly nodes: number;
  readonly edges: number;
  /** The kind of the node, when exactly one node is selected. */
  readonly kind?: ElementKind;
}

export interface Shortcut {
  readonly id: string;
  /** What it does, in words: `Rename`. */
  readonly label: string;
  readonly chords: readonly Chord[];
  /** How the keys are written, for a row that has several: `Arrow keys`. Left out, it is the first chord. */
  readonly keys?: string;
  readonly scope: Scope;
  /**
   * Whether it works while the cursor is in a field of text, which every other row leaves to the field (ADR-0035). Only a chord with Ctrl, Cmd or Alt can, because
   * anything else is typed there, and only one that the field has no use for: Ctrl+K opens the command bar from anywhere (ADR-0045).
   */
  readonly inFields?: boolean;
  readonly owner: 'app' | 'library';
  /** The feature flag that the row is for, or the flags, all of which have to be on (ADR-0004). Without them the key is the page's, and the hint bar and the cheat-sheet do not say it. */
  readonly flag?: FlagName | readonly FlagName[];
  /** Whether it is worth showing for this selection. */
  readonly shows: (selection: SelectionFacts) => boolean;
  /** What the app does. It answers `false` when it had nothing to do, so that the key is left for the page. */
  readonly run?: (actions: EditorActions) => boolean | void;
}

const always = (): boolean => true;
const something = (selection: SelectionFacts): boolean => selection.nodes + selection.edges > 0;
const oneNode = (selection: SelectionFacts): boolean => selection.nodes === 1 && selection.edges === 0;
const oneProducer = (selection: SelectionFacts): boolean => oneNode(selection) && selection.kind === 'producer';

export const SHORTCUTS: readonly Shortcut[] = [
  {
    id: 'navigate',
    label: 'Move between nodes',
    chords: [{ key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'ArrowLeft' }, { key: 'ArrowRight' }],
    keys: 'Arrow keys',
    scope: 'canvas',
    owner: 'library',
    shows: always,
  },
  {
    id: 'grab',
    label: 'Move with the arrow keys',
    chords: [{ key: 'm' }],
    scope: 'canvas',
    owner: 'library',
    shows: (selection) => selection.nodes > 0,
  },
  {
    id: 'connect',
    label: 'Link to another node',
    chords: [{ key: 'l' }],
    scope: 'canvas',
    owner: 'library',
    // A consumer is where a message ends, so nothing can be linked from it.
    shows: (selection) => oneNode(selection) && selection.kind !== 'consumer',
  },
  {
    id: 'rename',
    label: 'Rename',
    chords: [{ key: 'F2' }],
    scope: 'canvas',
    owner: 'app',
    shows: oneNode,
    run: (actions) => actions.renameSelected(),
  },
  {
    id: 'edit',
    label: 'Edit in the inspector',
    chords: [{ key: 'Enter' }],
    scope: 'canvas',
    owner: 'app',
    shows: something,
    run: (actions) => actions.editSelected(),
  },
  {
    id: 'delete',
    label: 'Delete',
    chords: [{ key: 'Delete' }, { key: 'Backspace' }],
    keys: 'Delete',
    scope: 'canvas',
    owner: 'library',
    shows: something,
  },
  {
    id: 'fit',
    label: 'Fit the canvas',
    chords: [{ key: 'f' }],
    scope: 'canvas',
    owner: 'app',
    shows: always,
    run: (actions) => actions.fit(),
  },
  {
    id: 'play',
    label: 'Play or pause the simulation',
    chords: [{ key: ' ' }],
    keys: 'Space',
    scope: 'canvas',
    owner: 'app',
    flag: 'simulation',
    shows: always,
    run: (actions) => actions.togglePlay('key'),
  },
  {
    id: 'step',
    label: 'Step to the next event',
    chords: [{ key: '.' }],
    scope: 'canvas',
    owner: 'app',
    flag: 'simulation',
    shows: always,
    run: (actions) => actions.step('key'),
  },
  {
    id: 'publish',
    label: 'Publish from the producer',
    chords: [{ key: 'p' }],
    scope: 'canvas',
    owner: 'app',
    flag: 'simulation',
    shows: oneProducer,
    run: (actions) => actions.publishSelected('key'),
  },
  {
    id: 'event-log',
    label: 'Show or hide the event log',
    chords: [{ key: 'e' }],
    scope: 'canvas',
    owner: 'app',
    // A log is made of what the simulation does, so with the explanation alone there is none to show, and the key is not offered (ADR-0064).
    flag: ['simulation', 'explain'],
    shows: always,
    run: (actions) => actions.toggleEventLog(),
  },
  {
    id: 'zoom',
    label: 'Zoom',
    chords: [{ key: '+' }, { key: '-' }, { key: '0' }],
    keys: '+ and -',
    scope: 'canvas',
    owner: 'library',
    shows: (selection) => !something(selection),
  },
  {
    id: 'undo',
    label: 'Undo',
    chords: [{ key: 'z', mod: true }],
    scope: 'app',
    owner: 'app',
    shows: always,
    run: (actions) => actions.undo('key'),
  },
  {
    id: 'redo',
    label: 'Redo',
    chords: [
      { key: 'z', mod: true, shift: true },
      { key: 'y', mod: true },
    ],
    scope: 'app',
    owner: 'app',
    shows: always,
    run: (actions) => actions.redo('key'),
  },
  {
    id: 'commands',
    label: 'Commands',
    chords: [{ key: '/' }],
    scope: 'canvas',
    owner: 'app',
    shows: always,
    run: (actions) => actions.openCommandBar(),
  },
  {
    // The hint bar says `/`, and the cheat-sheet lists this one too.
    id: 'commands-anywhere',
    label: 'Commands, from anywhere',
    chords: [{ key: 'k', mod: true }],
    scope: 'app',
    inFields: true,
    owner: 'app',
    shows: () => false,
    run: (actions) => actions.openCommandBar(),
  },
  {
    id: 'shortcuts',
    label: 'Shortcuts',
    chords: [{ key: '?' }],
    scope: 'canvas',
    owner: 'app',
    shows: always,
    run: (actions) => actions.openCheatSheet(),
  },
];

/** Whether a row is for the page that this is: it has no flag, or its flag is on, or every one of its flags is. */
export const available = (row: Shortcut, enabled: readonly FlagName[]): boolean =>
  row.flag === undefined || [row.flag].flat().every((flag) => enabled.includes(flag));

const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** A chord as it is written for a person: `Ctrl+Shift+Z`, `F2`, `M`. */
export function formatChord(chord: Chord, mac: boolean = isMac()): string {
  const parts = [
    ...(chord.mod === true ? [mac ? 'Cmd' : 'Ctrl'] : []),
    ...(chord.alt === true ? [mac ? 'Option' : 'Alt'] : []),
    ...(chord.shift === true ? ['Shift'] : []),
    chord.key === ' ' ? 'Space' : chord.key.length === 1 ? chord.key.toUpperCase() : chord.key,
  ];
  return parts.join('+');
}

/** The keys of a row as a person is told them: the words that it has, or its chords with "or" between them. */
export function keysOf(row: Shortcut, mac?: boolean): string {
  return row.keys ?? row.chords.map((chord) => formatChord(chord, mac)).join(' or ');
}

/** The keys of the rows with these ids, in the order given, with "or" between them. An id that no row has is left out. */
export function keysFor(ids: readonly string[], mac?: boolean): string {
  return ids
    .flatMap((id) => SHORTCUTS.filter((row) => row.id === id))
    .map((row) => keysOf(row, mac))
    .join(' or ');
}

const normal = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

/** A character that has no case: a digit or a punctuation mark, which Shift may be what types on this keyboard. */
const isSymbol = (key: string): boolean => key.length === 1 && key.toLowerCase() === key.toUpperCase();

/**
 * Whether a key press is this chord: the same key, without case for a letter, and exactly the modifiers that the chord names. Shift is not compared for a symbol
 * unless the chord names it, because it is Shift that types `?` on most keyboards and `/` on some (ADR-0047). A letter and a key with a name keep it, because
 * Shift makes Ctrl+Shift+Z another shortcut than Ctrl+Z.
 */
export function matches(
  chord: Chord,
  event: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>,
): boolean {
  return (
    normal(event.key) === normal(chord.key) &&
    (event.ctrlKey || event.metaKey) === (chord.mod === true) &&
    (event.shiftKey === (chord.shift === true) || (isSymbol(chord.key) && chord.shift === undefined)) &&
    event.altKey === (chord.alt === true)
  );
}

/** What a person types into: a field of text, a number, a list that opens, or something that can be edited. */
const TEXT_ENTRY =
  'textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="spinbutton"], [role="searchbox"], ' +
  'input:not([type="button"], [type="checkbox"], [type="radio"], [type="submit"], [type="reset"], [type="range"], [type="file"], [type="color"], [type="image"], [type="hidden"])';

export function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TEXT_ENTRY) !== null;
}

/** Whether the event is for the canvas: its target is the canvas, or something in it. */
export function isInCanvas(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('rmq-flow-canvas') !== null;
}

/**
 * The keyboard of the app (ADR-0035): one listener, in the bubble phase, on the root of the editor, which is after the library inside it
 * has had its turn. A key that the library used is `defaultPrevented` and is left alone, and so is a key that goes into a text
 * field (but for a row that says it works there), one that repeats, and one that an input method is still composing. A single character
 * works only on the canvas (WCAG 2.1.4), and never with a modifier.
 */
@Injectable()
export class KeyboardService {
  private readonly actions = inject(EditorActions);
  private readonly flags = inject(FeatureFlags);

  handle(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.repeat) {
      return;
    }
    const inField = isTextEntry(event.target);
    const inCanvas = isInCanvas(event.target);
    const shortcut = SHORTCUTS.find(
      (row) =>
        row.run !== undefined &&
        available(row, this.flags.enabled) &&
        (!inField || row.inFields === true) &&
        (row.scope === 'app' || inCanvas) &&
        row.chords.some((chord) => matches(chord, event)),
    );
    if (shortcut?.run !== undefined && shortcut.run(this.actions) !== false) {
      event.preventDefault();
    }
  }
}
