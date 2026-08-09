import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readHarness } from './harness.mjs';

export let haUrl = '';
export let clientId = '';
export let redirectUri = '';
export let cardOrigin = '';
export let cardResourceUrl = '';
export const cardResourcePath = '/src/card.ts';
export const dashboardPath = 'estanza-dev';

export function useHarness({ port, cardPort }) {
  haUrl = `http://127.0.0.1:${port}`;
  clientId = `${haUrl}/`;
  redirectUri = `${haUrl}/?auth_callback=1`;
  cardOrigin = `http://127.0.0.1:${cardPort}`;
  cardResourceUrl = `${cardOrigin}${cardResourcePath}`;
}

const savedHarness = readHarness();

if (savedHarness) useHarness(savedHarness);

export const devUser = {
  name: 'Estanza Dev',
  username: 'dev',
  password: 'estanza-dev',
  language: 'en',
};

export const configDir = fileURLToPath(
  new URL('./ha-config/', import.meta.url),
);
export const tokenPath = `${configDir}.estanza-dev-token`;

export function readToken() {
  if (!haUrl || !existsSync(tokenPath)) {
    throw new Error('No dev token yet. Run `corepack pnpm ha:up` first.');
  }

  return readFileSync(tokenPath, 'utf8').trim();
}

export async function request(
  path,
  { method = 'GET', token, body, form } = {},
) {
  const headers = {};

  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  const response = await fetch(`${haUrl}${path}`, {
    method,
    headers,
    body: form
      ? new URLSearchParams(form)
      : body === undefined
        ? undefined
        : JSON.stringify(body),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed with ${response.status}: ${text}`,
    );
  }

  return text ? JSON.parse(text) : null;
}

export function callService(token, domain, service, data) {
  return request(`/api/services/${domain}/${service}`, {
    method: 'POST',
    token,
    body: data,
  });
}

export async function loginWithPassword() {
  const flow = await request('/auth/login_flow', {
    method: 'POST',
    body: {
      client_id: clientId,
      handler: ['homeassistant', null],
      redirect_uri: redirectUri,
    },
  });
  const step = await request(`/auth/login_flow/${flow.flow_id}`, {
    method: 'POST',
    body: {
      client_id: clientId,
      username: devUser.username,
      password: devUser.password,
    },
  });

  if (step.type !== 'create_entry') {
    throw new Error(
      `Login as ${devUser.username} was refused: ${JSON.stringify(step.errors)}`,
    );
  }

  return exchangeCode(step.result);
}

export async function exchangeCode(code) {
  const tokens = await request('/auth/token', {
    method: 'POST',
    form: { grant_type: 'authorization_code', code, client_id: clientId },
  });

  return tokens.access_token;
}

export async function connectSocket(token) {
  const socket = new WebSocket(`${haUrl.replace('http', 'ws')}/api/websocket`);
  const pending = new Map();
  let nextId = 1;

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('error', () =>
      reject(new Error('Websocket error')),
    );
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'auth_required') {
        socket.send(JSON.stringify({ type: 'auth', access_token: token }));
      } else if (message.type === 'auth_ok') {
        resolve();
      } else if (message.type === 'auth_invalid') {
        reject(new Error(`Websocket auth refused: ${message.message}`));
      } else if (message.type === 'result') {
        settle(pending, message);
      }
    });
  });

  await ready;

  return {
    send(type, payload = {}) {
      const id = nextId++;

      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, type });
        socket.send(JSON.stringify({ id, type, ...payload }));
      });
    },
    close() {
      socket.close();
    },
  };
}

function settle(pending, message) {
  const entry = pending.get(message.id);

  if (!entry) return;

  pending.delete(message.id);

  if (message.success) {
    entry.resolve(message.result);

    return;
  }

  entry.reject(new Error(`${entry.type}: ${JSON.stringify(message.error)}`));
}

export async function waitForHa(timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const response = await fetch(`${haUrl}/api/onboarding`).catch(() => null);

    if (response?.ok) return response.json();

    // Home Assistant stops serving the onboarding API once onboarding is done.
    if (response?.status === 404) return [];

    await sleep(2000);
  }

  throw new Error(
    `Home Assistant did not answer on ${haUrl} within ${timeoutMs / 1000}s`,
  );
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
