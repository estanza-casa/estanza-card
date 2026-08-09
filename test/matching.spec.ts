import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { describe, expect, it } from 'vitest';

import type { SceneBinding } from '../src/bindings.js';
import {
  type MatchCandidate,
  matchName,
  matchRooms,
  nameKey,
  proposeSetup,
  type SetupProposal,
} from '../src/matching.js';
import homeFixture from './fixtures/home.json';
import {
  createMockHass,
  mockBinarySensor,
  type MockHassOptions,
  mockLight,
} from './mock-hass.js';
import { threeStoreyHome } from './storeys.js';

const home = homeDocumentSchema.parse(homeFixture);

function areas(...names: string[]): MatchCandidate[] {
  return names.map((name) => ({ id: nameKey(name).replace(/ /g, '_'), name }));
}

function hassWith(options: MockHassOptions) {
  return createMockHass(options);
}

function houseHass() {
  return hassWith({
    areas: [
      { area_id: 'living', name: 'Living space' },
      { area_id: 'bano', name: 'Baño' },
      { area_id: 'hall', name: 'Hall' },
    ],
    states: [
      mockLight('light.living_space_light'),
      mockLight('light.ceiling'),
      mockLight('light.hall_spots'),
      mockLight('light.hall_lamp'),
      mockBinarySensor('binary_sensor.bathroom_door', 'door', false),
      mockBinarySensor('binary_sensor.bathroom_motion', 'motion', false),
    ],
    entities: [
      { entity_id: 'light.living_space_light', area_id: 'living' },
      { entity_id: 'light.ceiling', area_id: 'bano' },
      { entity_id: 'light.hall_spots', area_id: 'hall' },
      { entity_id: 'light.hall_lamp', area_id: 'hall' },
      { entity_id: 'binary_sensor.bathroom_door', area_id: 'bano' },
      { entity_id: 'binary_sensor.bathroom_motion', area_id: 'bano' },
    ],
  });
}

function roomsOf(proposal: SetupProposal) {
  return proposal.floors.flatMap((floor) => floor.rooms);
}

function roomOf(proposal: SetupProposal, slug: string) {
  const room = roomsOf(proposal).find((entry) => entry.scope.id === slug);

  if (!room) throw new Error(`no proposal for ${slug}`);

  return room;
}

describe('nameKey', () => {
  it('ignores case, accents and punctuation', () => {
    expect(nameKey('Salón')).toBe('salon');
    expect(nameKey('  Living-Room! ')).toBe('living room');
    expect(nameKey('Łazienka')).toBe('lazienka');
    expect(nameKey('Gäste-WC')).toBe('gaste wc');
  });
});

describe('matchName', () => {
  it('takes the area with exactly the same name', () => {
    expect(matchName('Kitchen', areas('Garage', 'Kitchen'))).toEqual({
      quality: 'exact',
      choice: 'kitchen',
      candidates: areas('Kitchen', 'Garage'),
      fits: 1,
    });
  });

  it('reads a difference of case alone as the same name', () => {
    expect(matchName('Living room', areas('Living Room')).quality).toBe(
      'exact',
    );
  });

  it('matches across accents and punctuation as a similar name', () => {
    const match = matchName('Salon', areas('Garage', 'Salón'));

    expect(match.quality).toBe('similar');
    expect(match.choice).toBe('salon');
  });

  it('matches the same room named in another of the eight languages', () => {
    expect(matchName('Living room', areas('Wohnzimmer')).choice).toBe(
      'wohnzimmer',
    );
    expect(matchName('Kitchen', areas('Garaje', 'Cocina')).choice).toBe(
      'cocina',
    );
    expect(matchName('Bedroom', areas('Sypialnia')).quality).toBe('similar');
    expect(matchName('Bathroom', areas('Salle de bain')).quality).toBe(
      'similar',
    );
    expect(matchName('Hall', areas('Ingresso')).quality).toBe('similar');
    expect(matchName('Study', areas('Kantoor')).quality).toBe('similar');
    expect(matchName('Garage', areas('Garagem')).quality).toBe('similar');
  });

  it('matches an area alias', () => {
    const match = matchName('Lounge', [
      { id: 'front_room', name: 'Front room', aliases: ['Lounge'] },
    ]);

    expect(match.quality).toBe('similar');
    expect(match.choice).toBe('front_room');
  });

  it('proposes a near name but leaves it doubtful', () => {
    expect(matchName('Wine Cellar', areas('Kitchen', 'Cellar'))).toEqual({
      quality: 'doubtful',
      choice: 'cellar',
      candidates: areas('Cellar', 'Kitchen'),
      fits: 1,
    });
    expect(matchName('Kitchn', areas('Kitchen')).quality).toBe('doubtful');
  });

  it('picks nothing when two areas fit, and offers both first', () => {
    expect(
      matchName('Bedroom', areas('Garage', 'Bedroom 1', 'Bedroom 2')),
    ).toEqual({
      quality: 'doubtful',
      choice: null,
      candidates: areas('Bedroom 1', 'Bedroom 2', 'Garage'),
      fits: 2,
    });
    expect(matchName('Living room', areas('Salón', 'Wohnzimmer'))).toEqual({
      quality: 'doubtful',
      choice: null,
      candidates: areas('Salón', 'Wohnzimmer'),
      fits: 2,
    });
  });

  it('matches nothing when no area comes close', () => {
    expect(matchName('Garage', areas('Kitchen', 'Bedroom'))).toEqual({
      quality: 'none',
      choice: null,
      candidates: areas('Kitchen', 'Bedroom'),
      fits: 0,
    });
    expect(matchName('Garage', []).quality).toBe('none');
  });
});

