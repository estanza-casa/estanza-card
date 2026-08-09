import type { HomeDocument } from '@estanza/plan-engine';
import {
  type DerivedFloor,
  engineAdditions,
  groundFloor,
} from '@estanza/plan-engine/geometry/geometry.js';
import { plotColor } from '@estanza/plan-engine/geometry/plot.js';
import { zoneHole } from '@estanza/scene/components/Plot.js';
import {
  basementBounds,
  CM_PER_UNIT,
  DEFAULT_SKIN,
  GARDEN_NIGHT,
  groundCatchesShadow,
  groundSkin,
  type Pit,
  pitOf,
  PLAIN_GROUND,
  SKIN_GARDEN_NIGHT,
  SKIN_GROUND,
  underground,
  useGroundPlane,
  wallBounds,
} from '@estanza/scene/ground.js';
import { createElement, type ReactElement, useEffect, useMemo } from 'react';
import { Path, Shape, ShapeGeometry } from 'three';

export const BURIED_LAWN = 'buried-lawn';

export const PIT_LID = 'pit-lid';

const COVER_MARGIN_M = 0.5;
const COVER_LIFT_M = 0.01;
const LID_OVERLAP_M = 0.1;

export type GroundCover = { outer: Pit; pit: Pit };

function centreOf(floors: DerivedFloor[]): number[] | null {
  const footprint = wallBounds(floors);

  if (!footprint) return null;

  return [
    (footprint.minX + footprint.maxX) / 2,
    (footprint.minY + footprint.maxY) / 2,
  ];
}

export function buriedPit(floors: DerivedFloor[]): Pit | null {
  const centre = centreOf(floors);

  if (!centre || !underground(floors)) return null;

  return pitOf(floors, centre);
}

// The scene lays the ground of every storey, hidden ones included, so a basement shown alone needs it grassed over.
export function groundCover(
  floors: DerivedFloor[],
  shown: DerivedFloor[],
): GroundCover | null {
  const centre = centreOf(floors);
  const footprint = wallBounds(floors);

  if (!centre || !footprint) return null;
  if (underground(floors) || !underground(shown)) return null;

  const pit = pitOf(floors, centre);

  if (!pit) return null;

  const outer = {
    minX:
      Math.min((footprint.minX - centre[0]) / CM_PER_UNIT, pit.minX) -
      COVER_MARGIN_M,
    maxX:
      Math.max((footprint.maxX - centre[0]) / CM_PER_UNIT, pit.maxX) +
      COVER_MARGIN_M,
    minY:
      Math.min((footprint.minY - centre[1]) / CM_PER_UNIT, pit.minY) -
      COVER_MARGIN_M,
    maxY:
      Math.max((footprint.maxY - centre[1]) / CM_PER_UNIT, pit.maxY) +
      COVER_MARGIN_M,
  };

  return { outer, pit };
}

export function coverTone(
  home: HomeDocument,
  floors: DerivedFloor[],
): string | null {
  const pit = basementBounds(floors);
  const ground = groundFloor(floors).id;
  const zone = (home.additions.groundZones ?? []).find(
    (candidate) =>
      (candidate.floor ?? ground) === ground &&
      zoneHole(candidate.points, pit) !== null,
  );

  return zone ? plotColor(zone.material) : null;
}

// Drawn in the lawn's own frame, plan y mirrored, so a painted skin lines up with the scene's lawn.
export function coverPlane(cover: GroundCover | null): ShapeGeometry {
  if (!cover) return new ShapeGeometry(new Shape());

  const { outer, pit } = cover;
  const shape = new Shape();
  const hole = new Path();

  shape.moveTo(outer.minX, -outer.minY);
  shape.lineTo(outer.maxX, -outer.minY);
  shape.lineTo(outer.maxX, -outer.maxY);
  shape.lineTo(outer.minX, -outer.maxY);
  shape.closePath();

  hole.moveTo(pit.minX, -pit.minY);
  hole.lineTo(pit.minX, -pit.maxY);
  hole.lineTo(pit.maxX, -pit.maxY);
  hole.lineTo(pit.maxX, -pit.minY);
  hole.closePath();
  shape.holes.push(hole);

  return new ShapeGeometry(shape);
}

