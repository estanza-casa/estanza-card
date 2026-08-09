import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const demoHomePath = fileURLToPath(
  new URL('../../estanza/packages/shared/src/demo-home.json', import.meta.url),
);

export const sharedHomePath = fileURLToPath(
  new URL('./ha-config/shared-home.json', import.meta.url),
);

export const cardVerdictPath = fileURLToPath(
  new URL('./ha-config/card-update.txt', import.meta.url),
);

export const shareToken = 'casa-aurora';

export const exteriorDoorNames = { d1: 'Front door', d7: 'Garage door' };

export const coverDoorIds = ['d7'];

export const thermostatRoom = 'living-room';

export const lockedDoorId = 'd1';

export const plugProp = 'living-room-television';

export const alertSensors = [
  { kind: 'leak', room: 'bathroom', deviceClass: 'moisture', label: 'leak' },
  { kind: 'smoke', room: 'kitchen', deviceClass: 'smoke', label: 'smoke' },
  { kind: 'gas', room: 'garage', deviceClass: 'gas', label: 'gas' },
  { kind: 'safety', room: 'workshop', deviceClass: 'safety', label: 'safety' },
  {
    kind: 'problem',
    room: 'wine-cellar',
    deviceClass: 'problem',
    label: 'cooler fault',
  },
];

export const alarmEntity = 'alarm_control_panel.house_alarm';

export function loadDemoHome() {
  return JSON.parse(readFileSync(demoHomePath, 'utf8'));
}

export function objectId(value) {
  return value.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
}

export function describeHome(home) {
  const floors = home.plan.floors.map((floor, index) => {
    const wallRooms = new Map();

    for (const room of floor.rooms) {
      const slug = home.rooms[room.id]?.slug;

      if (!slug) continue;

      for (const wall of room.walls ?? []) {
        wallRooms.set(wall, [...(wallRooms.get(wall) ?? []), slug]);
      }
    }

    return {
      id: floor.id,
      name: floor.name && floor.name !== '0' ? floor.name : 'Ground floor',
      level: floorLevel(floor.name, index),
      rooms: floor.rooms
        .map((room) => home.rooms[room.id]?.slug)
        .filter(Boolean),
      doors: floor.doors.map((door) => ({
        id: door.id,
        rooms: wallRooms.get(door.wallId) ?? [],
      })),
      windows: floor.windows.map((window) => ({
        id: window.id,
        rooms: wallRooms.get(window.wallId) ?? [],
      })),
    };
  });

  const rooms = Object.values(home.rooms).map((room) => ({
    slug: room.slug,
    label: room.label,
    floor: floors.find((floor) => floor.rooms.includes(room.slug))?.id ?? null,
  }));

  return {
    floors,
    rooms,
    lights: home.additions.lights.map((light) => ({
      slug: light.slug,
      room: light.room,
    })),
  };
}

function floorLevel(name, index) {
  if (name === 'Basement') return -1;

  return index;
}

export function lightEntity(slug) {
  return `light.${objectId(slug)}`;
}

export function doorEntity(id) {
  return coverDoorIds.includes(id)
    ? `cover.door_${objectId(id)}`
    : `binary_sensor.door_${objectId(id)}`;
}

export function windowEntity(id) {
  return `binary_sensor.window_${objectId(id)}`;
}

export function temperatureEntity(room) {
  return `sensor.${objectId(room)}_temperature`;
}

export function humidityEntity(room) {
  return `sensor.${objectId(room)}_humidity`;
}

export function occupancyEntity(room) {
  return `binary_sensor.${objectId(room)}_occupancy`;
}

export function alertEntity(sensor) {
  return `binary_sensor.${objectId(sensor.room)}_${sensor.kind}`;
}

export function lockEntity() {
  return `lock.door_${objectId(lockedDoorId)}`;
}

export function plugEntity() {
  return `switch.${objectId(plugProp)}`;
}

export function thermostatEntity() {
  return `climate.${objectId(thermostatRoom)}_thermostat`;
}
