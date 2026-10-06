import { applyCommand, ID_PATTERN, type CanvasDocument, type IdKind } from '@rmq/domain';
import { documentOf, exchangeRecord, queueRecord } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { createIdGenerator, nextName } from './ids';

const KINDS: readonly IdKind[] = ['exchange', 'queue', 'producer', 'consumer', 'binding'];

describe('createIdGenerator', () => {
  it('makes an id with a letter for the kind and a number that counts up for that kind', () => {
    const generator = createIdGenerator(() => documentOf());

    expect(generator.newId('exchange')).toBe('x1');
    expect(generator.newId('queue')).toBe('q1');
    expect(generator.newId('queue')).toBe('q2');
    expect(generator.newId('producer')).toBe('p1');
    expect(generator.newId('consumer')).toBe('c1');
    expect(generator.newId('binding')).toBe('b1');
    expect(generator.newId('exchange')).toBe('x2');
  });

  it('makes ids that are valid and that are not the same for two kinds', () => {
    const generator = createIdGenerator(() => documentOf());
    const ids = KINDS.flatMap((kind) => [generator.newId(kind), generator.newId(kind), generator.newId(kind)]);

    expect(ids.every((id) => ID_PATTERN.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('skips an id that the canvas has, whatever kind of thing has it, so that a canvas from a file never meets one', () => {
    const document = documentOf({
      exchanges: { q1: exchangeRecord('an exchange that has the id of the first queue'), x1: exchangeRecord('x') },
      queues: { q2: queueRecord('another') },
    });
    const generator = createIdGenerator(() => document);

    expect(generator.newId('queue')).toBe('q3');
    expect(generator.newId('exchange')).toBe('x2');
  });

  it('never makes an id again, not even when what had it has gone, because the history may bring it back', () => {
    let document: CanvasDocument = documentOf();
    const generator = createIdGenerator(() => document);
    const first = generator.newId('queue');
    document = documentOf({ queues: { [first]: queueRecord('q') } });
    document = documentOf();

    expect(generator.newId('queue')).not.toBe(first);
  });

  it('asks the canvas as it is when it is asked, and not as it was when the generator was made', () => {
    let document: CanvasDocument = documentOf();
    const generator = createIdGenerator(() => document);
    document = documentOf({ queues: { q1: queueRecord('q') } });

    expect(generator.newId('queue')).toBe('q2');
  });

  it('is what applyCommand needs: it never throws for a long run of commands that add things, in one batch or many', () => {
    let document: CanvasDocument = documentOf();
    const context = { newId: createIdGenerator(() => document).newId };
    for (let index = 0; index < 40; index += 1) {
      const result = applyCommand(
        document,
        {
          type: 'batch',
          commands: [
            { type: 'declare-queue', name: `q${index}`, durable: true },
            {
              type: 'declare-exchange',
              name: `e${index}`,
              exchangeType: 'direct',
              durable: true,
              autoDelete: false,
              internal: false,
            },
            { type: 'add-producer', name: `p${index}` },
            { type: 'add-consumer', name: `c${index}` },
            { type: 'bind', source: `e${index}`, destination: { kind: 'queue', name: `q${index}` }, key: 'k' },
          ],
        },
        context,
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        document = result.value;
      }
    }

    expect(Object.keys(document.queues)).toHaveLength(40);
    expect(Object.keys(document.bindings)).toHaveLength(40);
  });
});

describe('nextName', () => {
  it('is the kind and the smallest number that no element of that kind has', () => {
    const document = documentOf({
      queues: { a: queueRecord('queue1'), b: queueRecord('queue3') },
      exchanges: { c: exchangeRecord('exchange1') },
    });

    expect(nextName(document, 'queue')).toBe('queue2');
    expect(nextName(document, 'exchange')).toBe('exchange2');
    expect(nextName(document, 'producer')).toBe('producer1');
    expect(nextName(document, 'consumer')).toBe('consumer1');
  });

  it('does not mind that another kind has the name, because a queue and an exchange may share one', () => {
    const document = documentOf({ exchanges: { c: exchangeRecord('queue1') } });

    expect(nextName(document, 'queue')).toBe('queue1');
  });

  it('is a word that needs no quotes in the typed command', () => {
    expect(nextName(documentOf(), 'queue')).toMatch(/^[a-z]+\d+$/);
  });
});
