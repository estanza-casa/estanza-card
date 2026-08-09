import { EXPLODE_MS } from '@estanza/scene/explode.js';

import type { EstanzaCardConfig, SceneScope, TabletMode } from './bindings.js';
import type { FloorChoice } from './floors.js';

export type Orientation = 'landscape' | 'portrait';

export type HomePlace = { orbit: number; x: number; y: number };

export type IdleHold = { floor: FloorChoice; room?: SceneScope };

export type IdleReturn = { floor: FloorChoice; camera: boolean };

export type Drift = { x: number; y: number };

export type Framing = { raise: number; zoom: number; house: boolean };

export const IDLE_SECONDS = 45;
export const IDLE_RETURN_MS = 1200;
export const REFRAME_WAIT_MS = EXPLODE_MS + 200;
export const BURN_IN_EVERY_MS = 15 * 60 * 1000;
export const BURN_IN_SHIFT_MS = 3000;
export const LATE_NIGHT_START = '23:00';
export const LATE_NIGHT_END = '06:00';
export const LATE_EXPOSURE = 0.6;
export const PORTRAIT_RAISE = 1 / 6;
export const LANDSCAPE_ZOOM = 1.2;
export const HOUSE_BAND = 2 / 3;
export const HOUSE_MARGIN_PX = 32;
export const PORTRAIT_CONTROLS_PX = 96;
export const TABLET_TARGET_RADIUS_PX = 28;

const CONTROL_DRIFT = 0.6;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CLOCK = /^([01]?\d|2[0-3]):([0-5]\d)$/;

export const burnInPlaces: readonly HomePlace[] = [
  { orbit: 0, x: 0, y: 0 },
  { orbit: 3, x: 10, y: -6 },
  { orbit: -2, x: -8, y: 10 },
  { orbit: 1.5, x: -10, y: -4 },
  { orbit: -3, x: 6, y: 8 },
  { orbit: 2, x: 4, y: -10 },
];

export function isTablet(
  mode: TabletMode,
  layout: string | undefined,
): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;

  return layout === 'panel';
}

export function orientationOf(width: number, height: number): Orientation {
  return height > width ? 'portrait' : 'landscape';
}

export function framingOf(tablet: boolean, orientation: Orientation): Framing {
  if (!tablet) return { raise: 0, zoom: 1, house: true };
  if (orientation === 'portrait') {
    return { raise: PORTRAIT_RAISE, zoom: 1, house: true };
  }

  return { raise: 0, zoom: LANDSCAPE_ZOOM, house: true };
}

export function idleMs(
  config: Pick<EstanzaCardConfig, 'idle_seconds'>,
): number {
  return (config.idle_seconds ?? IDLE_SECONDS) * 1000;
}

export function idleReturn(
  hold: IdleHold | null,
  defaultFloor: FloorChoice,
): IdleReturn {
  if (hold) return { floor: hold.floor, camera: false };

  return { floor: defaultFloor, camera: true };
}

export function burnInPlace(index: number): HomePlace {
  const count = burnInPlaces.length;

  return burnInPlaces[((index % count) + count) % count];
}

export function controlDrift(place: HomePlace): Drift {
  return {
    x: Math.round(place.x * CONTROL_DRIFT) || 0,
    y: Math.round(place.y * CONTROL_DRIFT) || 0,
  };
}

export function parseClock(text: string): number | null {
  const match = CLOCK.exec(text);

  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function lateNightStart(
  config: Pick<EstanzaCardConfig, 'late_night'>,
): number | null {
  const start = config.late_night ?? LATE_NIGHT_START;

  return start === 'off' ? null : parseClock(start);
}

export function lateNightEnd(): number {
  return parseClock(LATE_NIGHT_END) ?? 0;
}

export function isLateNight(now: Date, start: number, end: number): boolean {
  const minute = msOfDay(now) / MINUTE_MS;

  if (start === end) return false;
  if (start < end) return minute >= start && minute < end;

  return minute >= start || minute < end;
}

export function msToLateNightChange(
  now: Date,
  start: number,
  end: number,
): number {
  const since = msOfDay(now);

  return Math.min(
    ...[start, end].map((boundary) => {
      const ahead = (boundary * MINUTE_MS - since + DAY_MS) % DAY_MS;

      return ahead === 0 ? DAY_MS : ahead;
    }),
  );
}

function msOfDay(date: Date): number {
  return (
    ((date.getHours() * 60 + date.getMinutes()) * 60 + date.getSeconds()) *
      1000 +
    date.getMilliseconds()
  );
}
