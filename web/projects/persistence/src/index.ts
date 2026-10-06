export { DB_NAME, DB_VERSION, STORES, type StoreName } from './lib/storage';
export { failure, succeed, type Outcome } from './lib/outcome';
export type { CanvasError, LoadError, RepositoryError, StorageError, TooLargeWhat, VersionOf } from './lib/errors';
export { SIZE_CAPS } from './lib/load/caps';
export { loadCanvas, type Loaded } from './lib/load/load';
export { CURRENT_SCHEMA_VERSION } from './lib/load/migrations';
export type { CanvasRecord } from './lib/record';
export { BACKUP_FORMAT, BACKUP_VERSION, CANVAS_FILE_FORMAT, CANVAS_FILE_VERSION } from './lib/files/formats';
export { parseCanvasFile, readCanvasFile, writeCanvasFile, type CanvasFile } from './lib/files/canvas-file';
export { parseBackup, readBackup, writeBackup, type Backup, type BackupEntry } from './lib/files/backup';
export {
  TOMBSTONE_TTL_MS,
  type CanvasChange,
  type CanvasListing,
  type CanvasRepository,
  type MetaKey,
  type MetaValues,
  type NewCanvas,
  type RepositoryOptions,
  type RepositoryUsage,
  type UnreadableCanvas,
} from './lib/repository/repository';
export { createIdbRepository, createMemoryRepository, type IdbRepositoryOptions } from './lib/repository/repositories';
