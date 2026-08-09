import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  appJwt,
  installationToken,
  publishRelease,
  RELEASE_REPO,
} from './github-release.ts';
import {
  nextVersion,
  parseReleaseArgs,
  RELEASE_BRANCH,
  type ReleaseOptions,
  releaseRefusals,
  type RepoState,
} from './release-checks.ts';

const cardRoot = fileURLToPath(new URL('..', import.meta.url));
const packagePath = `${cardRoot}package.json`;
const asset = 'dist/estanza-card.js';

const options = parseReleaseArgs(process.argv.slice(2));

if (typeof options === 'string') fail(options);

run('git', ['fetch', '--quiet', 'origin', RELEASE_BRANCH]);

const packageText = readFileSync(packagePath, 'utf8');
const packageJson: { version: string } = JSON.parse(packageText);
const version = nextVersion(packageJson.version, options.bump);
const tag = `v${version}`;

const refusals = releaseRefusals(readRepoState(tag), options);

if (options.notesFile && !existsSync(options.notesFile)) {
  refusals.push(`No notes file at ${options.notesFile}.`);
}

if (!existsSync(options.appKey)) {
  refusals.push(
    `No GitHub App key at ${options.appKey}. Pass its path with --app-key.`,
  );
}

if (refusals.length > 0) fail(refusals.join('\n'));

console.log(`Releasing ${packageJson.version} -> ${version}`);
run('corepack', ['pnpm', 'check']);

writeFileSync(
  packagePath,
  packageText.replace(
    `"version": "${packageJson.version}"`,
    `"version": "${version}"`,
  ),
);
run('corepack', ['pnpm', 'build']);

const steps = gitSteps(options);
const releaseKind = options.draft ? 'draft release' : 'release';

if (options.dryRun) {
  writeFileSync(packagePath, packageText);
  console.log(`Dry run: built ${asset} as ${tag}, then put package.json back.`);
  console.log('It would now run:');

  for (const [command, ...args] of steps) {
    console.log(`  ${command} ${args.join(' ')}`);
  }

  console.log(
    `  then, as the GitHub App, create the ${releaseKind} ${tag} on ${RELEASE_REPO} and upload ${asset}`,
  );
  process.exit(0);
}

let token;

try {
  token = await installationToken(
    appJwt(readFileSync(options.appKey, 'utf8'), Math.floor(Date.now() / 1000)),
    fetch,
  );
} catch (error) {
  writeFileSync(packagePath, packageText);
  fail(`Could not sign in as the GitHub App: ${messageOf(error)}`);
}

for (const [command, ...args] of steps) run(command, args);

try {
  const url = await publishRelease(
    {
      tag,
      notes: options.notesFile
        ? readFileSync(options.notesFile, 'utf8')
        : undefined,
      draft: options.draft,
      asset: {
        name: basename(asset),
        contentType: 'application/javascript',
        data: readFileSync(`${cardRoot}${asset}`),
      },
    },
    token,
    fetch,
  );

  console.log(`Released ${tag}${options.draft ? ' as a draft' : ''}: ${url}`);
} catch (error) {
  fail(`${tag} is pushed but the ${releaseKind} failed: ${messageOf(error)}`);
}

function gitSteps(release: ReleaseOptions): string[][] {
  return [
    ['git', 'add', 'package.json'],
    ['git', 'commit', '--quiet', '-m', `Release ${tag}`],
    ['git', 'tag', '-a', tag, '-m', tag],
    ...(release.pushMain ? [['git', 'push', 'origin', RELEASE_BRANCH]] : []),
    ['git', 'push', 'origin', `refs/tags/${tag}`],
  ];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readRepoState(releaseTag: string): RepoState {
  const status = capture('git', ['status', '--porcelain']);
  const localTag = spawnSync(
    'git',
    ['rev-parse', '--quiet', '--verify', `refs/tags/${releaseTag}`],
    { cwd: cardRoot },
  );
  const remoteTag = capture('git', [
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${releaseTag}`,
  ]);

  return {
    dirtyFiles: status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.trim()),
    branch: capture('git', ['branch', '--show-current']),
    head: capture('git', ['rev-parse', 'HEAD']),
    originMain: capture('git', ['rev-parse', `origin/${RELEASE_BRANCH}`]),
    tagExists: localTag.status === 0 || remoteTag !== '',
  };
}

function capture(command: string, args: string[]): string {
  const result = spawnSync(command, args, { cwd: cardRoot, encoding: 'utf8' });

  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed.`);

  return result.stdout.trim();
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: cardRoot, stdio: 'inherit' });

  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed.`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
