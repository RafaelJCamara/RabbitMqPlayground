import { emptyDocument, validateDocument } from '@rmq/domain';
import { deepFreeze, documentOf, exchangeRecord, queueRecord, sampleDocument, snapshotAfter } from '@rmq/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareError } from '../errors';
import { BACKUP_FORMAT, CANVAS_FILE_FORMAT, SHARE_FORMAT, SHARE_VERSION } from '../files/formats';
import { SIZE_CAPS } from '../load/caps';
import { toBase64Url } from './base64url';
import { decodeShare, encodeShare, payloadOf, SHARE_KEY, SHARE_PREFIX, SHARE_WARN_AT, shareLink } from './codec';
import { deflate, inflate } from './compress';

type Raw = Record<string, unknown>;

afterEach(() => vi.unstubAllGlobals());

const encoder = new TextEncoder();

/** What a value is after it has been in a link: JSON text and back. */
const viaJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** The payload of a link whose text is this text, or these bytes: what any program could make, whether it is this app or not. */
const packed = async (content: string | Uint8Array): Promise<string> =>
  `${SHARE_PREFIX}${toBase64Url(await deflate(typeof content === 'string' ? encoder.encode(content) : content))}`;

const envelope = (change: Raw = {}): Raw => ({
  format: SHARE_FORMAT,
  version: SHARE_VERSION,
  name: 'Orders',
  document: viaJson(sampleDocument()),
  ...change,
});

/** The payload of a link whose envelope is this data. */
const linkOf = (data: unknown): Promise<string> => packed(JSON.stringify(data));

const made = async (shared: Parameters<typeof encodeShare>[0]): Promise<string> => {
  const result = await encodeShare(shared);
  if (!result.ok) {
    throw new Error(`expected a link, and got: ${result.error.message}`);
  }
  return result.value;
};

const refused = async (payload: string): Promise<ShareError> => {
  const result = await decodeShare(payload);
  if (result.ok) {
    throw new Error('expected a refusal, and the link was opened');
  }
  return result.error;
};

/** The text that a payload holds, which is how to look at what the encoder wrote. */
async function textOf(payload: string): Promise<string> {
  const bytes = Buffer.from(payload.slice(SHARE_PREFIX.length), 'base64url');
  const inflated = await inflate(new Uint8Array(bytes), SIZE_CAPS.inflated);
  if (!inflated.ok) {
    throw new Error('the payload does not inflate');
  }
  return new TextDecoder().decode(inflated.bytes);
}

/**
 * The sample canvas with `count` more producers, each with the payload that `payload` gives for it, so that a canvas can be as big as a spec needs. Every element has a place, as a canvas
 * that commands made does.
 */
function crowded(count: number, payload: (index: number) => string) {
  const document = sampleDocument();
  const producers = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `P${index + 100}`,
      { ...document.producers['P1']!, name: `p${index}`, message: { payload: payload(index), key: '', headers: [] } },
    ]),
  );
  const all = { ...document, producers: { ...document.producers, ...producers } };
  const ids = [
    ...Object.keys(all.exchanges),
    ...Object.keys(all.queues),
    ...Object.keys(all.producers),
    ...Object.keys(all.consumers),
  ];
  return {
    ...all,
    layout: { ...all.layout, nodes: Object.fromEntries(ids.map((id, index) => [id, { x: index, y: 0 }])) },
  };
}

