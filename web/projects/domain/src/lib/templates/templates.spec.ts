import { engineFor, settle } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands/apply';
import { isDocumentCommand } from '../commands/kinds';
import { emptyDocument, type CanvasDocument } from '../document/schema';
import { formatCommand } from '../syntax/format';
import { parseCommand } from '../syntax/parse';
import { buildTemplate } from './build';
import { TEMPLATES, templateById, type Template, type TemplateId } from './templates';

/** The six templates (ADR-0081): that each is built by the commands, says what it is, and routes as it teaches. */

const ids = (): TemplateId[] => TEMPLATES.map(({ id }) => id);
const template = (id: TemplateId): Template => {
  const found = templateById(id);
  if (found === undefined) {
    throw new Error(`There is no template ${id}`);
  }
  return found;
};

/** What the engine does when these producers publish once each: the queues that were given a copy, in order, and how many messages consumers were given. */
function played(
  document: CanvasDocument,
  producers: readonly string[],
): { readonly queues: string[]; readonly delivered: number } {
  const engine = engineFor(document);
  const events: ReturnType<typeof settle> = [];
  for (const [id, record] of Object.entries(document.producers)) {
    if (producers.includes(record.name)) {
      const result = engine.dispatch({ op: 'producer.publish', producer: id });
      if (!result.ok) {
        throw new Error(`The engine refused ${record.name}: ${result.text}`);
      }
      events.push(...result.events);
    }
  }
  events.push(...settle(engine));
  return {
    queues: events.flatMap((event) => (event.type === 'enqueued' ? [event.queue] : [])).sort(),
    delivered: events.filter((event) => event.type === 'delivered').length,
  };
}

/** The canvas with one more command, typed as the learner would. */
function changed(document: CanvasDocument, line: string): CanvasDocument {
  const read = parseCommand(line, document);
  if (!read.ok || !isDocumentCommand(read.value)) {
    throw new Error(`${line} is not a command that changes the canvas`);
  }
  const result = applyCommand(document, read.value, { newId: (kind) => `n-${kind}-${line.length}` });
  if (!result.ok) {
    throw new Error(`${line} was refused: ${result.error.message}`);
  }
  return result.value;
}

const COUNTS: Readonly<
  Record<TemplateId, Readonly<Record<'exchanges' | 'queues' | 'producers' | 'consumers' | 'bindings', number>>>
> = {
  'hello-world': { exchanges: 0, queues: 1, producers: 1, consumers: 1, bindings: 0 },
  'work-queues': { exchanges: 0, queues: 1, producers: 1, consumers: 2, bindings: 0 },
  'pub-sub': { exchanges: 1, queues: 2, producers: 1, consumers: 2, bindings: 2 },
  routing: { exchanges: 1, queues: 2, producers: 2, consumers: 2, bindings: 4 },
  topics: { exchanges: 1, queues: 2, producers: 1, consumers: 2, bindings: 3 },
  headers: { exchanges: 1, queues: 2, producers: 1, consumers: 2, bindings: 2 },
};

