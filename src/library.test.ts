import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildInventory, lockEntries, validate } from './library';
import type { AdvisorySource } from './library';
import type { AdvisoryReport, AdvisoryTarget } from './advisories';
import { validateWorkflow } from './parser/validator';
import { formatReport } from './report';
import type { InventoryAction } from './inventory';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const CI = [
  'name: CI',
  'on: push',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  build:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - uses: ./.github/actions/build',
  '        with:',
  '          title: ${{ github.event.head_commit.message }}',
  ''
].join('\n');

const BUILD_ACTION = [
  'name: Build',
  'description: Build it',
  'inputs:',
  '  title:',
  '    description: A title',
  'runs:',
  '  using: composite',
  '  steps:',
  '    - uses: actions/setup-node@v4',
  '    - run: echo "${{ inputs.title }}"',
  '      shell: bash',
  ''
].join('\n');

const RELEASE = [
  'name: Release',
  'on: push',
  'permissions:',
  '  contents: read',
  'jobs:',
  '  release:',
  '    runs-on: ubuntu-latest',
  '    steps:',
  '      - uses: actions/checkout@v4',
  `      - uses: org/publish@${SHA_C}`,
  ''
].join('\n');

const repo = {
  '.github/workflows/ci.yml': CI,
  '.github/actions/build/action.yml': BUILD_ACTION
};

const emptyReport = (): AdvisoryReport => ({
  findings: [],
  unknownVersions: [],
  unchecked: [],
  stale: []
});

