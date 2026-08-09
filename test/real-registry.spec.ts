import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { deriveFloors } from '@estanza/plan-engine/geometry/geometry.js';
import { describe, expect, it } from 'vitest';

import aurora from '../../estanza/packages/shared/src/demo-home.json';
import {
  type Candidate,
  candidatesFor,
  proposedAreas,
  suggestAll,
  type Thing,
  thingsOf,
} from '../src/linking.js';
import { matchName, matchRooms, proposeSetup } from '../src/matching.js';
import {
  createMockHass,
  mockBinarySensor,
  mockEntityState,
  type MockHass,
  mockLight,
  mockSensor,
  mockSwitch,
} from './mock-hass.js';

const home = homeDocumentSchema.parse(aurora);
const floors = deriveFloors(home);
const unusable = [
  'sensor.bike_trainer_power',
  'light.garage_ceiling',
  'light.workshop_lamp',
];

function named<TState extends { attributes: Record<string, unknown> }>(
  state: TState,
  friendlyName: string,
): TState {
  return {
    ...state,
    attributes: { ...state.attributes, friendly_name: friendlyName },
  };
}

function registryHass(): MockHass {
  return createMockHass({
    areas: [
      { area_id: 'office_a', name: 'Office A' },
      { area_id: 'office_b', name: 'Office B' },
      { area_id: 'upstairs_landing', name: 'Upstairs landing' },
      { area_id: 'marias_office', name: "Maria's office" },
      { area_id: 'garage', name: 'Garage' },
      { area_id: 'server_rack', name: 'Server rack' },
    ],
    states: [
      mockEntityState('sensor.bike_trainer_power', 'unavailable', {
        device_class: 'power',
        unit_of_measurement: 'W',
        friendly_name: 'Workshop bike trainer power',
      }),
      mockLight('light.garage_ceiling', { unavailable: true }),
      mockEntityState('light.workshop_lamp', 'unknown', {
        friendly_name: 'Workshop light',
      }),
      named(
        mockSwitch('switch.smoke_detector_hallway', false),
        'Smoke Detector Hallway switch',
      ),
      named(
        mockSwitch('switch.smoke_detector_landing', false),
        'Smoke Detector Landing switch',
      ),
      named(mockSwitch('switch.rack_pdu_outlet_3', true), 'Rack PDU outlet 3'),
      named(mockSwitch('switch.rack_pdu_outlet_4', true), 'Rack PDU outlet 4'),
      named(mockSwitch('switch.garage_lights', false), 'Garage lights'),
      named(mockLight('light.hall_ceiling'), 'Hall ceiling'),
      named(
        mockSensor('sensor.office_a_temperature', 'temperature', 21.2, '°C'),
        'Office A Temperature',
      ),
      named(mockLight('light.office_a_ceiling'), 'Office A Ceiling'),
      named(mockLight('light.landing_ceiling'), 'Upstairs landing ceiling'),
      named(
        mockSensor('sensor.kitchen_temperature', 'temperature', 22.4, '°C'),
        'Kitchen Temperature',
      ),
      named(
        mockBinarySensor('binary_sensor.front_door', 'door', false),
        'Front door',
      ),
    ],
    entities: [
      { entity_id: 'sensor.bike_trainer_power', area_id: null },
      { entity_id: 'light.garage_ceiling', area_id: 'garage' },
      { entity_id: 'switch.smoke_detector_hallway', area_id: null },
      { entity_id: 'switch.rack_pdu_outlet_3', area_id: 'server_rack' },
      { entity_id: 'switch.rack_pdu_outlet_4', area_id: 'server_rack' },
      { entity_id: 'sensor.office_a_temperature', area_id: 'office_a' },
      { entity_id: 'light.office_a_ceiling', area_id: 'office_a' },
      { entity_id: 'light.landing_ceiling', area_id: 'upstairs_landing' },
      {
        entity_id: 'switch.smoke_detector_landing',
        area_id: 'upstairs_landing',
      },
    ],
  });
}

function auroraThing(key: string): Thing {
  const found = thingsOf(home, floors, []).find((entry) => entry.key === key);

  if (!found) throw new Error(`Casa Aurora has no ${key}`);

  return found;
}

function roomThing(name: string): Thing {
  const slug = name.toLowerCase().replace(/ /g, '-');

  return {
    scope: { type: 'room', id: slug },
    key: `room:${slug}`,
    name,
    shortName: name,
    room: slug,
    roomName: name,
    floor: null,
    entrance: false,
  };
}

function byId(candidates: Candidate[]): Map<string, Candidate> {
  return new Map(candidates.map((entry) => [entry.entityId, entry]));
}

function suggestions(hass: MockHass) {
  return suggestAll(
    proposeSetup(home, hass, []),
    thingsOf(home, floors, []),
    hass,
    [],
  );
}

function roomProposal(hass: MockHass, slug: string) {
  const room = proposeSetup(home, hass, [])
    .floors.flatMap((floor) => floor.rooms)
    .find((entry) => entry.scope.id === slug);

  if (!room) throw new Error(`no proposal for ${slug}`);

  return room;
}

