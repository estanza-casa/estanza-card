import '../src/card.js';

import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import { cardType } from '../src/bindings.js';
import type { EstanzaCard } from '../src/card.js';
import { EstanzaPlanView } from '../src/plan-view.js';
import { EstanzaSceneView } from '../src/scene-view.js';
import { MemoryStorage } from './memory-storage.js';
import {
  createMockHass,
  mockBinarySensor,
  mockCover,
  mockLight,
  mockLock,
  mockSensor,
} from './mock-hass.js';

const STAGE = { width: 1280, height: 800 };

const rooms = ['living-room', 'study', 'hall', 'garage'];

const devices = [
  ...rooms.map((room) =>
    mockSensor(
      `sensor.${room.replace('-', '_')}_temperature`,
      'temperature',
      20,
      '°C',
    ),
  ),
  {
    ...mockLight('light.living_room_light', { on: true }),
    attributes: { friendly_name: 'Hue color lamp 3', brightness: 255 },
  },
  {
    ...mockBinarySensor('binary_sensor.study_window', 'window', true),
    attributes: {
      device_class: 'window',
      friendly_name: 'Aqara Door/Window Sensor - C - 1',
    },
  },
  {
    ...mockBinarySensor('binary_sensor.front_door', 'door', false),
    attributes: {
      device_class: 'door',
      friendly_name: 'Aqara Door/Window Sensor - C - 2',
    },
  },
  mockLock('lock.front_door', 'locked'),
  mockCover('cover.garage_door', 40),
];

async function settle(card: EstanzaCard): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await Promise.resolve();
    await card.updateComplete;
    await card.shadowRoot?.querySelector('estanza-scene-view')?.updateComplete;
    await card.shadowRoot?.querySelector('estanza-plan-view')?.updateComplete;
  }
}

function find(card: EstanzaCard, selector: string): HTMLElement | null {
  return card.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

async function mountAurora(): Promise<EstanzaCard> {
  vi.stubGlobal('innerWidth', STAGE.width);

  for (const view of [EstanzaSceneView, EstanzaPlanView]) {
    vi.spyOn(view.prototype, 'anchorOf').mockReturnValue({ x: 400, y: 300 });
  }

  const card = document.createElement('estanza-card');

  card.hass = createMockHass({ states: devices });
  card.setConfig({
    type: cardType,
    home_document: homeDocumentSchema.parse(aurora),
    bindings: [
      ...rooms.map((room) => ({
        scope: { type: 'room' as const, id: room },
        temperature_entity_id: `sensor.${room.replace('-', '_')}_temperature`,
      })),
      {
        scope: { type: 'light', id: 'living-room-light' },
        entity_id: 'light.living_room_light',
      },
      {
        scope: { type: 'window', id: 'win2' },
        entity_id: 'binary_sensor.study_window',
      },
      {
        scope: { type: 'door', id: 'd1' },
        entity_ids: ['binary_sensor.front_door', 'lock.front_door'],
      },
      {
        scope: { type: 'door', id: 'd7' },
        entity_id: 'cover.garage_door',
      },
    ],
  });
  document.body.append(card);
  await settle(card);

  const stage = find(card, '.stage');

  if (!stage) throw new Error('no stage');

  vi.spyOn(stage, 'clientWidth', 'get').mockReturnValue(STAGE.width);
  vi.spyOn(stage, 'clientHeight', 'get').mockReturnValue(STAGE.height);
  card.requestUpdate();
  await settle(card);

  return card;
}

async function open(card: EstanzaCard, key: string): Promise<void> {
  const [scopeType, scopeId] = key.split(':');
  const surface =
    find(card, 'estanza-plan-view') ?? find(card, 'estanza-scene-view');

  surface?.dispatchEvent(
    new CustomEvent('scope-select', {
      detail: { scopeType, scopeId, gesture: 'press', x: 400, y: 300 },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(card);
}

function rowName(row: HTMLElement | null): string | undefined {
  const text = row?.textContent ?? '';
  const state = row?.querySelector('.row-state')?.textContent ?? '';

  return text.replace(state, '').replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('one name per thing in Casa Aurora', () => {
  const things = [
    {
      key: 'light:living-room-light',
      room: 'room:living-room',
      row: '.device[data-key="light:living-room-light"] .device-name',
      name: 'Living Room light',
      sheet: true,
    },
    {
      key: 'window:win2',
      room: 'room:study',
      row: '.readout.row[data-key="window:win2"]',
      name: 'Study window 1',
      sheet: false,
    },
    {
      key: 'door:d1',
      room: 'room:hall',
      row: '.readout.row[data-key="door:d1"]',
      name: 'Hall door',
      sheet: false,
    },
    {
      key: 'door:d7',
      room: 'room:garage',
      row: ':is(.readout.row, .device)[data-key="door:d7"]',
      name: 'Garage door',
      sheet: true,
    },
  ];

  for (const thing of things) {
    it(`reads ${thing.name} on the mark, its sheet and the room row`, async () => {
      const card = await mountAurora();
      const mark = find(card, `.mark[data-key="${thing.key}"]`)
        ?.getAttribute('title')
        ?.replace(/, (?:un)?locked$/, '');

      await open(card, thing.key);

      const title = find(card, '.sheet .sheet-title')?.textContent?.trim();

      await open(card, thing.room);

      const row = rowName(find(card, `.sheet ${thing.row}`));

      expect([mark, title, row]).toEqual([
        thing.name,
        thing.sheet ? thing.name : undefined,
        thing.name,
      ]);
    });
  }
});
