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
