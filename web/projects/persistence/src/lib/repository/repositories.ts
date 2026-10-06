import { createIdbStore, type IdbStoreOptions } from './idb-store';
import { createMemoryStore } from './memory-store';
import { createCanvasRepository, type CanvasRepository, type RepositoryOptions } from './repository';

/**
 * A repository that keeps canvases in memory, for specs of whatever uses one, and for a browser that does not let the site keep
 * data (ADR-0028). It behaves as the one on IndexedDB does.
 */
export const createMemoryRepository = (options: RepositoryOptions): CanvasRepository =>
  createCanvasRepository(createMemoryStore(), options);

export interface IdbRepositoryOptions extends RepositoryOptions {
  /** Which database, which version of it, and how it is upgraded. A spec changes these. The app does not. */
  readonly database?: IdbStoreOptions;
}

/** The repository that the app uses: canvases that stay in the browser, in IndexedDB. */
export function createIdbRepository(options: IdbRepositoryOptions): CanvasRepository {
  const { database, ...repository } = options;
  return createCanvasRepository(createIdbStore(database), repository);
}
