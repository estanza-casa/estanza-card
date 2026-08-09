import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';

import homeFixture from './fixtures/home.json';

type Storey = {
  prefix: string;
  name: string;
  level: number;
  room: string;
};

const extra: Storey[] = [
  { prefix: 'b', name: 'Basement', level: -1, room: 'cellar' },
  { prefix: 'u', name: 'First floor', level: 1, room: 'bedroom' },
];

export function threeStoreyHome(): HomeDocument {
  const home = structuredClone(homeFixture);
  const ground = home.plan.floors[0];

  for (const storey of extra) {
    const id = (value: string) => `${storey.prefix}${value}`;

    home.plan.floors.push({
      ...structuredClone(ground),
      id: id('floor'),
      name: storey.name,
      level: storey.level,
      walls: ground.walls.map((wall) => ({ ...wall, id: id(wall.id) })),
      doors: ground.doors.map((door) => ({
        ...door,
        id: id(door.id),
        wallId: id(door.wallId),
      })),
      rooms: [
        {
          id: id('room1'),
          name: storey.name,
          walls: ['w1', 'w2', 'w3', 'w4'].map(id),
        },
      ],
    });
    Object.assign(home.rooms, {
      [id('room1')]: {
        slug: storey.room,
        label: storey.name,
        floorColor: '#c9b391',
      },
    });
    home.additions.lights.push({
      slug: `${storey.room}-light`,
      room: storey.room,
      style: 'flush',
      color: '#ffd4ab',
      on: true,
    });
  }

  return homeDocumentSchema.parse(home);
}
