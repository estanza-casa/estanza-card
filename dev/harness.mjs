import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const repoDir = fileURLToPath(new URL('..', import.meta.url));
const cloneId = createHash('sha256').update(repoDir).digest('hex').slice(0, 8);
const preferredPort = 8123;
const preferredCardPort = 5199;

export const containerName = `estanza-card-ha-${cloneId}`;
export const projectName = `estanza-card-dev-${cloneId}`;
export const harnessPath = fileURLToPath(
  new URL('./ha-config/.estanza-dev-harness.json', import.meta.url),
);

export function readHarness() {
  if (!existsSync(harnessPath)) return null;

  return JSON.parse(readFileSync(harnessPath, 'utf8'));
}

export function writeHarness(port, cardPort) {
  const harness = { containerName, port, cardPort };

  writeFileSync(harnessPath, `${JSON.stringify(harness, null, 2)}\n`);

  return harness;
}

export function composeEnv(port) {
  return {
    ...process.env,
    ESTANZA_HA_CONTAINER: containerName,
    ESTANZA_HA_PORT: String(port),
  };
}

export function isContainerRunning() {
  const inspected = spawnSync(
    'docker',
    ['inspect', '--format', '{{.State.Running}}', containerName],
    { encoding: 'utf8' },
  );

  return inspected.status === 0 && inspected.stdout.trim() === 'true';
}

export async function choosePort() {
  const saved = readHarness();

  if (saved?.containerName === containerName && isContainerRunning()) {
    return saved.port;
  }

  return (await listenOn(preferredPort)) ?? (await listenOn(0));
}

export async function chooseCardPort() {
  const saved = readHarness()?.cardPort;
  const savedFree = saved ? await listenOn(saved) : null;

  return (
    savedFree ?? (await listenOn(preferredCardPort)) ?? (await listenOn(0))
  );
}

function listenOn(port) {
  return new Promise((resolve) => {
    const server = createServer();

    server.once('error', () => resolve(null));
    server.listen(port, '127.0.0.1', () => {
      const { port: bound } = server.address();

      server.close(() => resolve(bound));
    });
  });
}
