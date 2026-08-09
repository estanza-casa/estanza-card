import type { DerivedFloor } from '@estanza/plan-engine/geometry/geometry.js';
import { tokens } from '@estanza/tokens';

import { type SceneScope, scopeKey } from './bindings.js';
import type { Point } from './gesture.js';
import {
  deviceClassOf,
  doorDeviceClasses,
  entityDomain,
  type HassEntityState,
  type ScopeStateMap,
  windowDeviceClasses,
} from './hass-state.js';

export type Box = { left: number; top: number; right: number; bottom: number };

export type Size = { width: number; height: number };

export type Dock = Point & { width: number; room: number };

export type OpenThing = {
  kind: 'door' | 'window';
  entityId: string;
  scope: SceneScope | null;
  beyond: string | null;
  open: boolean;
  lock: string | null;
};

export const SHEET_EDGE_PX = tokens.spacing[3];
export const SHEET_WIDTH_PX = 272;
export const WIDE_VIEWPORT_PX = 600;
export const DOCK_CARD_SHARE = 0.6;
export const COVER_CARD_PX = 400;
export const FREE_CARD_SHARE = 0.4;
export const SHEET_GUESS: Size = { width: SHEET_WIDTH_PX, height: 132 };
export const SWIPE_CLOSE_SHARE = 0.25;
export const SWIPE_FLICK_PX_PER_MS = 0.5;

export function sheetsBelow(viewportWidth: number, stage?: Size): boolean {
  const small =
    stage !== undefined &&
    stage.width > 0 &&
    stage.height > 0 &&
    stage.width < COVER_CARD_PX &&
    stage.height < COVER_CARD_PX;

  return viewportWidth < WIDE_VIEWPORT_PX && !small;
}

export function dockCovers(stage: Size): boolean {
  const width = Math.min(
    SHEET_WIDTH_PX,
    Math.floor(stage.width * DOCK_CARD_SHARE),
  );

  return (
    stage.width < COVER_CARD_PX ||
    stage.width - width - 2 * SHEET_EDGE_PX < stage.width * FREE_CARD_SHARE
  );
}

export function dockSpot(stage: Size, top: number, bottom = 0): Dock {
  const y = Math.max(top, SHEET_EDGE_PX);
  const width = dockCovers(stage)
    ? stage.width - 2 * SHEET_EDGE_PX
    : Math.min(SHEET_WIDTH_PX, Math.floor(stage.width * DOCK_CARD_SHARE));

  return {
    x: stage.width - SHEET_EDGE_PX - width,
    y,
    width,
    room: Math.max(0, stage.height - y - Math.max(bottom, SHEET_EDGE_PX)),
  };
}

