import { createPrivateKey, sign } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const APP_CLIENT_ID = 'Iv23lipnjke1Xee2wYU8';
export const RELEASE_REPO = 'estanza-casa/estanza-card';
export const DEFAULT_APP_KEY_PATH = join(
  homedir(),
  '.config/estanza/estanza-casa-app.pem',
);

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

export type Fetch = typeof fetch;

export type ReleaseAsset = {
  name: string;
  contentType: string;
  data: Uint8Array<ArrayBuffer>;
};

export type ReleaseRequest = {
  tag: string;
  notes: string | undefined;
  draft: boolean;
  asset: ReleaseAsset;
};

export function appJwt(privateKeyPem: string, nowSeconds: number): string {
  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const payload = encode({
    iat: nowSeconds - 60,
    exp: nowSeconds + 540,
    iss: APP_CLIENT_ID,
  });
  const signingInput = `${header}.${payload}`;

  let key;

  try {
    key = createPrivateKey(privateKeyPem);
  } catch {
    throw new Error('The GitHub App key is not a readable PEM private key.');
  }

  const signature = sign('sha256', Buffer.from(signingInput), key);

  return `${signingInput}.${signature.toString('base64url')}`;
}

export async function installationToken(
  jwt: string,
  fetchImpl: Fetch,
): Promise<string> {
  const installation = await request<{ id: number }>(
    fetchImpl,
    'GET',
    `${API}/repos/${RELEASE_REPO}/installation`,
    jwt,
  );
  const access = await request<{ token: string }>(
    fetchImpl,
    'POST',
    `${API}/app/installations/${installation.id}/access_tokens`,
    jwt,
  );

  return access.token;
}

export async function publishRelease(
  release: ReleaseRequest,
  token: string,
  fetchImpl: Fetch,
): Promise<string> {
  await request(
    fetchImpl,
    'GET',
    `${API}/repos/${RELEASE_REPO}/git/ref/tags/${release.tag}`,
    token,
  );

  const created = await request<{ id: number; html_url: string }>(
    fetchImpl,
    'POST',
    `${API}/repos/${RELEASE_REPO}/releases`,
    token,
    {
      tag_name: release.tag,
      name: release.tag,
      draft: true,
      ...(release.notes === undefined
        ? { generate_release_notes: true }
        : { body: release.notes }),
    },
  );
  const assetName = encodeURIComponent(release.asset.name);

  await request(
    fetchImpl,
    'POST',
    `${UPLOADS}/repos/${RELEASE_REPO}/releases/${created.id}/assets?name=${assetName}`,
    token,
    release.asset,
  );

  if (release.draft) return created.html_url;

  const published = await request<{ html_url: string }>(
    fetchImpl,
    'PATCH',
    `${API}/repos/${RELEASE_REPO}/releases/${created.id}`,
    token,
    { draft: false },
  );

  return published.html_url;
}

async function request<TResponse>(
  fetchImpl: Fetch,
  method: string,
  url: string,
  bearer: string,
  body?: object | ReleaseAsset,
): Promise<TResponse> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${bearer}`,
    'User-Agent': 'estanza-card-release',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  let payload: string | Uint8Array<ArrayBuffer> | undefined;

  if (body && 'data' in body) {
    headers['Content-Type'] = body.contentType;
    payload = body.data;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const response = await fetchImpl(url, { method, headers, body: payload });

  if (!response.ok) {
    const message = await errorMessage(response);

    throw new Error(
      `GitHub ${method} ${url} answered ${response.status}${message}`,
    );
  }

  return (await response.json()) as TResponse;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body: { message?: unknown } = await response.json();

    return typeof body.message === 'string' ? `: ${body.message}` : '';
  } catch {
    return '';
  }
}

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
