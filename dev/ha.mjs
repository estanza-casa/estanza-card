import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createServer } from 'vite';

import { buildDashboard } from './dashboard.mjs';
import { buildPackage, entityAreas } from './entities.mjs';
import {
  cardOrigin,
  cardResourcePath,
  cardResourceUrl,
  clientId,
  configDir,
  connectSocket,
  dashboardPath,
  devUser,
  exchangeCode,
  haUrl,
  loginWithPassword,
  readToken,
  redirectUri,
  request,
  sleep,
  tokenPath,
  useHarness,
  waitForHa,
} from './ha-client.mjs';
import {
  chooseCardPort,
  choosePort,
  composeEnv,
  containerName,
  projectName,
  readHarness,
  writeHarness,
} from './harness.mjs';
import { describeHome, loadDemoHome, sharedHomePath } from './home.mjs';
import { restoreEntities } from './renames.mjs';
import { toYaml } from './yaml.mjs';

const templateDir = fileURLToPath(new URL('./ha-template/', import.meta.url));
const composeFile = fileURLToPath(new URL('./compose.yaml', import.meta.url));
const cardConfigFile = fileURLToPath(
  new URL('./vite.config.ts', import.meta.url),
);
const startupTimeoutMs = 240_000;
const registryTimeoutMs = 90_000;

const home = loadDemoHome();
const model = describeHome(home);

const command = process.argv[2];

if (command === 'seed') seed();
else if (command === 'up') await up();
else if (command === 'down') await down();
else {
  console.error('Usage: node dev/ha.mjs <seed|up|down>');
  process.exit(1);
}

async function down() {
  const harness = readHarness();
  const running = haUrl ? await fetch(`${haUrl}/api/`).catch(() => null) : null;

  if (running && existsSync(tokenPath)) {
    const restored = await restoreEntities(readToken());

    if (restored > 0) console.log(`Undid ${restored} renames and deletions`);
  }

  const stopped = spawnSync(
    'docker',
    ['compose', '-p', projectName, '-f', composeFile, 'down'],
    { stdio: 'inherit', env: composeEnv(harness?.port ?? 8123) },
  );

  process.exit(stopped.status ?? 1);
}

function seed() {
  mkdirSync(`${configDir}packages`, { recursive: true });
  cpSync(templateDir, configDir, { recursive: true });
  writeFileSync(
    `${configDir}packages/casa_aurora.yaml`,
    toYaml(buildPackage(model)),
  );

  if (!existsSync(sharedHomePath)) {
    writeFileSync(sharedHomePath, `${JSON.stringify(home, null, 2)}\n`);
  }

  console.log(`Seeded ${configDir} from ${templateDir}`);
}

async function up() {
  seed();

  const harness = writeHarness(await choosePort(), await chooseCardPort());
  const { port } = harness;

  useHarness(harness);

  const cardServer = await createServer({ configFile: cardConfigFile });

  await cardServer.listen();
  console.log(`Serving the card on ${cardOrigin}`);
  console.log(`Home Assistant container ${containerName} on port ${port}`);

  const started = spawnSync(
    'docker',
    ['compose', '-p', projectName, '-f', composeFile, 'up', '-d'],
    { stdio: 'inherit', env: composeEnv(port) },
  );

  if (started.status !== 0) process.exit(started.status ?? 1);

  console.log(`Waiting for Home Assistant on ${haUrl}`);
  const steps = await waitForHa(startupTimeoutMs);

  await onboard(steps);

  const accessToken = await loginWithPassword();
  console.log(`Logged in as ${devUser.username}`);

  const socket = await connectSocket(accessToken);

  try {
    await ensureLongLivedToken(socket);
    const areaIds = await ensureAreas(socket);
    await assignAreas(socket, areaIds);
    await ensureResource(socket);
    await ensureDashboard(socket);

    const registry = await socket.send('config/entity_registry/list');

    await socket.send('lovelace/config/save', {
      url_path: dashboardPath,
      config: buildDashboard(home, model, areaIds, cardOrigin, registry),
    });
    console.log('Saved the Casa Aurora dashboard');
  } finally {
    socket.close();
  }

  console.log(
    `Home Assistant is ready at ${haUrl}/${dashboardPath}/casa-aurora`,
  );
  console.log(`Login: ${devUser.username} / ${devUser.password}`);
}