describe('the templates (ADR-0081)', () => {
  it('are the six that ADR-0003 names, in the order of the tutorials, each with a name of its own', () => {
    expect(TEMPLATES.map(({ name }) => name)).toEqual([
      'Hello World',
      'Work Queues',
      'Pub/Sub',
      'Routing',
      'Topics',
      'Headers routing',
    ]);
    expect(ids()).toEqual(['hello-world', 'work-queues', 'pub-sub', 'routing', 'topics', 'headers']);
    expect(new Set(ids()).size).toBe(6);
  });

  it('each say what they show and what to try, in a sentence, and are made of commands', () => {
    for (const each of TEMPLATES) {
      expect(each.summary, each.id).toMatch(/^[A-Z].*\.$/);
      expect(each.tryThis, each.id).toMatch(/^[A-Z].*\.$/);
      expect(each.script.length, each.id).toBeGreaterThan(3);
      expect(each.script.at(-1), each.id).toBe('layout');
    }
  });

  it('are found by their id, and a name that is none of them is nothing', () => {
    expect(templateById('topics')?.name).toBe('Topics');
    expect(templateById('hello-world')).toBe(TEMPLATES[0]);
    expect(templateById('hello')).toBeUndefined();
    expect(templateById('')).toBeUndefined();
  });

  describe.each(TEMPLATES)('$name', (each) => {
    it('is built by the commands, with the exchanges, queues, producers, consumers and bindings it is described by', () => {
      const document = buildTemplate(each);

      const counts = COUNTS[each.id];
      expect(Object.keys(document.exchanges)).toHaveLength(counts.exchanges);
      expect(Object.keys(document.queues)).toHaveLength(counts.queues);
      expect(Object.keys(document.producers)).toHaveLength(counts.producers);
      expect(Object.keys(document.consumers)).toHaveLength(counts.consumers);
      expect(Object.keys(document.bindings)).toHaveLength(counts.bindings);
    });

    it('is the same canvas every time that it is made, with ids that count from 1', () => {
      const first = buildTemplate(each);

      expect(buildTemplate(each)).toStrictEqual(first);
      expect(Object.keys(first.queues).every((id) => /^q\d+$/.test(id))).toBe(true);
      expect(Object.keys(first.producers)).toContain('p1');
    });

    it('is written in the form that the log of commands writes, line by line', () => {
      let document = emptyDocument();
      let made = 0;
      each.script.forEach((line) => {
        const read = parseCommand(line, document);
        if (!read.ok || !isDocumentCommand(read.value)) {
          throw new Error(`${each.name}: ${line} is not a command`);
        }
        expect(formatCommand(read.value, document), line).toBe(line);
        const result = applyCommand(document, read.value, { newId: (kind) => `${kind[0]}${(made += 1)}` });
        if (!result.ok) {
          throw new Error(`${each.name}: ${line} was refused`);
        }
        document = result.value;
      });
    });

    it('has every node laid out, and a producer that sends nothing by itself', () => {
      const document = buildTemplate(each);

      const nodes = [
        ...Object.keys(document.exchanges),
        ...Object.keys(document.queues),
        ...Object.keys(document.producers),
        ...Object.keys(document.consumers),
      ];
      expect(Object.keys(document.layout.nodes).sort()).toEqual([...nodes].sort());
      for (const place of Object.values(document.layout.nodes)) {
        expect(Number.isFinite(place.x) && Number.isFinite(place.y)).toBe(true);
      }
      expect(Object.values(document.producers).some((producer) => producer.interval.on)).toBe(false);
    });
  });

  describe('route as they teach', () => {
    it('Hello World: the message goes to the queue and a consumer is given it', () => {
      expect(played(buildTemplate(template('hello-world')), ['sender'])).toEqual({ queues: ['hello'], delivered: 1 });
    });

    it('Work Queues: six tasks go to the one queue and the consumers are given all six', () => {
      expect(played(buildTemplate(template('work-queues')), ['dispatcher'])).toEqual({
        queues: ['tasks', 'tasks', 'tasks', 'tasks', 'tasks', 'tasks'],
        delivered: 6,
      });
    });

    it('Pub/Sub: one message is copied to both queues, and each consumer is given a copy', () => {
      expect(played(buildTemplate(template('pub-sub')), ['emitter'])).toEqual({
        queues: ['to-file', 'to-screen'],
        delivered: 2,
      });
    });

    it('Routing: an error goes to both queues, because both are bound with the key error, and an info only to the queue of everything', () => {
      const document = buildTemplate(template('routing'));

      expect(played(document, ['app-errors'])).toEqual({ queues: ['errors', 'everything'], delivered: 2 });
      expect(played(document, ['app-info'])).toEqual({ queues: ['everything'], delivered: 1 });
      expect(played(changed(document, 'set app-info key=trace'), ['app-info']).queues).toEqual([]);
    });

    it('Topics: quick.orange.rabbit matches both patterns, lazy.pink.fox one, and quick.brown.fox none', () => {
      const document = buildTemplate(template('topics'));

      expect(played(document, ['zoo'])).toEqual({ queues: ['orange', 'rabbits'], delivered: 2 });
      expect(played(changed(document, 'set zoo key=lazy.pink.fox'), ['zoo'])).toEqual({
        queues: ['rabbits'],
        delivered: 1,
      });
      expect(played(changed(document, 'set zoo key=quick.brown.fox'), ['zoo'])).toEqual({ queues: [], delivered: 0 });
    });

    it('Headers routing: the message matches both bindings, only the one of all conditions without urgent, and none without a pdf', () => {
      const document = buildTemplate(template('headers'));

      expect(played(document, ['scanner'])).toEqual({ queues: ['flagged', 'pdf-reports'], delivered: 2 });
      const calm = changed(document, 'unset scanner header:urgent');
      expect(played(calm, ['scanner'])).toEqual({ queues: ['pdf-reports'], delivered: 1 });
      expect(played(changed(calm, 'set scanner header:format=txt'), ['scanner'])).toEqual({ queues: [], delivered: 0 });
    });
  });

  describe('when a line is wrong', () => {
    const broken = (script: readonly string[]): Template => ({ ...template('hello-world'), name: 'Broken', script });

    it('says which template and which line, for a line that is not read', () => {
      expect(() => buildTemplate(broken(['declare queue hello', 'declare cake x']))).toThrow(
        /^The template “Broken”, line 2 \(declare cake x\), was not read: /,
      );
    });

    it('says so for a line that is a command of the runtime and does not change the canvas', () => {
      expect(() => buildTemplate(broken(['declare queue hello', 'play']))).toThrow(
        /^The template “Broken”, line 2 \(play\), is not a command that changes the canvas$/,
      );
    });

    it('says why, for a line that the canvas refuses', () => {
      expect(() => buildTemplate(broken(['declare exchange amq.fancy type=direct']))).toThrow(
        /^The template “Broken”, line 1 \(declare exchange amq\.fancy type=direct\), was (not read|refused): /,
      );
    });

    it('makes an empty canvas of a script with nothing in it', () => {
      expect(Object.keys(buildTemplate(broken([])).queues)).toEqual([]);
    });
  });
});
