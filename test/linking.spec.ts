import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { describe, expect, it } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import type {
  SceneBinding,
  SceneScope,
  SceneScopeType,
} from '../src/bindings.js';
import {
  candidatesFor,
  entityFilter,
  entityRole,
  formatState,
  holderOf,
  isStorageRoom,
  linkEntity,
  moveEntity,
  type SceneObjectOption,
  sceneObjectsFromDocument,
  setArea,
  setThingAction,
  shortName,
  splitDevice,
  suggestAll,
  swapEntity,
  type Thing,
  thingsOf,
  unlinkEntity,
  unlinkThing,
} from '../src/linking.js';
import { proposeSetup } from '../src/matching.js';
import homeFixture from './fixtures/home.json';
import {
  createMockHass,
  mockBinarySensor,
  mockClimate,
  mockCover,
  mockEntityState,
  mockLight,
  mockLock,
  mockSensor,
  mockSwitch,
} from './mock-hass.js';

const auroraHome = homeDocumentSchema.parse(aurora);

const idPattern =
  /\b(?=\w*\d)(?=\w*[a-z])\w+\b|\b[A-Z]\d+\b|\w+[-_]\w+|\b[a-z]\b/;

function labelsOf(
  options: SceneObjectOption[],
  type: SceneScopeType,
): Map<string, string> {
  return new Map(
    options
      .filter((option) => option.scope.type === type)
      .map((option) => [option.scope.id, option.label]),
  );
}

function named<TState extends { attributes: Record<string, unknown> }>(
  state: TState,
  friendlyName: string,
): TState {
  return {
    ...state,
    attributes: { ...state.attributes, friendly_name: friendlyName },
  };
}

function thing(
  type: SceneScopeType,
  id: string,
  name: string,
  roomName: string,
): Thing {
  const scope: SceneScope = { type, id };

  return {
    scope,
    key: `${type}:${id}`,
    name,
    shortName: name,
    room: roomName ? roomName.toLowerCase().replace(/ /g, '-') : null,
    roomName,
    floor: null,
    entrance: false,
  };
}

function officeHass() {
  return createMockHass({
    states: [
      named(
        mockSensor('sensor.th_b_temperature', 'temperature', 20.1, '°C'),
        "Sonoff Temperature and Humidity Sensor - B - Kim's Office Temperature",
      ),
      named(
        mockSensor('sensor.th_a_temperature', 'temperature', 21.4, '°C'),
        "Sonoff Temperature and Humidity Sensor - A - Kim's Office Temperature",
      ),
      named(
        mockSensor('sensor.th_a_humidity', 'humidity', 48, '%'),
        "Sonoff Temperature and Humidity Sensor - A - Kim's Office Humidity",
      ),
      named(
        mockSensor('sensor.th_c_temperature', 'temperature', 19.5, '°C'),
        'Sonoff Temperature and Humidity Sensor - C - Guest Room Temperature',
      ),
      named(
        mockBinarySensor('binary_sensor.contact_c', 'door', false),
        "Aqara Door Window Sensor C - Kim's Office",
      ),
      named(
        mockBinarySensor('binary_sensor.contact_d', 'window', true),
        'Aqara Door Window Sensor D - Bathroom',
      ),
      named(mockLight('light.night_stand'), "Kim's Night Stand"),
      mockLight('light.office_a_ceiling'),
      mockSwitch('switch.coffee', false),
      mockBinarySensor('binary_sensor.office_motion', 'motion', false),
      mockCover('cover.garage', 0),
      mockEntityState('cover.office_blind', 'open', {
        device_class: 'blind',
        friendly_name: 'Office A Blind',
      }),
      mockLock('lock.front', 'locked'),
      mockClimate('climate.office_a_radiator'),
      mockEntityState('media_player.office_a_speaker', 'idle', {
        friendly_name: 'Office speaker',
      }),
      mockEntityState('media_player.kitchen_radio', 'idle', {
        friendly_name: 'Kitchen radio',
      }),
      mockLight('light.hidden_strip'),
    ],
    entities: [
      { entity_id: 'light.office_a_ceiling', area_id: 'office_a' },
      { entity_id: 'media_player.office_a_speaker', area_id: 'office_a' },
      { entity_id: 'media_player.kitchen_radio', area_id: 'kitchen' },
      { entity_id: 'light.hidden_strip', hidden: true },
    ],
    areas: [
      { area_id: 'office_a', name: 'Office A' },
      { area_id: 'kitchen', name: 'Kitchen' },
    ],
  });
}

function idsOf(things: { entityId: string }[]): string[] {
  return things.map((entry) => entry.entityId);
}

