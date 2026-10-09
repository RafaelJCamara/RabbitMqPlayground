import { decodeShare, payloadOf, SHARE_WARN_AT } from '@rmq/persistence';
import { documentOf, exchangeRecord, producerRecord, sampleDocument, snapshotAfter } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { fileInstead, linkBase, makeLink } from './link-maker';

/** The link that the panel makes (ADR-0077, ADR-0078). */

describe('linkBase', () => {
  const address = { base: () => 'https://learner.test/RabbitMqPlayground/' };

  it('is the page alone when no feature flag is on, which is what every link is once the flags are gone', () => {
    expect(linkBase(address, { enabled: [] })).toBe('https://learner.test/RabbitMqPlayground/');
  });

  it('carries the flags that are on, so that a link opens for whoever is sent it as it does for whoever made it', () => {
    expect(linkBase(address, { enabled: ['editor'] })).toBe('https://learner.test/RabbitMqPlayground/?ff=editor');
  });
});

describe('makeLink', () => {
  const base = 'https://learner.test/app/';

  it('makes an address on the base that opens as the canvas it was made from, and says how long it is', async () => {
    const made = await makeLink({ name: 'Orders', document: sampleDocument() }, base);

    expect(made.kind).toBe('ready');
    if (made.kind === 'ready') {
      expect(made.address.startsWith(`${base}#c=v1.`)).toBe(true);
      expect(made.length).toBe(made.address.length);
      expect(made.long).toBe(false);
      const opened = await decodeShare(payloadOf(new URL(made.address).hash) ?? '');
      expect(opened).toEqual({ ok: true, value: { name: 'Orders', document: sampleDocument() } });
    }
  });

  it('carries the messages when it is given them, and opens as the canvas with its messages', async () => {
    const document = sampleDocument();
    const simulation = snapshotAfter(document, 1_000);

    const made = await makeLink({ name: 'Orders', document, simulation }, base);

    expect(made.kind).toBe('ready');
    const opened = await decodeShare(payloadOf(new URL(made.kind === 'ready' ? made.address : base).hash) ?? '');
    expect(opened.ok && opened.value.simulation).toEqual(simulation);
  });

  it('says that the link is long when the whole address is more than 8,000 characters, and not before', async () => {
    const shared = { name: 'Orders', document: sampleDocument() };
    const prefix = 'https://learner.test/';
    const small = await makeLink(shared, base);
    if (small.kind !== 'ready') {
      throw new Error('expected a link');
    }
    // The part after the base is the same whatever the base is, so the base is the only part of the address that a spec can size to the character.
    const tail = small.length - base.length;
    const baseOf = (length: number): string => prefix + 'a'.repeat(length - prefix.length);

    const at = await makeLink(shared, baseOf(SHARE_WARN_AT - tail));
    const over = await makeLink(shared, baseOf(SHARE_WARN_AT - tail + 1));

    expect(at.kind === 'ready' && [at.length, at.long]).toEqual([SHARE_WARN_AT, false]);
    expect(over.kind === 'ready' && [over.length, over.long]).toEqual([SHARE_WARN_AT + 1, true]);
  });

  it('says why there is no link, in the words of the codec, for a canvas that the codec would not open', async () => {
    const made = await makeLink({ name: '  ', document: sampleDocument() }, base);

    expect(made.kind).toBe('failed');
    expect(made.kind === 'failed' && made.error.kind).toBe('invalid');
  });

  it('says that a link is too long to send as one, with the sentence that a file is the way, for a canvas that is too big', async () => {
    // Text that does not compress: a generator of numbers that has no pattern a compressor can find.
    let state = 12345;
    const noise = (length: number): string => {
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      let text = '';
      for (let at = 0; at < length; at += 1) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        text += letters.charAt(state >>> 26);
      }
      return text;
    };
    const crowded = documentOf({
      exchanges: { E1: exchangeRecord('x') },
      producers: Object.fromEntries(
        Array.from({ length: 60 }, (_, index) => [
          `P${index}`,
          producerRecord(`p${index}`, null, { message: { payload: noise(8_000), key: '', headers: [] } }),
        ]),
      ),
    });

    const made = await makeLink({ name: 'Big', document: crowded }, base);

    expect(made.kind).toBe('failed');
    expect(made.kind === 'failed' && made.error.kind).toBe('too-large');
    expect(made.kind === 'failed' && fileInstead(made.error)).toBe(true);
    expect(made.kind === 'failed' && made.error.message).toContain('A canvas that big is sent as a file.');
  });
});

describe('fileInstead', () => {
  it.each([
    [{ kind: 'too-large', what: 'link', found: 1, limit: 1, message: 'm' }, true],
    [{ kind: 'too-large', what: 'inflated', found: 1, limit: 1, message: 'm' }, true],
    [{ kind: 'unsupported', message: 'm' }, true],
    [{ kind: 'too-large', what: 'name', found: 1, limit: 1, message: 'm' }, false],
    [{ kind: 'too-large', what: 'elements', found: 1, limit: 1, message: 'm' }, false],
    [{ kind: 'invalid', issues: [], message: 'm' }, false],
    [{ kind: 'damaged', message: 'm' }, false],
  ] as const)('is, for %j, %s', (error, expected) => {
    expect(fileInstead(error)).toBe(expected);
  });
});
