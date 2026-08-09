// @vitest-environment node

import { describe, expect, it } from 'vitest';

import devConfig, { replaceGlobalDefines } from '../dev/vite.config.ts';
import packageJson from '../package.json';

describe('dev card server', () => {
  it('declares the card version the build declares', () => {
    expect(devConfig.define?.__CARD_VERSION__).toBe(
      JSON.stringify(packageJson.version),
    );
  });

  it('writes the card version into served source', () => {
    const served = replaceGlobalDefines(
      'export const cardVersion = __CARD_VERSION__;',
      devConfig.define ?? {},
    );

    expect(served).toBe(`export const cardVersion = "${packageJson.version}";`);
  });

  it('serves the production builds the released card bundles, never a development Lit beside Home Assistant own', () => {
    const conditions = devConfig.resolve?.conditions ?? [];

    expect(conditions).toContain('browser');
    expect(conditions).toContain('production');
    expect(conditions).not.toContain('development');
  });

  it('leaves other globals and longer names alone', () => {
    const served = replaceGlobalDefines(
      'const a = __OTHER__; const b = __CARD_VERSION___X;',
      devConfig.define ?? {},
    );

    expect(served).toBe('const a = __OTHER__; const b = __CARD_VERSION___X;');
  });
});
