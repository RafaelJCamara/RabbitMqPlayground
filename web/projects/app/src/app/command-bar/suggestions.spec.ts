import {
  applyCommand,
  emptyDocument,
  isDocumentCommand,
  parseCommand,
  type CanvasDocument,
  type DocumentCommand,
} from '@rmq/domain';
import { applyAll, arbDocument, configureFastCheck, prefixedIds, queueEnd } from '@rmq/testing';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_SUGGESTIONS, nextSteps } from './suggestions';

const exchange = (name: string, exchangeType: 'direct' | 'fanout' | 'topic' | 'headers' = 'direct', internal = false) =>
  ({ type: 'declare-exchange', name, exchangeType, durable: true, autoDelete: false, internal }) as const;
const queue = (name: string) => ({ type: 'declare-queue', name, durable: true }) as const;

const canvas = (...commands: readonly DocumentCommand[]): CanvasDocument => applyAll(emptyDocument(), commands);

// The app has no Node typings, and the properties here run as many times as the libraries' do (FC_NUM_RUNS), with the same seed (FC_SEED).
configureFastCheck((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {});

describe('nextSteps (ADR-0045)', () => {
  it('has the learner declare something on an empty canvas, one of each kind, as lines that can be typed as they are', () => {
    expect(nextSteps(emptyDocument())).toEqual([
      'declare exchange orders type=direct',
      'declare queue billing',
      'add producer sender',
      'add consumer worker',
    ]);
  });

  it('asks only for the kinds that the canvas does not have', () => {
    expect(nextSteps(canvas(exchange('logs', 'fanout'), queue('archive')))).toEqual([
      'add producer sender',
      'add consumer worker',
      'bind logs -> archive',
    ]);
  });

  it('has an exchange that nothing is bound from bound to the first queue, with the key that its kind of exchange uses', () => {
    expect(nextSteps(canvas(exchange('orders'), queue('billing'), queue('archive')))).toContain(
      'bind orders -> billing key=billing',
    );
    expect(nextSteps(canvas(exchange('events', 'topic'), queue('billing')))).toContain('bind events -> billing key=#');
    expect(nextSteps(canvas(exchange('logs', 'fanout'), queue('billing')))).toContain('bind logs -> billing');
    expect(nextSteps(canvas(exchange('h', 'headers'), queue('billing')))).toContain('bind h -> billing');
  });

  it('writes a name that has to be quoted, and says which kind where the name would not', () => {
    const lines = nextSteps(canvas(exchange('my orders'), queue('my orders')));

    expect(lines).toContain('bind "my orders" -> queue:"my orders" key="my orders"');
  });

  it('does not bind an exchange that is bound already, and does not bind one that has no queue to go to', () => {
    expect(
      nextSteps(
        canvas(exchange('orders'), queue('billing'), {
          type: 'bind',
          source: 'orders',
          destination: queueEnd('billing'),
          key: 'k',
        }),
      ).filter((line) => line.startsWith('bind')),
    ).toEqual([]);
    expect(nextSteps(canvas(exchange('orders'))).filter((line) => line.startsWith('bind'))).toEqual([]);
  });

  it('links a producer that has no target to the first exchange that a client can publish to', () => {
    const lines = nextSteps(
      canvas(exchange('internal-one', 'direct', true), exchange('orders'), queue('billing'), {
        type: 'add-producer',
        name: 'sender',
      }),
    );

    expect(lines).toContain('link sender -> orders');
  });

  it('links a producer to the first queue when the only exchanges are internal, and not at all when there is nothing to link it to', () => {
    expect(
      nextSteps(
        canvas(exchange('internal-one', 'direct', true), queue('billing'), { type: 'add-producer', name: 'sender' }),
      ),
    ).toContain('link sender -> billing');
    expect(
      nextSteps(canvas({ type: 'add-producer', name: 'sender' })).filter((line) => line.startsWith('link')),
    ).toEqual([]);
  });

  it('does not link a producer that has a target already', () => {
    const lines = nextSteps(
      canvas(
        exchange('orders'),
        { type: 'add-producer', name: 'sender' },
        {
          type: 'link',
          producer: 'sender',
          target: { kind: 'exchange', name: 'orders' },
        },
      ),
    );

    expect(lines.filter((line) => line.startsWith('link'))).toEqual([]);
  });

  it('subscribes a consumer that has no queue to the first queue, and leaves one that has a queue alone', () => {
    expect(nextSteps(canvas(queue('billing'), { type: 'add-consumer', name: 'worker' }))).toContain(
      'subscribe worker billing',
    );
    expect(
      nextSteps(
        canvas(
          queue('billing'),
          { type: 'add-consumer', name: 'worker' },
          { type: 'subscribe', consumer: 'worker', queue: 'billing' },
        ),
      ).filter((line) => line.startsWith('subscribe')),
    ).toEqual([]);
    expect(
      nextSteps(canvas({ type: 'add-consumer', name: 'worker' })).filter((line) => line.startsWith('subscribe')),
    ).toEqual([]);
  });

  it('goes in the order of the work: what is missing, then the bindings, then the links, then the subscriptions', () => {
    const lines = nextSteps(
      canvas(
        exchange('orders'),
        queue('billing'),
        { type: 'add-producer', name: 'sender' },
        { type: 'add-consumer', name: 'worker' },
      ),
    );

    expect(lines).toEqual(['bind orders -> billing key=billing', 'link sender -> orders', 'subscribe worker billing']);
  });

  it('says nothing about a canvas that is wired from one end to the other', () => {
    const wired = canvas(
      exchange('orders'),
      queue('billing'),
      { type: 'add-producer', name: 'sender' },
      { type: 'add-consumer', name: 'worker' },
      { type: 'bind', source: 'orders', destination: queueEnd('billing'), key: 'billing' },
      { type: 'link', producer: 'sender', target: { kind: 'exchange', name: 'orders' } },
      { type: 'subscribe', consumer: 'worker', queue: 'billing' },
    );

    expect(nextSteps(wired)).toEqual([]);
  });

  it('has no more than five lines, and the ones that come first are kept', () => {
    const many = canvas(
      exchange('a'),
      exchange('b'),
      exchange('c'),
      exchange('d'),
      exchange('e'),
      exchange('f'),
      queue('q'),
    );

    const lines = nextSteps(many);

    expect(MAX_SUGGESTIONS).toBe(5);
    expect(lines).toHaveLength(MAX_SUGGESTIONS);
    expect(lines.slice(0, 2)).toEqual(['add producer sender', 'add consumer worker']);
  });

  it('is a line that works, for every canvas that commands can make: read by the parser, and accepted by the canvas it was made for', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        const lines = nextSteps(document);

        expect(lines.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
        for (const line of lines) {
          const parsed = parseCommand(line, document);
          expect(parsed.ok, line).toBe(true);
          if (parsed.ok && isDocumentCommand(parsed.value)) {
            const applied = applyCommand(document, parsed.value, prefixedIds('new-'));
            expect(applied.ok, `${line}: ${applied.ok ? '' : applied.error.message}`).toBe(true);
          }
        }
      }),
    );
  });

  it('is nothing but lines that change the canvas: it never suggests the same line twice', () => {
    fc.assert(
      fc.property(arbDocument, (document) => {
        const lines = nextSteps(document);

        expect(new Set(lines).size).toBe(lines.length);
      }),
    );
  });
});
