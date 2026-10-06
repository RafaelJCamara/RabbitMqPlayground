import type { Clear, Delete, Layout, Move, MoveLabel, Redo, Rename, Undo } from '../../commands/types';
import { ELEMENT_KINDS } from '../../document/issue';
import { LIMITS } from '../../document/schema';
import { refText, type CommandSpec } from '../spec';
import { wordText } from '../words';

/**
 * The commands about where things are, what they are called and whether they are there: move, rename, delete, clear and
 * layout, and the two that are about the history of the canvas, undo and redo.
 */

const COORDINATE = { kind: 'number', min: -LIMITS.coordinate, max: LIMITS.coordinate } as const;

/** A coordinate as it is written: a number, with the sign of a zero left out, because there is none to read back. */
const written = (value: number): string => String(value + 0);

export const move: CommandSpec<Move> = {
  name: 'move',
  type: 'move',
  scope: 'document',
  syntax: 'move <element> [x=<number>] [y=<number>]',
  summary: 'Puts a node somewhere on the canvas. A coordinate that is left out stays as it was.',
  examples: ['move billing x=640 y=120'],
  parse(cursor) {
    const target = cursor.ref(ELEMENT_KINDS, 'the element to move');
    const { options } = cursor.options({
      options: [
        { name: 'x', value: COORDINATE, summary: 'how far right' },
        { name: 'y', value: COORDINATE, summary: 'how far down' },
      ],
    });
    if (Object.keys(options).length === 0) {
      cursor.stop({ kind: 'nothing-to-change', message: 'Say where to move it, for example x=200 y=80.' });
    }
    return {
      type: 'move',
      target,
      ...(options['x'] === undefined ? {} : { x: options['x'] as number }),
      ...(options['y'] === undefined ? {} : { y: options['y'] as number }),
    };
  },
  format: (command, document) =>
    [
      'move',
      refText(document, command.target, ELEMENT_KINDS),
      ...(command.x === undefined ? [] : [`x=${written(command.x)}`]),
      ...(command.y === undefined ? [] : [`y=${written(command.y)}`]),
    ].join(' '),
};

export const moveLabel: CommandSpec<MoveLabel> = {
  name: 'move label',
  type: 'move-label',
  scope: 'document',
  syntax: 'move label <element> -> <element> at=<0 to 1>',
  summary:
    'Puts the label of an edge somewhere along it: 0 is at its start, where the message leaves, and 1 at its end. The edge goes from a producer to what it publishes to, from an exchange to what it is bound to, or from a queue to a consumer.',
  examples: ['move label orders -> billing at=0.25'],
  parse(cursor) {
    const from = cursor.ref(ELEMENT_KINDS, 'the element that the edge starts at');
    cursor.arrow();
    const to = cursor.ref(ELEMENT_KINDS, 'the element that the edge ends at');
    const { options } = cursor.options({
      options: [
        { name: 'at', value: { kind: 'number', min: 0, max: 1 }, summary: 'how far along the edge', required: true },
      ],
    });
    return { type: 'move-label', from, to, at: options['at'] as number };
  },
  format: (command, document) =>
    `move label ${refText(document, command.from, ELEMENT_KINDS)} -> ${refText(document, command.to, ELEMENT_KINDS)} at=${written(command.at)}`,
};

export const rename: CommandSpec<Rename> = {
  name: 'rename',
  type: 'rename',
  scope: 'document',
  syntax: 'rename <element> <new name>',
  summary:
    'Gives an element another name. Every binding, link and subscription keeps pointing at it, because they hold its id. The new name has to be one that a declaration would take.',
  examples: ['rename billing invoices'],
  parse(cursor) {
    const target = cursor.ref(ELEMENT_KINDS, 'the element to rename');
    const name = cursor.name('the new name');
    cursor.finish();
    return { type: 'rename', target, name };
  },
  format: (command, document) => `rename ${refText(document, command.target, ELEMENT_KINDS)} ${wordText(command.name)}`,
};

export const deleteElement: CommandSpec<Delete> = {
  name: 'delete',
  type: 'delete',
  scope: 'document',
  syntax: 'delete <element>',
  summary:
    'Takes an element off the canvas, with what hangs on it: the bindings of an exchange or a queue, the link of a producer that publishes to it, and the subscriptions of consumers to a queue.',
  examples: ['delete archive'],
  parse(cursor) {
    const target = cursor.ref(ELEMENT_KINDS, 'the element to delete');
    cursor.finish();
    return { type: 'delete', target };
  },
  format: (command, document) => `delete ${refText(document, command.target, ELEMENT_KINDS)}`,
};

export const clear: CommandSpec<Clear> = {
  name: 'clear',
  type: 'clear',
  scope: 'document',
  syntax: 'clear',
  summary:
    'Takes everything off the canvas. Its vhost and its settings stay, and undo brings everything back. It takes no arguments.',
  examples: ['clear'],
  parse(cursor) {
    cursor.finish();
    return { type: 'clear' };
  },
  format: () => 'clear',
};

export const layout: CommandSpec<Layout> = {
  name: 'layout',
  type: 'layout',
  scope: 'document',
  syntax: 'layout',
  summary:
    'Puts every node in its place, from left to right in the way that a message travels: producers, exchanges, queues, consumers.',
  examples: ['layout'],
  parse(cursor) {
    cursor.finish();
    return { type: 'layout' };
  },
  format: () => 'layout',
};

export const undo: CommandSpec<Undo> = {
  name: 'undo',
  type: 'undo',
  scope: 'app',
  syntax: 'undo',
  summary:
    'Takes back the last change to the canvas, all of a batch at once. It restores the design and not the simulation: a queue that comes back is empty.',
  examples: ['undo'],
  parse(cursor) {
    cursor.finish();
    return { type: 'undo' };
  },
  format: () => 'undo',
};

export const redo: CommandSpec<Redo> = {
  name: 'redo',
  type: 'redo',
  scope: 'app',
  syntax: 'redo',
  summary: 'Does again the change that the last undo took back.',
  examples: ['redo'],
  parse(cursor) {
    cursor.finish();
    return { type: 'redo' };
  },
  format: () => 'redo',
};