describe('sceneObjectsFromDocument', () => {
  it('names every room, light and door of a shared home', () => {
    expect(
      sceneObjectsFromDocument(homeFixture).map((option) => option.label),
    ).toEqual([
      'Living Space',
      'Bathroom',
      'Hall',
      'Living Space light',
      'Bathroom light',
      'Hall light',
      'Door between Living Space and Bathroom',
      'Door between Living Space and Hall',
    ]);
  });

  it('names a door after the only room its wall belongs to', () => {
    const options = sceneObjectsFromDocument({
      plan: {
        floors: [
          {
            doors: [{ id: 'd1', wallId: 'w1' }],
            windows: [{ id: 'w9', wallId: 'w2' }],
            rooms: [
              { id: 'room1', name: 'Hall', walls: ['w1'] },
              { id: 'room2', name: 'Kitchen', walls: ['w2'] },
            ],
          },
        ],
      },
      rooms: { room2: { slug: 'kitchen', label: 'Cooking Corner' } },
    });

    expect(options.map((option) => option.label)).toEqual([
      'Cooking Corner',
      'Hall door',
      'Cooking Corner window',
    ]);
  });

  it('numbers the doors of a room only when it has more than one', () => {
    const options = sceneObjectsFromDocument({
      plan: {
        floors: [
          {
            doors: [
              { id: 'd1', wallId: 'w1' },
              { id: 'd2', wallId: 'w1' },
              { id: 'd3', wallId: 'w2' },
            ],
            rooms: [
              { id: 'room1', name: 'Hall', walls: ['w1'] },
              { id: 'room2', name: 'Garage', walls: ['w2'] },
            ],
          },
        ],
      },
    });

    expect(options.map((option) => option.label)).toEqual([
      'Hall door 1',
      'Hall door 2',
      'Garage door',
    ]);
  });

  it('names windows and props, and reads a door id that is already a name', () => {
    const options = sceneObjectsFromDocument({
      plan: {
        floors: [
          {
            name: 'Ground floor',
            doors: [{ id: 'patio-door' }],
            windows: [{ id: 'kitchen-window' }],
          },
        ],
      },
      rooms: { kitchen: { slug: 'kitchen', label: 'Kitchen' } },
      additions: {
        props: [{ slug: 'sofa-1', type: 'sofa', room: 'kitchen' }],
        lights: [],
      },
    });

    expect(options.map((option) => option.label)).toEqual([
      'Kitchen',
      'Patio door',
      'Kitchen window',
      'Sofa (Kitchen)',
    ]);
  });

  it('leaves hidden rooms out', () => {
    const options = sceneObjectsFromDocument({
      rooms: {
        kitchen: { slug: 'kitchen', label: 'Kitchen' },
        loft: { slug: 'loft', label: 'Loft', hidden: true },
      },
    });

    expect(options.map((option) => option.key)).toEqual(['room:kitchen']);
  });

  it('leaves the floor to the floor chip when a home has more than one', () => {
    const options = sceneObjectsFromDocument({
      plan: {
        floors: [
          { name: 'Ground floor', doors: [{ id: 'd1' }] },
          { name: 'First floor', doors: [{ id: 'd2' }] },
        ],
      },
    });

    expect(options.map((option) => option.label)).toEqual(['Door 1', 'Door 2']);
  });

  it('never shows an internal id in a name', () => {
    const generated = {
      plan: {
        floors: [
          {
            name: 'Ground floor',
            doors: [
              { id: 'd2', wallId: 'w1' },
              { id: 'wardrobe-d', wallId: 'w9' },
            ],
            windows: [{ id: 'win4', wallId: 'w9' }],
            rooms: [{ id: 'r1', walls: ['w1'] }],
          },
          { name: 'First floor', doors: [{ id: 'x3m9ivzq' }] },
        ],
      },
      rooms: { r1: { slug: 'room-3' } },
      additions: {
        lights: [{ slug: 'l7', room: 'room-3' }, { slug: 'bulb-4' }],
        props: [
          { slug: 'wardrobe-d', type: 'catalog', catalogId: 'x-99' },
          { slug: 'p12' },
        ],
      },
    };
    const labels = [aurora, homeFixture, generated].flatMap((home) =>
      sceneObjectsFromDocument(home).map((option) => option.label),
    );

    expect(labels.length).toBeGreaterThan(40);

    for (const label of labels) expect(label).not.toMatch(idPattern);
  });

  it('names the rooms, lights, doors, windows and furniture of Casa Aurora', () => {
    const options = sceneObjectsFromDocument(aurora);

    expect(labelsOf(options, 'room').get('wine-cellar')).toBe('Wine Cellar');
    expect(labelsOf(options, 'light').get('games-room-light')).toBe(
      'Games Room light',
    );
    expect(labelsOf(options, 'door').get('d6')).toBe(
      'Door between Kitchen and Garage',
    );
    expect(labelsOf(options, 'door').get('d1')).toBe('Hall door');
    expect(labelsOf(options, 'door').get('d7')).toBe('Garage door');
    expect(labelsOf(options, 'window').get('win8')).toBe('Kitchen window 1');
    expect(labelsOf(options, 'prop').get('living-room-floor-lamp')).toBe(
      'Floor lamp (Living Room)',
    );
    expect([...labelsOf(options, 'door').values()].join(' ')).not.toMatch(
      /\(\d+\)/,
    );
  });

  it('numbers a window only when its room has more than one', () => {
    const windows = labelsOf(sceneObjectsFromDocument(aurora), 'window');

    expect(windows.get('win1')).toBe('Hall window');
    expect(windows.get('win7')).toBe('Washroom window');
    expect(windows.get('win2')).toBe('Study window 1');
    expect(windows.get('win3')).toBe('Study window 2');
  });

  it('returns nothing for a home it cannot read', () => {
    expect(sceneObjectsFromDocument(null)).toEqual([]);
    expect(sceneObjectsFromDocument({})).toEqual([]);
  });
});

describe('thingsOf', () => {
  const floors = deriveFloors(auroraHome);

  it('lists rooms, lights, doors and windows with their room and floor', () => {
    const things = thingsOf(auroraHome, floors, []);
    const window = things.find((entry) => entry.key === 'window:win8');
    const door = things.find((entry) => entry.key === 'door:d6');

    expect(window).toMatchObject({ room: 'kitchen', roomName: 'Kitchen' });
    expect(window?.floor).toBe(
      floors.find((floor) => floor.roomsBySlug.has('kitchen'))?.id,
    );
    expect(door?.room).not.toBeNull();
    expect(things.some((entry) => entry.key === 'room:wine-cellar')).toBe(true);
    expect(things.some((entry) => entry.key === 'light:games-room-light')).toBe(
      true,
    );
  });

  it('keeps only the furniture a device could drive, unless it is linked', () => {
    const plain = thingsOf(auroraHome, floors, []);
    const linked = thingsOf(auroraHome, floors, [
      {
        scope: { type: 'prop', id: 'living-room-sofa-long' },
        entity_id: 'switch.sofa',
      },
    ]);
    const props = (list: Thing[]) =>
      list.filter((entry) => entry.scope.type === 'prop').map((e) => e.key);

    expect(props(plain)).toContain('prop:living-room-floor-lamp');
    expect(props(plain)).toContain('prop:kitchen-fridge');
    expect(props(plain)).toContain('prop:washroom-washer-dryer');
    expect(props(plain)).not.toContain('prop:living-room-sofa-long');
    expect(props(plain)).not.toContain('prop:living-room-tv-stand');
    expect(props(plain)).not.toContain('prop:games-room-tv-stand');
    expect(props(linked)).toContain('prop:living-room-sofa-long');
  });

  it('puts the top storey first', () => {
    const things = thingsOf(auroraHome, floors, []);
    const levels = things.map(
      (entry) => floors.find((floor) => floor.id === entry.floor)?.level ?? 0,
    );

    expect(levels).toEqual([...levels].sort((a, b) => b - a));
  });
});

