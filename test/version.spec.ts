import { afterEach, describe, expect, it, vi } from 'vitest';

import packageJson from '../package.json';
import { cardVersion, logCardVersion } from '../src/version.js';

describe('card version', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the version in package.json', () => {
    expect(cardVersion).toBe(packageJson.version);
  });

  it('logs one styled badge naming the card and its version', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    logCardVersion('1.2.3');

    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0]?.[0]).toBe('%c ESTANZA-CARD %c v1.2.3 ');
    expect(info.mock.calls[0]).toHaveLength(3);
  });
});