describe('the parts of a link (ADR-0013, ADR-0077)', () => {
  it('start with v1., are kept in the fragment c, and are warned about above 8,000 characters', () => {
    expect(SHARE_PREFIX).toBe('v1.');
    expect(SHARE_KEY).toBe('c');
    expect(SHARE_WARN_AT).toBe(8_000);
  });

  it('are put in the address as the fragment, after the page, and nothing is put in the query', () => {
    expect(shareLink('https://learner.test/app/', 'v1.abc')).toBe('https://learner.test/app/#c=v1.abc');
  });

  it.each([
    ['#c=v1.abc', 'v1.abc'],
    ['c=v1.abc', 'v1.abc'],
    ['#c=', ''],
    ['#c=v1.a=b&c=d', 'v1.a=b&c=d'],
    ['#c=#c=v1.a', '#c=v1.a'],
  ])('are found in the fragment %j, as %j', (fragment, payload) => {
    expect(payloadOf(fragment)).toBe(payload);
  });

  it.each([
    [''],
    ['#'],
    ['#d=v1.abc'],
    ['#c'],
    ['#cc=v1.abc'],
    ['#C=v1.abc'],
    ['#/c=v1.abc'],
    ['v1.abc'],
    ['##c=v1.abc'],
    [' #c=v1.abc'],
  ])('are not found in the fragment %j', (fragment) => {
    expect(payloadOf(fragment)).toBeUndefined();
  });
});