describe('candidatesFor', () => {
  it('ranks the sensor named after the room above its twin in the other office', () => {
    const hass = officeHass();
    const sensors = (room: Thing) =>
      candidatesFor(room, hass, []).filter((entry) =>
        entry.entityId.startsWith('sensor.'),
      );
    const officeA = sensors(thing('room', 'office-a', 'Office A', 'Office A'));
    const officeB = sensors(thing('room', 'office-b', 'Office B', 'Office B'));

    expect(idsOf(officeA).slice(0, 2).sort()).toEqual([
      'sensor.th_a_humidity',
      'sensor.th_a_temperature',
    ]);
    expect(officeA[0].good).toBe(true);
    expect(idsOf(officeB)[0]).toBe('sensor.th_b_temperature');
    expect(idsOf(officeA).indexOf('sensor.th_c_temperature')).toBeGreaterThan(
      idsOf(officeA).indexOf('sensor.th_b_temperature'),
    );
  });

  it('offers a room only its sensors, never a light, contact, presence or player, even in its area', () => {
    const hass = officeHass();

    hass.states = {
      ...hass.states,
      'sensor.office_a_desk_power': named(
        mockSensor('sensor.office_a_desk_power', 'power', 40, 'W'),
        'Office A desk power',
      ),
      'sensor.office_a_lux': named(
        mockSensor('sensor.office_a_lux', 'illuminance', 300, 'lx'),
        'Office A light level',
      ),
    };

    const ids = idsOf(
      candidatesFor(
        thing('room', 'office-a', 'Office A', 'Office A'),
        hass,
        [],
      ),
    );

    expect(ids.sort()).toEqual([
      'climate.office_a_radiator',
      'sensor.office_a_desk_power',
      'sensor.office_a_lux',
      'sensor.th_a_humidity',
      'sensor.th_a_temperature',
      'sensor.th_b_temperature',
      'sensor.th_c_temperature',
    ]);
  });

  it('shows the name and area of what it offers', () => {
    const [top] = candidatesFor(
      thing('light', 'pendant', 'Pendant', 'Office A'),
      officeHass(),
      [],
    );

    expect(top).toMatchObject({
      entityId: 'light.office_a_ceiling',
      area: 'Office A',
    });
  });

  it('offers lights for a light, and never a switch its room does not name or hold', () => {
    const ids = idsOf(
      candidatesFor(
        thing('light', 'bedside', 'Bedside lamp', 'Suite'),
        officeHass(),
        [],
      ),
    );

    expect(ids.sort()).toEqual(['light.night_stand', 'light.office_a_ceiling']);
  });

  it('offers each object only the kinds of entity that can be that object', () => {
    const hass = createMockHass({
      states: [
        mockEntityState('media_player.living_room_tv', 'off'),
        mockSwitch('switch.living_room_tv_plug', false),
        mockSensor('sensor.living_room_humidity', 'humidity', 50, '%'),
        mockSensor('sensor.living_room_temperature', 'temperature', 21, '°C'),
        mockClimate('climate.living_room_thermostat'),
        mockEntityState('fan.living_room_fan', 'off'),
      ],
    });
    const offered = (name: string) =>
      idsOf(
        candidatesFor(
          thing('prop', name.toLowerCase(), name, 'Living Room'),
          hass,
          [],
        ),
      ).sort();

    expect(offered('Television')).toEqual([
      'media_player.living_room_tv',
      'switch.living_room_tv_plug',
    ]);
    expect(offered('Thermostat')).toEqual(['climate.living_room_thermostat']);
    expect(offered('Ceiling fan')).toEqual([
      'fan.living_room_fan',
      'switch.living_room_tv_plug',
    ]);
    expect(
      entityFilter('prop', 'Television').map((entry) => entry.domain),
    ).toEqual(['media_player', 'switch']);
  });

  it('offers door contacts, door covers and locks for a door, never motion', () => {
    const ids = idsOf(
      candidatesFor(
        thing('door', 'd1', 'Door in Office A', 'Office A'),
        officeHass(),
        [],
      ),
    );

    expect(ids.sort()).toEqual([
      'binary_sensor.contact_c',
      'cover.garage',
      'lock.front',
    ]);
  });

  it('offers window and door contacts and blinds for a window, the named one first', () => {
    const candidates = candidatesFor(
      thing('window', 'w1', 'Window in Office A (Ground floor)', 'Office A'),
      officeHass(),
      [],
    );

    expect(idsOf(candidates).sort()).toEqual([
      'binary_sensor.contact_c',
      'binary_sensor.contact_d',
      'cover.office_blind',
    ]);
    expect(idsOf(candidates).indexOf('binary_sensor.contact_c')).toBeLessThan(
      idsOf(candidates).indexOf('binary_sensor.contact_d'),
    );
  });

  it('offers climate, sensors, switches and media for furniture of no known kind', () => {
    const domains = (name: string) =>
      [
        ...new Set(
          candidatesFor(
            thing('prop', name.toLowerCase(), name, 'Office A'),
            officeHass(),
            [],
          ).map((entry) => entry.entityId.split('.')[0]),
        ),
      ].sort();

    expect(domains('Sideboard')).toEqual([
      'climate',
      'media_player',
      'sensor',
      'switch',
    ]);
    expect(domains('Radiator')).toEqual(['climate', 'switch']);
  });

  it('breaks a tie in name by the area of the room', () => {
    const ids = idsOf(
      candidatesFor(
        thing('light', 'pendant', 'Pendant', 'Office A'),
        officeHass(),
        [],
      ),
    );

    expect(ids[0]).toBe('light.office_a_ceiling');
  });

  it('puts what is linked to the thing first and marks what another thing holds with its place', () => {
    const other: SceneScope = { type: 'light', id: 'other' };
    const links: SceneBinding[] = [
      { scope: { type: 'light', id: 'pendant' }, entity_id: 'switch.coffee' },
      { scope: other, entity_id: 'light.night_stand' },
    ];
    const candidates = candidatesFor(
      thing('light', 'pendant', 'Pendant', 'Office A'),
      officeHass(),
      links,
    );

    expect(candidates[0]).toMatchObject({
      entityId: 'switch.coffee',
      linked: true,
      elsewhere: null,
    });
    expect(
      candidates.find((entry) => entry.entityId === 'light.night_stand'),
    ).toMatchObject({ linked: false, elsewhere: other });
    expect(idsOf(candidates)).not.toContain('light.hidden_strip');
  });

  it('keeps a linked entity in the list even when it does not fit the kind', () => {
    const links: SceneBinding[] = [
      { scope: { type: 'light', id: 'pendant' }, entity_id: 'lock.front' },
    ];
    const [first] = candidatesFor(
      thing('light', 'pendant', 'Pendant', 'Office A'),
      officeHass(),
      links,
    );

    expect(first).toMatchObject({ entityId: 'lock.front', linked: true });
  });

  it('is sure of a match only when the whole name matches', () => {
    const byId = new Map(
      candidatesFor(
        thing('light', 'night-stand', "Kim's Night Stand", "Kim's Office"),
        officeHass(),
        [],
      ).map((entry) => [entry.entityId, entry]),
    );

    expect(byId.get('light.night_stand')?.strong).toBe(true);
    expect(byId.get('light.office_a_ceiling')?.strong).toBe(false);
  });

  it('labels each entity by its whole Home Assistant name, never a shortened third name', () => {
    const labels = new Map(
      candidatesFor(
        thing('light', 'pendant', 'Pendant', 'Office A'),
        officeHass(),
        [],
      ).map((entry) => [entry.entityId, entry.label]),
    );

    expect(labels.get('light.office_a_ceiling')).toBe('Office a ceiling');
  });
});