export function boxOf(points: readonly Point[]): Box | null {
  if (points.length === 0) return null;

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

export function underSheet(
  mark: Point,
  size: Size,
  sheets: readonly Box[],
): boolean {
  const box = {
    left: mark.x - size.width / 2,
    top: mark.y - size.height / 2,
    right: mark.x + size.width / 2,
    bottom: mark.y + size.height / 2,
  };

  return sheets.some(
    (sheet) =>
      box.left < sheet.right &&
      box.right > sheet.left &&
      box.top < sheet.bottom &&
      box.bottom > sheet.top,
  );
}

export function swipeCloses(
  drop: number,
  height: number,
  speed: number,
): boolean {
  if (speed <= -SWIPE_FLICK_PX_PER_MS) return false;

  return drop > height * SWIPE_CLOSE_SHARE || speed >= SWIPE_FLICK_PX_PER_MS;
}

export function mostlyUnderSheet(
  ring: readonly Point[],
  sheets: readonly Box[],
): boolean {
  const whole = areaOf(ring);

  if (whole === 0) return false;

  const hidden = sheets.reduce(
    (sum, sheet) => sum + areaOf(clipToBox(ring, sheet)),
    0,
  );

  return hidden > whole / 2;
}

function clipToBox(ring: readonly Point[], box: Box): Point[] {
  const edges: [(at: Point) => number, number][] = [
    [(at) => at.x, box.left],
    [(at) => -at.x, -box.right],
    [(at) => at.y, box.top],
    [(at) => -at.y, -box.bottom],
  ];

  return edges.reduce<Point[]>(
    (points, [along, limit]) =>
      points.flatMap((to, index) => {
        const from = points[(index + points.length - 1) % points.length];
        const inside = (at: Point): boolean => along(at) >= limit;
        const cut = (): Point => {
          const share = (limit - along(from)) / (along(to) - along(from));

          return {
            x: from.x + (to.x - from.x) * share,
            y: from.y + (to.y - from.y) * share,
          };
        };

        if (inside(to)) return inside(from) ? [to] : [cut(), to];

        return inside(from) ? [cut()] : [];
      }),
    [...ring],
  );
}

function areaOf(ring: readonly Point[]): number {
  const twice = ring.reduce((sum, at, index) => {
    const next = ring[(index + 1) % ring.length];

    return sum + at.x * next.y - next.x * at.y;
  }, 0);

  return Math.abs(twice) / 2;
}

export function openingsInRoom(
  floors: readonly DerivedFloor[],
  slug: string,
  scopeStates: ScopeStateMap,
  roomStates: readonly HassEntityState[],
): OpenThing[] {
  const floor = floors.find((candidate) => candidate.roomsBySlug.has(slug));
  const walls = new Set(floor?.roomsBySlug.get(slug)?.walls ?? []);
  const found = new Map<string, OpenThing>();
  const inPlan = [
    ...(floor?.floor.doors ?? []).map((item) => ({
      item,
      kind: 'door' as const,
    })),
    ...(floor?.floor.windows ?? []).map((item) => ({
      item,
      kind: 'window' as const,
    })),
  ];

  for (const { item, kind } of inPlan) {
    if (!walls.has(item.wallId)) continue;

    const scope: SceneScope = { type: kind, id: item.id };
    const scopeState = own(scopeStates, scopeKey(scope));
    const reading =
      scopeState?.reading?.kind === 'opening' ? scopeState.reading : null;
    const lock =
      scopeState?.states.find(
        (state) => entityDomain(state.entity_id) === 'lock',
      )?.entity_id ?? null;
    const entityId = reading?.entityId ?? lock;

    if (entityId === null || found.has(entityId)) continue;

    const beyond = floor?.rooms.find(
      (room) => room.slug !== slug && room.walls.includes(item.wallId),
    );

    found.set(entityId, {
      kind,
      entityId,
      scope,
      beyond: beyond?.label ?? null,
      open: (reading?.open ?? 0) > 0,
      lock,
    });
  }

  const contacts = roomStates.flatMap((state) => {
    const kind = openingKind(state);

    return kind && !found.has(state.entity_id) ? [{ state, kind }] : [];
  });

  contacts.sort(
    (a, b) =>
      a.kind.localeCompare(b.kind) ||
      a.state.entity_id.localeCompare(b.state.entity_id),
  );

  for (const { state, kind } of contacts) {
    found.set(state.entity_id, {
      kind,
      entityId: state.entity_id,
      scope: null,
      beyond: null,
      open: state.state === 'on',
      lock: null,
    });
  }

  return [...found.values()];
}

function own<TValue>(
  record: Record<string, TValue>,
  key: string,
): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function openingKind(state: HassEntityState): OpenThing['kind'] | null {
  if (entityDomain(state.entity_id) !== 'binary_sensor') return null;

  const deviceClass = deviceClassOf(state) ?? '';

  if ((windowDeviceClasses as readonly string[]).includes(deviceClass)) {
    return 'window';
  }

  if ((doorDeviceClasses as readonly string[]).includes(deviceClass)) {
    return 'door';
  }

  return null;
}