describe('encodeShare', () => {
  it('makes the payload of a link: v1., and the characters of base64url and no others, and no padding', async () => {
    const payload = await made({ name: 'Orders', document: sampleDocument() });

    expect(payload).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
  });

  it('makes a link that is small for a canvas that is small, and that is below the length at which chat apps cut it', async () => {
    const sample = await made({ name: 'Orders', document: sampleDocument() });
    const empty = await made({ name: 'Orders', document: emptyDocument() });

    expect(empty.length).toBeLessThan(600);
    expect(sample.length).toBeLessThan(SHARE_WARN_AT);
    expect(sample.length).toBeGreaterThan(empty.length);
  });

  it('makes the same payload for the same canvas, every time on one platform', async () => {
    const shared = { name: 'Orders', document: sampleDocument() };

    expect(await made(shared)).toBe(await made(shared));
  });

  it('writes the text of the envelope compact, with its keys in the order format, version, name, document', async () => {
    const payload = await made({ name: 'Orders', document: sampleDocument() });

    const text = await textOf(payload);

    expect(text).toBe(JSON.stringify(envelope()));
    expect(text).not.toMatch(/\n| {2}/);
    expect(Object.keys(JSON.parse(text) as Raw)).toEqual(['format', 'version', 'name', 'document']);
  });

  it('puts the messages last, when the sender asked for them, and leaves the key out when not', async () => {
    const document = sampleDocument();
    const simulation = snapshotAfter(document, 1_000);

    const withMessages = JSON.parse(await textOf(await made({ name: 'Orders', document, simulation }))) as Raw;
    const without = JSON.parse(await textOf(await made({ name: 'Orders', document }))) as Raw;

    expect(Object.keys(withMessages)).toEqual(['format', 'version', 'name', 'document', 'simulation']);
    expect(withMessages['simulation']).toEqual(viaJson(simulation));
    expect(Object.keys(without)).not.toContain('simulation');
  });

  it('makes a link that opens as the canvas that it was made from', async () => {
    const shared = { name: 'Orders ✓ 注文', document: sampleDocument() };

    const opened = await decodeShare(await made(shared));

    expect(opened).toEqual({ ok: true, value: shared });
  });

  it('makes a link that opens as the canvas with its messages, when it was made with them', async () => {
    const document = sampleDocument();
    const shared = { name: 'Orders', document, simulation: snapshotAfter(document, 1_400) };

    const opened = await decodeShare(await made(shared));

    expect(opened).toEqual({ ok: true, value: shared });
  });

  it('makes a link from a canvas that is frozen, and does not change it', async () => {
    const shared = deepFreeze({ name: 'Orders', document: sampleDocument() });

    await made(shared);

    expect(shared).toEqual({ name: 'Orders', document: sampleDocument() });
  });

  describe('refusing', () => {
    it('never makes a link that it would refuse to open, and says what it would have said', async () => {
      const broken = { ...sampleDocument(), vhost: '' };

      const result = await encodeShare({ name: 'Orders', document: broken });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.kind).toBe('invalid');
      expect(!result.ok && result.error.message).toContain('vhost');
    });

    it('does not make a link for a canvas that has no name, or a name that is too long', async () => {
      expect(await encodeShare({ name: '  ', document: emptyDocument() })).toMatchObject({
        ok: false,
        error: { kind: 'invalid' },
      });
      expect(await encodeShare({ name: 'x'.repeat(SIZE_CAPS.name + 1), document: emptyDocument() })).toMatchObject({
        ok: false,
        error: { kind: 'too-large', what: 'name' },
      });
    });

    it('does not make a link with messages that are not those of the canvas', async () => {
      const elsewhere = snapshotAfter(documentOf({ queues: { Q9: queueRecord('elsewhere') } }), 600);

      const result = await encodeShare({ name: 'Orders', document: sampleDocument(), simulation: elsewhere });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toContain('Its messages are not those of this canvas');
    });

    it('does not make a link whose text is more than 2,000,000 bytes, and lets through a text that is exactly that', async () => {
      // The payloads are text of one byte a character, so the text of the envelope can be sized to the byte by the length of the last one.
      const FULL = 9_000;
      const sized = (count: number, last: number) => ({
        name: 'Orders',
        document: crowded(count, (index) => 'a'.repeat(index === count - 1 ? last : FULL)),
      });
      const bytes = (shared: ReturnType<typeof sized>): number =>
        encoder.encode(
          JSON.stringify({
            format: SHARE_FORMAT,
            version: SHARE_VERSION,
            name: shared.name,
            document: shared.document,
          }),
        ).length;
      const perProducer = bytes(sized(3, 0)) - bytes(sized(2, 0));
      let count = Math.floor((SIZE_CAPS.inflated - bytes(sized(1, 0))) / perProducer) + 1;
      while (bytes(sized(count, 0)) > SIZE_CAPS.inflated) {
        count -= 1;
      }
      while (bytes(sized(count + 1, 0)) <= SIZE_CAPS.inflated) {
        count += 1;
      }
      const last = SIZE_CAPS.inflated - bytes(sized(count, 0));
      expect(last).toBeGreaterThanOrEqual(0);
      expect(last).toBeLessThan(FULL + 1_000);
      const exactly = sized(count, last);
      const one = sized(count, last + 1);
      expect(bytes(exactly)).toBe(SIZE_CAPS.inflated);
      expect(bytes(one)).toBe(SIZE_CAPS.inflated + 1);

      const over = await encodeShare(one);
      const at = await encodeShare(exactly);

      expect(over).toMatchObject({
        ok: false,
        error: { kind: 'too-large', what: 'inflated', found: SIZE_CAPS.inflated + 1, limit: SIZE_CAPS.inflated },
      });
      expect(at.ok).toBe(true);
      expect(await decodeShare(at.ok ? at.value : '')).toEqual({ ok: true, value: exactly });
    });

    it('does not make a link of more than 256,000 characters, which is what a canvas that does not compress comes to', async () => {
      let state = 12345;
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
      const noise = (length: number): string => {
        let text = '';
        for (let index = 0; index < length; index += 1) {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
          text += letters.charAt(state >>> 26);
        }
        return text;
      };

      const result = await encodeShare({ name: 'Orders', document: crowded(60, () => noise(8_000)) });

      expect(result).toMatchObject({ ok: false, error: { kind: 'too-large', what: 'link', limit: SIZE_CAPS.link } });
      expect(!result.ok && result.error.kind === 'too-large' && result.error.found).toBeGreaterThan(SIZE_CAPS.link);
      expect(!result.ok && result.error.message).toContain('A canvas that big is sent as a file.');
    });

    it('says that the browser cannot, when it has no compression, and does not try', async () => {
      vi.stubGlobal('CompressionStream', undefined);

      const result = await encodeShare({ name: 'Orders', document: emptyDocument() });

      expect(result).toMatchObject({ ok: false, error: { kind: 'unsupported' } });
      expect(!result.ok && result.error.message).toContain('it has no CompressionStream');
    });
  });
});

