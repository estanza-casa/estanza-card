import { parseArgs } from 'node:util';

import { DEFAULT_APP_KEY_PATH } from './github-release.ts';

export const bumps = ['patch', 'minor', 'major'] as const;

export type Bump = (typeof bumps)[number];

export type ReleaseOptions = {
  bump: Bump;
  notesFile: string | undefined;
  dryRun: boolean;
  draft: boolean;
  pushMain: boolean;
  appKey: string;
};

export type RepoState = {
  dirtyFiles: string[];
  branch: string;
  head: string;
  originMain: string;
  tagExists: boolean;
};

export const RELEASE_BRANCH = 'main';

export const usage =
  'Usage: corepack pnpm release <patch|minor|major> [--notes <file>] [--dry-run] [--draft] [--no-push-main] [--app-key <pem>]';

export function parseReleaseArgs(argv: string[]): ReleaseOptions | string {
  let parsed;

  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        notes: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        draft: { type: 'boolean', default: false },
        'no-push-main': { type: 'boolean', default: false },
        'app-key': { type: 'string', default: DEFAULT_APP_KEY_PATH },
      },
    });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const [bump, ...extra] = parsed.positionals;

  if (!isBump(bump) || extra.length > 0) return usage;

  const pushMain = !parsed.values['no-push-main'];

  if (!pushMain && !parsed.values.draft) {
    return '--no-push-main only makes a draft, so it needs --draft.';
  }

  return {
    bump,
    notesFile: parsed.values.notes,
    dryRun: parsed.values['dry-run'],
    draft: parsed.values.draft,
    pushMain,
    appKey: parsed.values['app-key'],
  };
}

export function nextVersion(version: string, bump: Bump): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (!match) throw new Error(`package.json version "${version}" is not X.Y.Z`);

  const [major, minor, patch] = match.slice(1).map(Number);

  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;

  return `${major}.${minor}.${patch + 1}`;
}

export function releaseRefusals(
  state: RepoState,
  options: Pick<ReleaseOptions, 'pushMain'>,
): string[] {
  const refusals: string[] = [];

  if (state.dirtyFiles.length > 0) {
    refusals.push(
      `The tree has uncommitted changes: ${state.dirtyFiles.join(', ')}`,
    );
  }

  if (state.tagExists) refusals.push('That version is already tagged.');

  if (!options.pushMain) return refusals;

  if (state.branch !== RELEASE_BRANCH) {
    refusals.push(
      `Releases are cut from ${RELEASE_BRANCH}, and this is ${state.branch || 'a detached HEAD'}.`,
    );
  }

  if (state.head !== state.originMain) {
    refusals.push(
      `Local HEAD ${state.head.slice(0, 7)} is not origin/${RELEASE_BRANCH} ${state.originMain.slice(0, 7)}.`,
    );
  }

  return refusals;
}

function isBump(value: string | undefined): value is Bump {
  return bumps.some((bump) => bump === value);
}