describe('matchRooms', () => {
  it('gives an area to one room only, the one that matches it best', () => {
    const matches = matchRooms(
      [
        { id: 'bath', name: 'Bath' },
        { id: 'bathroom', name: 'Bathroom' },
      ],
      areas('Bathroom'),
    );

    expect(matches.get('bathroom')?.choice).toBe('bathroom');
    expect(matches.get('bath')?.choice).toBeNull();
  });

  it('leaves both rooms doubtful when they claim one area equally', () => {
    const matches = matchRooms(
      [
        { id: 'lounge', name: 'Lounge' },
        { id: 'sitting', name: 'Sitting room' },
      ],
      areas('Salón'),
    );

    expect(matches.get('lounge')).toMatchObject({
      quality: 'doubtful',
      choice: null,
    });
    expect(matches.get('sitting')).toMatchObject({
      quality: 'doubtful',
      choice: null,
    });
  });

  it('lets the loser of a claim take the area left for it', () => {
    const matches = matchRooms(
      [
        { id: 'salon', name: 'Salon' },
        { id: 'salon-2', name: 'Salón' },
      ],
      areas('Salón', 'Lounge'),
    );

    expect(matches.get('salon-2')).toMatchObject({
      quality: 'exact',
      choice: 'salon',
    });
    expect(matches.get('salon')).toMatchObject({
      quality: 'similar',
      choice: 'lounge',
    });
  });
});