describe('decodeShare', () => {
  describe('text that is not a link of this app', () => {
    it.each([[undefined], [null], [5], [{}], [[]], [Symbol('s')]])(
      'is refused when it is %s, because it never throws',
      async (odd) => {
        expect(await refused(odd as never)).toEqual({
          kind: 'not-a-link',
          message: 'This is not a link of this app: it is not text. Nothing was opened and nothing was changed.',
        });
      },
    );

    it.each([
      [''],
      ['hello'],
      ['v1'],
      ['v1abc'],
      ['V1.abc'],
      ['v.abc'],
      [' v1.abc'],
      ['v0.abc'],
      ['v01.abc'],
      ['v-1.abc'],
      ['v1000000.abc'],
      ['version1.abc'],
      ['c=v1.abc'],
      ['#c=v1.abc'],
      ['https://learner.test/#c=v1.abc'],
    ])('is refused when it is %j, and the sentence says what a link starts with', async (text) => {
      expect(await refused(text)).toEqual({
        kind: 'not-a-link',
        message:
          'This is not a link of this app: it does not start with “v1.”, as every link of this app does. Nothing was opened and nothing was changed.',
      });
    });

    it('is refused when there is nothing after v1.', async () => {
      expect(await refused('v1.')).toEqual({
        kind: 'not-a-link',
        message:
          'This is not a link of this app: there is nothing after “v1.”. Nothing was opened and nothing was changed.',
      });
    });

    it.each([
      ['v1.ab+/', '"+"', 6],
      ['v1.Zg==', '"="', 6],
      ['v1.Zm 9', '" "', 6],
      ['v1.Zm9v!', '"!"', 8],
      ['v1.Zm9v&utm=1', '"&"', 8],
      ['v1.5.abc', '"."', 5],
      ['v1.Zm9😀', '"😀"', 7],
      ['v1.Zm9v\n', '"\\n"', 8],
    ])(
      'is refused when it is %j, with the character that it should not have and the place it is at',
      async (text, shown, place) => {
        const error = await refused(text);

        expect(error.kind).toBe('not-a-link');
        expect(error.message).toBe(
          `This is not a link of this app: it has a character that a link never has (${shown} at place ${place} after “#c=”). Nothing was opened and nothing was changed.`,
        );
      },
    );
  });

  describe('a link of a version that this app does not have', () => {
    it.each([2, 3, 9, 10, 999_999])(
      'is a link from a newer app when it says v%i, and is refused before anything is read',
      async (version) => {
        expect(await refused(`v${version}.this is not even base64!`)).toEqual({
          kind: 'newer-version',
          of: 'link',
          found: version,
          understood: 1,
          message: `This link was made by a newer version of this app. It is link format ${version}, and this version reads up to format 1. Reload the page to get the newest version, then open it again. Nothing was loaded and nothing was changed.`,
        });
      },
    );
  });

  describe('a link that is cut short or changed', () => {
    it('is damaged when its length is not one that a link has, and the sentence says that chat apps do that', async () => {
      const error = await refused('v1.AAAAA');

      expect(error.kind).toBe('damaged');
      expect(error.message).toBe(
        'This link is cut short or was changed on the way: its length is not one that a link can have. Chat apps and mail clients do that to a long link, so ask for it again, or for a file. Nothing was opened and nothing was changed.',
      );
    });

    it('is damaged when what it holds is not deflated text, and says what the platform said', async () => {
      const error = await refused(`v1.${toBase64Url(new Uint8Array(8).fill(0xff))}`);

      expect(error.kind).toBe('damaged');
      expect(error.message).toMatch(
        /^This link is cut short or was changed on the way: it could not be unpacked \(.+\)\. Chat apps/,
      );
    });

    it('is damaged at every place that it is cut, and never opens as another canvas', async () => {
      const payload = await made({ name: 'Orders', document: sampleDocument() });

      for (let keep = SHARE_PREFIX.length + 1; keep < payload.length; keep += 1) {
        const result = await decodeShare(payload.slice(0, keep));

        expect(result.ok, `cut to ${keep} of ${payload.length}`).toBe(false);
        expect(!result.ok && result.error.kind, `cut to ${keep}`).toBe('damaged');
      }
    });

    it('is refused, and not opened as a canvas, when what it holds is not text', async () => {
      const error = await refused(await packed(new Uint8Array([0xff, 0xfe, 0xfd, 0x80, 0xc0])));

      expect(error).toEqual({
        kind: 'damaged',
        message:
          'This link is cut short or was changed on the way: what it holds is not text. Chat apps and mail clients do that to a long link, so ask for it again, or for a file. Nothing was opened and nothing was changed.',
      });
    });

    it.each([[''], ['not json'], ['{"format":'], ['{'], ['undefined'], ['{"a":1}}']])(
      'is refused when what it holds is %j, which is not JSON',
      async (content) => {
        const error = await refused(await packed(content));

        expect(error.kind).toBe('damaged');
        expect(error.message).toMatch(
          /^This link is cut short or was changed on the way: what it holds is not JSON \(.+\)\. Chat apps/,
        );
      },
    );

    it('opens a link that has a byte order mark in front of its text, as a file does', async () => {
      const bom = String.fromCharCode(0xfeff);

      expect((await decodeShare(await packed(bom + JSON.stringify(envelope())))).ok).toBe(true);
    });
  });

  describe('a link that opens into something that is not a canvas', () => {
    it.each([['[]'], ['5'], ['"text"'], ['null'], ['true']])(
      'is refused when its text is the JSON %s, which is not an object',
      async (content) => {
        expect((await refused(await packed(content))).kind).toBe('not-an-object');
      },
    );

    it('is told to open the file of a canvas as a file, and a backup as a backup', async () => {
      expect(await refused(await linkOf(envelope({ format: CANVAS_FILE_FORMAT })))).toMatchObject({
        kind: 'unknown-format',
        message: 'This is the file of one canvas, and not a link. Open it with “Open a file…” on the home.',
      });
      expect(await refused(await linkOf(envelope({ format: BACKUP_FORMAT })))).toMatchObject({
        kind: 'unknown-format',
        message:
          'This is a backup of several canvases, and not a link. Put it back with “Restore a backup…” on the home.',
      });
    });

    it('is refused when it is from a newer envelope, though the prefix was the one it knows', async () => {
      expect(await refused(await linkOf(envelope({ version: 2 })))).toMatchObject({
        kind: 'newer-version',
        of: 'link',
        found: 2,
      });
    });

    it('is refused when the canvas in it is from a newer schema', async () => {
      const document = { ...(envelope()['document'] as Raw), schemaVersion: 2 };

      expect(await refused(await linkOf(envelope({ document })))).toMatchObject({
        kind: 'newer-version',
        of: 'schema',
        found: 2,
      });
    });

    it('is refused, as a file would be, when the canvas in it is over a cap or is not valid', async () => {
      const crowded = {
        ...(envelope()['document'] as Raw),
        exchanges: Object.fromEntries(Array.from({ length: SIZE_CAPS.elements + 1 }, (_, i) => [`e${i}`, {}])),
      };

      expect(await refused(await linkOf(envelope({ document: crowded })))).toMatchObject({
        kind: 'too-large',
        what: 'elements',
      });
      expect(
        await refused(await linkOf(envelope({ document: { ...(envelope()['document'] as Raw), vhost: 5 } }))),
      ).toMatchObject({
        kind: 'invalid',
      });
    });

    it('is refused when a binding has an x-match that does not exist, and when a header is an integer that is not safe (question 3 of OPEN_QUESTIONS)', async () => {
      const document = viaJson(sampleDocument()) as {
        bindings: Record<string, { headers: { xMatch: string } }>;
        producers: Record<string, { message: { headers: unknown[] } }>;
      };
      const badMatch = structuredClone(document);
      badMatch.bindings['B2']!.headers.xMatch = 'bogus';
      const unsafe = structuredClone(document);
      unsafe.producers['P1']!.message.headers = [{ key: 'n', value: { t: 'integer', v: 2 ** 60 } }];

      expect(await refused(await linkOf(envelope({ document: badMatch })))).toMatchObject({ kind: 'invalid' });
      expect(await refused(await linkOf(envelope({ document: unsafe })))).toMatchObject({ kind: 'invalid' });
    });

    it('is refused when its messages are not those of its canvas, or are not messages', async () => {
      const foreign = viaJson(snapshotAfter(documentOf({ exchanges: { E9: exchangeRecord('elsewhere') } }), 0));

      expect(await refused(await linkOf(envelope({ simulation: foreign })))).toMatchObject({ kind: 'invalid' });
      expect(await refused(await linkOf(envelope({ simulation: 'messages' })))).toMatchObject({ kind: 'invalid' });
    });
  });

  describe('a link that is made to do harm', () => {
    it('is stopped at the cap of text, and does not make the 50 MB that a link of 48 KB opens into', async () => {
      const bomb = `${SHARE_PREFIX}${toBase64Url(await deflate(new Uint8Array(50_000_000)))}`;
      expect(bomb.length).toBeLessThan(SIZE_CAPS.link);

      const started = Date.now();
      const error = await refused(bomb);

      expect(error.kind).toBe('too-large');
      expect(error.kind === 'too-large' && error.what).toBe('inflated');
      expect(error.kind === 'too-large' && error.found).toBeLessThan(10_000_000);
      expect(error.message).toContain('more than 2,000,000 bytes');
      expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('is stopped at exactly 2,000,000 bytes of text: that many is read, and one more is too many', async () => {
      const at = await refused(await packed(' '.repeat(SIZE_CAPS.inflated)));
      const over = await refused(await packed(' '.repeat(SIZE_CAPS.inflated + 1)));

      expect(at.kind).toBe('damaged');
      expect(at.message).toContain('is not JSON');
      expect(over.kind).toBe('too-large');
    });

    it('is refused for its length before anything is read: 256,001 characters, and not 256,000', async () => {
      const long = `${SHARE_PREFIX}${'A'.repeat(SIZE_CAPS.link - SHARE_PREFIX.length)}`;

      expect(long.length).toBe(SIZE_CAPS.link);
      expect((await refused(long)).kind).toBe('damaged');
      expect(await refused(`${long}A`)).toMatchObject({
        kind: 'too-large',
        what: 'link',
        found: SIZE_CAPS.link + 1,
        limit: SIZE_CAPS.link,
      });
      expect((await refused(`v2.${'!'.repeat(SIZE_CAPS.link)}`)).kind).toBe('too-large');
    });

    it('is refused when its text is nested a hundred thousand deep, in a list, in an object, or in the canvas, and does not run out of stack', async () => {
      const deep = 100_000;
      const lists = '['.repeat(deep) + ']'.repeat(deep);
      const objects = '{"a":'.repeat(deep) + '1' + '}'.repeat(deep);
      const inCanvas = `{"format":"${SHARE_FORMAT}","version":1,"name":"x","document":${objects}}`;

      expect((await refused(await packed(lists))).kind).toBe('not-an-object');
      expect((await refused(await packed(objects))).kind).toBe('unknown-format');
      expect((await refused(await packed(inCanvas))).kind).toBe('unknown-format');
    });

    it('is refused when its text is a million open brackets, which is not JSON', async () => {
      const error = await refused(await packed('['.repeat(1_000_000)));

      expect(error.kind).toBe('damaged');
    });

    it('does not set a prototype, whatever the keys of its text are', async () => {
      const clean = JSON.stringify(viaJson(sampleDocument()));
      const text = (document: string, extra = ''): string =>
        `{${extra}"format":"${SHARE_FORMAT}","version":1,"name":"x","document":${document}}`;
      const polluting = '"__proto__":{"polluted":true},';

      const attempts: readonly (readonly [string, string, string])[] = [
        ['the envelope', text(clean, polluting), 'invalid'],
        ['the envelope, as the constructor', text(clean, '"constructor":{"prototype":{"polluted":true}},'), 'invalid'],
        ['a document that is only a prototype', text('{"__proto__":{"polluted":true}}'), 'unknown-format'],
        ['the layout', text(clean.replace('"layout":{', `"layout":{${polluting}`)), 'invalid'],
        ['the settings', text(clean.replace('"settings":{', `"settings":{${polluting}`)), 'invalid'],
        // The schema reads a record of elements without a key that is no id, and keeps nothing of it.
        ['the exchanges', text(clean.replace('"exchanges":{', `"exchanges":{${polluting}`)), 'left out'],
      ];
      for (const [where, attempt, outcome] of attempts) {
        const result = await decodeShare(await packed(attempt));

        if (outcome === 'left out') {
          expect(result.ok, where).toBe(true);
          const exchanges = result.ok ? result.value.document.exchanges : {};
          expect(Object.hasOwn(exchanges, '__proto__'), where).toBe(false);
          expect(Object.getPrototypeOf(exchanges), where).toBe(Object.prototype);
          expect(result.ok && validateDocument(result.value.document), where).toEqual([]);
        } else {
          expect(!result.ok && result.error.kind, where).toBe(outcome);
        }
      }

      expect(({} as Raw)['polluted']).toBeUndefined();
      expect((Object.prototype as Raw)['polluted']).toBeUndefined();
    });

    it('is refused when an element refers to an id that is a property of every object, because it is not there', async () => {
      const document = viaJson(sampleDocument()) as { bindings: Record<string, { source: string }> };
      for (const id of ['constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
        const changed = structuredClone(document);
        changed.bindings['B1']!.source = id;

        const error = await refused(await linkOf(envelope({ document: changed })));

        expect(error.kind, id).toBe('invalid');
      }
    });

    it('opens as text, and as only text, when the canvas has names that are HTML or script (ADR-0078)', async () => {
      const hostile = [
        '<img src=x onerror=alert(1)>',
        '<script>alert(1)</script>',
        'javascript:alert(1)',
        '" onmouseover="alert(1)',
        '{{constructor.constructor("alert(1)")()}}',
      ];
      const base = sampleDocument();
      const document = {
        ...base,
        exchanges: { ...base.exchanges, E1: { ...base.exchanges['E1']!, name: hostile[0]! } },
        queues: { ...base.queues, Q1: { ...base.queues['Q1']!, name: hostile[1]! } },
        producers: { ...base.producers, P1: { ...base.producers['P1']!, name: hostile[2]! } },
        consumers: { ...base.consumers, C1: { ...base.consumers['C1']!, name: hostile[3]! } },
      };

      const opened = await decodeShare(await made({ name: hostile[4]!, document }));

      expect(opened).toEqual({ ok: true, value: { name: hostile[4], document } });
    });

    it('is refused in words that are sentences, and none of them ends a sentence twice', async () => {
      const refusals = await Promise.all([
        refused('hello'),
        refused('v1.'),
        refused('v1.!'),
        refused('v2.x'),
        refused('v1.AAAAA'),
        refused(`v1.${toBase64Url(new Uint8Array(8).fill(0xff))}`),
        refused(await packed(new Uint8Array([0xff, 0xfe]))),
        refused(await packed('not json')),
        refused(await packed('[]')),
        refused(await linkOf(envelope({ name: '' }))),
        refused(await linkOf(envelope({ version: 2 }))),
        refused(`${SHARE_PREFIX}${'A'.repeat(SIZE_CAPS.link)}`),
        refused(await packed(new Uint8Array(3_000_000))),
      ]);

      for (const error of refusals) {
        expect(error.message, error.kind).not.toContain('..');
        expect(error.message, error.kind).toMatch(/[.”]$/);
        expect(error.message.length, error.kind).toBeGreaterThan(30);
      }
    });
  });

  describe('a browser that cannot unpack', () => {
    it('still says that a link is not one, and that it is from a newer app, but says that it cannot open one that is well made', async () => {
      const payload = await made({ name: 'Orders', document: emptyDocument() });
      vi.stubGlobal('DecompressionStream', undefined);

      expect((await refused('hello')).kind).toBe('not-a-link');
      expect((await refused('v2.x')).kind).toBe('newer-version');
      expect((await refused('v1.!')).kind).toBe('not-a-link');
      expect(await refused(payload)).toMatchObject({ kind: 'unsupported' });
    });
  });
});
