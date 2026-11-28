import * as fs from 'fs';
import * as path from 'path';
import { repositoryRoot } from './repository';

/**
 * Where the parser reads workflow, action and lock files from, and how
 * `./` references between them resolve: the disk (the CLI), or an
 * in-memory map of a repository's files (the library). The checks never
 * touch `fs` directly, so a map can't make them read the host's disk.
 */
export interface FileSource {
  /** The file's text, or undefined when there is no such file. */
  read(file: string): string | undefined;
  /** Whether `file` is a file (not a directory, not missing). */
  isFile(file: string): boolean;
  /** The repository root that `./` references in `file` resolve against. */
  root(file: string): string;
  /** `segments` joined and resolved into one path, as `path.resolve`. */
  resolve(...segments: string[]): string;
  /** `file` relative to `root`, for messages. */
  relative(root: string, file: string): string;
}

/** Files on disk; `./` resolves as on GitHub (see repositoryRoot). */
export const diskFiles: FileSource = {
  read: (file) =>
    fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined,
  isFile: (file) => fs.existsSync(file) && fs.statSync(file).isFile(),
  root: repositoryRoot,
  resolve: (...segments) => path.resolve(...segments),
  relative: (root, file) => path.relative(root, file)
};

/** A repository-relative POSIX path: no leading `./` or `/`. */
function normalize(file: string): string {
  const posix = path.posix.normalize(file.replace(/\\/g, '/'));
  return posix.replace(/^\/+/, '').replace(/^(\.\/)+/, '');
}

/**
 * A repository's files, keyed by repository-relative path
 * (`.github/workflows/ci.yml`). Every `./` reference resolves against the
 * repository root, and a path that leaves it (`../x`) is never a file.
 */
export function memoryFiles(
  files: Readonly<Record<string, string>>
): FileSource {
  const byPath = new Map(
    Object.entries(files).map(([file, text]) => [normalize(file), text])
  );
  const lookup = (file: string): string | undefined => {
    const key = normalize(file);
    return key.startsWith('../') ? undefined : byPath.get(key);
  };
  return {
    read: lookup,
    isFile: (file) => lookup(file) !== undefined,
    root: () => '',
    resolve: (...segments) => normalize(path.posix.join(...segments)),
    relative: (_root, file) => file
  };
}