describe('shortName', () => {
  it('drops the room and thing names the way Home Assistant drops a device prefix', () => {
    expect(shortName('Guest Room humidity', ['Guest Room'])).toBe('Humidity');
    expect(shortName('Window win17 Guest Room', ['Guest Room'])).toBe(
      'Window win17',
    );
    expect(
      shortName(
        'Sonoff Temperature and Humidity Sensor - Guest Room Humidity',
        ['Guest Room'],
      ),
    ).toBe('Sonoff Temperature and Humidity Sensor - Humidity');
  });

  it('drops a possessive name with its apostrophe', () => {
    expect(shortName("Kim's Night Stand lamp", ["Kim's Night Stand"])).toBe(
      'Lamp',
    );
    expect(
      shortName("Sonoff Temperature Sensor - A - Kim's Office", [
        "Kim's Office",
      ]),
    ).toBe('Sonoff Temperature Sensor - A');
  });

  it('drops a name only when every word of it is there', () => {
    expect(shortName('Office speaker', ['Office A'])).toBe('Office speaker');
  });

  it('drops a name only from the start, the end or next to a separator', () => {
    expect(shortName('Door d8 Landing to Bathroom', ['Landing'])).toBe(
      'Door d8 Landing to Bathroom',
    );
    expect(shortName('Sensor - Landing - Motion', ['Landing'])).toBe(
      'Sensor - Motion',
    );
  });

  it('keeps a room that another word ties into the name', () => {
    expect(shortName('Door d11 Landing to Guest Room', ['Guest Room'])).toBe(
      'Door d11 Landing to Guest Room',
    );
  });

  it('falls back to the room alone when the thing name would leave nothing', () => {
    expect(
      shortName('Guest Room light', ['Guest Room light', 'Guest Room']),
    ).toBe('Light');
  });

  it('keeps the full name when nothing meaningful would be left', () => {
    expect(shortName('Hall', ['Hall'])).toBe('Hall');
    expect(shortName('Hall - 2', ['Hall'])).toBe('Hall - 2');
    expect(shortName('Bathroom light', [])).toBe('Bathroom light');
  });

  it('never leaves a dangling separator or joining word', () => {
    expect(shortName('Temperature in Kitchen', ['Kitchen'])).toBe(
      'Temperature',
    );
    expect(shortName('Kitchen - Temperature', ['Kitchen'])).toBe('Temperature');
  });
});

describe('splitDevice', () => {
  it('puts what follows the last separator first and keeps the device before it', () => {
    expect(
      splitDevice('Sonoff Temperature and Humidity Sensor - Humidity'),
    ).toEqual({
      label: 'Humidity',
      device: 'Sonoff Temperature and Humidity Sensor',
    });
  });

  it('keeps a name whole when there is no separator or nothing readable after it', () => {
    expect(splitDevice('Window win17')).toEqual({
      label: 'Window win17',
      device: '',
    });
    expect(splitDevice('Sonoff Sensor - A')).toEqual({
      label: 'Sonoff Sensor - A',
      device: '',
    });
    expect(splitDevice('- Humidity')).toEqual({
      label: '- Humidity',
      device: '',
    });
  });
});

describe('entityRole', () => {
  it('names what the card reads an entity as', () => {
    const roles = [
      mockSensor('sensor.t', 'temperature', 20, '°C'),
      mockSensor('sensor.h', 'humidity', 40, '%'),
      mockLight('light.l'),
      mockSwitch('switch.s', true),
      mockBinarySensor('binary_sensor.m', 'motion', false),
      mockBinarySensor('binary_sensor.w', 'window', false),
      mockBinarySensor('binary_sensor.d', 'door', false),
      mockSensor('sensor.b', 'battery', 80, '%'),
    ].map((state) => entityRole(state.entity_id, state));

    expect(roles).toEqual([
      'Temperature',
      'Humidity',
      'Light',
      'Plug',
      'Presence',
      'Window',
      'Door',
      'Battery',
    ]);
    expect(entityRole('light.gone', undefined)).toBe('Not found');
  });

  it('names a door or window contact after the thing it is linked to', () => {
    const contact = mockBinarySensor('binary_sensor.contact_a', 'door', true);

    expect(entityRole(contact.entity_id, contact, 'window')).toBe('Window');
    expect(entityRole(contact.entity_id, contact, 'door')).toBe('Door');
    expect(entityRole(contact.entity_id, contact, 'room')).toBe('Door');
  });

  it('names a switch by its device class, and as a light only where it drives one', () => {
    const plug = mockSwitch('switch.television', true);
    const outlet = mockEntityState('switch.kettle', 'on', {
      device_class: 'outlet',
    });
    const wall = mockEntityState('switch.porch', 'off', {
      device_class: 'switch',
    });

    expect(entityRole(plug.entity_id, plug, 'prop')).toBe('Plug');
    expect(entityRole(outlet.entity_id, outlet, 'prop')).toBe('Plug');
    expect(entityRole(wall.entity_id, wall, 'prop')).toBe('Switch');
    expect(entityRole(plug.entity_id, plug, 'light')).toBe('Light');
    expect(entityRole(outlet.entity_id, outlet, 'light')).toBe('Light');
  });
});

