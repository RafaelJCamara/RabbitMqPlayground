import type { Page } from '@playwright/test';
import { applyCommand, emptyDocument, type CanvasDocument, type DocumentCommand } from '@rmq/domain';
import { sequentialIds } from '@rmq/testing';

/**
 * Canvases for the end-to-end tests, made with the commands of the domain, so that a test starts from a document that the app could
 * have made, and put into IndexedDB the way that the app keeps them (ADR-0028) before the app starts.
 */

/** A canvas that the commands make, in the order given, with ids `x1`, `q1`, `p1`, `c1` and `b1`. A refused command throws. */
export function buildDocument(
  commands: readonly DocumentCommand[],
  start: CanvasDocument = emptyDocument(),
): CanvasDocument {
  const ids = sequentialIds();
  return commands.reduce((document, command, index) => {
    const result = applyCommand(document, command, ids);
    if (!result.ok) {
      throw new Error(`Command ${index + 1} was refused: ${result.error.message}`);
    }
    return result.value;
  }, start);
}

/**
 * Writes one canvas into the database of the app, and says that it is the one that was open last. It goes to a page of the same
 * origin that is not the app (so that the app has not started and made a canvas of its own), and it makes the database as
 * the app does: version 1, with a store for the canvases under `id` and one for the small values.
 */
export async function seedCanvas(page: Page, document: CanvasDocument, name = 'Seeded canvas'): Promise<void> {
  await page.goto('build-info.json');
  await page.evaluate(
    async ({ record }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('rmq-playground', 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('canvases', { keyPath: 'id' });
          open.result.createObjectStore('meta');
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['canvases', 'meta'], 'readwrite');
        transaction.objectStore('canvases').put(record);
        transaction.objectStore('meta').put(record.id, 'lastOpenCanvas');
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    { record: { id: 'seeded', name, createdAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, document } },
  );
}

/** A canvas to put in the database: the document is empty unless the test gives one, and the times are fixed so that the order of the home is known. */
export interface SeededCanvas {
  readonly id: string;
  readonly name: string;
  readonly document?: CanvasDocument;
  readonly createdAt?: number;
  readonly updatedAt?: number;
}

/**
 * Writes several canvases into the database of the app, and what the workspace keeps of the strip (ADR-0072), the way `seedCanvas` does: to a page of the same
 * origin that is not the app, before the app starts. Without `meta` the app opens the most recent canvas, and its strip is that one.
 */
export async function seedLibrary(
  page: Page,
  canvases: readonly SeededCanvas[],
  meta: { readonly openCanvases?: readonly string[]; readonly lastOpenCanvas?: string } = {},
): Promise<void> {
  // A canvas that the test does not date was made a minute ago, one after the other, so that the order of the home is known and nothing is old enough to be reminded of.
  const base = Date.now() - 60_000;
  await page.goto('build-info.json');
  await page.evaluate(
    async ({ records, values }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open('rmq-playground', 1);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('canvases', { keyPath: 'id' });
          open.result.createObjectStore('meta');
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(['canvases', 'meta'], 'readwrite');
        for (const record of records) {
          transaction.objectStore('canvases').put(record);
        }
        for (const [key, value] of Object.entries(values)) {
          transaction.objectStore('meta').put(value, key);
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      records: canvases.map(({ id, name, document, createdAt, updatedAt }, index) => ({
        id,
        name,
        createdAt: createdAt ?? base + index,
        updatedAt: updatedAt ?? base + index,
        document: document ?? emptyDocument(),
      })),
      values: Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)),
    },
  );
}
