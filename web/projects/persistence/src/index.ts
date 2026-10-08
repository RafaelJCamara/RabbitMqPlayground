export { DB_NAME, DB_VERSION, STORES, type StoreName } from './lib/storage';
export { failure, succeed, type Outcome } from './lib/outcome';
export type {
  CanvasError,
  LoadError,
  RepositoryError,
  ShareError,
  StorageError,
  TooLargeWhat,
  VersionOf,
} from './lib/errors';
export { SIZE_CAPS } from './lib/load/caps';
export { loadCanvas, type Loaded } from './lib/load/load';
export { CURRENT_SCHEMA_VERSION } from './lib/load/migrations';
export type { CanvasRecord } from './lib/record';
export {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  CANVAS_FILE_FORMAT,
  CANVAS_FILE_VERSION,
  SHARE_FORMAT,
  SHARE_VERSION,
} from './lib/files/formats';
export {
  decodeShare,
  encodeShare,
  payloadOf,
  SHARE_KEY,
  SHARE_PREFIX,
  SHARE_WARN_AT,
  shareLink,
} from './lib/share/codec';
export { readShare, type Shared } from './lib/share/share';
export {
  definitionsText,
  exportDefinitions,
  NOT_IN_THE_FILE,
  planDefinitions,
  vhostIssue,
  type DefinitionsPlan,
  type DefinitionsSummary,
  type DefinitionsWarning,
  type ExportedDefinitions,
  type ExportError,
  type WarningKind,
} from './lib/export/definitions';
export { parseCanvasFile, readCanvasFile, writeCanvasFile, type CanvasFile } from './lib/files/canvas-file';
export { parseBackup, readBackup, writeBackup, type Backup, type BackupEntry } from './lib/files/backup';
export {
  cutName,
  planRestore,
  restoreBackup,
  restoredName,
  sameValue,
  type Restored,
  type RestoreHeld,
  type RestoreReport,
  type RestoreStep,
} from './lib/files/restore';
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
export {
  AUTOSAVE_DELAY_MS,
  createAutosave,
  systemTimer,
  type Autosave,
  type AutosaveOptions,
  type AutosaveTimer,
} from './lib/autosave';
export {
  formatBytes,
  QUOTA_CRITICAL_AT,
  QUOTA_LOW_AT,
  quotaWarning,
  readUsage,
  requestPersistence,
  type PersistResult,
  type PersistStatus,
  type QuotaLevel,
  type QuotaWarning,
  type StorageManagerLike,
  type StorageUsage,
} from './lib/storage-manager';
