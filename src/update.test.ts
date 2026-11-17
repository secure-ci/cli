import { describe, it, expect } from 'vitest';
import {
  latestTag,
  matchesAction,
  parseActionSpec,
  remoteActionRepos,
  updateContent
} from './update';

const sha = (digit: string | number): string => String(digit).repeat(40);

const lines = (...l: string[]): string => l.join('\n') + '\n';
const steps = (...l: string[]): string =>
  lines(
    'on: push',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...l
  );

describe('parseActionSpec', () => {
  it('splits owner/repo[/path] and an optional ref', () => {
    expect(parseActionSpec('actions/checkout@v7.0.1')).toEqual({
      name: 'actions/checkout',
      owner: 'actions',
      repo: 'checkout',
      ref: 'v7.0.1'
    });
    expect(parseActionSpec('actions/checkout')).toEqual({
      name: 'actions/checkout',
      owner: 'actions',
      repo: 'checkout'
    });
    expect(parseActionSpec('github/codeql-action/init@v3')).toEqual({
      name: 'github/codeql-action/init',
      owner: 'github',
      repo: 'codeql-action',
      ref: 'v3'
    });
  });

  it('rejects anything that is not a remote action', () => {
    for (const bad of [
      'checkout',
      'actions/',
      '/checkout',
      'actions/checkout@',
      './local',
      'docker://alpine:3',
      'a//b@v1',
      '.github/workflows/ci.yml'
    ]) {
      expect(parseActionSpec(bad), bad).toBeUndefined();
    }
  });
});

describe('matchesAction', () => {
  it('matches every path in a repository when given owner/repo, case-insensitively', () => {
    expect(matchesAction('actions/checkout@v4', 'actions/checkout')).toBe(true);
    expect(matchesAction('Actions/Checkout@v4', 'actions/checkout')).toBe(true);
    expect(
      matchesAction('github/codeql-action/init@v3', 'github/codeql-action')
    ).toBe(true);
    expect(
      matchesAction(
        'org/workflows/.github/workflows/build.yml@v1',
        'org/workflows'
      )
    ).toBe(true);
    expect(matchesAction('actions/checkout-x@v4', 'actions/checkout')).toBe(
      false
    );
    expect(matchesAction('./actions/checkout', 'actions/checkout')).toBe(false);
  });

  it('matches only that path when given owner/repo/path', () => {
    expect(
      matchesAction('github/codeql-action/init@v3', 'github/codeql-action/init')
    ).toBe(true);
    expect(
      matchesAction(
        'github/codeql-action/analyze@v3',
        'github/codeql-action/init'
      )
    ).toBe(false);
    expect(
      matchesAction('github/codeql-action@v3', 'github/codeql-action/init')
    ).toBe(false);
  });
});

describe('latestTag', () => {
  it('picks the highest stable version, preferring the most specific tag', () => {
    expect(
      latestTag(['v4', 'v4.2.2', 'v4.2.1', 'v3.9.9', 'v4.10.0', 'v4.10'])
    ).toBe('v4.10.0');
    expect(latestTag(['1.0.0', '1.2.0', 'v1.1.0'])).toBe('1.2.0');
    expect(latestTag(['v1', 'v2'])).toBe('v2');
  });

  it('ignores pre-releases and tags that are not versions', () => {
    expect(
      latestTag(['v5.0.0-beta.1', 'v4.1.0', 'latest', 'nightly', 'v6-rc'])
    ).toBe('v4.1.0');
    expect(latestTag(['latest', 'main'])).toBeUndefined();
    expect(latestTag([])).toBeUndefined();
  });
});

describe('remoteActionRepos', () => {
  it('lists each remote repository once, skipping local and docker references', () => {
    const content = steps(
      '      - uses: actions/checkout@v4',
      `      - uses: actions/checkout@${sha(1)} # v4`,
      '      - uses: github/codeql-action/init@v3',
      '      - uses: github/codeql-action/analyze@v3',
      '      - uses: ./local',
      '      - uses: docker://alpine:3.20',
      '      - uses: not-a-ref'
    );
    expect(remoteActionRepos(content)).toEqual([
      'actions/checkout',
      'github/codeql-action'
    ]);
  });
});

