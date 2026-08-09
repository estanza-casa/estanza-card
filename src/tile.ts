import type { DerivedFloor } from '@estanza/plan-engine/geometry/geometry.js';

import type { GridOptions } from './bindings.js';
import type { FloorChoice } from './floors.js';
import { entityDomain, type ScopeStateMap } from './hass-state.js';
import { planFloor } from './plan.js';

export const TILE_MAX_ROWS = 3;
export const SECTION_COLUMNS = 12;
export const TILE_KEYS = ['Enter', ' '] as const;

export function isTile(grid: GridOptions | undefined): boolean {
  return grid?.rows !== undefined && grid.rows <= TILE_MAX_ROWS;
}

export function isWideTile(grid: GridOptions | undefined): boolean {
  const columns = grid?.columns;

  return columns === 'full' || (columns ?? 0) >= SECTION_COLUMNS;
}

export function tileFloors(
  floors: readonly DerivedFloor[],
  choice: FloorChoice,
  wide: boolean,
): FloorChoice[] {
  if (floors.length < 2) return [null];
  if (!wide) return [planFloor(floors, choice)];

  const roomed = floors.filter((floor) => floor.rooms.length > 0);

  return [...(roomed.length > 0 ? roomed : floors)]
    .sort((a, b) => a.level - b.level)
    .map((floor) => floor.id);
}

export function lightsOn(scopeStates: ScopeStateMap): number {
  const lit = new Set<string>();

  for (const scopeState of Object.values(scopeStates)) {
    for (const state of scopeState.states) {
      if (entityDomain(state.entity_id) === 'light' && state.state === 'on') {
        lit.add(state.entity_id);
      }
    }
  }

  return lit.size;
}

export function lightsWord(count: number): string {
  return count === 1 ? '1 light on' : `${count} lights on`;
}

export function navigate(path: string): void {
  history.pushState(null, '', path);
  window.dispatchEvent(
    new CustomEvent('location-changed', { detail: { replace: false } }),
  );
}
