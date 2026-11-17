import { applyEdits, commentEdit, findUsesSites } from './pin';
import type { Edit, PinProblem } from './pin';

/** An action named on the command line: `owner/repo[/path][@ref]`. */
export interface ActionSpec {
  /** `owner/repo` or `owner/repo/path`, as given. */
  name: string;
  owner: string;
  repo: string;
  /** The tag or branch asked for; undefined means the latest release. */
  ref?: string;
}

/** What to move an action to: the ref asked for and its commit. */
export interface UpdateTarget {
  name: string;
  ref: string;
  sha: string;
}

/** A reference re-pinned to the target's commit. */
export interface UpdateChange {
  line: number;
  /** The reference as it was. */
  uses: string;
  ref: string;
  sha: string;
  /** The new reference, `name@<sha>`. */
  updated: string;
}

export interface UpdateResult {
  content: string;
  changes: UpdateChange[];
  /** References of the action that couldn't be edited (left unchanged). */
  skipped: PinProblem[];
  /** How many references of the action the file has, changed or not. */
  matched: number;
}

/**
 * Parse `owner/repo[/path][@ref]`, or undefined for anything that isn't a
 * remote action (a local `./` path, `docker://`, an empty part).
 */
export function parseActionSpec(spec: string): ActionSpec | undefined {
  if (/^(\.|\/|docker:\/\/)/.test(spec)) return undefined;
  const at = spec.lastIndexOf('@');
  const name = at === -1 ? spec : spec.slice(0, at);
  const ref = at === -1 ? undefined : spec.slice(at + 1);
  const parts = name.split('/');
  if (parts.length < 2 || parts.some((p) => !p) || ref === '') {
    return undefined;
  }
  return {
    name,
    owner: parts[0],
    repo: parts[1],
    ...(ref !== undefined ? { ref } : {})
  };
}

/** `owner/repo` lowercased, then any path, as GitHub matches names. */
function normalize(name: string): string {
  const parts = name.split('/');
  return [
    ...parts.slice(0, 2).map((p) => p.toLowerCase()),
    ...parts.slice(2)
  ].join('/');
}

/** The `owner/repo[/path]` of a remote `uses:` value, or undefined. */
function remoteName(uses: string): string | undefined {
  if (/^(\.\.?\/|docker:\/\/)/.test(uses)) return undefined;
  const at = uses.lastIndexOf('@');
  if (at === -1) return undefined;
  const name = uses.slice(0, at);
  const parts = name.split('/');
  if (!uses.slice(at + 1) || parts.length < 2 || parts.some((p) => !p)) {
    return undefined;
  }
  return name;
}

/**
 * Whether a `uses:` value is the action `name`: `owner/repo` matches every
 * path in that repository (all of `github/codeql-action/*` move together,
 * as they share one tag), `owner/repo/path` only that path.
 */
export function matchesAction(uses: string, name: string): boolean {
  const own = remoteName(uses);
  if (!own) return false;
  const want = normalize(name);
  const have = normalize(own);
  if (want.split('/').length > 2) return have === want;
  return have === want || have.startsWith(`${want}/`);
}

/** Each remote repository (`owner/repo`) a file uses, once, in order. */
export function remoteActionRepos(content: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const { uses } of findUsesSites(content)) {
    const name = remoteName(uses);
    if (!name) continue;
    const repo = name.split('/').slice(0, 2).join('/');
    if (seen.has(repo.toLowerCase())) continue;
    seen.add(repo.toLowerCase());
    result.push(repo);
  }
  return result;
}

const VERSION_TAG = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/i;

/**
 * The latest release among `tags`: the highest stable version (`v1.2.3`,
 * `1.2`, `v2`; pre-releases and non-version tags are ignored). Of tags
 * naming the same version (`v4` and `v4.0.0`), the most specific wins.
 */
export function latestTag(tags: Iterable<string>): string | undefined {
  let best: { tag: string; key: number[] } | undefined;
  for (const tag of tags) {
    const m = tag.match(VERSION_TAG);
    if (!m) continue;
    const parts = m.slice(1).filter((p) => p !== undefined);
    const key = [
      Number(m[1]),
      Number(m[2] ?? 0),
      Number(m[3] ?? 0),
      parts.length
    ];
    if (!best || compare(key, best.key) > 0) best = { tag, key };
  }
  return best?.tag;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Move every reference to `target.name` (see matchesAction) to
 * `name@<target.sha> # <target.ref>`, whether it was pinned to a commit or
 * on a tag or branch. Edited in place like `pin`: only the value (keeping
 * its quotes) and its trailing comment change.
 */
export function updateContent(
  content: string,
  target: UpdateTarget
): UpdateResult {
  const sites = findUsesSites(content);
  const result: UpdateResult = {
    content,
    changes: [],
    skipped: [],
    matched: 0
  };
  const lineCounts = new Map<number, number>();
  sites.forEach((s) =>
    lineCounts.set(s.line, (lineCounts.get(s.line) ?? 0) + 1)
  );
  const sha = target.sha.toLowerCase();
  const edits: Edit[] = [];

  for (const site of sites) {
    const { uses, line } = site;
    if (!matchesAction(uses, target.name)) continue;
    result.matched++;
    if (site.style === 'block') {
      result.skipped.push({
        line,
        uses,
        reason: 'is written as a block scalar; update it by hand'
      });
      continue;
    }
    const name = uses.slice(0, uses.lastIndexOf('@'));
    const updated = `${name}@${sha}`;
    const quote =
      site.style === 'single' ? "'" : site.style === 'double' ? '"' : '';
    const siteEdits: Edit[] = [
      { start: site.start, end: site.end, text: `${quote}${updated}${quote}` }
    ];
    // Several references on one line (a flow sequence) can't each have a
    // trailing comment, so none is written rather than a wrong one.
    if (lineCounts.get(line) === 1) {
      siteEdits.push(commentEdit(content, site.end, target.ref));
    }
    const unchanged = siteEdits.every(
      (e) => content.slice(e.start, e.end) === e.text
    );
    if (unchanged) continue;
    edits.push(...siteEdits);
    result.changes.push({
      line,
      uses,
      ref: target.ref,
      sha,
      updated
    });
  }

  result.content = applyEdits(content, edits);
  return result;
}
