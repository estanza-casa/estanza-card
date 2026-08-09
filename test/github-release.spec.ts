// @vitest-environment node
import { generateKeyPairSync, verify } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  APP_CLIENT_ID,
  appJwt,
  type Fetch,
  installationToken,
  publishRelease,
  type ReleaseRequest,
} from '../scripts/github-release.ts';

type Call = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
};

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const privatePem = privateKey
  .export({ type: 'pkcs1', format: 'pem' })
  .toString();
const now = 1_900_000_000;

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

function fakeGitHub(answers: { status: number; body: unknown }[]): {
  fetch: Fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: Fetch = async (input, init) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: String(input),
      headers: init?.headers as Record<string, string>,
      body: init?.body,
    });

    const answer = answers[calls.length - 1];

    return new Response(JSON.stringify(answer.body), { status: answer.status });
  };

  return { fetch: fetchImpl, calls };
}

const release: ReleaseRequest = {
  tag: 'v0.2.0',
  notes: undefined,
  draft: false,
  asset: {
    name: 'estanza-card.js',
    contentType: 'application/javascript',
    data: new TextEncoder().encode('export {};'),
  },
};

describe('app JWT', () => {
  it('signs RS256 claims issued by the client id, back-dated a minute and valid nine', () => {
    const jwt = appJwt(privatePem, now);
    const [header, payload, signature] = jwt.split('.');

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decode(payload)).toEqual({
      iat: now - 60,
      exp: now + 540,
      iss: APP_CLIENT_ID,
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });

  it('refuses a key that is not a PEM without repeating it', () => {
    expect(() => appJwt('not-a-key-secret-material', now)).toThrow(
      'The GitHub App key is not a readable PEM private key.',
    );

    try {
      appJwt('not-a-key-secret-material', now);
    } catch (error) {
      expect(String(error)).not.toContain('secret-material');
    }
  });
});

describe('installation token', () => {
  it('finds the repo installation and exchanges the JWT for its token', async () => {
    const github = fakeGitHub([
      { status: 200, body: { id: 42 } },
      { status: 201, body: { token: 'ghs_installation' } },
    ]);

    await expect(installationToken('app.jwt', github.fetch)).resolves.toBe(
      'ghs_installation',
    );
    expect(github.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET https://api.github.com/repos/estanza-casa/estanza-card/installation',
      'POST https://api.github.com/app/installations/42/access_tokens',
    ]);
    expect(
      github.calls.every(
        (call) => call.headers.Authorization === 'Bearer app.jwt',
      ),
    ).toBe(true);
  });

  it('stops with the status and GitHub message when the app is not installed', async () => {
    const github = fakeGitHub([
      { status: 404, body: { message: 'Not Found' } },
    ]);

    await expect(installationToken('app.jwt', github.fetch)).rejects.toThrow(
      '/repos/estanza-casa/estanza-card/installation answered 404: Not Found',
    );
    expect(github.calls).toHaveLength(1);
  });
});

describe('publish release', () => {
  it('verifies the tag, creates a draft, uploads the asset, then publishes it', async () => {
    const github = fakeGitHub([
      { status: 200, body: { ref: 'refs/tags/v0.2.0' } },
      { status: 201, body: { id: 7, html_url: 'draft-url' } },
      { status: 201, body: { id: 70 } },
      { status: 200, body: { html_url: 'release-url' } },
    ]);

    await expect(
      publishRelease(release, 'ghs_installation', github.fetch),
    ).resolves.toBe('release-url');
    expect(github.calls.map(({ method, url }) => `${method} ${url}`)).toEqual([
      'GET https://api.github.com/repos/estanza-casa/estanza-card/git/ref/tags/v0.2.0',
      'POST https://api.github.com/repos/estanza-casa/estanza-card/releases',
      'POST https://uploads.github.com/repos/estanza-casa/estanza-card/releases/7/assets?name=estanza-card.js',
      'PATCH https://api.github.com/repos/estanza-casa/estanza-card/releases/7',
    ]);
    expect(JSON.parse(String(github.calls[1].body))).toEqual({
      tag_name: 'v0.2.0',
      name: 'v0.2.0',
      draft: true,
      generate_release_notes: true,
    });
    expect(github.calls[2].headers['Content-Type']).toBe(
      'application/javascript',
    );
    expect(github.calls[2].body).toBe(release.asset.data);
    expect(JSON.parse(String(github.calls[3].body))).toEqual({ draft: false });
    expect(
      github.calls.every(
        (call) => call.headers.Authorization === 'Bearer ghs_installation',
      ),
    ).toBe(true);
  });

  it('leaves a draft as a draft and uses the notes it was given', async () => {
    const github = fakeGitHub([
      { status: 200, body: { ref: 'refs/tags/v0.2.0' } },
      { status: 201, body: { id: 7, html_url: 'draft-url' } },
      { status: 201, body: { id: 70 } },
    ]);

    await expect(
      publishRelease(
        { ...release, draft: true, notes: 'Fixes the sheet.' },
        'ghs_installation',
        github.fetch,
      ),
    ).resolves.toBe('draft-url');
    expect(github.calls).toHaveLength(3);
    expect(JSON.parse(String(github.calls[1].body))).toEqual({
      tag_name: 'v0.2.0',
      name: 'v0.2.0',
      draft: true,
      body: 'Fixes the sheet.',
    });
  });

  it('creates nothing when the tag is not on GitHub', async () => {
    const github = fakeGitHub([
      { status: 404, body: { message: 'Not Found' } },
    ]);

    await expect(
      publishRelease(release, 'ghs_installation', github.fetch),
    ).rejects.toThrow('answered 404');
    expect(github.calls).toHaveLength(1);
  });

  it('never publishes a release whose asset upload failed', async () => {
    const github = fakeGitHub([
      { status: 200, body: { ref: 'refs/tags/v0.2.0' } },
      { status: 201, body: { id: 7, html_url: 'draft-url' } },
      { status: 422, body: { message: 'Validation Failed' } },
    ]);

    await expect(
      publishRelease(release, 'ghs_installation', github.fetch),
    ).rejects.toThrow('answered 422: Validation Failed');
    expect(github.calls.some((call) => call.method === 'PATCH')).toBe(false);
  });
});
