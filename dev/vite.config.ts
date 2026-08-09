import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mergeConfig, type Plugin } from 'vite';

import baseConfig from '../vite.config.ts';

const cardRoot = fileURLToPath(new URL('..', import.meta.url));
const monorepoRoot = fileURLToPath(new URL('../../estanza', import.meta.url));
const propsDir = `${monorepoRoot}/apps/webapp/public/assets/props`;
const sharedHomePath = fileURLToPath(
  new URL('./ha-config/shared-home.json', import.meta.url),
);
const harnessPath = fileURLToPath(
  new URL('./ha-config/.estanza-dev-harness.json', import.meta.url),
);
const cardVerdictPath = fileURLToPath(
  new URL('./ha-config/card-update.txt', import.meta.url),
);
const shareToken = 'casa-aurora';

function cardVerdict(): string {
  if (!existsSync(cardVerdictPath)) return 'ok';

  return readFileSync(cardVerdictPath, 'utf8').trim();
}

function cardPort(): number {
  if (!existsSync(harnessPath)) return 5199;

  const harness: { cardPort?: number } = JSON.parse(
    readFileSync(harnessPath, 'utf8'),
  );

  return harness.cardPort ?? 5199;
}

export function replaceGlobalDefines(
  code: string,
  define: Record<string, unknown>,
): string {
  return Object.entries(define)
    .filter(([key]) => /^__\w+__$/.test(key))
    .reduce(
      (source, [key, value]) =>
        source.replace(new RegExp(`\\b${key}\\b`, 'g'), String(value)),
      code,
    );
}

// Vite serves define globals from its own client script, which Home Assistant never loads.
function inlineGlobalDefines(): Plugin {
  let define: Record<string, unknown> = {};

  return {
    name: 'estanza-inline-global-defines',
    apply: 'serve',
    configResolved(config) {
      define = config.define ?? {};
    },
    transform(code, id) {
      if (!id.startsWith(`${cardRoot}src/`)) return null;

      const replaced = replaceGlobalDefines(code, define);

      return replaced === code ? null : { code: replaced, map: null };
    },
  };
}

function localModels(): Plugin {
  return {
    name: 'estanza-local-models',
    configureServer(server) {
      server.middlewares.use('/assets/props', (req, res, next) => {
        const file = `${propsDir}/${basename(decodeURIComponent(req.url ?? ''))}`;

        if (!file.endsWith('.glb') || !existsSync(file)) return next();

        res.setHeader('content-type', 'model/gltf-binary');
        createReadStream(file).pipe(res);
      });
    },
  };
}

function localShare(): Plugin {
  return {
    name: 'estanza-local-share',
    configureServer(server) {
      server.middlewares.use(
        '/v1/integrations/home-assistant',
        (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'OPTIONS') return next();

          res.setHeader('access-control-allow-origin', '*');
          res.setHeader(
            'access-control-allow-headers',
            'accept, if-none-match, x-estanza-card',
          );
          res.setHeader(
            'access-control-expose-headers',
            'ETag, X-Estanza-Card-Update',
          );
          res.setHeader('cache-control', 'no-store');
          res.setHeader('x-estanza-card-update', cardVerdict());

          if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();

            return;
          }

          const token = decodeURIComponent(basename(req.url ?? ''));

          if (token !== shareToken || !existsSync(sharedHomePath)) {
            res.statusCode = 404;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: 'Not found' }));

            return;
          }

          const body = JSON.stringify({
            home: {
              name: 'Casa Aurora',
              document: JSON.parse(readFileSync(sharedHomePath, 'utf8')),
              watermark: false,
            },
          });
          const etag = `"${createHash('sha256').update(body).digest('hex').slice(0, 32)}"`;

          res.setHeader('etag', etag);

          if (req.headers['if-none-match'] === etag) {
            res.statusCode = 304;
            res.end();

            return;
          }

          res.setHeader('content-type', 'application/json');
          res.end(body);
        },
      );
    },
  };
}

export default mergeConfig(baseConfig, {
  root: cardRoot,
  plugins: [inlineGlobalDefines(), localModels(), localShare()],
  resolve: { conditions: ['module', 'browser', 'production'] },
  server: {
    host: '127.0.0.1',
    port: cardPort(),
    strictPort: true,
    fs: { allow: [cardRoot, monorepoRoot] },
  },
});
