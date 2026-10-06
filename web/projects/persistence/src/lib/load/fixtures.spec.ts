import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateDocument } from '@rmq/domain';
import { deepFreeze } from '@rmq/testing';
import { describe, expect, it } from 'vitest';
import { loadCanvas } from './load';
import { CURRENT_SCHEMA_VERSION } from './migrations';

/**
 * ADR-0015 asks for a migration test for every schema version, and ADR-0027 says what that is: `fixtures/schema/vN/` holds
 * documents as version N wrote them, each one is loaded into the current document, and a file that is there is never edited,
 * because the day a migration is wrong, the file is the only proof. The manifest pins each file by the hash of what it parses
 * to, so that editing one fails here, and a different line ending does not.
 */

const ROOT = fileURLToPath(new URL('../../../../../fixtures/schema/', import.meta.url));

const hashOf = (text: string): string =>
  createHash('sha256')
    .update(JSON.stringify(JSON.parse(text)))
    .digest('hex');

const manifest = JSON.parse(readFileSync(`${ROOT}manifest.json`, 'utf8')) as {
  about: string;
  files: Record<string, string>;
};

const folders = readdirSync(ROOT).filter((name) => statSync(`${ROOT}${name}`).isDirectory());
const files = folders.flatMap((folder) => readdirSync(`${ROOT}${folder}`).map((name) => `${folder}/${name}`)).sort();
const versions = folders.map((folder) => Number(/^v(\d+)$/.exec(folder)?.[1])).sort((a, b) => a - b);

describe('the schema fixtures', () => {
  it('have a folder for every schema version from 1 to the current one, and none above it', () => {
    expect(folders.every((folder) => /^v[1-9]\d*$/.test(folder))).toBe(true);
    expect(versions).toEqual(Array.from({ length: CURRENT_SCHEMA_VERSION }, (_, index) => index + 1));
  });

  it('have at least one file for each version, and nothing in a folder but documents', () => {
    for (const version of versions) {
      const inFolder = files.filter((file) => file.startsWith(`v${version}/`));

      expect(inFolder.length, `v${version}`).toBeGreaterThan(0);
      expect(
        inFolder.every((file) => file.endsWith('.json')),
        `v${version}`,
      ).toBe(true);
    }
  });

  describe('the manifest', () => {
    it('lists every file, and no file that is not there', () => {
      expect(Object.keys(manifest.files).sort()).toEqual(files);
    });

    it('says what each file parses to, and does not mind the line endings of a checkout', () => {
      for (const file of files) {
        const text = readFileSync(`${ROOT}${file}`, 'utf8');

        expect(hashOf(text), file).toBe(manifest.files[file]);
        expect(hashOf(text.replaceAll('\n', '\r\n')), file).toBe(manifest.files[file]);
      }
    });

    it('notices a file that was edited, even by one character', () => {
      for (const file of files) {
        const text = readFileSync(`${ROOT}${file}`, 'utf8');

        expect(hashOf(text.replace('"schemaVersion"', '"schemaVersions"')), file).not.toBe(manifest.files[file]);
        expect(hashOf(text.replace(/"vhost": "([^"]*)"/, '"vhost": "$1x"')), file).not.toBe(manifest.files[file]);
      }
    });

    it('is a hash for every file, and it says why the files are never edited', () => {
      expect(Object.values(manifest.files).every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
      expect(manifest.about).toContain('is never edited');
    });
  });

  describe.each(versions)('written by schema version %i', (version) => {
    const own = files.filter((file) => file.startsWith(`v${version}/`));

    it.each(own)('%s says that it is that version', (file) => {
      const document = JSON.parse(readFileSync(`${ROOT}${file}`, 'utf8')) as { schemaVersion: number };

      expect(document.schemaVersion).toBe(version);
    });

    it.each(own)('%s loads into the current document, from frozen data, and is right', (file) => {
      const raw = deepFreeze(JSON.parse(readFileSync(`${ROOT}${file}`, 'utf8')) as Record<string, unknown>);
      const result = loadCanvas(raw);

      expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
      if (result.ok) {
        expect(result.value.from).toBe(version);
        expect(result.value.document.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(validateDocument(result.value.document)).toEqual([]);
      }
    });

    // The files of the current version need no migration, so loading them changes nothing. The older ones are changed on purpose.
    if (version === CURRENT_SCHEMA_VERSION) {
      it.each(own)('%s is the same document after loading, because nothing has to be migrated', (file) => {
        const raw = JSON.parse(readFileSync(`${ROOT}${file}`, 'utf8')) as Record<string, unknown>;
        const result = loadCanvas(raw);

        expect(result.ok).toBe(true);
        expect(result.ok && result.value.document).toEqual(raw);
      });
    }
  });
});
