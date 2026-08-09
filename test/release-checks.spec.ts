// @vitest-environment node
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_KEY_PATH } from '../scripts/github-release.ts';
import {
  nextVersion,
  parseReleaseArgs,
  releaseRefusals,
  type RepoState,
  usage,
} from '../scripts/release-checks.ts';

const releasable: RepoState = {
  dirtyFiles: [],
  branch: 'main',
  head: 'a1b2c3d4e5',
  originMain: 'a1b2c3d4e5',
  tagExists: false,
};

describe('release refusals', () => {
  it('lets a clean main at origin/main release', () => {
    expect(releaseRefusals(releasable, { pushMain: true })).toEqual([]);
  });

  it('refuses a dirty tree and names the files', () => {
    const refusals = releaseRefusals(
      { ...releasable, dirtyFiles: ['M src/card.ts', '?? notes.md'] },
      { pushMain: true },
    );

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('src/card.ts');
    expect(refusals[0]).toContain('notes.md');
  });

  it('refuses a branch other than main', () => {
    const refusals = releaseRefusals(
      { ...releasable, branch: '2070-releases' },
      { pushMain: true },
    );

    expect(refusals).toEqual([
      'Releases are cut from main, and this is 2070-releases.',
    ]);
  });

  it('refuses a detached HEAD', () => {
    const refusals = releaseRefusals(
      { ...releasable, branch: '' },
      { pushMain: true },
    );

    expect(refusals[0]).toContain('a detached HEAD');
  });

  it('refuses a local main that is not origin/main', () => {
    const refusals = releaseRefusals(
      { ...releasable, originMain: 'ffffffffff' },
      { pushMain: true },
    );

    expect(refusals).toEqual([
      'Local HEAD a1b2c3d is not origin/main fffffff.',
    ]);
  });

  it('refuses a version that is already tagged', () => {
    const refusals = releaseRefusals(
      { ...releasable, tagExists: true },
      { pushMain: true },
    );

    expect(refusals).toEqual(['That version is already tagged.']);
  });

  it('reports every refusal at once', () => {
    const refusals = releaseRefusals(
      {
        dirtyFiles: ['M package.json'],
        branch: 'topic',
        head: 'a1b2c3d4e5',
        originMain: 'ffffffffff',
        tagExists: true,
      },
      { pushMain: true },
    );

    expect(refusals).toHaveLength(4);
  });

  it('skips the branch checks for a draft that leaves main alone, but not the clean tree', () => {
    const refusals = releaseRefusals(
      {
        ...releasable,
        dirtyFiles: ['M package.json'],
        branch: 'topic',
        originMain: 'ffffffffff',
      },
      { pushMain: false },
    );

    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toContain('package.json');
  });
});

describe('release arguments', () => {
  it('reads the bump and every flag', () => {
    expect(
      parseReleaseArgs([
        'minor',
        '--notes',
        'notes.md',
        '--dry-run',
        '--draft',
        '--no-push-main',
        '--app-key',
        '/keys/app.pem',
      ]),
    ).toEqual({
      bump: 'minor',
      notesFile: 'notes.md',
      dryRun: true,
      draft: true,
      pushMain: false,
      appKey: '/keys/app.pem',
    });
  });

  it('defaults to a full release that pushes main, signed with the default app key', () => {
    expect(parseReleaseArgs(['patch'])).toEqual({
      bump: 'patch',
      notesFile: undefined,
      dryRun: false,
      draft: false,
      pushMain: true,
      appKey: DEFAULT_APP_KEY_PATH,
    });
    expect(DEFAULT_APP_KEY_PATH).toBe(
      join(homedir(), '.config/estanza/estanza-casa-app.pem'),
    );
  });

  it('refuses a missing or unknown bump', () => {
    expect(parseReleaseArgs([])).toBe(usage);
    expect(parseReleaseArgs(['huge'])).toBe(usage);
    expect(parseReleaseArgs(['patch', 'minor'])).toBe(usage);
  });

  it('refuses an unknown flag', () => {
    expect(parseReleaseArgs(['patch', '--force'])).toContain('--force');
  });

  it('refuses to skip pushing main outside a draft', () => {
    expect(parseReleaseArgs(['patch', '--no-push-main'])).toBe(
      '--no-push-main only makes a draft, so it needs --draft.',
    );
  });
});

describe('next version', () => {
  it('bumps each part and resets the lower ones', () => {
    expect(nextVersion('1.4.7', 'patch')).toBe('1.4.8');
    expect(nextVersion('1.4.7', 'minor')).toBe('1.5.0');
    expect(nextVersion('1.4.7', 'major')).toBe('2.0.0');
  });

  it('refuses a version that is not X.Y.Z', () => {
    expect(() => nextVersion('1.4.7-beta.1', 'patch')).toThrow('not X.Y.Z');
  });
});