describe('validate', () => {
  it('reports one file in the flat `--format json` shape', async () => {
    const report = await validate(repo);
    expect(report).toMatchObject({
      file: '.github/workflows/ci.yml',
      valid: false
    });
    expect('files' in report).toBe(false);
  });

  it('follows local composite actions through the given files', async () => {
    const report = await validate(repo);
    const errors = 'errors' in report ? report.errors : [];
    expect(errors).toContainEqual(
      expect.objectContaining({
        rule: 'secureci/injection',
        severity: 'error',
        path: expect.stringContaining('./.github/actions/build')
      })
    );
  });

  it('gives the same report as validating the files on disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secureci-lib-'));
    try {
      for (const [file, content] of Object.entries(repo)) {
        fs.mkdirSync(path.join(dir, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
      }
      const onDisk = validateWorkflow(
        path.join(dir, '.github/workflows/ci.yml')
      );
      const expected = JSON.parse(
        formatReport(
          [{ file: '.github/workflows/ci.yml', result: onDisk }],
          'json'
        )
      );
      expect(await validate(repo)).toEqual(expected);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('validates every workflow by default, in the multi-file shape', async () => {
    const report = await validate({
      ...repo,
      '.github/workflows/release.yaml': RELEASE,
      '.github/workflows/nested/ignored.yml': 'not: a workflow',
      'README.md': '# not YAML: ['
    });
    expect('files' in report && report.files.map((f) => f.file)).toEqual([
      '.github/workflows/ci.yml',
      '.github/workflows/release.yaml'
    ]);
    expect(report.valid).toBe(false);
  });

  it('finds workflows however their paths are spelled', async () => {
    const report = await validate({
      './.github/workflows/release.yml': RELEASE
    });
    expect(report).toMatchObject({
      file: '.github/workflows/release.yml',
      valid: true
    });
  });

  it('validates the paths asked for, actions included', async () => {
    const report = await validate(repo, {
      paths: ['.github/actions/build/action.yml']
    });
    expect(report).toMatchObject({
      file: '.github/actions/build/action.yml',
      valid: true,
      errors: []
    });
  });

  it('reports a path that is not among the files as an error', async () => {
    const report = await validate(repo, { paths: ['missing.yml'] });
    expect(report).toMatchObject({
      file: 'missing.yml',
      valid: false,
      errors: [
        expect.objectContaining({
          path: 'root',
          message: 'File not found: missing.yml'
        })
      ]
    });
  });

  it('reports invalid YAML as a root error', async () => {
    const report = await validate({ '.github/workflows/x.yml': 'jobs: [' });
    expect(report).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ path: 'root', severity: 'error' })]
    });
  });

  it('never reads files from disk', async () => {
    // test/fixtures/simple-action.yml exists relative to the working
    // directory, but only files in the map may be read.
    const local = './test/fixtures/simple-action.yml';
    const workflow = CI.replace('./.github/actions/build', local).replace(
      'title:',
      'who-to-greet:'
    );
    const injections = (r: Awaited<ReturnType<typeof validate>>) =>
      ('errors' in r ? r.errors : []).filter(
        (e) => e.rule === 'secureci/injection'
      );
    expect(
      injections(await validate({ '.github/workflows/ci.yml': workflow }))
    ).toEqual([]);
    expect(
      injections(
        await validate({
          '.github/workflows/ci.yml': workflow,
          'test/fixtures/simple-action.yml': fs.readFileSync(local, 'utf8')
        })
      )
    ).not.toEqual([]);
  });

  it('checks a contract given as text, and records it', async () => {
    const report = await validate(repo, {
      contract: {
        source: 'org/policy/contract.yml@v1',
        commit: SHA_A,
        content: 'required:\n  - uses: org/security-scan\n'
      }
    });
    expect(report).toMatchObject({
      valid: false,
      contract: { source: 'org/policy/contract.yml@v1', commit: SHA_A }
    });
    expect('contract' in report && 'content' in report.contract!).toBe(false);
    const errors = 'errors' in report ? report.errors : [];
    expect(errors).toContainEqual(
      expect.objectContaining({ path: 'required[0]', severity: 'error' })
    );
  });

  it("finds a contract's lockfile among the files", async () => {
    const contract = {
      source: 'contract.yml',
      content: 'lockfile:\n  required: true\n'
    };
    const without = await validate(repo, { contract });
    const errors = (r: typeof without) => ('errors' in r ? r.errors : []);
    expect(errors(without)).toContainEqual(
      expect.objectContaining({ path: 'lockfile' })
    );

    const lock = JSON.stringify({
      version: 2,
      actions: {
        'actions/checkout@v4': { commit: SHA_A },
        'actions/setup-node@v4': { commit: SHA_B }
      }
    });
    const withLock = await validate(
      { ...repo, 'secureci.lock': lock },
      { contract }
    );
    expect(errors(withLock).filter((e) => e.path === 'lockfile')).toEqual([]);
  });

  it('rejects a contract for an action file, as the CLI does', async () => {
    const report = await validate(repo, {
      paths: ['.github/actions/build/action.yml'],
      contract: { source: 'contract.yml', content: 'required: []\n' }
    });
    expect(report).toMatchObject({
      valid: false,
      errors: [
        expect.objectContaining({
          path: 'root',
          message: expect.stringContaining('only apply to workflow files')
        })
      ]
    });
  });

  it('reports a contract that is not valid YAML on each file', async () => {
    const report = await validate(repo, {
      contract: { source: 'contract.yml', content: 'required: [' }
    });
    expect(report).toMatchObject({
      valid: false,
      errors: [
        expect.objectContaining({
          path: 'root',
          message: expect.stringContaining('Failed to parse contract file')
        })
      ]
    });
  });

  it('checks advisories through the injected source', async () => {
    const seen: AdvisoryTarget[][] = [];
    const advisories: AdvisorySource = {
      check: async (targets) => {
        seen.push(targets);
        return {
          ...emptyReport(),
          findings: [
            {
              uses: 'actions/checkout@v4',
              ghsaId: 'GHSA-xxxx-xxxx-xxxx',
              severity: 'critical',
              summary: 'Bad',
              range: '< 5',
              version: 'v4.0.0',
              approximate: false,
              path: 'jobs.build.steps[0]'
            }
          ]
        };
      }
    };
    const report = await validate(repo, { advisories });
    expect(seen[0].map((t) => t.uses)).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4'
    ]);
    const errors = 'errors' in report ? report.errors : [];
    expect(errors).toContainEqual(
      expect.objectContaining({
        rule: 'secureci/vulnerable-action',
        severity: 'error',
        path: 'jobs.build.steps[0]'
      })
    );
  });
});