async function onboard(steps) {
  const pending = new Set(
    steps.filter((step) => !step.done).map((step) => step.step),
  );

  if (pending.size === 0) return;

  let token = null;

  if (pending.has('user')) {
    const created = await request('/api/onboarding/users', {
      method: 'POST',
      body: { ...devUser, client_id: clientId },
    });

    token = await exchangeCode(created.auth_code);
    console.log(`Onboarded user ${devUser.username}`);
  }

  token ??= await loginWithPassword();

  if (pending.has('core_config')) {
    await request('/api/onboarding/core_config', {
      method: 'POST',
      token,
      body: {},
    });
  }

  if (pending.has('analytics')) {
    await request('/api/onboarding/analytics', {
      method: 'POST',
      token,
      body: {},
    });
  }

  if (pending.has('integration')) {
    await request('/api/onboarding/integration', {
      method: 'POST',
      token,
      body: { client_id: clientId, redirect_uri: redirectUri },
    });
  }

  console.log('Onboarding marked done');
}

async function ensureLongLivedToken(socket) {
  if (existsSync(tokenPath)) {
    const response = await fetch(`${haUrl}/api/`, {
      headers: { authorization: `Bearer ${readToken()}` },
    });

    if (response.ok) return;
  }

  const token = await socket.send('auth/long_lived_access_token', {
    client_name: `estanza-card dev ${new Date().toISOString()}`,
    lifespan: 3650,
  });

  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  console.log(`Wrote a long-lived token to ${tokenPath}`);
}

async function ensureAreas(socket) {
  const floorIds = await ensureFloors(socket);
  const areas = await socket.send('config/area_registry/list');
  const areaIds = {};

  for (const room of model.rooms) {
    const floorId = floorIds[room.floor] ?? null;
    const existing = areas.find((area) => area.name === room.label);

    if (!existing) {
      const created = await socket.send('config/area_registry/create', {
        name: room.label,
        floor_id: floorId,
      });

      areaIds[room.slug] = created.area_id;
      continue;
    }

    areaIds[room.slug] = existing.area_id;

    if (existing.floor_id !== floorId) {
      await socket.send('config/area_registry/update', {
        area_id: existing.area_id,
        floor_id: floorId,
      });
    }
  }

  console.log(`Areas ready: ${Object.values(areaIds).join(', ')}`);

  return areaIds;
}

async function ensureFloors(socket) {
  const floors = await socket.send('config/floor_registry/list');
  const floorIds = {};

  for (const floor of model.floors) {
    const existing = floors.find((entry) => entry.name === floor.name);

    floorIds[floor.id] = existing
      ? existing.floor_id
      : (
          await socket.send('config/floor_registry/create', {
            name: floor.name,
            level: floor.level,
          })
        ).floor_id;
  }

  return floorIds;
}

async function assignAreas(socket, areaIds) {
  const wanted = entityAreas(model);
  const registry = await waitForEntities(socket, Object.keys(wanted));

  for (const [entityId, room] of Object.entries(wanted)) {
    const areaId = areaIds[room];

    if (registry.get(entityId)?.area_id === areaId) continue;

    await socket.send('config/entity_registry/update', {
      entity_id: entityId,
      area_id: areaId,
    });
  }

  console.log(`Assigned ${Object.keys(wanted).length} entities to their areas`);
}

async function waitForEntities(socket, entityIds) {
  const deadline = Date.now() + registryTimeoutMs;

  while (true) {
    const entries = await socket.send('config/entity_registry/list');
    const registry = new Map(entries.map((entry) => [entry.entity_id, entry]));
    const missing = entityIds.filter((entityId) => !registry.has(entityId));

    if (missing.length === 0) return registry;

    if (Date.now() > deadline) {
      throw new Error(`Entities never registered: ${missing.join(', ')}`);
    }

    await sleep(2000);
  }
}

async function ensureDashboard(socket) {
  const dashboards = await socket.send('lovelace/dashboards/list');

  const exists = dashboards.some(
    (dashboard) => dashboard.url_path === dashboardPath,
  );

  if (exists) return;

  await socket.send('lovelace/dashboards/create', {
    url_path: dashboardPath,
    title: 'Estanza',
    icon: 'mdi:home-floor-3',
    mode: 'storage',
    show_in_sidebar: true,
    require_admin: false,
  });
  console.log(`Created the dashboard /${dashboardPath}`);
}

async function ensureResource(socket) {
  const resources = await socket.send('lovelace/resources');

  if (resources.some((resource) => resource.url === cardResourceUrl)) return;

  const stale = resources.find((resource) =>
    resource.url.endsWith(cardResourcePath),
  );

  if (stale) {
    await socket.send('lovelace/resources/update', {
      resource_id: stale.id,
      res_type: 'module',
      url: cardResourceUrl,
    });
    console.log(`Moved the card resource to ${cardResourceUrl}`);

    return;
  }

  await socket.send('lovelace/resources/create', {
    res_type: 'module',
    url: cardResourceUrl,
  });
  console.log(`Registered the card resource ${cardResourceUrl}`);
}