describe('proposeSetup', () => {
  it('matches rooms to areas and groups them by floor', () => {
    const proposal = proposeSetup(home, houseHass(), []);

    expect(proposal.floors.map((floor) => floor.name)).toEqual([
      'Ground floor',
    ]);
    expect(
      roomsOf(proposal).map((room) => [room.name, room.match.choice]),
    ).toEqual([
      ['Living Space', 'living'],
      ['Bathroom', 'bano'],
      ['Hall', 'hall'],
    ]);
    expect(roomOf(proposal, 'bathroom').match.quality).toBe('similar');
    expect(proposal.found).toEqual({ rooms: 3, lights: 3, doors: 2 });
  });

  it('matches a light by its name within the room area', () => {
    const light = roomOf(proposeSetup(home, houseHass(), []), 'living-space')
      .lights[0];

    expect(light.name).toBe('Living space light');
    expect(light.match).toMatchObject({
      quality: 'exact',
      choice: 'light.living_space_light',
    });
  });

  it('takes the only light of an area for the only light of its room', () => {
    const light = roomOf(proposeSetup(home, houseHass(), []), 'bathroom')
      .lights[0];

    expect(light.match).toMatchObject({
      quality: 'similar',
      choice: 'light.ceiling',
    });
  });

  it('leaves a light doubtful when its area holds two', () => {
    const light = roomOf(proposeSetup(home, houseHass(), []), 'hall').lights[0];

    expect(light.match.quality).toBe('doubtful');
    expect(light.match.choice).toBeNull();
    expect(light.match.candidates.map((candidate) => candidate.id)).toEqual([
      'light.hall_spots',
      'light.hall_lamp',
    ]);
  });

  it('links a door to the only door sensor its rooms hold', () => {
    const doors = roomOf(
      proposeSetup(home, houseHass(), []),
      'living-space',
    ).doors;

    expect(doors.map((door) => [door.rooms, door.match.choice])).toEqual([
      [['Living Space', 'Bathroom'], 'binary_sensor.bathroom_door'],
      [['Living Space', 'Hall'], null],
    ]);
    expect(doors[0].match.quality).toBe('similar');
    expect(doors[1].match.quality).toBe('none');
  });

  it('links a door to the sensor named after both of its rooms', () => {
    const hass = houseHass();

    hass.states['binary_sensor.hall_door'] = mockBinarySensor(
      'binary_sensor.hall_door',
      'door',
      false,
    );
    hass.states['binary_sensor.hall_door'].attributes.friendly_name =
      'Living space to Hall';
    hass.entities['binary_sensor.hall_door'] = {
      entity_id: 'binary_sensor.hall_door',
      area_id: 'hall',
    };

    const doors = roomOf(proposeSetup(home, hass, []), 'living-space').doors;

    expect(doors[1].match).toMatchObject({
      quality: 'exact',
      choice: 'binary_sensor.hall_door',
    });
  });

  it('keeps an existing binding and proposes only for the gaps', () => {
    const bindings: SceneBinding[] = [
      { scope: { type: 'room', id: 'hall' }, area_id: 'living' },
      {
        scope: { type: 'light', id: 'bathroom-light' },
        entity_id: 'light.hall_lamp',
      },
    ];
    const proposal = proposeSetup(home, houseHass(), bindings);
    const hall = roomOf(proposal, 'hall');

    expect(hall.linked).toBe(true);
    expect(hall.match.choice).toBe('living');
    expect(roomOf(proposal, 'living-space').match.choice).toBeNull();
    expect(roomOf(proposal, 'bathroom').lights).toEqual([]);
    expect(hall.lights[0].match.candidates.map((entry) => entry.id)).toEqual([
      'light.living_space_light',
    ]);
  });

  it('leaves out a room that is linked with nothing left to propose', () => {
    const bindings: SceneBinding[] = [
      { scope: { type: 'room', id: 'bathroom' }, area_id: 'bano' },
      {
        scope: { type: 'light', id: 'bathroom-light' },
        entity_id: 'light.ceiling',
      },
    ];
    const proposal = proposeSetup(home, houseHass(), bindings);

    expect(roomsOf(proposal).map((room) => room.scope.id)).toEqual([
      'living-space',
      'hall',
    ]);
  });

  it('does not trust a light or door of a room with a doubtful area', () => {
    const hass = houseHass();

    hass.areas.bano = { area_id: 'bano', name: 'Bathroom 1' };
    hass.areas.bano2 = { area_id: 'bano2', name: 'Bathroom 2' };

    const proposal = proposeSetup(home, hass, [], { bathroom: 'bano' });
    const bathroom = roomOf(proposal, 'bathroom');

    expect(bathroom.match.choice).toBeNull();
    expect(bathroom.lights[0].match).toMatchObject({
      quality: 'similar',
      choice: 'light.ceiling',
    });
    expect(
      roomOf(proposeSetup(home, hass, []), 'bathroom').lights[0].match.choice,
    ).toBeNull();
  });

  it('proposes a door contact with no area by the room its name gives', () => {
    const hass = hassWith({
      states: [
        {
          ...mockBinarySensor('binary_sensor.contact_3', 'door', false),
          attributes: { device_class: 'door', friendly_name: 'Bathroom Door' },
        },
      ],
    });
    const doors = roomOf(proposeSetup(home, hass, []), 'living-space').doors;

    expect(doors.map((door) => [door.rooms, door.match.choice])).toEqual([
      [['Living Space', 'Bathroom'], 'binary_sensor.contact_3'],
      [['Living Space', 'Hall'], null],
    ]);
    expect(doors[0].match.quality).toBe('similar');
  });

  it('proposes a light with no area by its name, even with no area for the room', () => {
    const hass = hassWith({
      states: [
        {
          ...mockLight('light.bulb_7'),
          attributes: { friendly_name: 'Hall Ceiling' },
        },
        mockLight('light.garden_string'),
      ],
      entities: [{ entity_id: 'light.bulb_7', area_id: null }],
    });
    const light = roomOf(proposeSetup(home, hass, []), 'hall').lights[0];

    expect(light.match).toMatchObject({
      quality: 'similar',
      choice: 'light.bulb_7',
    });
    expect(light.match.candidates.map((candidate) => candidate.id)).toEqual([
      'light.bulb_7',
    ]);
  });

  it('never proposes an area-less entity of the wrong kind', () => {
    const hass = hassWith({
      states: [
        {
          ...mockBinarySensor('binary_sensor.contact_3', 'window', false),
          attributes: { device_class: 'window', friendly_name: 'Bathroom' },
        },
        {
          ...mockBinarySensor('binary_sensor.motion_1', 'motion', false),
          attributes: { device_class: 'motion', friendly_name: 'Hall Door' },
        },
      ],
    });
    const doors = roomOf(proposeSetup(home, hass, []), 'living-space').doors;

    expect(doors.map((door) => door.match.choice)).toEqual([null, null]);
  });

  it('puts the top storey first', () => {
    const hass = hassWith({
      areas: [
        { area_id: 'cellar', name: 'Basement' },
        { area_id: 'bedroom', name: 'First floor' },
      ],
    });
    const proposal = proposeSetup(threeStoreyHome(), hass, []);

    expect(proposal.floors.map((floor) => floor.name)).toEqual([
      'First floor',
      'Ground floor',
      'Basement',
    ]);
  });
});
