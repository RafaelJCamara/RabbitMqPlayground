import {
  consumerRecord,
  deepFreeze,
  documentOf,
  exchangeRecord,
  producerRecord,
  queueRecord,
  sampleDocument,
} from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import type { CanvasDocument } from '../document/schema';
import { completeCommand, type Completion } from './complete';

const sample = (): CanvasDocument => deepFreeze(sampleDocument());
const twins = (): CanvasDocument =>
  deepFreeze(
    documentOf({
      exchanges: { E: exchangeRecord('same'), F: exchangeRecord('other') },
      queues: { Q: queueRecord('same'), R: queueRecord('my queue') },
      producers: { P: producerRecord('same') },
      consumers: { C: consumerRecord('same') },
    }),
  );

/** Completes at the end of the text, which is where a person types. */
const at = (text: string, document: CanvasDocument = sample()): Completion =>
  completeCommand(text, text.length, document);
const inserts = (completion: Completion): string[] => completion.items.map(({ insert }) => insert);

describe('completeCommand', () => {
  describe('the name of a command', () => {
    it('is every first word of a command, once each, when nothing is typed', () => {
      expect(inserts(at(''))).toEqual([
        'declare',
        'add',
        'bind',
        'unbind',
        'link',
        'unlink',
        'subscribe',
        'unsubscribe',
        'set',
        'unset',
        'move',
        'rename',
        'delete',
        'clear',
        'layout',
        'undo',
        'redo',
        'help',
      ]);
      expect(at('').items.every(({ kind }) => kind === 'command')).toBe(true);
    });

    it('is the commands that start with what is typed, whatever its case, and replaces what is typed', () => {
      const completion = at('de');

      expect(inserts(completion)).toEqual(['declare', 'delete']);
      expect(completion).toMatchObject({ from: 0, to: 2 });
      expect(inserts(at('DE'))).toEqual(['declare', 'delete']);
      expect(inserts(at('u'))).toEqual(['unbind', 'unlink', 'unsubscribe', 'unset', 'undo']);
    });

    it('says what each command does, in its first sentence', () => {
      expect(at('bi').items[0]).toMatchObject({ insert: 'bind', kind: 'command' });
      expect(at('bi').items[0]?.detail).toMatch(/^Binds a queue or an exchange to an exchange/);
    });

    it('is the second words that a command with two words has, after the first', () => {
      expect(inserts(at('declare '))).toEqual(['exchange', 'queue']);
      expect(inserts(at('add '))).toEqual(['producer', 'consumer']);
      expect(inserts(at('declare e'))).toEqual(['exchange']);
      expect(inserts(at('add c'))).toEqual(['consumer']);
      expect(completeCommand('declare e', 9, sample())).toMatchObject({ from: 8, to: 9 });
    });

    it('is nothing for a word that no command starts with, and for the second word of a command that has none', () => {
      expect(inserts(at('zzz'))).toEqual([]);
      expect(inserts(at('declare z'))).toEqual([]);
      expect(inserts(at('frobnicate '))).toEqual([]);
    });

    it('is nothing when what comes before is not the bare words of a command', () => {
      expect(inserts(at('"declare" '))).toEqual([]);
      expect(inserts(at('-> '))).toEqual([]);
      // A word that is partly quoted is a name, and not the name of a command.
      expect(inserts(at('de"clare" '))).toEqual([]);
      expect(inserts(at('"de"clare '))).toEqual([]);
    });

    it('offers the second word of move label, as well as the elements, after move', () => {
      const completion = at('move ');

      expect(inserts(completion)).toEqual([
        'orders',
        'docs',
        'hidden',
        'billing',
        'archive',
        'sender',
        'worker',
        'label',
      ]);
      expect(inserts(at('move l'))).toEqual(['label']);
    });
  });

  describe('the name of an element', () => {
    it('is the elements of the kind that goes there, in the order of the canvas', () => {
      expect(inserts(at('bind '))).toEqual(['orders', 'docs', 'hidden']);
      expect(inserts(at('link '))).toEqual(['sender']);
      expect(inserts(at('subscribe '))).toEqual(['worker']);
      expect(inserts(at('subscribe worker '))).toEqual(['billing', 'archive']);
      expect(inserts(at('unlink '))).toEqual(['sender']);
      expect(at('bind ').items.map(({ kind, detail }) => [kind, detail])).toEqual([
        ['name', 'exchange'],
        ['name', 'exchange'],
        ['name', 'exchange'],
      ]);
    });

    it('is the elements that start with what is typed, whatever its case, and replaces what is typed', () => {
      const completion = at('bind OR');

      expect(inserts(completion)).toEqual(['orders']);
      expect(completion).toMatchObject({ from: 5, to: 7 });
      expect(inserts(at('bind d'))).toEqual(['docs']);
      expect(inserts(at('bind x'))).toEqual([]);
    });

    it('is the exchanges and the queues after an arrow, and every kind for a command that takes any', () => {
      expect(inserts(at('bind orders -> '))).toEqual(['orders', 'docs', 'hidden', 'billing', 'archive']);
      expect(inserts(at('bind orders ->b'))).toEqual(['billing']);
      expect(inserts(at('delete '))).toEqual(['orders', 'docs', 'hidden', 'billing', 'archive', 'sender', 'worker']);
      expect(inserts(at('rename b'))).toEqual(['billing']);
      expect(inserts(at('move label orders -> '))).toEqual([
        'orders',
        'docs',
        'hidden',
        'billing',
        'archive',
        'sender',
        'worker',
      ]);
    });

    it('has the kind in front where a name is more than one kind’s, and not where it is not', () => {
      expect(inserts(at('bind other -> ', twins()))).toEqual(['exchange:same', 'other', 'queue:same', '"my queue"']);
      expect(inserts(at('delete ', twins()))).toEqual([
        'exchange:same',
        'other',
        'queue:same',
        '"my queue"',
        'producer:same',
        'consumer:same',
      ]);
    });

    it('writes a name that has to be quoted in quotes, which is how it is read back', () => {
      expect(inserts(at('bind other -> my', twins()))).toEqual(['"my queue"']);
      expect(inserts(at('bind other -> queue:my', twins()))).toEqual(['queue:"my queue"']);
    });

    it('is only the kind that is named when a qualifier is typed, and the kind in front of each name', () => {
      expect(inserts(at('bind other -> queue:', twins()))).toEqual(['queue:same', 'queue:"my queue"']);
      expect(inserts(at('bind other -> exchange:s', twins()))).toEqual(['exchange:same']);
      expect(inserts(at('delete producer:', twins()))).toEqual(['producer:same']);
    });

    it('is nothing for a qualifier that does not go there, for a name that nothing has, and for a name that is new', () => {
      expect(inserts(at('bind other -> producer:', twins()))).toEqual([]);
      expect(inserts(at('bind orders -> nope'))).toEqual([]);
      expect(inserts(at('declare queue '))).toEqual([]);
      expect(inserts(at('rename billing '))).toEqual([]);
      expect(inserts(at('add producer '))).toEqual([]);
    });

    it('offers canvas, with the elements, as the target of set', () => {
      expect(inserts(at('set '))).toEqual([
        'canvas',
        'orders',
        'docs',
        'hidden',
        'billing',
        'archive',
        'sender',
        'worker',
      ]);
      expect(at('set ').items[0]).toMatchObject({ kind: 'keyword', detail: 'the canvas itself' });
      expect(inserts(at('set ca'))).toEqual(['canvas']);
      expect(inserts(at('set b'))).toEqual(['billing']);
    });
  });

  describe('an arrow', () => {
    it('is offered where an arrow goes, once the first name is typed', () => {
      expect(inserts(at('bind orders '))).toEqual(['->']);
      expect(inserts(at('link sender '))).toEqual(['->']);
      expect(inserts(at('move label orders '))).toEqual(['->']);
    });

    it('is offered when a dash is typed, and is not when something else is', () => {
      expect(inserts(at('bind orders -'))).toEqual(['->']);
      expect(inserts(at('bind orders x'))).toEqual([]);
    });
  });

  describe('an option', () => {
    it('is each option that is not used yet, as name=, with what it is for', () => {
      const completion = at('declare exchange events ');

      expect(inserts(completion)).toEqual(['type=', 'durable=', 'auto-delete=', 'internal=']);
      expect(completion.items.every(({ kind }) => kind === 'option')).toBe(true);
      expect(completion.items[0]?.detail).toBe('how it routes');
      expect(inserts(at('declare exchange events type=direct '))).toEqual(['durable=', 'auto-delete=', 'internal=']);
      expect(inserts(at('declare exchange events au'))).toEqual(['auto-delete=']);
    });

    it('is nothing when there is no option left', () => {
      expect(inserts(at('declare exchange events type=direct durable=true auto-delete=true internal=true '))).toEqual(
        [],
      );
    });

    it('includes exists( for a binding, and header: for the headers of a message, and the options of the kind of element that is set', () => {
      expect(inserts(at('bind orders -> billing '))).toEqual(['key=', 'x-match=', 'exists(']);
      expect(inserts(at('bind orders -> billing ex'))).toEqual(['exists(']);
      expect(inserts(at('set sender '))).toEqual(['payload=', 'key=', 'burst=', 'every=', 'repeat=', 'header:']);
      expect(inserts(at('set orders '))).toEqual(['type=', 'durable=', 'auto-delete=', 'internal=']);
      expect(inserts(at('set billing '))).toEqual(['durable=']);
      expect(inserts(at('set worker '))).toEqual(['ack=', 'prefetch=', 'processing=']);
      expect(inserts(at('set canvas '))).toEqual([
        'default-exchange=',
        'seed=',
        'publish-ms=',
        'broker-ms=',
        'deliver-ms=',
      ]);
      expect(inserts(at('unset sender '))).toEqual(['header:']);
      expect(inserts(at('move billing '))).toEqual(['x=', 'y=']);
      expect(inserts(at('move label orders -> billing '))).toEqual(['at=']);
      expect(at('bind orders -> billing ').items.find(({ insert }) => insert === 'exists(')).toMatchObject({
        kind: 'keyword',
        detail: 'a header that has to be there',
      });
    });

    it('does not offer a second key or x-match once one is written, and still offers exists(', () => {
      expect(inserts(at('bind orders -> billing key=a '))).toEqual(['x-match=', 'exists(']);
      expect(inserts(at('bind orders -> billing key=a x-match=all '))).toEqual(['exists(']);
    });

    it('is the values of an option, for an enum and for a boolean, that start with what is typed', () => {
      const types = at('declare exchange e type=');

      expect(inserts(types)).toEqual(['type=direct', 'type=fanout', 'type=topic', 'type=headers']);
      expect(types).toMatchObject({ from: 19, to: 24 });
      expect(types.items.every(({ kind }) => kind === 'value')).toBe(true);
      expect(inserts(at('declare exchange e type=to'))).toEqual(['type=topic']);
      expect(inserts(at('declare exchange e type=direct durable='))).toEqual(['durable=true', 'durable=false']);
      expect(inserts(at('declare exchange e type=direct durable=f'))).toEqual(['durable=false']);
      expect(inserts(at('bind docs -> archive x-match=a'))).toEqual([
        'x-match=all',
        'x-match=any',
        'x-match=all-with-x',
        'x-match=any-with-x',
      ]);
      expect(inserts(at('set worker ack=m'))).toEqual(['ack=manual']);
    });

    it('is nothing for the value of an option that takes text or a number, of one that is not an option, and of one that is used', () => {
      expect(inserts(at('bind orders -> billing key='))).toEqual([]);
      expect(inserts(at('set worker prefetch='))).toEqual([]);
      expect(inserts(at('bind orders -> billing format='))).toEqual([]);
      expect(inserts(at('declare exchange e type=direct type='))).toEqual([]);
    });
  });

  describe('what an item shows', () => {
    /** The kind of an item, what it inserts, the label that the list shows, and what it is for. */
    const shown = (text: string): string[] =>
      at(text).items.map(({ kind, insert, label, detail }) => `${kind} | ${insert} | ${label} | ${detail ?? ''}`);

    it('is its kind, what it inserts, its label, which is the same, and a few words on what it is for', () => {
      expect(shown('declare ')).toEqual([
        'command | exchange | exchange | Puts an exchange on the canvas',
        'command | queue | queue | Puts a queue on the canvas',
      ]);
      expect(shown('set ')).toEqual([
        'keyword | canvas | canvas | the canvas itself',
        'name | orders | orders | exchange',
        'name | docs | docs | exchange',
        'name | hidden | hidden | exchange',
        'name | billing | billing | queue',
        'name | archive | archive | queue',
        'name | sender | sender | producer',
        'name | worker | worker | consumer',
      ]);
      expect(shown('bind orders ')).toEqual(['keyword | -> | -> | from … to …']);
      expect(shown('bind orders -> billing ')).toEqual([
        'option | key= | key= | the binding key: the routing key for a direct exchange, a pattern for a topic one',
        'option | x-match= | x-match= | how the conditions of a headers binding are combined',
        'keyword | exists( | exists( | a header that has to be there',
      ]);
      expect(shown('set sender ')).toEqual([
        'option | payload= | payload= | the body of the message',
        'option | key= | key= | the routing key of the message',
        'option | burst= | burst= | messages in one publish',
        'option | every= | every= | milliseconds between publishes',
        'option | repeat= | repeat= | publish again and again',
        'keyword | header: | header: | a header of the message',
      ]);
      expect(shown('unset sender ')).toEqual(['keyword | header: | header: | a header of the message']);
      expect(shown('declare exchange e type=')).toEqual([
        'value | type=direct | direct | how it routes',
        'value | type=fanout | fanout | how it routes',
        'value | type=topic | topic | how it routes',
        'value | type=headers | headers | how it routes',
      ]);
      expect(shown('move billing ')).toEqual(['option | x= | x= | how far right', 'option | y= | y= | how far down']);
    });

    it('says what each option of the other commands is for', () => {
      expect(shown('declare exchange e ')).toEqual([
        'option | type= | type= | how it routes',
        'option | durable= | durable= | survives a restart (default true)',
        'option | auto-delete= | auto-delete= | goes when its last binding does (default false)',
        'option | internal= | internal= | no client can publish to it (default false)',
      ]);
      expect(shown('declare queue q ')).toEqual([
        'option | type= | type= | only classic for now',
        'option | durable= | durable= | has to be true (default true)',
      ]);
      expect(shown('set orders ')).toEqual([
        'option | type= | type= | how it routes',
        'option | durable= | durable= | survives a restart',
        'option | auto-delete= | auto-delete= | goes when its last binding does',
        'option | internal= | internal= | no client can publish to it',
      ]);
      expect(shown('set billing ')).toEqual(['option | durable= | durable= | has to be true']);
      expect(shown('set worker ')).toEqual([
        'option | ack= | ack= | when a message is taken as handled',
        'option | prefetch= | prefetch= | messages in flight at once, 0 for no limit',
        'option | processing= | processing= | milliseconds to handle a message',
      ]);
      expect(shown('set canvas ')).toEqual([
        'option | default-exchange= | default-exchange= | draw the default exchange',
        'option | seed= | seed= | the seed of the simulation',
        'option | publish-ms= | publish-ms= | milliseconds to publish',
        'option | broker-ms= | broker-ms= | milliseconds in the broker',
        'option | deliver-ms= | deliver-ms= | milliseconds to deliver',
      ]);
      expect(shown('move label orders -> billing ')).toEqual(['option | at= | at= | how far along the edge']);
    });

    it('offers header: only where a header goes, and only for what starts with what is typed', () => {
      expect(inserts(at('set sender he'))).toEqual(['header:']);
      expect(inserts(at('unset sender he'))).toEqual(['header:']);
      expect(inserts(at('set sender x'))).toEqual([]);
      expect(inserts(at('set worker he'))).toEqual([]);
      expect(inserts(at('bind orders -> billing he'))).toEqual([]);
    });
  });

  describe('where the cursor is', () => {
    it('is the end of the text that counts, and what comes after the cursor is not looked at', () => {
      const text = 'bind orders -> billing key=a';

      expect(inserts(completeCommand(text, 5, sample()))).toEqual(['orders', 'docs', 'hidden']);
      expect(completeCommand(text, 5, sample())).toMatchObject({ from: 5, to: 5 });
      expect(inserts(completeCommand(text, 8, sample()))).toEqual(['orders']);
      expect(completeCommand(text, 8, sample())).toMatchObject({ from: 5, to: 8 });
    });

    it('is the command after the last ; in a batch, which starts again with the names of commands', () => {
      expect(inserts(at('declare queue a; '))).toEqual(inserts(at('')));
      expect(inserts(at('declare queue a; bind '))).toEqual(['orders', 'docs', 'hidden']);
      expect(inserts(at('declare queue a;de'))).toEqual(['declare', 'delete']);
      expect(completeCommand('declare queue a;de', 18, sample())).toMatchObject({ from: 16 });
    });

    it('does not take a name that an earlier command in a batch made, because the canvas is the one that is there', () => {
      expect(inserts(at('declare exchange x type=direct; bind ', sample()))).toEqual(['orders', 'docs', 'hidden']);
    });

    it('is nothing inside a quoted text that is not closed', () => {
      expect(inserts(at('bind "or'))).toEqual([]);
      expect(inserts(at('rename billing "new na'))).toEqual([]);
    });

    it('is nothing after an error in what is typed already, such as an element that is not there', () => {
      expect(inserts(at('delete nope '))).toEqual([]);
      expect(inserts(at('declare exchange e type=bogus '))).toEqual([]);
      expect(inserts(at('bind orders -> billing key=a key=b '))).toEqual([]);
    });

    it('is nothing for a command that has nothing more to say', () => {
      expect(inserts(at('clear '))).toEqual([]);
      expect(inserts(at('add producer p '))).toEqual([]);
      expect(inserts(at('undo '))).toEqual([]);
    });

    it('offers, after help, the first word of each command', () => {
      expect(inserts(at('help '))).toEqual(
        inserts(at(''))
          .filter((word) => word !== 'help')
          .concat('help'),
      );
      expect(at('help ').items.every(({ kind }) => kind === 'command')).toBe(true);
      expect(inserts(at('help bi'))).toEqual(['bind']);
      expect(completeCommand('help bi', 7, sample())).toMatchObject({ from: 5, to: 7 });
    });

    it('offers, after help and the first word of a command that has two, the second word', () => {
      expect(inserts(at('help declare '))).toEqual(['exchange', 'queue']);
      expect(inserts(at('help declare e'))).toEqual(['exchange']);
      expect(inserts(at('help add '))).toEqual(['producer', 'consumer']);
    });

    it('offers label after help move, which is a command and also the start of one, and nothing after a whole command', () => {
      expect(inserts(at('help move '))).toEqual(['label']);
      expect(inserts(at('help bind '))).toEqual([]);
      expect(inserts(at('help declare queue '))).toEqual([]);
      expect(inserts(at('help frobnicate '))).toEqual([]);
    });

    it('treats a typed arrow as finished, and takes what follows it as a new word', () => {
      expect(inserts(at('bind orders ->'))).toEqual(['orders', 'docs', 'hidden', 'billing', 'archive']);
      expect(completeCommand('bind orders ->', 14, sample())).toMatchObject({ from: 14, to: 14 });
    });
  });

  it('does not change the canvas, and gives the same answer every time', () => {
    const document = sample();

    expect(at('bind ', document)).toEqual(at('bind ', document));
    expect(document).toEqual(sampleDocument());
  });
});
