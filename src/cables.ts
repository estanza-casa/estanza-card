import type { HomeDocument } from '@estanza/plan-engine';
import type { Cable, CableEndpoint } from '@estanza/plan-engine/document';
import {
  type DerivedFloor,
  floorOfItem,
} from '@estanza/plan-engine/geometry/geometry.js';
import {
  type CanvasState,
  drawCable,
  drawCableEndpoint,
} from '@estanza/plan2d';

type CableType = NonNullable<Cable['type']>;
type Vec3 = [number, number, number];

export type CableRun = { color: string; points: Vec3[] };

// The share viewer's palette, so a run reads the same colour in both places.
const CABLE_COLORS: Record<CableType, string> = {
  cat6: '#3f8efc',
  power: '#e0b13f',
  coax: '#d06044',
  fiber: '#43c59e',
  speaker: '#a06fd0',
  conduit: '#8a8f98',
};

function runPoints(cable: Cable, ends: Map<string, CableEndpoint>): Vec3[] {
  const points: Vec3[] = (cable.points ?? []).map(([x, y, z]) => [x, y, z]);
  if (points.length < 2) return points;

  const from = cable.from === undefined ? undefined : ends.get(cable.from);
  const to = cable.to === undefined ? undefined : ends.get(cable.to);

  if (from) points[0] = [from.at[0], from.at[1], from.elevation ?? 0];
  if (to) points[points.length - 1] = [to.at[0], to.at[1], to.elevation ?? 0];

  return points;
}

export function cableRuns(
  home: HomeDocument,
  floors: DerivedFloor[],
  active: string | null,
): { runs: CableRun[]; ends: CableEndpoint[] } {
  const cables = home.additions.cables ?? [];
  const endpoints = home.additions.cableEndpoints ?? [];
  const bySlug = new Map(endpoints.map((end) => [end.slug, end]));
  const shown = (item: Cable | CableEndpoint): boolean =>
    active === null || floorOfItem(item, floors).id === active;

  return {
    runs: cables.filter(shown).map((cable) => ({
      color: cable.color ?? CABLE_COLORS[cable.type ?? 'conduit'],
      points: runPoints(cable, bySlug),
    })),
    ends: endpoints.filter(shown),
  };
}

export function drawCableLayer(
  cs: CanvasState,
  home: HomeDocument,
  floors: DerivedFloor[],
  active: string | null,
): void {
  const { runs, ends } = cableRuns(home, floors, active);

  for (const run of runs) drawCable(cs, run.color, run.points, false);
  for (const end of ends) drawCableEndpoint(cs, end, end.at, false);
}