describe('formatState', () => {
  it('prints what Home Assistant translates the state to', () => {
    const hass = createMockHass();
    const door = mockBinarySensor('binary_sensor.d', 'door', true);

    hass.formatEntityState = (state) => `Abierta (${state.state})`;

    expect(formatState(hass, door)).toBe('Abierta (on)');
  });

  it('reads an on or off sensor in the words its class means when Home Assistant does not translate', () => {
    const hass = createMockHass();
    const words = [
      mockBinarySensor('binary_sensor.d', 'door', false),
      mockBinarySensor('binary_sensor.w', 'window', true),
      mockBinarySensor('binary_sensor.o', 'opening', false),
      mockBinarySensor('binary_sensor.g', 'garage_door', true),
      mockBinarySensor('binary_sensor.l', 'lock', false),
      mockBinarySensor('binary_sensor.l2', 'lock', true),
      mockBinarySensor('binary_sensor.m', 'motion', true),
      mockBinarySensor('binary_sensor.p', 'occupancy', false),
      mockBinarySensor('binary_sensor.wet', 'moisture', true),
      mockBinarySensor('binary_sensor.dry', 'moisture', false),
      mockBinarySensor('binary_sensor.still', 'motion', false),
      mockBinarySensor('binary_sensor.smoke', 'smoke', true),
      mockBinarySensor('binary_sensor.gas', 'gas', false),
      mockBinarySensor('binary_sensor.x', 'power', false),
    ].map((state) => formatState(hass, state));

    expect(words).toEqual([
      'Closed',
      'Open',
      'Closed',
      'Open',
      'Locked',
      'Unlocked',
      'Detected',
      'Clear',
      'Wet',
      'Dry',
      'Clear',
      'Detected',
      'Clear',
      'Off',
    ]);
  });

  it('never prints a raw state word for a light, lock, cover, climate or player', () => {
    const hass = createMockHass();
    const words = [
      mockLight('light.l'),
      mockLight('light.o', { on: false }),
      mockSwitch('switch.s', false),
      mockLock('lock.f', 'unlocked'),
      mockCover('cover.c', 0),
      mockClimate('climate.a', { mode: 'fan_only' }),
      mockEntityState('media_player.tv', 'playing'),
      mockEntityState('light.gone', 'unavailable'),
    ].map((state) => formatState(hass, state));

    expect(words).toEqual([
      'On',
      'Off',
      'Off',
      'Unlocked',
      'Closed',
      'Fan only',
      'Playing',
      'Unavailable',
    ]);
  });

  it('keeps a measurement as its number and unit', () => {
    const hass = createMockHass();

    expect(formatState(hass, mockSensor('sensor.p', 'power', 47, 'W'))).toBe(
      '47 W',
    );
    expect(formatState(hass, undefined)).toBe('Not found');
  });

  it('writes a humidity the card way, a whole percent with no space, over the Home Assistant format', () => {
    const hass = { ...createMockHass(), formatEntityState: () => '45.0 %' };

    expect(formatState(hass, mockSensor('sensor.h', 'humidity', 45, '%'))).toBe(
      '45%',
    );
    expect(
      formatState(hass, mockSensor('sensor.h', 'humidity', 45.6, '%')),
    ).toBe('46%');
  });

  it('writes a temperature the card way, over the Home Assistant format', () => {
    const hass = {
      ...createMockHass(),
      formatEntityState: () => '26 °C',
    };

    expect(
      formatState(hass, mockSensor('sensor.t', 'temperature', 26, '°C')),
    ).toBe('26.0°');
    expect(
      formatState(hass, mockSensor('sensor.t', 'temperature', 19.44, '°C')),
    ).toBe('19.4°');
  });

  it('writes a temperature in the unit the home uses', () => {
    const hass = createMockHass({ temperatureUnit: '°F' });

    expect(
      formatState(hass, mockSensor('sensor.t', 'temperature', 20, '°C')),
    ).toBe('68.0°');
  });
});

describe('isStorageRoom', () => {
  it('knows small storage rooms in English, Spanish and Portuguese', () => {
    const names = [
      'Wardrobe',
      'Walk-in closet',
      'Pantry',
      'Storage',
      'Utility room',
      'Trastero',
      'Despensa',
      'Arrecadação',
      'Kitchen',
      'Guest Room',
    ];

    expect(names.filter(isStorageRoom)).toEqual(names.slice(0, 8));
  });
});

describe('candidatesFor with Zigbee2MQTT names', () => {
  function zigbeeHass() {
    return createMockHass({
      states: [
        named(
          mockSensor('sensor.sensor_x_a_temperature', 'temperature', 21, '°C'),
          'Study Sensor X - A Temperature',
        ),
        named(
          mockSensor('sensor.sensor_x_a_battery', 'battery', 90, '%'),
          'Study Sensor X - A Battery',
        ),
        mockEntityState('sensor.sensor_x_a_linkquality', '120', {
          friendly_name: 'Study Sensor X - A Linkquality',
          unit_of_measurement: 'lqi',
        }),
        named(
          mockSensor('sensor.sensor_x_a_voltage', 'voltage', 3000, 'mV'),
          'Study Sensor X - A Voltage',
        ),
        named(
          mockSensor('sensor.plug_y_energy', 'energy', 1.2, 'kWh'),
          'Study Plug Y Energy',
        ),
        mockEntityState('sensor.plug_y_power_outage_count', '12', {
          friendly_name: 'Study Plug Y Power outage count',
        }),
        mockEntityState(
          'sensor.plug_y_protection',
          "{'enable_max_voltage': 'DISABLE', 'max_power': 2500}",
          { friendly_name: 'Study Plug Y Overload protection' },
        ),
        named(
          mockSensor(
            'sensor.plug_y_device_temperature',
            'temperature',
            31,
            '°C',
          ),
          'Study Plug Y Device temperature',
        ),
        named(
          mockBinarySensor(
            'binary_sensor.sensor_x_a_occupancy',
            'occupancy',
            false,
          ),
          'Study Sensor X - A Occupancy',
        ),
        named(
          mockSensor('sensor.sensor_z_b_pressure', 'pressure', 1012, 'hPa'),
          'Study Sensor Z - B Pressure',
        ),
        named(
          mockSensor('sensor.hall_door_battery', 'battery', 80, '%'),
          'Hall Door Battery (Contact Sensor - A)',
        ),
        named(
          mockSensor('sensor.porch_temperature', 'temperature', 12, '°C'),
          'Porch Sensor W - A Temperature',
        ),
      ],
      entities: [
        {
          entity_id: 'sensor.plug_y_device_temperature',
          entity_category: 'diagnostic',
        },
      ],
    });
  }

  it('offers no meter, counter or setting of a plug for a piece of furniture', () => {
    const ids = idsOf(
      candidatesFor(
        thing('prop', 'desk', 'Study Plug Y desk', 'Study'),
        zigbeeHass(),
        [],
      ),
    );

    expect(ids.sort()).toEqual([
      'sensor.porch_temperature',
      'sensor.sensor_x_a_temperature',
      'sensor.sensor_z_b_pressure',
    ]);
  });

  it('never offers diagnostics, config, meters or junk states', () => {
    const ids = idsOf(
      candidatesFor(thing('room', 'study', 'Study', 'Study'), zigbeeHass(), []),
    );

    expect(ids.sort()).toEqual([
      'sensor.porch_temperature',
      'sensor.sensor_x_a_temperature',
    ]);
  });

  it('keeps a linked battery sensor in the picker so it can be unlinked', () => {
    const scope: SceneScope = { type: 'room', id: 'study' };
    const ids = idsOf(
      candidatesFor(thing('room', 'study', 'Study', 'Study'), zigbeeHass(), [
        { scope, entity_id: 'sensor.sensor_x_a_battery' },
      ]),
    );

    expect(ids[0]).toBe('sensor.sensor_x_a_battery');
  });

  it('does not count a single letter or a number as a match', () => {
    const [porch] = candidatesFor(
      thing('room', 'office-a', 'Office A', 'Office A'),
      zigbeeHass(),
      [],
    ).filter((entry) => entry.entityId === 'sensor.porch_temperature');

    expect(porch).toMatchObject({ good: false, close: false, strong: false });
  });

  it('says a room has no close matches when nothing shares its name', () => {
    const candidates = candidatesFor(
      thing('room', 'guest-room', 'Guest Room', 'Guest Room'),
      zigbeeHass(),
      [],
    );

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((entry) => entry.close)).toBe(false);
  });

  it('finds the close match in a room that shares its name', () => {
    const [top] = candidatesFor(
      thing('room', 'study', 'Study', 'Study'),
      zigbeeHass(),
      [],
    );

    expect(top).toMatchObject({ close: true, good: true });
  });
});

