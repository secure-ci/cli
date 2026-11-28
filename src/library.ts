import * as path from 'path';
import {
  addTransitive,
  directActions,
  InventoryAction,
  ShaResolver
} from './inventory';
import { parsePipelineContractText } from './parser/pipeline-contract-parser';
import { buildReport, ContractInfo, ValidationReport } from './report';
import { FileSource, memoryFiles } from './utils/files';
import { AdvisorySource, validateFiles } from './validate';

export { lockEntries } from './inventory';
export type { AdvisorySource } from './validate';

/**
 * A repository's files: repository-relative path (`.github/workflows/ci.yml`)
 * to text. Only these are read; `./` references resolve within them, and
 * nothing is read from disk.
 */
export type RepoFiles = Readonly<Record<string, string>>;

/**
 * The workflows GitHub runs: `.github/workflows/*.yml` and `*.yaml`
 * (not subdirectories), in path order.
 */
function workflowPaths(files: RepoFiles): string[] {
  return Object.keys(files)
    .map((file) => file.replace(/\\/g, '/').replace(/^(\.\/|\/)+/, ''))
    .filter(
      (file) =>
        path.posix.dirname(file) === '.github/workflows' &&
        /\.ya?ml$/.test(file)
    )
    .sort();
}

export interface ValidateOptions {
  /** Files to validate (workflows or actions). Default: every workflow. */
  paths?: string[];
  /**
   * A pipeline contract to check workflows against: its YAML text, and
   * what to record in the report (`source`, and for a remote contract its
   * `ref` and `commit`).
   */
  contract?: ContractInfo & { content: string };
  /**
   * Local composite actions and reusable workflows to look inside for the
   * contract: `local` (default) or `none`. Remote ones aren't fetched.
   */
  contractRecurse?: 'none' | 'local';
  /**
   * Where to look up known security advisories (network). Omitted, none
   * are checked and the library makes no network calls.
   */
  advisories?: AdvisorySource;
}

/**
 * Validate a repository's workflow and action files, as `secureci validate
 * --format json` does, and return that report: structure, expressions,
 * template injection, permissions and dangerous triggers, then the
 * contract and advisories when given. Local composite actions and
 * reusable workflows are followed through `files`.
 */
export async function validate(
  files: RepoFiles,
  options: ValidateOptions = {}
): Promise<ValidationReport> {
  const { contract } = options;
  const { entries } = await validateFiles(
    options.paths ?? workflowPaths(files),
    {
      files: memoryFiles(files),
      contract: contract && (() => parsePipelineContractText(contract.content)),
      recurse: options.contractRecurse ?? 'local',
      offline: true,
      advisories: options.advisories
    }
  );
  if (!contract) return buildReport(entries);
  const info: ContractInfo = { ...contract };
  delete (info as Partial<typeof contract>).content;
  return buildReport(entries, { contract: info });
}

export interface InventoryOptions {
  /** Workflows to read. Default: every workflow. */
  paths?: string[];
  /**
   * Resolves a tag or branch (`owner/repo@v4`) to its commit SHA, or
   * undefined. Omitted, only references already pinned to a SHA resolve.
   */
  resolveSha?: ShaResolver;
  /**
   * Fetches a remote action's `action.yml` (kind `action`) or a reusable
   * workflow file (kind `reusable-workflow`) at `owner/repo[/path]@<sha>`,
   * returning its text or null. Given, the actions those use are added
   * (transitively, with `via`); omitted, only direct references are listed.
   */
  fetch?: (
    uses: string,
    kind: InventoryAction['kind']
  ) => Promise<string | null>;
}

export interface RepoInventory {
  /** Distinct remote actions and reusable workflows, sorted by `uses`. */
  actions: InventoryAction[];
  /** Remote actions that couldn't be fetched to read the actions they use. */
  warnings: string[];
}

/**
 * The actions and reusable workflows a repository's workflows use (local
 * composite actions and reusable workflows followed through `files`),
 * resolved to commits, as `secureci inventory --dry-run` lists them. Pass
 * the actions to lockEntries for diffLock / mergeLock / a secureci.lock.
 * Repository ids (`ownerId`, `repoId`) aren't looked up; set them on the
 * actions before lockEntries to record them.
 */
export async function buildInventory(
  files: RepoFiles,
  options: InventoryOptions = {}
): Promise<RepoInventory> {
  const { resolveSha, fetch } = options;
  const direct = await directActions(
    options.paths ?? workflowPaths(files),
    memoryFiles(files)
  );
  if (resolveSha) {
    for (const action of direct) {
      action.resolvedSha ??= await resolveSha(action.uses);
    }
  }
  const warnings: string[] = [];
  let actions = direct;
  if (fetch) {
    // Fetched files are keyed by their `owner/repo...@sha`, apart from the
    // repository's. A `./` path in one resolves to a key starting with
    // `./`, which is never fetched, so it reads nothing.
    const remote = new Map<string, string>();
    const remoteFiles: FileSource = {
      read: (file) => remote.get(file),
      isFile: (file) => remote.has(file),
      root: () => '',
      resolve: (...segments) => segments.filter(Boolean).join('/'),
      relative: (_root, file) => file
    };
    actions = await addTransitive(direct, {
      files: remoteFiles,
      resolveSha,
      warn: (message) => warnings.push(message),
      fetch: async (uses, kind) => {
        const text = await fetch(uses, kind);
        if (text === null) return null;
        remote.set(uses, text);
        return uses;
      }
    });
  }
  return {
    actions: [...actions].sort((a, b) => a.uses.localeCompare(b.uses)),
    warnings
  };
}
