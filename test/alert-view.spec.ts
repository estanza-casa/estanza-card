import { describe, expect, it } from 'vitest';

import { besideGlyphs, pinBox } from '../src/alert-view.js';
import { covered } from '../src/living.js';

const glyph = { x: 200, y: 200, width: 32, height: 32 };

describe('where an alert pin stands', () => {
  it('stands on its room when no glyph is near', () => {
    expect(besideGlyphs({ x: 200, y: 200 }, 'critical', [])).toEqual({
      x: 200,
      y: 200,
    });
  });

  it('steps aside from a light glyph on the same spot, so pin and glyph never touch', () => {
    const at = besideGlyphs({ x: 200, y: 200 }, 'critical', [glyph]);

    expect(at.y).toBe(200);
    expect(covered(pinBox(at, 'critical', false), [glyph])).toBe(false);
  });

  it('steps aside from a glyph just under its foot', () => {
    const under = { ...glyph, y: 215 };
    const at = besideGlyphs({ x: 200, y: 200 }, 'notice', [under]);

    expect(covered(pinBox(at, 'notice', false), [under])).toBe(false);
  });

  it('takes the side that is free', () => {
    const left = { ...glyph, x: 150 };
    const at = besideGlyphs({ x: 200, y: 200 }, 'critical', [glyph, left]);

    expect(at.x).toBeGreaterThan(200);
    expect(covered(pinBox(at, 'critical', false), [glyph, left])).toBe(false);
  });
});
