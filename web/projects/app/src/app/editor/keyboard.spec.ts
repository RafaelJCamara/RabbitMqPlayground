import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECT_KEYS, GRAB_KEYS } from '../canvas/model/guard';
import { FLAG_SOURCES } from '../core/flags/feature-flags';
import { EditorActions } from './actions';
import {
  formatChord,
  isInCanvas,
  isTextEntry,
  KeyboardService,
  keysFor,
  keysOf,
  matches,
  SHORTCUTS,
  type Chord,
} from './keyboard';

const press = (init: KeyboardEventInit & { key: string }) => ({
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

describe('the table of shortcuts', () => {
  const rows = SHORTCUTS.flatMap((row) => row.chords.map((chord) => ({ row, chord })));
  const isSingleCharacter = (chord: Chord) => chord.key.length === 1;

  it('has one row for each thing, with a name of its own', () => {
    const ids = SHORTCUTS.map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has a chord that no other row has, so that one key never means two things', () => {
    const seen = rows.map(({ chord }) => formatChord(chord, false));

    expect(new Set(seen).size).toBe(seen.length);
  });

  it('works only on the canvas for a single character without Ctrl, Cmd or Alt (WCAG 2.1.4)', () => {
    for (const { row, chord } of rows) {
      if (isSingleCharacter(chord) && chord.mod !== true && chord.alt !== true) {
        expect(row.scope, `${row.id}: ${formatChord(chord, false)}`).toBe('canvas');
      }
    }
  });

  it('has an app row that can run, and a library row that cannot, because the library handles its own keys', () => {
    for (const row of SHORTCUTS) {
      expect(row.run !== undefined, row.id).toBe(row.owner === 'app');
    }
  });

  it('says in words what each row does, so that the hints and the cheat-sheet have something to say', () => {
    for (const row of SHORTCUTS) {
      expect(row.label, row.id).not.toBe('');
    }
  });

  it('lists the keys that the library takes itself, which the app says in its hints and never handles', () => {
    const library = SHORTCUTS.filter((row) => row.owner === 'library');

    expect(library.map((row) => [row.id, row.keys, row.chords.map((chord) => chord.key)])).toEqual([
      ['navigate', 'Arrow keys', ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']],
      ['grab', undefined, ['m']],
      ['connect', undefined, ['l']],
      ['delete', 'Delete', ['Delete', 'Backspace']],
      ['zoom', '+ and -', ['+', '-', '0']],
    ]);
  });

  it('gives the library the keys that the guard of the canvas holds back Ctrl and Cmd from, and no others', () => {
    const keysOf = (id: string) => SHORTCUTS.find((row) => row.id === id)?.chords.map((chord) => chord.key);

    expect(keysOf('grab')).toEqual(GRAB_KEYS);
    expect(keysOf('connect')).toEqual(CONNECT_KEYS);
  });

  it('has no key press that two rows both take, although a symbol is matched without Shift', () => {
    for (const { row, chord } of rows) {
      const event = press({
        key: chord.key,
        ctrlKey: chord.mod === true,
        shiftKey: chord.shift === true,
        altKey: chord.alt === true,
      });

      const taken = rows.filter((other) => matches(other.chord, event)).map((other) => other.row.id);

      expect(taken, formatChord(chord, false)).toEqual([row.id]);
    }
  });

  it('lets only a chord with Ctrl, Cmd or Alt work in a field of text, because every other key is typed there', () => {
    const inFields = SHORTCUTS.filter((row) => row.inFields === true);

    expect(inFields.map((row) => row.id)).toEqual(['commands-anywhere']);
    for (const row of inFields) {
      for (const chord of row.chords) {
        expect(chord.mod === true || chord.alt === true, row.id).toBe(true);
      }
    }
  });

  it('has the rows that ADR-0035 lists for the app, and the keys that ADR-0017 gives to the library', () => {
    const named = (id: string) => SHORTCUTS.find((row) => row.id === id);

    expect(formatChord(named('rename')!.chords[0]!, false)).toBe('F2');
    expect(formatChord(named('edit')!.chords[0]!, false)).toBe('Enter');
    expect(formatChord(named('fit')!.chords[0]!, false)).toBe('F');
    expect(formatChord(named('undo')!.chords[0]!, false)).toBe('Ctrl+Z');
    expect(named('redo')!.chords.map((chord) => formatChord(chord, false))).toEqual(['Ctrl+Shift+Z', 'Ctrl+Y']);
    expect(named('grab')!.owner).toBe('library');
    expect(named('connect')!.owner).toBe('library');
    expect(named('delete')!.owner).toBe('library');
  });

  it('has the rows that ADR-0045 and ADR-0047 add: the command bar, from the canvas and from anywhere, and the shortcuts', () => {
    const named = (id: string) => SHORTCUTS.find((row) => row.id === id);

    expect(named('commands')).toMatchObject({ label: 'Commands', scope: 'canvas', owner: 'app' });
    expect(formatChord(named('commands')!.chords[0]!, false)).toBe('/');
    expect(named('commands-anywhere')).toMatchObject({ label: 'Commands, from anywhere', scope: 'app', owner: 'app' });
    expect(formatChord(named('commands-anywhere')!.chords[0]!, false)).toBe('Ctrl+K');
    expect(formatChord(named('commands-anywhere')!.chords[0]!, true)).toBe('Cmd+K');
    expect(named('shortcuts')).toMatchObject({ label: 'Shortcuts', scope: 'canvas', owner: 'app' });
    expect(formatChord(named('shortcuts')!.chords[0]!, false)).toBe('?');
  });

  it('shows the command bar and the shortcuts for every selection, and the one that works from anywhere for none, because the hint says it already', () => {
    for (const selection of [
      { nodes: 0, edges: 0 },
      { nodes: 1, edges: 0 },
      { nodes: 0, edges: 1 },
      { nodes: 3, edges: 0 },
    ]) {
      expect(SHORTCUTS.find((row) => row.id === 'commands')!.shows(selection)).toBe(true);
      expect(SHORTCUTS.find((row) => row.id === 'shortcuts')!.shows(selection)).toBe(true);
      expect(SHORTCUTS.find((row) => row.id === 'commands-anywhere')!.shows(selection)).toBe(false);
    }
  });
});

describe('formatChord', () => {
  it('writes the modifiers, then the key, the way that a person says it', () => {
    expect(formatChord({ key: 'z', mod: true, shift: true }, false)).toBe('Ctrl+Shift+Z');
    expect(formatChord({ key: 'z', mod: true }, true)).toBe('Cmd+Z');
    expect(formatChord({ key: 'x', alt: true }, false)).toBe('Alt+X');
    expect(formatChord({ key: 'x', alt: true }, true)).toBe('Option+X');
    expect(formatChord({ key: 'F2' }, false)).toBe('F2');
    expect(formatChord({ key: 'm' }, false)).toBe('M');
  });
});

describe('keysOf and keysFor', () => {
  const row = (id: string) => SHORTCUTS.find((candidate) => candidate.id === id)!;

  it('write the keys of a row as it says them, or as its chords with "or" between them', () => {
    expect(keysOf(row('navigate'), false)).toBe('Arrow keys');
    expect(keysOf(row('redo'), false)).toBe('Ctrl+Shift+Z or Ctrl+Y');
    expect(keysOf(row('redo'), true)).toBe('Cmd+Shift+Z or Cmd+Y');
    expect(keysOf(row('fit'), false)).toBe('F');
  });

  it('write the keys of the rows that are asked for, in the order asked, with "or" between them', () => {
    expect(keysFor(['commands', 'commands-anywhere'], false)).toBe('/ or Ctrl+K');
    expect(keysFor(['commands-anywhere', 'commands'], true)).toBe('Cmd+K or /');
  });

  it('leave out an id that no row has', () => {
    expect(keysFor(['commands', 'nothing'], false)).toBe('/');
    expect(keysFor([], false)).toBe('');
  });
});

describe('matches', () => {
  it('is the same key, without case for a letter', () => {
    expect(matches({ key: 'f' }, press({ key: 'f' }))).toBe(true);
    expect(matches({ key: 'f' }, press({ key: 'F' }))).toBe(true);
    expect(matches({ key: 'F2' }, press({ key: 'F2' }))).toBe(true);
    expect(matches({ key: 'F2' }, press({ key: 'f2' }))).toBe(false);
    expect(matches({ key: 'f' }, press({ key: 'g' }))).toBe(false);
  });

  it('takes Ctrl or Cmd for the mod', () => {
    const chord: Chord = { key: 'z', mod: true };

    expect(matches(chord, press({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(matches(chord, press({ key: 'z', metaKey: true }))).toBe(true);
    expect(matches(chord, press({ key: 'z' }))).toBe(false);
  });

  it('takes Alt for a chord that names it, and not for one that does not', () => {
    expect(matches({ key: 'x', alt: true }, press({ key: 'x', altKey: true }))).toBe(true);
    expect(matches({ key: 'x', alt: true }, press({ key: 'x' }))).toBe(false);
    expect(matches({ key: 'x' }, press({ key: 'x', altKey: true }))).toBe(false);
  });

  it('does not compare Shift for a symbol, because it is Shift that makes some of them: ? on most keyboards, and / on some', () => {
    expect(matches({ key: '?' }, press({ key: '?', shiftKey: true }))).toBe(true);
    expect(matches({ key: '?' }, press({ key: '?' }))).toBe(true);
    expect(matches({ key: '/' }, press({ key: '/', shiftKey: true }))).toBe(true);
    expect(matches({ key: '/' }, press({ key: '/' }))).toBe(true);
    expect(matches({ key: '5' }, press({ key: '5', shiftKey: true }))).toBe(true);
  });

  it('still compares the other modifiers for a symbol, and Shift when the chord names it', () => {
    expect(matches({ key: '?' }, press({ key: '?', ctrlKey: true }))).toBe(false);
    expect(matches({ key: '/' }, press({ key: '/', metaKey: true }))).toBe(false);
    expect(matches({ key: '/' }, press({ key: '/', altKey: true }))).toBe(false);
    expect(matches({ key: '+', shift: true }, press({ key: '+' }))).toBe(false);
    expect(matches({ key: '+', shift: true }, press({ key: '+', shiftKey: true }))).toBe(true);
  });

  it('still compares Shift for a letter, and for a key with a name, which Shift makes another shortcut of', () => {
    expect(matches({ key: 'k', mod: true }, press({ key: 'K', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches({ key: 'F2' }, press({ key: 'F2', shiftKey: true }))).toBe(false);
    expect(matches({ key: 'Enter' }, press({ key: 'Enter', shiftKey: true }))).toBe(false);
  });

  it('wants exactly the modifiers that the chord names, so a single key never matches with one held', () => {
    expect(matches({ key: 'f' }, press({ key: 'f', ctrlKey: true }))).toBe(false);
    expect(matches({ key: 'f' }, press({ key: 'f', metaKey: true }))).toBe(false);
    expect(matches({ key: 'f' }, press({ key: 'f', altKey: true }))).toBe(false);
    expect(matches({ key: 'f' }, press({ key: 'f', shiftKey: true }))).toBe(false);
    expect(matches({ key: 'z', mod: true }, press({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(matches({ key: 'z', mod: true, shift: true }, press({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe(
      true,
    );
    expect(matches({ key: 'z', mod: true }, press({ key: 'z', ctrlKey: true, altKey: true }))).toBe(false);
  });
});

describe('isTextEntry', () => {
  const html = (markup: string): Element => {
    const host = document.createElement('div');
    host.innerHTML = markup;
    document.body.append(host);
    return host.firstElementChild as Element;
  };

  it.each([
    ['a text field', '<input type="text">'],
    ['a field with no type, which is text', '<input>'],
    ['a number field', '<input type="number">'],
    ['a search field', '<input type="search">'],
    ['an area of text', '<textarea></textarea>'],
    ['a list that opens', '<select><option>a</option></select>'],
    ['something that can be edited', '<div contenteditable="true">x</div>'],
    ['a box with the role of a text box', '<div role="textbox"></div>'],
    ['a combo box', '<div role="combobox"></div>'],
    ['a spin button', '<div role="spinbutton"></div>'],
  ])('is true for %s', (_, markup) => {
    expect(isTextEntry(html(markup))).toBe(true);
  });

  it.each([
    ['a button', '<button>x</button>'],
    ['a check box', '<input type="checkbox">'],
    ['a radio button', '<input type="radio">'],
    ['a range', '<input type="range">'],
    ['a plain element', '<div>x</div>'],
    ['something that cannot be edited', '<div contenteditable="false">x</div>'],
  ])('is false for %s', (_, markup) => {
    expect(isTextEntry(html(markup))).toBe(false);
  });

  it('is true for what is inside something that is typed into, and false for nothing', () => {
    const editable = html('<div contenteditable="true"><span id="inner">x</span></div>');

    expect(isTextEntry(editable.querySelector('#inner'))).toBe(true);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry(document)).toBe(false);
  });
});

describe('isInCanvas', () => {
  it('is true for the canvas and what is in it, and false for what is not', () => {
    document.body.innerHTML = `<rmq-flow-canvas><f-flow tabindex="0"><div id="node"></div></f-flow></rmq-flow-canvas><button id="outside"></button>`;

    expect(isInCanvas(document.querySelector('f-flow'))).toBe(true);
    expect(isInCanvas(document.getElementById('node'))).toBe(true);
    expect(isInCanvas(document.getElementById('outside'))).toBe(false);
    expect(isInCanvas(null)).toBe(false);
  });
});

describe('KeyboardService', () => {
  /** The feature flags that are on, as the address says them. */
  let flags: string | null = null;
  let actions: Record<
    | 'undo'
    | 'redo'
    | 'fit'
    | 'renameSelected'
    | 'editSelected'
    | 'openCommandBar'
    | 'openCheatSheet'
    | 'togglePlay'
    | 'step'
    | 'publishSelected',
    ReturnType<typeof vi.fn>
  >;
  let service: KeyboardService;
  let root: HTMLElement;

  /** The page that a key is pressed in, with a listener on the root of the editor as the editor has. */
  const mount = (): void => {
    document.body.innerHTML = `
      <div id="root" tabindex="-1">
        <aside><button id="toolbox-button">Queue</button></aside>
        <rmq-flow-canvas><f-flow id="flow" tabindex="0"><div id="node"></div></f-flow></rmq-flow-canvas>
        <aside><input id="name" type="text"><input id="box" type="checkbox"><select id="type"></select></aside>
      </div>`;
    root = document.getElementById('root')!;
    root.addEventListener('keydown', (event) => service.handle(event));
  };

  beforeEach(() => {
    actions = {
      undo: vi.fn(),
      redo: vi.fn(),
      fit: vi.fn(),
      renameSelected: vi.fn(),
      editSelected: vi.fn(() => true),
      openCommandBar: vi.fn(),
      openCheatSheet: vi.fn(),
      togglePlay: vi.fn(),
      step: vi.fn(),
      publishSelected: vi.fn(() => true),
    };
    TestBed.configureTestingModule({
      providers: [
        KeyboardService,
        { provide: EditorActions, useValue: actions },
        { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
      ],
    });
    service = TestBed.inject(KeyboardService);
    mount();
  });

  /** Sends a key to an element, as the browser does, and answers whether the page was left to act on it. */
  const send = (id: string, init: KeyboardEventInit & { key: string }): { prevented: boolean } => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.getElementById(id)!.dispatchEvent(event);
    return { prevented: event.defaultPrevented };
  };

  describe('a single key, which is for the canvas', () => {
    it('renames what is selected on F2, and keeps the page from acting on the key', () => {
      const { prevented } = send('flow', { key: 'F2' });

      expect(actions.renameSelected).toHaveBeenCalledOnce();
      expect(prevented).toBe(true);
    });

    it('works from something inside the canvas too, such as a node', () => {
      send('node', { key: 'F2' });

      expect(actions.renameSelected).toHaveBeenCalledOnce();
    });

    it('fits the canvas on F, in either case', () => {
      send('flow', { key: 'f' });
      send('flow', { key: 'F' });

      expect(actions.fit).toHaveBeenCalledTimes(2);
    });

    it('edits what is selected on Enter, and leaves the key to the page when there was nothing to edit', () => {
      expect(send('flow', { key: 'Enter' }).prevented).toBe(true);
      actions.editSelected.mockReturnValue(false);
      expect(send('flow', { key: 'Enter' }).prevented).toBe(false);
      expect(actions.editSelected).toHaveBeenCalledTimes(2);
    });

    it('does nothing outside the canvas, where a single key is not a shortcut', () => {
      for (const key of ['F2', 'f', 'Enter']) {
        send('toolbox-button', { key });
      }

      expect(actions.renameSelected).not.toHaveBeenCalled();
      expect(actions.fit).not.toHaveBeenCalled();
      expect(actions.editSelected).not.toHaveBeenCalled();
    });

    it('does nothing in a text field, where the key is typed', () => {
      for (const id of ['name', 'type']) {
        send(id, { key: 'f' });
        send(id, { key: 'F2' });
      }

      expect(actions.fit).not.toHaveBeenCalled();
      expect(actions.renameSelected).not.toHaveBeenCalled();
    });

    it('does nothing with a modifier held, because that is another key', () => {
      send('flow', { key: 'f', ctrlKey: true });
      send('flow', { key: 'f', metaKey: true });
      send('flow', { key: 'f', altKey: true });
      send('flow', { key: 'F2', ctrlKey: true });

      expect(actions.fit).not.toHaveBeenCalled();
      expect(actions.renameSelected).not.toHaveBeenCalled();
    });
  });

  describe('the keys of the simulation (ADR-0054)', () => {
    it('are left to the page without the flag: Space, the full stop and P are not taken, and nothing is run', () => {
      expect(send('flow', { key: ' ' }).prevented).toBe(false);
      expect(send('flow', { key: '.' }).prevented).toBe(false);
      expect(send('flow', { key: 'p' }).prevented).toBe(false);

      expect(actions.togglePlay).not.toHaveBeenCalled();
      expect(actions.step).not.toHaveBeenCalled();
      expect(actions.publishSelected).not.toHaveBeenCalled();
    });

    describe('with the flag', () => {
      beforeEach(() => {
        TestBed.resetTestingModule();
        flags = 'simulation';
        TestBed.configureTestingModule({
          providers: [
            KeyboardService,
            { provide: EditorActions, useValue: actions },
            { provide: FLAG_SOURCES, useValue: { stored: null, query: flags } },
          ],
        });
        service = TestBed.inject(KeyboardService);
        mount();
      });

      afterEach(() => {
        flags = null;
      });

      it('play or pause on Space, with the key that asked, and keep the page from scrolling', () => {
        const { prevented } = send('flow', { key: ' ' });

        expect(prevented).toBe(true);
        expect(actions.togglePlay).toHaveBeenCalledWith('key');
      });

      it('step on the full stop', () => {
        const { prevented } = send('node', { key: '.' });

        expect(prevented).toBe(true);
        expect(actions.step).toHaveBeenCalledWith('key');
      });

      it('publish on P, in either case, and leave the key to the page when what is selected is not a producer', () => {
        expect(send('flow', { key: 'p' }).prevented).toBe(true);
        expect(send('flow', { key: 'P', shiftKey: true }).prevented).toBe(false);
        actions.publishSelected.mockReturnValue(false);

        expect(send('flow', { key: 'p' }).prevented).toBe(false);
        expect(actions.publishSelected).toHaveBeenCalledWith('key');
      });

      it('do nothing outside the canvas, where a single key is not a shortcut, and in a text field, where it is typed', () => {
        send('toolbox-button', { key: ' ' });
        send('name', { key: ' ' });
        send('name', { key: '.' });
        send('name', { key: 'p' });

        expect(actions.togglePlay).not.toHaveBeenCalled();
        expect(actions.step).not.toHaveBeenCalled();
        expect(actions.publishSelected).not.toHaveBeenCalled();
      });

      it('do nothing with a modifier held, because that is another key', () => {
        send('flow', { key: ' ', ctrlKey: true });
        send('flow', { key: '.', altKey: true });
        send('flow', { key: 'p', metaKey: true });

        expect(actions.togglePlay).not.toHaveBeenCalled();
        expect(actions.step).not.toHaveBeenCalled();
        expect(actions.publishSelected).not.toHaveBeenCalled();
      });
    });
  });

  describe('the command bar and the cheat-sheet (ADR-0045, ADR-0047)', () => {
    it('opens the command bar on /, on the canvas, and keeps the page from typing the slash into the field that it opens', () => {
      const { prevented } = send('flow', { key: '/' });

      expect(actions.openCommandBar).toHaveBeenCalledOnce();
      expect(prevented).toBe(true);
    });

    it('opens it on / that needs Shift to be typed, as it does on some keyboards', () => {
      send('flow', { key: '/', shiftKey: true });

      expect(actions.openCommandBar).toHaveBeenCalledOnce();
    });

    it('opens the cheat-sheet on ?, with Shift as it is typed on most keyboards and without it as on others', () => {
      send('flow', { key: '?', shiftKey: true });
      send('flow', { key: '?' });

      expect(actions.openCheatSheet).toHaveBeenCalledTimes(2);
      expect(actions.openCommandBar).not.toHaveBeenCalled();
    });

    it('does nothing with / and ? outside the canvas, or in a field of text, where they are typed', () => {
      for (const key of ['/', '?']) {
        send('toolbox-button', { key });
        send('name', { key });
        send('type', { key });
      }

      expect(actions.openCommandBar).not.toHaveBeenCalled();
      expect(actions.openCheatSheet).not.toHaveBeenCalled();
    });

    it('does nothing with / and ? when a modifier is held, because that is another key', () => {
      send('flow', { key: '/', ctrlKey: true });
      send('flow', { key: '?', metaKey: true });
      send('flow', { key: '/', altKey: true });

      expect(actions.openCommandBar).not.toHaveBeenCalled();
      expect(actions.openCheatSheet).not.toHaveBeenCalled();
    });

    it('opens the command bar on Ctrl+K and Cmd+K, from the canvas and from outside it', () => {
      send('flow', { key: 'k', ctrlKey: true });
      send('toolbox-button', { key: 'K', metaKey: true });

      expect(actions.openCommandBar).toHaveBeenCalledTimes(2);
    });

    it('opens it from a field of text too, which has no use for Ctrl+K, and keeps the browser from taking the key for its address bar', () => {
      const { prevented } = send('name', { key: 'k', ctrlKey: true });
      send('type', { key: 'k', metaKey: true });

      expect(actions.openCommandBar).toHaveBeenCalledTimes(2);
      expect(prevented).toBe(true);
    });

    it('leaves Ctrl+Shift+K to the browser', () => {
      send('flow', { key: 'K', ctrlKey: true, shiftKey: true });

      expect(actions.openCommandBar).not.toHaveBeenCalled();
    });

    it('still leaves Ctrl+Z to a field of text, because only the row for the command bar works in one', () => {
      send('name', { key: 'z', ctrlKey: true });

      expect(actions.undo).not.toHaveBeenCalled();
    });
  });

  describe('undo and redo, which are for the whole editor', () => {
    it('undoes on Ctrl+Z or Cmd+Z, from the canvas and from outside it', () => {
      send('flow', { key: 'z', ctrlKey: true });
      send('toolbox-button', { key: 'z', metaKey: true });

      expect(actions.undo).toHaveBeenCalledTimes(2);
    });

    it('redoes on Ctrl+Shift+Z and on Ctrl+Y', () => {
      send('flow', { key: 'Z', ctrlKey: true, shiftKey: true });
      send('toolbox-button', { key: 'y', ctrlKey: true });

      expect(actions.redo).toHaveBeenCalledTimes(2);
      expect(actions.undo).not.toHaveBeenCalled();
    });

    it('leaves Ctrl+Z to a text field, where it undoes the typing', () => {
      const { prevented } = send('name', { key: 'z', ctrlKey: true });

      expect(actions.undo).not.toHaveBeenCalled();
      expect(prevented).toBe(false);
    });

    it('leaves the key alone with Alt held', () => {
      send('flow', { key: 'z', ctrlKey: true, altKey: true });

      expect(actions.undo).not.toHaveBeenCalled();
    });

    it('works from a check box, which is not typed into', () => {
      send('box', { key: 'z', ctrlKey: true });

      expect(actions.undo).toHaveBeenCalledOnce();
    });
  });

  describe('a key that is not for the service', () => {
    it('is left alone when the library used it, which it says by preventing its default', () => {
      document.getElementById('flow')!.addEventListener('keydown', (event) => event.preventDefault());

      send('flow', { key: 'F2' });
      send('flow', { key: 'z', ctrlKey: true });

      expect(actions.renameSelected).not.toHaveBeenCalled();
      expect(actions.undo).not.toHaveBeenCalled();
    });

    it('is left alone when it repeats, because a key that is held must not rename thirty times', () => {
      send('flow', { key: 'F2', repeat: true });

      expect(actions.renameSelected).not.toHaveBeenCalled();
    });

    it('is left alone while an input method is composing', () => {
      send('flow', { key: 'f', isComposing: true });

      expect(actions.fit).not.toHaveBeenCalled();
    });

    it('is left alone when no row is for it, and the page may act on it', () => {
      const { prevented } = send('flow', { key: 'q' });

      expect(prevented).toBe(false);
    });

    it('is left alone when it belongs to the library, which handles M, L, the arrows and Delete itself', () => {
      for (const key of ['m', 'l', 'ArrowRight', 'Delete', 'Backspace', '+', '-', '0']) {
        expect(send('flow', { key }).prevented, key).toBe(false);
      }
    });
  });
});
