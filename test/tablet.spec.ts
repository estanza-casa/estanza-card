import { describe, expect, it } from 'vitest';

import {
  BURN_IN_EVERY_MS,
  BURN_IN_SHIFT_MS,
  burnInPlace,
  burnInPlaces,
  controlDrift,
  framingOf,
  IDLE_RETURN_MS,
  idleMs,
  idleReturn,
  isLateNight,
  isTablet,
  LATE_EXPOSURE,
  lateNightStart,
  msToLateNightChange,
  orientationOf,
  parseClock,
} from '../src/tablet.js';

function at(hours: number, minutes = 0): Date {
  return new Date(2026, 8, 23, hours, minutes);
}

describe('wall tablet mode', () => {
  it('turns on by itself in a panel view', () => {
    expect(isTablet('auto', 'panel')).toBe(true);
  });

  it('stays a card in a sections grid or a masonry column', () => {
    expect(isTablet('auto', 'grid')).toBe(false);
    expect(isTablet('auto', undefined)).toBe(false);
  });

  it('can be forced on anywhere, or kept off in a panel', () => {
    expect(isTablet('on', 'grid')).toBe(true);
    expect(isTablet('off', 'panel')).toBe(false);
  });
});

describe('the tablet layout', () => {
  it('lays a wide screen out as landscape', () => {
    expect(orientationOf(1280, 800)).toBe('landscape');
    expect(orientationOf(1920, 1200)).toBe('landscape');
  });

  it('lays a tall screen out as portrait', () => {
    expect(orientationOf(800, 1280)).toBe('portrait');
  });

  it('treats a square screen as landscape', () => {
    expect(orientationOf(900, 900)).toBe('landscape');
  });

  it('fits the house in landscape and flies closer into a room', () => {
    expect(framingOf(true, 'landscape')).toEqual({
      raise: 0,
      zoom: 1.2,
      house: true,
    });
  });

  it('frames the house in the top two thirds in portrait, clear of the controls', () => {
    expect(framingOf(true, 'portrait')).toEqual({
      raise: 1 / 6,
      zoom: 1,
      house: true,
    });
  });

  it('fits the house of a card that is not a tablet, with no raise or zoom', () => {
    expect(framingOf(false, 'portrait')).toEqual({
      raise: 0,
      zoom: 1,
      house: true,
    });
  });
});

describe('the idle return', () => {
  it('waits 45 seconds by default', () => {
    expect(idleMs({})).toBe(45_000);
  });

  it('waits as long as the card is told to', () => {
    expect(idleMs({ idle_seconds: 5 })).toBe(5_000);
  });

  it('eases the camera home in 1.2 seconds', () => {
    expect(IDLE_RETURN_MS).toBe(1200);
  });

  it('puts the floor back to its default and brings the camera home', () => {
    expect(idleReturn(null, null)).toEqual({ floor: null, camera: true });
    expect(idleReturn(null, 'f1')).toEqual({ floor: 'f1', camera: true });
  });

  it('holds the floor and the room of a critical alert', () => {
    expect(idleReturn({ floor: 'bfloor' }, null)).toEqual({
      floor: 'bfloor',
      camera: false,
    });
  });
});

describe('burn-in', () => {
  it('has six home positions', () => {
    expect(burnInPlaces).toHaveLength(6);
    expect(
      new Set(burnInPlaces.map((place) => JSON.stringify(place))).size,
    ).toBe(6);
  });

  it('starts from the home view itself', () => {
    expect(burnInPlace(0)).toEqual({ orbit: 0, x: 0, y: 0 });
  });

  it('keeps every position within 3 degrees and 10px of home', () => {
    for (const place of burnInPlaces) {
      expect(Math.abs(place.orbit)).toBeLessThanOrEqual(3);
      expect(Math.abs(place.x)).toBeLessThanOrEqual(10);
      expect(Math.abs(place.y)).toBeLessThanOrEqual(10);
    }
  });

  it('comes round to the first position after the sixth', () => {
    expect(burnInPlace(6)).toEqual(burnInPlace(0));
    expect(burnInPlace(7)).toEqual(burnInPlace(1));
  });

  it('moves every 15 minutes, over 3 seconds', () => {
    expect(BURN_IN_EVERY_MS).toBe(15 * 60 * 1000);
    expect(BURN_IN_SHIFT_MS).toBe(3000);
  });

  it('moves the controls with the house, never more than 6px', () => {
    for (const place of burnInPlaces) {
      const drift = controlDrift(place);

      expect(Math.abs(drift.x)).toBeLessThanOrEqual(6);
      expect(Math.abs(drift.y)).toBeLessThanOrEqual(6);
      expect(Math.sign(drift.x)).toBe(Math.sign(place.x));
      expect(Math.sign(drift.y)).toBe(Math.sign(place.y));
    }
  });

  it('reaches the full 6px at the edge of the range', () => {
    expect(controlDrift({ orbit: 0, x: 10, y: -10 })).toEqual({ x: 6, y: -6 });
  });
});

describe('late night', () => {
  const start = parseClock('23:00') ?? 0;
  const end = parseClock('06:00') ?? 0;

  it('reads a time of day as minutes after midnight', () => {
    expect(parseClock('23:00')).toBe(23 * 60);
    expect(parseClock('7:05')).toBe(7 * 60 + 5);
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('23:60')).toBeNull();
    expect(parseClock('late')).toBeNull();
  });

  it('starts at 23:00 by default and can be switched off', () => {
    expect(lateNightStart({})).toBe(23 * 60);
    expect(lateNightStart({ late_night: '21:15' })).toBe(21 * 60 + 15);
    expect(lateNightStart({ late_night: 'off' })).toBeNull();
  });

  it('runs from its start past midnight until six in the morning', () => {
    expect(isLateNight(at(22, 59), start, end)).toBe(false);
    expect(isLateNight(at(23, 0), start, end)).toBe(true);
    expect(isLateNight(at(2, 30), start, end)).toBe(true);
    expect(isLateNight(at(5, 59), start, end)).toBe(true);
    expect(isLateNight(at(6, 0), start, end)).toBe(false);
    expect(isLateNight(at(12, 0), start, end)).toBe(false);
  });

  it('works for a start after midnight too', () => {
    const early = parseClock('01:00') ?? 0;

    expect(isLateNight(at(0, 30), early, end)).toBe(false);
    expect(isLateNight(at(3, 0), early, end)).toBe(true);
    expect(isLateNight(at(7, 0), early, end)).toBe(false);
  });

  it('knows how long until it next begins or ends', () => {
    expect(msToLateNightChange(at(22, 0), start, end)).toBe(60 * 60 * 1000);
    expect(msToLateNightChange(at(23, 0), start, end)).toBe(7 * 60 * 60 * 1000);
    expect(msToLateNightChange(at(12, 0), start, end)).toBe(
      11 * 60 * 60 * 1000,
    );
  });

  it('dims the scene by a further 40 percent', () => {
    expect(LATE_EXPOSURE).toBeCloseTo(0.6);
  });
});