describe('candidatesFor a room and the sensors of the whole house', () => {
  function houseHass() {
    return createMockHass({
      states: [
        mockEntityState('sensor.ups_q_load', '17', {
          friendly_name: 'Rackpower Q Load',
          unit_of_measurement: '%',
        }),
        mockEntityState('sensor.grid_fossil', '41', {
          friendly_name: 'Carbon Maps Grid fossil fuel percentage',
          unit_of_measurement: '%',
        }),
        named(
          mockSensor('sensor.box_r_cpu', 'temperature', 57.3, '°C'),
          'Rowing Box R CPU temperature',
        ),
        mockEntityState('sensor.box_r_cpu_use', '13.1', {
          friendly_name: 'Rowing Box R CPU',
          unit_of_measurement: '%',
        }),
        named(
          mockSensor('sensor.nas_disk_temp', 'temperature', 38, '°C'),
          'Vault Disk 2 temperature',
        ),
        named(
          mockSensor('sensor.card_gpu', 'temperature', 61, '°C'),
          'Render GPU',
        ),
        named(
          mockSensor('sensor.ups_q_battery_temp', 'temperature', 29, '°C'),
          'UPS Q internal',
        ),
        mockEntityState('sensor.study_bare_temp', '20.5', {
          friendly_name: 'Study thermometer',
          unit_of_measurement: '°C',
        }),
        mockEntityState('sensor.attic_bare_temp', '14', {
          friendly_name: 'Attic thermometer',
          unit_of_measurement: '°C',
        }),
        named(
          mockSensor('sensor.hall_temperature', 'temperature', 19, '°C'),
          'Hall Sensor V Temperature',
        ),
        named(
          mockSensor('sensor.hall_co2', 'carbon_dioxide', 640, 'ppm'),
          'Hall Sensor V CO2',
        ),
        named(mockSensor('sensor.hall_pm25', 'pm25', 8, 'µg/m³'), 'Hall PM2.5'),
        named(
          mockSensor(
            'sensor.hall_voc',
            'volatile_organic_compounds',
            120,
            'ppb',
          ),
          'Hall VOC',
        ),
        named(
          mockSensor('sensor.hall_lux', 'illuminance', 300, 'lx'),
          'Hall Lux',
        ),
        named(mockSensor('sensor.hall_aqi', 'aqi', 22, ''), 'Hall AQI'),
        named(
          mockSensor('sensor.hall_pressure', 'pressure', 1012, 'hPa'),
          'Hall pressure',
        ),
      ],
    });
  }

  function roomIds(name: string): string[] {
    return idsOf(
      candidatesFor(
        thing('room', name.toLowerCase(), name, name),
        houseHass(),
        [],
      ),
    ).sort();
  }

  it('offers only sensors whose class a room can have', () => {
    expect(roomIds('Hall')).toEqual([
      'sensor.hall_aqi',
      'sensor.hall_co2',
      'sensor.hall_lux',
      'sensor.hall_pm25',
      'sensor.hall_temperature',
      'sensor.hall_voc',
    ]);
  });

  it('offers a sensor with no class only to the room its name gives', () => {
    expect(roomIds('Study')).toContain('sensor.study_bare_temp');
    expect(roomIds('Study')).not.toContain('sensor.attic_bare_temp');
    expect(roomIds('Attic')).toContain('sensor.attic_bare_temp');
  });

  it('never offers a CPU, GPU, load, grid, UPS or disk reading to a room', () => {
    const offered = [
      ...roomIds('Hall'),
      ...roomIds('Study'),
      ...roomIds('Garage'),
    ];

    for (const entityId of [
      'sensor.ups_q_load',
      'sensor.grid_fossil',
      'sensor.box_r_cpu',
      'sensor.box_r_cpu_use',
      'sensor.nas_disk_temp',
      'sensor.card_gpu',
      'sensor.ups_q_battery_temp',
    ]) {
      expect(offered).not.toContain(entityId);
    }
  });
});

