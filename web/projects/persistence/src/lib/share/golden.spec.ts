import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDocument, type CanvasDocument } from '@rmq/domain';
import type { EngineSnapshot } from '@rmq/engine';
import { engineFor } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { SHARE_VERSION } from '../files/formats';
import { SIZE_CAPS } from '../load/caps';
import { decodeShare, encodeShare, payloadOf, SHARE_PREFIX, SHARE_WARN_AT, shareLink } from './codec';

/**
 * A link that has been sent cannot be recalled (ADR-0013), so every link that a version of the format made has to open in every later version (ADR-0077). `fixtures/share/vN/`
 * holds links as version N made them, each with the canvas it must open as, and a file that is there is never edited, because the day a reader stops opening one, the file is the only
 * proof. The manifest pins each file by what it holds, so that editing one fails here, and a different line ending does not. The links are decoded and not compared with what the
 * encoder makes: the bytes of a compressor differ between builds of zlib.
 */

const ROOT = fileURLToPath(new URL('../../../../../fixtures/share/', import.meta.url));

/** What a file holds, for the manifest: the text of a link, without the line ending, or what a JSON file parses to. */
const hashOf = (file: string, text: string): string =>
  createHash('sha256')
    .update(file.endsWith('.json') ? JSON.stringify(JSON.parse(text)) : text.trim())
    .digest('hex');

const viaJson = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

const manifest = JSON.parse(readFileSync(`${ROOT}manifest.json`, 'utf8')) as {
  about: string;
  files: Record<string, string>;
};

const folders = readdirSync(ROOT).filter((name) => statSync(`${ROOT}${name}`).isDirectory());
const files = folders.flatMap((folder) => readdirSync(`${ROOT}${folder}`).map((name) => `${folder}/${name}`)).sort();
const versions = folders.map((folder) => Number(/^v(\d+)$/.exec(folder)?.[1])).sort((a, b) => a - b);
const links = files.filter((file) => file.endsWith('.link'));

const textOf = (file: string): string => readFileSync(`${ROOT}${file}`, 'utf8');

interface Expected {
  readonly name: string;
  readonly document: CanvasDocument;
  readonly simulation?: EngineSnapshot;
}

describe('the share fixtures (ADR-0077)', () => {
  it('have a folder for every version of the format from 1 to the current one, and none above it', () => {
    expect(folders.every((folder) => /^v[1-9]\d*$/.test(folder))).toBe(true);
    expect(versions).toEqual(Array.from({ length: SHARE_VERSION }, (_, index) => index + 1));
  });

  it('have, for each link, the canvas it must open as, and nothing in a folder that is neither', () => {
    expect(files.every((file) => file.endsWith('.link') || file.endsWith('.expected.json'))).toBe(true);
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      expect(files, link).toContain(link.replace(/\.link$/, '.expected.json'));
    }
    expect(files.length).toBe(links.length * 2);
  });

  describe('the manifest', () => {
    it('lists every file, and no file that is not there', () => {
      expect(Object.keys(manifest.files).sort()).toEqual(files);
    });

    it('says what each file holds, and does not mind the line endings of a checkout', () => {
      for (const file of files) {
        expect(hashOf(file, textOf(file)), file).toBe(manifest.files[file]);
        expect(hashOf(file, textOf(file).replaceAll('\n', '\r\n')), file).toBe(manifest.files[file]);
      }
    });

    it('notices a file that was edited, even by one character', () => {
      for (const file of files) {
        const text = textOf(file);
        const edited = file.endsWith('.json') ? text.replace('"name"', '"names"') : `${text.trim()}A`;

        expect(hashOf(file, edited), file).not.toBe(manifest.files[file]);
      }
    });

    it('is a hash for every file, and it says why the files are never edited', () => {
      expect(Object.values(manifest.files).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
      expect(manifest.about).toContain('is never edited');
    });
  });

  describe.each(links)('the link %s', (file) => {
    const link = textOf(file).trim();
    const expected = JSON.parse(textOf(file.replace(/\.link$/, '.expected.json'))) as Expected;

    it('is a payload that this format makes: v1., the characters of base64url, and below the length at which chat apps cut a link', () => {
      expect(link.startsWith(SHARE_PREFIX)).toBe(true);
      expect(link).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
      expect(link.length).toBeLessThanOrEqual(SIZE_CAPS.link);
      expect(shareLink('https://learner.test/app/', link).length).toBeLessThan(SHARE_WARN_AT);
    });

    it('opens as the canvas that it was made from, down to the last field', async () => {
      const opened = await decodeShare(link);

      expect(opened.ok).toBe(true);
      expect(opened.ok && viaJson(opened.value)).toEqual(expected);
      expect(opened.ok && validateDocument(opened.value.document)).toEqual([]);
    });

    it('opens when it is the fragment of an address, as a browser gives it', async () => {
      const address = new URL(shareLink('https://learner.test/app/', link));

      const payload = payloadOf(address.hash);

      expect(payload).toBe(link);
      expect((await decodeShare(payload ?? '')).ok).toBe(true);
    });

    it('opens with the messages that it carries, when it carries any, as an engine takes them, and goes on from there', async () => {
      const opened = await decodeShare(link);
      const simulation = opened.ok ? opened.value.simulation : undefined;

      expect(simulation !== undefined).toBe('simulation' in expected);
      if (opened.ok && simulation !== undefined) {
        const engine = engineFor(opened.value.document);
        engine.restore(simulation);

        expect(viaJson(engine.snapshot())).toEqual(viaJson(simulation));
        expect(() => engine.advanceTo(engine.now() + 5_000)).not.toThrow();
      }
    });

    it('is a link that the encoder of today makes for the same canvas, and that opens as the same canvas', async () => {
      const made = await encodeShare(expected);

      expect(made.ok).toBe(true);
      const opened = await decodeShare(made.ok ? made.value : '');
      expect(opened.ok && viaJson(opened.value)).toEqual(expected);
    });
  });

  it('have a link that carries messages and links that do not, because a reader has to open both', () => {
    const withMessages = links.filter(
      (file) => 'simulation' in (JSON.parse(textOf(file.replace(/\.link$/, '.expected.json'))) as Expected),
    );

    expect(withMessages.length).toBeGreaterThanOrEqual(1);
    expect(withMessages.length).toBeLessThan(links.length);
  });
});