describe('proposals on a real registry', () => {
  it('never proposes an unavailable or unknown entity', () => {
    const hass = registryHass();
    const offered = [...suggestions(hass).values()]
      .flat()
      .flatMap((entry) => (entry.kind === 'entity' ? [entry.entityId] : []));
    const lights = [
      ...roomProposal(hass, 'garage').lights,
      ...roomProposal(hass, 'workshop').lights,
    ];
    const proposed = lights.flatMap((light) =>
      light.match.candidates.map((candidate) => candidate.id),
    );

    expect(offered.filter((id) => unusable.includes(id))).toEqual([]);
    expect(proposed.filter((id) => unusable.includes(id))).toEqual([]);
    expect(lights.map((light) => light.match.choice)).toEqual([null, null]);
  });

  it('lists an unavailable entity last in the picker, marked unavailable', () => {
    const candidates = candidatesFor(
      auroraThing('room:workshop'),
      registryHass(),
      [],
    );
    const last = candidates.at(-1);

    expect(last).toMatchObject({
      entityId: 'sensor.bike_trainer_power',
      unavailable: true,
      good: false,
      strong: false,
    });
    expect(candidates.filter((entry) => entry.unavailable)).toHaveLength(1);
  });

  it('offers a light only lights and the switches its room name or area ties to it', () => {
    const hass = registryHass();
    const hall = candidatesFor(auroraThing('light:hall-light'), hass, []);
    const garage = candidatesFor(auroraThing('light:garage-light'), hass, []);
    const rack = candidatesFor(
      {
        ...roomThing('Server rack'),
        scope: { type: 'light', id: 'rack-light' },
      },
      hass,
      [],
    );

    expect(
      hall.filter((entry) => entry.entityId.startsWith('switch.')),
    ).toEqual([]);
    expect(garage.map((entry) => entry.entityId)).toContain(
      'switch.garage_lights',
    );
    expect(
      garage.filter((entry) => entry.entityId.startsWith('switch.rack')),
    ).toEqual([]);
    expect(rack.map((entry) => entry.entityId)).toEqual(
      expect.arrayContaining([
        'switch.rack_pdu_outlet_3',
        'switch.rack_pdu_outlet_4',
      ]),
    );
  });

  it('never offers Office A for a room called Office B', () => {
    const officeB = byId(
      candidatesFor(roomThing('Office B'), registryHass(), []),
    ).get('sensor.office_a_temperature');

    expect(officeB).toMatchObject({ good: false, strong: false });
    expect(
      matchName('Office B', [{ id: 'office_a', name: 'Office A' }]),
    ).toMatchObject({ quality: 'none', choice: null });
    expect(
      matchName('Office B ceiling', [
        { id: 'light.office_a_ceiling', name: 'Office A Ceiling' },
      ]).quality,
    ).toBe('none');
    expect(
      matchRooms(
        [{ id: 'office-b', name: 'Office B' }],
        [{ id: 'office_a', name: 'Office A' }],
      ).get('office-b')?.choice,
    ).toBeNull();
  });

  it('is sure only of an entity with the room area and name, or an exact name', () => {
    const hass = registryHass();
    const kitchen = byId(
      candidatesFor(auroraThing('room:kitchen'), hass, []),
    ).get('sensor.kitchen_temperature');
    const officeA = byId(candidatesFor(roomThing('Office A'), hass, [])).get(
      'sensor.office_a_temperature',
    );

    expect(kitchen).toMatchObject({ good: true, strong: false });
    expect(officeA).toMatchObject({ good: true, strong: true });
  });

  it('proposes the Home Assistant area whose name comes close, without linking it', () => {
    const hass = registryHass();
    const landing = suggestions(hass).get('room:landing');

    expect(landing).toEqual([
      {
        kind: 'area',
        areaId: 'upstairs_landing',
        name: 'Upstairs landing',
        strong: false,
      },
    ]);
  });

  it('offers every office area for the study, and picks none of them', () => {
    const hass = registryHass();
    const study = proposedAreas(proposeSetup(home, hass, []), hass).get(
      'room:study',
    );

    expect(
      study?.map((entry) => entry.kind === 'area' && entry.areaId).sort(),
    ).toEqual(['marias_office', 'office_a', 'office_b']);
    expect(roomProposal(hass, 'study').match.choice).toBeNull();
    expect(suggestions(hass).has('room:study')).toBe(false);
  });

  it("ignores accents, case and 's when it matches a room to an area", () => {
    expect(
      matchName('MARIA office', [
        { id: 'marias_office', name: "María's Office" },
      ]),
    ).toMatchObject({ quality: 'similar', choice: 'marias_office' });
  });

  it('still offers the Front door contact for the entrance door', () => {
    expect(suggestions(registryHass()).get('door:d1')).toMatchObject([
      { kind: 'entity', entityId: 'binary_sensor.front_door' },
    ]);
  });
});
