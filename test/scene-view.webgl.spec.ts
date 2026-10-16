import { afterEach, describe, expect, it, vi } from 'vitest';

import { webglSupported } from '../src/scene-view.js';

describe('webglSupported', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('probes once, releases the probe context and remembers the answer', () => {
    const loseContext = vi.fn();
    const context = {
      getExtension: (name: string) =>
        name === 'WEBGL_lose_context' ? { loseContext } : null,
    };
    const probe = vi
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as RenderingContext);

    expect(webglSupported(document)).toBe(true);
    expect(webglSupported(document)).toBe(true);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