describe('updateContent', () => {
  const target = { name: 'actions/checkout', ref: 'v7.0.1', sha: sha(7) };

  it('re-pins pinned references and pins tag references, updating the comment', () => {
    const input = steps(
      `      - uses: actions/checkout@${sha(1)} # v4`,
      '      - uses: actions/checkout@v4',
      "      - uses: 'actions/checkout@v3' # v3 - keep for audit",
      '      - name: other',
      '        uses: actions/setup-node@v4'
    );
    const result = updateContent(input, target);

    expect(result.content).toBe(
      steps(
        `      - uses: actions/checkout@${sha(7)} # v7.0.1`,
        `      - uses: actions/checkout@${sha(7)} # v7.0.1`,
        `      - uses: 'actions/checkout@${sha(7)}' # v7.0.1 - keep for audit`,
        '      - name: other',
        '        uses: actions/setup-node@v4'
      )
    );
    expect(result.changes.map((c) => [c.line, c.uses, c.updated])).toEqual([
      [6, `actions/checkout@${sha(1)}`, `actions/checkout@${sha(7)}`],
      [7, 'actions/checkout@v4', `actions/checkout@${sha(7)}`],
      [8, 'actions/checkout@v3', `actions/checkout@${sha(7)}`]
    ]);
    expect(result.matched).toBe(3);
    expect(result.skipped).toEqual([]);
  });

  it('updates every path of the repository and reusable workflows', () => {
    const input = lines(
      'on: push',
      'jobs:',
      '  call:',
      `    uses: org/tools/.github/workflows/build.yml@${sha(1)} # v1`,
      '  a:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: org/tools/setup@v1',
      '      - uses: org/tools@v1'
    );
    const result = updateContent(input, {
      name: 'org/tools',
      ref: 'v2',
      sha: sha(2)
    });
    expect(result.content).toBe(
      lines(
        'on: push',
        'jobs:',
        '  call:',
        `    uses: org/tools/.github/workflows/build.yml@${sha(2)} # v2`,
        '  a:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        `      - uses: org/tools/setup@${sha(2)} # v2`,
        `      - uses: org/tools@${sha(2)} # v2`
      )
    );
  });

  it('leaves references already on the target untouched', () => {
    const input = steps(`      - uses: actions/checkout@${sha(7)} # v7.0.1`);
    const result = updateContent(input, target);
    expect(result.content).toBe(input);
    expect(result.changes).toEqual([]);
    expect(result.matched).toBe(1);
  });

  it('fixes a stale comment on a reference already at the target commit', () => {
    const input = steps(`      - uses: actions/checkout@${sha(7)} # v6`);
    const result = updateContent(input, target);
    expect(result.content).toBe(
      steps(`      - uses: actions/checkout@${sha(7)} # v7.0.1`)
    );
    expect(result.changes).toHaveLength(1);
  });

  it('writes no comment when several references share a line', () => {
    const input = lines(
      'runs:',
      '  using: composite',
      '  steps: [{uses: actions/checkout@v4}, {uses: actions/checkout@v3}]'
    );
    const result = updateContent(input, target);
    expect(result.content).toBe(
      lines(
        'runs:',
        '  using: composite',
        `  steps: [{uses: actions/checkout@${sha(7)}}, {uses: actions/checkout@${sha(7)}}]`
      )
    );
  });

  it('reports block scalars instead of editing them', () => {
    const input = steps('      - uses: >-', '          actions/checkout@v4');
    const result = updateContent(input, target);
    expect(result.content).toBe(input);
    expect(result.skipped).toEqual([
      {
        line: 6,
        uses: 'actions/checkout@v4',
        reason: 'is written as a block scalar; update it by hand'
      }
    ]);
  });

  it('leaves files without the action alone', () => {
    const input = steps('      - uses: actions/setup-node@v4');
    const result = updateContent(input, target);
    expect(result.content).toBe(input);
    expect(result.matched).toBe(0);
  });
});
