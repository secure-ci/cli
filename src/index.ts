export * from './types';
export * from './parser/workflow-parser';
export * from './parser/validator';
export * from './runner/dry-run';
export * from './runner/executor';
export * from './utils/logger';

// Library API: the CLI's checks and fixes on file contents (no disk, and
// network only through the resolvers and fetchers passed in). See DOCS.md
// "Library use".
export { validate, buildInventory, lockEntries } from './library';
export type {
  RepoFiles,
  ValidateOptions,
  InventoryOptions,
  RepoInventory,
  AdvisorySource
} from './library';
export type { ValidationReport, FileReport, ContractInfo } from './report';
export type {
  AdvisoryReport,
  AdvisoryTarget,
  AdvisoryFinding
} from './advisories';
export { diffLock, mergeLock } from './inventory';
export type {
  InventoryAction,
  LockEntry,
  Lockfile,
  LockDiff,
  ShaResolver
} from './inventory';
export {
  parseSecureciLockfile,
  parseGitHubLockfile,
  serializeSecureciLockfile
} from './github-lockfile';
export { pinContent, applyEdits } from './pin';
export type { PinResult, PinChange, PinProblem, Edit } from './pin';
export { parseActionSpec, updateContent, latestTag } from './update';
export type {
  ActionSpec,
  UpdateTarget,
  UpdateResult,
  UpdateChange
} from './update';