describe('linking and unlinking', () => {
  const lamp: SceneScope = { type: 'light', id: 'lamp' };
  const room: SceneScope = { type: 'room', id: 'study' };

  it('links one entity as entity_id and a second as entity_ids', () => {
    const once = linkEntity([], lamp, 'light.a');
    const twice = linkEntity(once, lamp, 'light.b');

    expect(once).toEqual([{ scope: lamp, entity_id: 'light.a' }]);
    expect(twice).toEqual([
      { scope: lamp, entity_ids: ['light.a', 'light.b'] },
    ]);
    expect(linkEntity(twice, lamp, 'light.a')).toBe(twice);
  });

  it('writes what a tap and a hold do on the thing, and clears it back to the default', () => {
    const links: SceneBinding[] = [
      { scope: lamp, entity_id: 'light.a' },
      { scope: lamp, entity_id: 'light.b', hold_action: { action: 'none' } },
    ];
    const held = setThingAction(links, lamp, 'hold', { action: 'more-info' });

    expect(held).toEqual([
      {
        scope: lamp,
        entity_id: 'light.a',
        hold_action: { action: 'more-info' },
      },
      { scope: lamp, entity_id: 'light.b' },
    ]);
    expect(setThingAction(held, lamp, 'hold', undefined)).toEqual([
      { scope: lamp, entity_id: 'light.a' },
      { scope: lamp, entity_id: 'light.b' },
    ]);
    expect(setThingAction([], lamp, 'tap', { action: 'none' })).toEqual([]);
  });

  it('keeps the chosen actions while entities come and go, and drops them with the last one', () => {
    const links = setThingAction(linkEntity([], lamp, 'light.a'), lamp, 'tap', {
      action: 'none',
    });
    const two = linkEntity(links, lamp, 'light.b');

    expect(two).toEqual([
      {
        scope: lamp,
        entity_ids: ['light.a', 'light.b'],
        tap_action: { action: 'none' },
      },
    ]);
    expect(
      unlinkEntity(unlinkEntity(two, lamp, 'light.a'), lamp, 'light.b'),
    ).toEqual([]);
  });

  it('unlinks back to one entity, then drops the link', () => {
    const both: SceneBinding[] = [
      { scope: lamp, entity_ids: ['light.a', 'light.b'] },
    ];
    const one = unlinkEntity(both, lamp, 'light.a');

    expect(one).toEqual([{ scope: lamp, entity_id: 'light.b' }]);
    expect(unlinkEntity(one, lamp, 'light.b')).toEqual([]);
  });

  it('forgets the chosen temperature sensor of a room when it is unlinked', () => {
    const links: SceneBinding[] = [
      {
        scope: room,
        area_id: 'study',
        temperature_entity_id: 'sensor.t',
      },
    ];

    expect(unlinkEntity(links, room, 'sensor.t')).toEqual([
      { scope: room, area_id: 'study' },
    ]);
  });

  it('sets and clears the area of a room', () => {
    const withArea = setArea([], room, 'study');

    expect(withArea).toEqual([{ scope: room, area_id: 'study' }]);
    expect(setArea(withArea, room, '')).toEqual([]);
    expect(setArea(linkEntity(withArea, room, 'sensor.t'), room, '')).toEqual([
      { scope: room, entity_id: 'sensor.t' },
    ]);
  });

  it('moves an entity from the thing that held it in one step', () => {
    const hall: SceneScope = { type: 'room', id: 'hall' };
    const links: SceneBinding[] = [
      { scope: hall, entity_ids: ['sensor.t', 'sensor.h'] },
      { scope: lamp, entity_id: 'light.a' },
    ];

    expect(moveEntity(links, room, 'sensor.t')).toEqual([
      { scope: hall, entity_id: 'sensor.h' },
      { scope: lamp, entity_id: 'light.a' },
      { scope: room, entity_id: 'sensor.t' },
    ]);
  });

  it('never links an entity twice, whatever moved it', () => {
    const links = moveEntity(
      moveEntity(linkEntity([], lamp, 'sensor.t'), room, 'sensor.t'),
      room,
      'sensor.t',
    );

    expect(links).toEqual([{ scope: room, entity_id: 'sensor.t' }]);
  });

  it('says which other thing holds an entity', () => {
    const links = linkEntity([], lamp, 'light.a');

    expect(holderOf(links, 'light.a', room)).toEqual(lamp);
    expect(holderOf(links, 'light.a', lamp)).toBeNull();
    expect(holderOf(links, 'light.b', room)).toBeNull();
  });

  it('replaces an entity in its place, keeping the order and what a tap does', () => {
    const links: SceneBinding[] = [
      {
        scope: lamp,
        entity_ids: ['light.a', 'light.b'],
        tap_action: { action: 'none' },
      },
    ];

    expect(swapEntity(links, lamp, 'light.a', 'light.c')).toEqual([
      {
        scope: lamp,
        entity_ids: ['light.c', 'light.b'],
        tap_action: { action: 'none' },
      },
    ]);
  });

  it('frees the replacement from the thing that held it and keeps the chosen reading', () => {
    const hall: SceneScope = { type: 'room', id: 'hall' };
    const links: SceneBinding[] = [
      { scope: hall, entity_ids: ['sensor.x', 'sensor.h'] },
      { scope: room, entity_id: 'sensor.t', temperature_entity_id: 'sensor.t' },
    ];

    expect(swapEntity(links, room, 'sensor.t', 'sensor.x')).toEqual([
      { scope: hall, entity_id: 'sensor.h' },
      { scope: room, entity_id: 'sensor.x', temperature_entity_id: 'sensor.x' },
    ]);
  });

  it('replaces with an entity the thing already holds by keeping just that one', () => {
    const links: SceneBinding[] = [
      { scope: lamp, entity_ids: ['light.a', 'light.b'] },
    ];

    expect(swapEntity(links, lamp, 'light.a', 'light.b')).toEqual([
      { scope: lamp, entity_id: 'light.b' },
    ]);
  });

  it('unlinks a whole thing and leaves the others', () => {
    const links = linkEntity(linkEntity([], lamp, 'light.a'), room, 'sensor.t');

    expect(unlinkThing(links, lamp)).toEqual([
      { scope: room, entity_id: 'sensor.t' },
    ]);
  });
});

describe('entityFilter', () => {
  it('lets a room pick its sensors and its climate, nothing else', () => {
    const filter = entityFilter('room');
    const sensorClasses = filter.find(
      (entry) => entry.domain === 'sensor',
    )?.device_class;

    expect(filter.map((entry) => entry.domain).sort()).toEqual([
      'climate',
      'sensor',
    ]);
    expect(sensorClasses).toEqual(
      expect.arrayContaining([
        'temperature',
        'humidity',
        'carbon_dioxide',
        'pm25',
        'illuminance',
        'power',
      ]),
    );
    expect(sensorClasses).not.toContain('battery');
  });

  it('lets a door pick its contact, its cover and its lock', () => {
    const filter = entityFilter('door');

    expect(filter).toContainEqual({ domain: 'lock' });
    expect(
      filter.find((entry) => entry.domain === 'binary_sensor')?.device_class,
    ).toContain('door');
  });

  it('lets a light pick lights and switches', () => {
    expect(entityFilter('light')).toEqual([
      { domain: 'light' },
      { domain: 'switch' },
    ]);
  });
});

