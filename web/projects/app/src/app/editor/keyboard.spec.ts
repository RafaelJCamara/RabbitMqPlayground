import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorActions } from './actions';
import { formatChord, isInCanvas, isTextEntry, KeyboardService, matches, SHORTCUTS, type Chord } from './keyboard';

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
  let actions: Record<'undo' | 'redo' | 'fit' | 'renameSelected' | 'editSelected', ReturnType<typeof vi.fn>>;
  let service: KeyboardService;
  let root: HTMLElement;

  beforeEach(() => {
    actions = {
      undo: vi.fn(),
      redo: vi.fn(),
      fit: vi.fn(),
      renameSelected: vi.fn(),
      editSelected: vi.fn(() => true),
    };
    TestBed.configureTestingModule({
      providers: [KeyboardService, { provide: EditorActions, useValue: actions }],
    });
    service = TestBed.inject(KeyboardService);
    document.body.innerHTML = `
      <div id="root" tabindex="-1">
        <aside><button id="toolbox-button">Queue</button></aside>
        <rmq-flow-canvas><f-flow id="flow" tabindex="0"><div id="node"></div></f-flow></rmq-flow-canvas>
        <aside><input id="name" type="text"><input id="box" type="checkbox"><select id="type"></select></aside>
      </div>`;
    root = document.getElementById('root')!;
    root.addEventListener('keydown', (event) => service.handle(event));
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
