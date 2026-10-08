import type { RestoreReport } from '@rmq/persistence';
import { describe, expect, it } from 'vitest';
import { backupDone, PROBLEMS_SHOWN, restoreView } from './backup-words';

const nothing: RestoreReport = { restored: [], alreadyHere: [], copies: [], unreadable: [], failed: [] };
const report = (change: Partial<RestoreReport>): RestoreReport => ({ ...nothing, ...change });
const some = (count: number, name = 'Canvas') =>
  Array.from({ length: count }, (_, index) => ({ id: `c${index}`, name: `${name} ${index}` }));

describe('backupDone (ADR-0075)', () => {
  const advice = 'Keep the file somewhere other than this device too: a backup beside the canvases is lost with them.';

  it('says how many canvases, to what file, and to keep the file somewhere else', () => {
    expect(backupDone({ file: 'rmq-playground-backup-2026-10-08.json', count: 5, left: 0 })).toBe(
      `Backed up 5 canvases to rmq-playground-backup-2026-10-08.json. ${advice}`,
    );
  });

  it('says "1 canvas" for one', () => {
    expect(backupDone({ file: 'b.json', count: 1, left: 0 })).toBe(`Backed up 1 canvas to b.json. ${advice}`);
  });

  it('says how many could not be opened and are not in the file, in the singular and the plural', () => {
    expect(backupDone({ file: 'b.json', count: 5, left: 1 })).toBe(
      `Backed up 5 canvases to b.json. 1 canvas could not be opened and is not in the file. ${advice}`,
    );
    expect(backupDone({ file: 'b.json', count: 5, left: 2 })).toBe(
      `Backed up 5 canvases to b.json. 2 canvases could not be opened and are not in the file. ${advice}`,
    );
  });
});

describe('restoreView (ADR-0075)', () => {
  it('says that the backup holds no canvases when nothing was in it', () => {
    expect(restoreView(nothing)).toEqual({ summary: ['The backup holds no canvases.'], problems: [], more: 0 });
  });

  it('says what was put back', () => {
    expect(restoreView(report({ restored: some(1) })).summary).toEqual(['Put back 1 canvas.']);
    expect(restoreView(report({ restored: some(3) })).summary).toEqual(['Put back 3 canvases.']);
  });

  it('says what was already here and was left as it is', () => {
    expect(restoreView(report({ alreadyHere: some(1) })).summary).toEqual([
      '1 canvas was already here, and was left as it is.',
    ]);
    expect(restoreView(report({ alreadyHere: some(2) })).summary).toEqual([
      '2 canvases were already here, and were left as they are.',
    ]);
  });

  it('says which canvases were added as copies, by the names they have now', () => {
    const one = restoreView(report({ copies: [{ id: 'n1', name: 'Orders (restored)', of: 'Orders' }] }));
    expect(one.summary).toEqual([
      '1 canvas has the id of a canvas that is here and is different, so it was added as a new canvas: “Orders (restored)”.',
    ]);

    const two = restoreView(
      report({
        copies: [
          { id: 'n1', name: 'A (restored)', of: 'A' },
          { id: 'n2', name: 'B (restored)', of: 'B' },
        ],
      }),
    );
    expect(two.summary).toEqual([
      '2 canvases have the ids of canvases that are here and are different, so they were added as new canvases: “A (restored)”, “B (restored)”.',
    ]);
  });

  it('names the first five copies and counts the rest', () => {
    const copies = Array.from({ length: 7 }, (_, index) => ({
      id: `n${index}`,
      name: `C${index} (restored)`,
      of: `C${index}`,
    }));

    expect(restoreView(report({ copies })).summary[0]).toContain(
      '“C0 (restored)”, “C1 (restored)”, “C2 (restored)”, “C3 (restored)”, “C4 (restored)” and 2 more.',
    );
    expect(restoreView(report({ copies: copies.slice(0, 5) })).summary[0]).toContain('“C4 (restored)”.');
  });

  it('says that the browser ran out of room, how many were not put back, and what the browser said', () => {
    expect(restoreView(report({ outOfRoom: { message: 'No room left.', notPutBack: 1 } })).summary).toEqual([
      'The browser ran out of room, so 1 canvas was not put back. No room left.',
    ]);
    expect(restoreView(report({ outOfRoom: { message: 'No room left.', notPutBack: 4 } })).summary).toEqual([
      'The browser ran out of room, so 4 canvases were not put back. No room left.',
    ]);
  });

  it('lists a canvas that could not be read by its place and its name, or by its place alone, with the reason', () => {
    const view = restoreView(
      report({
        restored: some(1),
        unreadable: [
          { position: 3, name: 'Broken', message: 'It was saved by a newer version.' },
          { position: 5, message: 'It is not valid.' },
        ],
      }),
    );

    expect(view.summary).toEqual(['Put back 1 canvas.']);
    expect(view.problems).toEqual([
      'Canvas 3 “Broken” could not be read. It was saved by a newer version.',
      'Canvas 5 could not be read. It is not valid.',
    ]);
  });

  it('lists a canvas that could not be put back, with the reason', () => {
    const view = restoreView(report({ failed: [{ name: 'Orders', message: 'The browser failed.' }] }));

    expect(view.problems).toEqual(['“Orders” could not be put back. The browser failed.']);
    expect(view.summary).toEqual([]);
  });

  it('has no sentence about an empty backup when the only thing in it could not be read', () => {
    const view = restoreView(report({ unreadable: [{ position: 1, message: 'Newer.' }] }));

    expect(view.summary).toEqual([]);
    expect(view.problems).toHaveLength(1);
  });

  it('lists at most 20 problems and counts the rest', () => {
    const unreadable = Array.from({ length: 23 }, (_, index) => ({ position: index + 1, message: 'Bad.' }));

    const view = restoreView(report({ unreadable }));

    expect(PROBLEMS_SHOWN).toBe(20);
    expect(view.problems).toHaveLength(20);
    expect(view.problems[19]).toBe('Canvas 20 could not be read. Bad.');
    expect(view.more).toBe(3);
  });

  it('has no more when there are exactly 20 problems', () => {
    const unreadable = Array.from({ length: 20 }, (_, index) => ({ position: index + 1, message: 'Bad.' }));

    expect(restoreView(report({ unreadable })).more).toBe(0);
  });

  it('puts what was done before what went wrong, in the order of the report', () => {
    const view = restoreView(
      report({
        restored: some(2),
        alreadyHere: some(1),
        copies: [{ id: 'n', name: 'X (restored)', of: 'X' }],
        outOfRoom: { message: 'No room.', notPutBack: 2 },
        failed: [{ name: 'Y', message: 'Failed.' }],
      }),
    );

    expect(view.summary.map((line) => line.split(' ').slice(0, 2).join(' '))).toEqual([
      'Put back',
      '1 canvas',
      '1 canvas',
      'The browser',
    ]);
  });
});