export function lidPlane(pit: Pit | null): ShapeGeometry {
  const shape = new Shape();

  if (pit) {
    const [x0, x1] = [pit.minX - LID_OVERLAP_M, pit.maxX + LID_OVERLAP_M];
    const [y0, y1] = [pit.minY - LID_OVERLAP_M, pit.maxY + LID_OVERLAP_M];

    shape.moveTo(x0, -y0);
    shape.lineTo(x1, -y0);
    shape.lineTo(x1, -y1);
    shape.lineTo(x0, -y1);
    shape.closePath();
  }

  return new ShapeGeometry(shape);
}

// The scene digs the basement pit whatever storey is in focus.
export function PitLid({
  home,
  floors,
  night,
  lit,
}: {
  home: HomeDocument;
  floors: DerivedFloor[];
  night: boolean;
  lit: boolean;
}): ReactElement | null {
  const pit = useMemo(() => {
    const centre = centreOf(floors);

    return centre && !underground(floors) ? pitOf(floors, centre) : null;
  }, [floors]);
  const lid = useMemo(() => lidPlane(pit), [pit]);
  const skin = engineAdditions(home).ground?.skin ?? DEFAULT_SKIN;
  const painted = useMemo(() => groundSkin(skin), [skin]);

  useEffect(() => () => lid.dispose(), [lid]);

  if (!pit) return null;

  const day = painted ? SKIN_GROUND : PLAIN_GROUND;
  const tone = night ? (painted ? SKIN_GARDEN_NIGHT : GARDEN_NIGHT) : day;

  return createElement(
    'mesh',
    {
      name: PIT_LID,
      geometry: lid,
      rotation: [-Math.PI / 2, 0, 0],
      position: [0, COVER_LIFT_M, 0],
      receiveShadow: groundCatchesShadow(lit, night),
    },
    createElement(lit ? 'meshStandardMaterial' : 'meshBasicMaterial', {
      key: `${skin}|${lit}`,
      color: tone,
      map: painted?.map ?? null,
    }),
  );
}

export function BuriedLawn({
  home,
  floors,
  shown,
  night,
  lit,
}: {
  home: HomeDocument;
  floors: DerivedFloor[];
  shown: DerivedFloor[];
  night: boolean;
  lit: boolean;
}): ReactElement | null {
  const pit = useMemo(() => buriedPit(floors), [floors]);
  const lawn = useGroundPlane(pit);
  const buried = underground(shown);
  const cover = useMemo(
    () =>
      buried
        ? groundCover(
            floors,
            floors.filter((fd) => fd.level < 0),
          )
        : null,
    [floors, buried],
  );
  const patch = useMemo(() => coverPlane(cover), [cover]);
  const skin = engineAdditions(home).ground?.skin ?? DEFAULT_SKIN;
  const painted = useMemo(() => groundSkin(skin), [skin]);
  const zoned = useMemo(
    () => (cover ? coverTone(home, floors) : null),
    [cover, home, floors],
  );

  useEffect(() => () => patch.dispose(), [patch]);

  if (!pit && !cover) return null;

  const day = painted ? SKIN_GROUND : PLAIN_GROUND;
  const tone = night ? (painted ? SKIN_GARDEN_NIGHT : GARDEN_NIGHT) : day;
  const where = {
    name: BURIED_LAWN,
    geometry: pit ? lawn : patch,
    rotation: [-Math.PI / 2, 0, 0],
    position: [0, pit ? -0.02 : COVER_LIFT_M, 0],
  };

  if (!pit && zoned) {
    return createElement(
      'mesh',
      { ...where, receiveShadow: true },
      createElement('meshStandardMaterial', { key: 'zone', color: zoned }),
    );
  }

  return createElement(
    'mesh',
    { ...where, receiveShadow: groundCatchesShadow(lit, night) },
    createElement(lit ? 'meshStandardMaterial' : 'meshBasicMaterial', {
      key: `${skin}|${lit}`,
      color: tone,
      map: painted?.map ?? null,
    }),
  );
}
