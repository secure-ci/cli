import * as lib from './index';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const WORKFLOW = [
  'name: CI',
  'on: push',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4 # pinned soon',
  ''
].join('\n');

describe('library API (src/index.ts)', () => {
  it('exports validate, inventory, pin and update functions', () => {
    for (const name of [
      'validate',
      'buildInventory',
      'lockEntries',
      'diffLock',
      'mergeLock',
      'parseSecureciLockfile',
      'parseGitHubLockfile',
      'serializeSecureciLockfile',
      'pinContent',
      'applyEdits',
      'parseActionSpec',
      'updateContent',
      'latestTag'
    ] as const) {
      expect(typeof lib[name]).toBe('function');
    }
  });

  it('pins file contents with an injected resolver', async () => {
    const result = await lib.pinContent(WORKFLOW, async () => SHA_A);
    expect(result.content).toContain(
      `uses: actions/checkout@${SHA_A} # v4 - pinned soon`
    );
    expect(lib.applyEdits('abc', [{ start: 1, end: 2, text: 'X' }])).toBe(
      'aXc'
    );
  });

  it('updates an action named by a spec in file contents', () => {
    const spec = lib.parseActionSpec('actions/checkout@v5');
    expect(spec).toEqual({
      name: 'actions/checkout',
      owner: 'actions',
      repo: 'checkout',
      ref: 'v5'
    });
    const result = lib.updateContent(WORKFLOW, {
      name: spec!.name,
      ref: spec!.ref!,
      sha: SHA_B
    });
    expect(result.content).toContain(`uses: actions/checkout@${SHA_B} # v5`);
    expect(lib.latestTag(['v4', 'v5.0.1', 'v5', 'v6-beta'])).toBe('v5.0.1');
  });

  it('reads, diffs, merges and writes secureci.lock text', () => {
    const lock = lib.parseSecureciLockfile(
      lib.serializeSecureciLockfile({
        'actions/checkout@v4': { commit: SHA_A }
      })
    );
    expect(lock.actions).toEqual({ 'actions/checkout@v4': { commit: SHA_A } });
    const current = { 'actions/checkout@v4': { commit: SHA_B } };
    expect(lib.diffLock(current, lock).drifted).toEqual([
      { uses: 'actions/checkout@v4', from: SHA_A, to: SHA_B }
    ]);
    expect(lib.mergeLock(lock.actions, current, new Set()).actions).toEqual(
      current
    );
  });

  it("reads GitHub's actions.lock text", () => {
    const github = lib.parseGitHubLockfile(
      [
        "version: 'v0.0.3'",
        'dependencies:',
        `  'actions/checkout@${SHA_A}':`,
        `    commit: 'sha1-${SHA_A}'`,
        ''
      ].join('\n')
    );
    expect(github.actions[`actions/checkout@${SHA_A}`]?.commit).toBe(SHA_A);
  });
});
