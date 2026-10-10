import { describe, expect, it } from 'vitest';
import { isJsonFile, refusedKind } from './file-kind';

const file = (name: string, type = '') => ({ name, type });

describe('isJsonFile (ADR-0102)', () => {
  it.each([
    ['orders.json', ''],
    ['orders.JSON', ''],
    ['Orders.Json', 'application/json'],
    ['orders.rmq.json', ''],
    ['orders.rmq.json', 'application/json'],
    ['backup.json', 'text/json'],
    ['backup.json', 'application/vnd.api+json'],
    ['backup.json', 'application/json; charset=utf-8'],
    ['backup.json', 'APPLICATION/JSON'],
    ['.json', ''],
  ])('takes %s with the type "%s"', (name, type) => {
    expect(isJsonFile(file(name, type))).toBe(true);
    expect(refusedKind(file(name, type))).toBeNull();
  });

  it.each([
    ['canvas.js', 'text/javascript'],
    ['canvas.js', ''],
    ['page.html', 'text/html'],
    ['page.htm', ''],
    ['canvas.json.exe', 'application/x-msdownload'],
    ['canvas.json.exe', ''],
    ['canvas.json ', ''],
    ['canvas', ''],
    ['json', 'application/json'],
    ['canvas.jsonl', 'application/json'],
    ['canvas.json', 'text/html'],
    ['canvas.json', 'text/javascript'],
    ['canvas.json', 'application/javascript'],
    ['canvas.json', 'image/svg+xml'],
    ['canvas.json', 'application/x-json-not'],
    ['canvas.svg', 'image/svg+xml'],
    ['archive.zip', 'application/zip'],
    ['', ''],
  ])('refuses %s with the type "%s"', (name, type) => {
    expect(isJsonFile(file(name, type))).toBe(false);
    expect(refusedKind(file(name, type))).not.toBeNull();
  });

  it('takes a file that the browser gave no type at all, by its name', () => {
    expect(isJsonFile({ name: 'orders.json' })).toBe(true);
    expect(isJsonFile({ name: 'orders.js' })).toBe(false);
  });
});

describe('refusedKind', () => {
  it('says which file, that only JSON files are opened, and which ones the app saves', () => {
    expect(refusedKind(file('x.js', 'text/javascript'))).toBe(
      '“x.js” is not a JSON file. This app opens only the JSON files it saves: a canvas (.rmq.json) or a backup.',
    );
  });
});