describe('buildInventory', () => {
  it('lists the remote actions of every workflow, merged by reference', async () => {
    const inventory = await buildInventory({
      ...repo,
      '.github/workflows/release.yml': RELEASE
    });
    expect(inventory.actions.map((a) => a.uses)).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4',
      `org/publish@${SHA_C}`
    ]);
    const checkout = inventory.actions[0];
    expect(checkout.paths).toEqual([
      'jobs.build.steps[0]',
      'jobs.release.steps[0]'
    ]);
    expect(checkout.resolvedSha).toBeUndefined();
    expect(inventory.actions[2].resolvedSha).toBe(SHA_C);
    expect(inventory.warnings).toEqual([]);
  });

  it('resolves tags with the injected resolver, once each', async () => {
    const asked: string[] = [];
    const inventory = await buildInventory(repo, {
      resolveSha: async (uses) => {
        asked.push(uses);
        return uses === 'actions/checkout@v4' ? SHA_A : undefined;
      }
    });
    expect(asked).toEqual(['actions/checkout@v4', 'actions/setup-node@v4']);
    expect(inventory.actions.map((a) => a.resolvedSha)).toEqual([
      SHA_A,
      undefined
    ]);
  });

  it('reads only the paths asked for', async () => {
    const inventory = await buildInventory(
      { ...repo, '.github/workflows/release.yml': RELEASE },
      { paths: ['.github/workflows/release.yml'] }
    );
    expect(inventory.actions.map((a) => a.uses)).toEqual([
      'actions/checkout@v4',
      `org/publish@${SHA_C}`
    ]);
  });

  it('throws, naming the file, when a workflow cannot be read', async () => {
    await expect(
      buildInventory({ '.github/workflows/x.yml': 'jobs: [' })
    ).rejects.toThrow(/^Could not read \.github\/workflows\/x\.yml: /);
  });

  it('follows remote composite actions through the injected fetcher', async () => {
    const fetched: Array<[string, string]> = [];
    const inventory = await buildInventory(
      { '.github/workflows/release.yml': RELEASE },
      {
        resolveSha: async () => SHA_A,
        fetch: async (uses, kind) => {
          fetched.push([uses, kind]);
          if (uses.startsWith('org/publish@')) {
            return [
              'name: Publish',
              'description: Publish it',
              'runs:',
              '  using: composite',
              '  steps:',
              '    - uses: org/upload@v2',
              '    - uses: ./local-only',
              ''
            ].join('\n');
          }
          return null;
        }
      }
    );
    expect(fetched).toEqual([
      [`actions/checkout@${SHA_A}`, 'action'],
      [`org/publish@${SHA_C}`, 'action'],
      [`org/upload@${SHA_A}`, 'action']
    ]);
    const upload = inventory.actions.find((a) => a.uses === 'org/upload@v2');
    expect(upload).toMatchObject({
      resolvedSha: SHA_A,
      via: [`org/publish@${SHA_C}`],
      paths: [`org/publish@${SHA_C} > steps[0]`]
    });
    expect(inventory.warnings).toEqual([
      'Could not read actions/checkout@v4, so the actions it uses are not listed.',
      'Could not read org/upload@v2, so the actions it uses are not listed.'
    ]);
  });
  it("never reads a repository file for a remote workflow's ./ path", async () => {
    const caller = [
      'name: Caller',
      'on: push',
      'jobs:',
      '  call:',
      `    uses: org/shared/.github/workflows/ci.yml@${SHA_C}`,
      ''
    ].join('\n');
    const inventory = await buildInventory(
      { ...repo, '.github/workflows/caller.yml': caller },
      {
        paths: ['.github/workflows/caller.yml'],
        fetch: async (uses, kind) => {
          expect(kind).toBe('reusable-workflow');
          return [
            'name: Shared',
            'on: workflow_call',
            'jobs:',
            '  a:',
            '    uses: ./.github/workflows/ci.yml',
            ''
          ].join('\n');
        }
      }
    );
    // The fetched workflow's ./.github/workflows/ci.yml is in its own
    // repository, so the caller's ci.yml (and actions/checkout) isn't read.
    expect(inventory.actions.map((a) => a.uses)).toEqual([
      `org/shared/.github/workflows/ci.yml@${SHA_C}`
    ]);
  });
});

describe('lockEntries', () => {
  it('locks each resolved action, with its identity and via', () => {
    const action = (over: Partial<InventoryAction>): InventoryAction => ({
      uses: 'a/b@v1',
      kind: 'action',
      owner: 'a',
      repo: 'b',
      pinned: false,
      paths: [],
      ...over
    });
    expect(
      lockEntries([
        action({ uses: 'a/b@v1', resolvedSha: SHA_A, ownerId: 1, repoId: 2 }),
        action({ uses: 'a/c@v1', resolvedSha: SHA_B, via: ['a/b@v1'] }),
        action({ uses: 'a/d@v1' })
      ])
    ).toEqual({
      'a/b@v1': { commit: SHA_A, ownerId: 1, repoId: 2 },
      'a/c@v1': { commit: SHA_B, via: ['a/b@v1'] }
    });
  });
});