describe('suggestAll', () => {
  const floors = deriveFloors(auroraHome);

  function studyHass() {
    return createMockHass({
      states: [
        named(
          mockSensor('sensor.th_1_temperature', 'temperature', 21, '°C'),
          'Sonoff Temperature and Humidity Sensor - Study Temperature',
        ),
        named(
          mockSensor('sensor.th_1_humidity', 'humidity', 45, '%'),
          'Sonoff Temperature and Humidity Sensor - Study Humidity',
        ),
        named(mockLight('light.bulb_9'), 'Games Room Light'),
        named(
          mockBinarySensor('binary_sensor.contact_7', 'door', false),
          'Garage Door',
        ),
      ],
    });
  }

  function suggestionsFor(links: SceneBinding[] = []) {
    const hass = studyHass();
    const things = thingsOf(auroraHome, floors, links);

    return suggestAll(
      proposeSetup(auroraHome, hass, links),
      things,
      hass,
      links,
    );
  }

  it('suggests both sensors of a room by name, with no areas at all', () => {
    const study = suggestionsFor().get('room:study') ?? [];

    expect(
      study
        .map((entry) => (entry.kind === 'entity' ? entry.entityId : ''))
        .sort(),
    ).toEqual(['sensor.th_1_humidity', 'sensor.th_1_temperature']);
  });

  it('suggests an area-less light for the light of the room its name gives', () => {
    expect(suggestionsFor().get('light:games-room-light')).toEqual([
      {
        kind: 'entity',
        entityId: 'light.bulb_9',
        name: 'Games Room Light',
        strong: true,
      },
    ]);
  });

  it('suggests the garage door contact for the one door of the garage', () => {
    const suggestions = suggestionsFor();
    const doors = [...suggestions]
      .filter(([key]) => key.startsWith('door:'))
      .map(([key, found]) => [
        key,
        found.map((entry) => (entry.kind === 'entity' ? entry.entityId : '')),
      ]);

    expect(doors).toEqual([['door:d7', ['binary_sensor.contact_7']]]);
  });

  it('never suggests an entity another thing already holds', () => {
    const links: SceneBinding[] = [
      { scope: { type: 'room', id: 'kitchen' }, entity_id: 'light.bulb_9' },
    ];

    expect(suggestionsFor(links).has('light:games-room-light')).toBe(false);
  });

  it('suggests nothing for a thing that is already linked', () => {
    const links: SceneBinding[] = [
      { scope: { type: 'room', id: 'study' }, entity_id: 'sensor.other' },
    ];

    expect(suggestionsFor(links).has('room:study')).toBe(false);
  });
});

describe('door and window contacts in the setup proposals', () => {
  const floors = deriveFloors(auroraHome);
  const mainDoor = 'binary_sensor.aqara_door_window_sensor_a_main_door_contact';
  const entrance = 'binary_sensor.up_sense_entrance_contact';

  function contact(entityId: string, deviceClass: string, name: string) {
    return named(mockBinarySensor(entityId, deviceClass, false), name);
  }

  function entranceStates() {
    return [
      contact(mainDoor, 'door', 'Aqara Door/Window Sensor - A - Main Door'),
      contact(entrance, 'door', 'UP Sense - Entrance Contact'),
    ];
  }

  function offered(hass: ReturnType<typeof createMockHass>) {
    const suggestions = suggestAll(
      proposeSetup(auroraHome, hass, []),
      thingsOf(auroraHome, floors, []),
      hass,
      [],
    );

    return [...suggestions]
      .filter(([key]) => key.startsWith('door:') || key.startsWith('window:'))
      .map(([key, found]) => [
        key,
        found.map((entry) => (entry.kind === 'entity' ? entry.entityId : '')),
      ]);
  }

  function entranceDoor(proposal: ReturnType<typeof proposeSetup>) {
    const door = proposal.floors
      .flatMap((floor) => floor.rooms)
      .flatMap((room) => room.doors)
      .find((entry) => entry.scope.id === 'd1');

    if (!door) throw new Error('no proposal for the entrance door');

    return door;
  }

  it('offers the Main Door contact for the entrance door, as a sure match', () => {
    const hass = createMockHass({ states: entranceStates() });
    const suggestions = suggestAll(
      proposeSetup(auroraHome, hass, []),
      thingsOf(auroraHome, floors, []),
      hass,
      [],
    );

    expect(offered(hass)).toEqual([['door:d1', [mainDoor]]]);
    expect(suggestions.get('door:d1')?.[0]).toMatchObject({ strong: true });
  });

  it('keeps the entrance contact as the second candidate for the entrance door', () => {
    const door = entranceDoor(
      proposeSetup(
        auroraHome,
        createMockHass({ states: entranceStates() }),
        [],
      ),
    );

    expect(door.match.quality).toBe('exact');
    expect(door.match.candidates.map((candidate) => candidate.id)).toEqual([
      mainDoor,
      entrance,
    ]);
  });

  it('still picks the Main Door contact when both sit in the hall area', () => {
    const hass = createMockHass({
      states: entranceStates(),
      entities: [
        { entity_id: mainDoor, area_id: 'hall' },
        { entity_id: entrance, area_id: 'hall' },
      ],
      areas: [{ area_id: 'hall', name: 'Hall' }],
    });

    expect(offered(hass)).toEqual([['door:d1', [mainDoor]]]);
  });

  it('reads a front door as the entrance door too', () => {
    const hass = createMockHass({
      states: [contact('binary_sensor.contact_2', 'door', 'Front door')],
    });

    expect(offered(hass)).toEqual([['door:d1', ['binary_sensor.contact_2']]]);
  });

  it('never reads the main door of another room as the entrance door', () => {
    const hass = createMockHass({
      states: [
        contact('binary_sensor.contact_3', 'door', 'Main Bathroom Door'),
      ],
    });

    expect(offered(hass).map(([key]) => key)).not.toContain('door:d1');
  });

  it('ranks the Main Door contact above the entrance contact in the picker', () => {
    const hass = createMockHass({
      states: [
        ...entranceStates(),
        contact('binary_sensor.contact_9', 'door', 'Contact 9'),
      ],
    });
    const door = thingsOf(auroraHome, floors, []).find(
      (entry) => entry.key === 'door:d1',
    );

    if (!door) throw new Error('no entrance door');

    expect(
      candidatesFor(door, hass, []).map((entry) => entry.entityId),
    ).toEqual([mainDoor, entrance, 'binary_sensor.contact_9']);
  });

  it('offers a window contact named after the room for its only window', () => {
    const hass = createMockHass({
      states: [contact('binary_sensor.contact_4', 'window', 'Washroom Window')],
    });

    expect(offered(hass)).toEqual([
      ['window:win7', ['binary_sensor.contact_4']],
    ]);
  });

  it("offers a window contact in the room's area for its only window", () => {
    const hass = createMockHass({
      states: [contact('binary_sensor.contact_5', 'window', 'Contact 5')],
      entities: [{ entity_id: 'binary_sensor.contact_5', area_id: 'washroom' }],
      areas: [{ area_id: 'washroom', name: 'Washroom' }],
    });

    expect(offered(hass)).toEqual([
      ['window:win7', ['binary_sensor.contact_5']],
    ]);
  });

  it('never offers a door contact for a window', () => {
    const hass = createMockHass({
      states: [contact('binary_sensor.contact_6', 'door', 'Washroom Window')],
    });

    expect(offered(hass).map(([key]) => key)).not.toContain('window:win7');
  });
});
