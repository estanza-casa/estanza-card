import { LIGHT_COLORS } from '@estanza/plan-engine/document';
import { describe, expect, it } from 'vitest';

import type { SceneBinding } from '../src/bindings.js';
import { controlStyles } from '../src/control-view.js';
import {
  entityDomain,
  entityIdsInArea,
  isOccupied,
  kelvinToPresetHex,
  lightColorPresets,
  mapScopeStates,
  readArea,
  readClimate,
  readEntityState,
  readLight,
  readOpening,
  resolveBindingEntityIds,
  rgbToHex,
  sceneOverlayOf,
} from '../src/hass-state.js';
import {
  createHouseHass,
  createMockHass,
  mockBinarySensor,
  mockClimate,
  mockCover,
  mockEntityState,
  mockLight,
  mockLock,
  mockSensor,
} from './mock-hass.js';

function statesOf(entityIds: string[]) {
  const hass = createHouseHass();

  return entityIds.map((entityId) => hass.states[entityId]);
}

describe('entityDomain', () => {
  it('reads the domain from an entity id', () => {
    expect(entityDomain('binary_sensor.front_door')).toBe('binary_sensor');
  });
});

describe('readEntityState', () => {
  it('returns undefined for an entity the hass object does not carry', () => {
    expect(readEntityState(createHouseHass(), 'light.ghost')).toBeUndefined();
  });
});

describe('entityIdsInArea', () => {
  it('includes an entity assigned to the area through its device', () => {
    expect(entityIdsInArea(createHouseHass(), 'kitchen')).toContain(
      'light.kitchen_strip',
    );
  });

  it('excludes entities of another area', () => {
    expect(entityIdsInArea(createHouseHass(), 'kitchen')).not.toContain(
      'light.bedroom_ceiling',
    );
  });
});

describe('rgbToHex', () => {
  it('converts a three channel tuple', () => {
    expect(rgbToHex([255, 110, 168])).toBe('#ff6ea8');
  });

  it('clamps and rounds out of range channels', () => {
    expect(rgbToHex([-4, 255.6, 90.2])).toBe('#00ff5a');
  });

  it('rejects anything that is not a colour tuple', () => {
    expect(rgbToHex('#ff6ea8')).toBeNull();
    expect(rgbToHex([255, 110])).toBeNull();
    expect(rgbToHex([255, 110, null])).toBeNull();
  });
});

describe('lightColorPresets', () => {
  it('reads the white presets from plan-engine', () => {
    expect(lightColorPresets).toEqual(
      LIGHT_COLORS.filter((preset) => preset.kelvin !== undefined),
    );
  });

  it('keeps the warm, neutral and cool colours the card drew before', () => {
    expect(
      lightColorPresets.map(({ hex, kelvin }) => ({ hex, kelvin })),
    ).toEqual([
      { hex: '#ffd4ab', kelvin: 2700 },
      { hex: '#ffe6d2', kelvin: 4000 },
      { hex: '#ffffff', kelvin: 6500 },
    ]);
  });

  it('keeps the warm fallback behind the lamp swatch', () => {
    expect(controlStyles.cssText).toContain('var(--lamp, #ffd4ab)');
  });
});

describe('kelvinToPresetHex', () => {
  it('maps the warm preset kelvin to its hex', () => {
    expect(kelvinToPresetHex(2700)).toBe('#ffd4ab');
  });

  it('maps an unlisted kelvin to the nearest preset', () => {
    expect(kelvinToPresetHex(6000)).toBe('#ffffff');
    expect(kelvinToPresetHex(3000)).toBe('#ffd4ab');
  });
});

describe('readLight', () => {
  it('reads on state and normalizes brightness to a fraction', () => {
    const reading = readLight(statesOf(['light.kitchen_ceiling']));

    expect(reading?.on).toBe(true);
    expect(reading?.brightness).toBeCloseTo(0.698, 3);
    expect(reading?.entityId).toBe('light.kitchen_ceiling');
  });

  it('reads a reported rgb colour as hex', () => {
    expect(readLight(statesOf(['light.kitchen_strip']))?.color).toBe('#ff6ea8');
  });

  it('falls back to the preset hex of a colour temperature', () => {
    const reading = readLight([
      mockLight('light.desk', { on: true, kelvin: 4000 }),
    ]);

    expect(reading?.color).toBe('#ffe6d2');
    expect(reading?.kelvin).toBe(4000);
  });

  it('reports an off light with no colour and no brightness', () => {
    const reading = readLight(statesOf(['light.bedroom_ceiling']));

    expect(reading?.on).toBe(false);
    expect(reading?.brightness).toBeNull();
    expect(reading?.color).toBeNull();
  });

  it('accepts a switch when no light entity is bound', () => {
    const reading = readLight([mockEntityState('switch.lamp_relay', 'on')]);

    expect(reading?.entityId).toBe('switch.lamp_relay');
    expect(reading?.on).toBe(true);
  });

  it('prefers a light over a switch bound to the same object', () => {
    const reading = readLight([
      mockEntityState('switch.lamp_relay', 'on'),
      mockLight('light.lamp', { on: false }),
    ]);

    expect(reading?.entityId).toBe('light.lamp');
  });

  it('returns nothing when no supported entity is bound', () => {
    expect(readLight([mockSensor('sensor.x', 'power', 4, 'W')])).toBeNull();
  });
});

describe('readOpening', () => {
  it('maps an open door sensor to a fully open leaf', () => {
    expect(
      readOpening(statesOf(['binary_sensor.front_door']), 'door')?.open,
    ).toBe(1);
  });

  it('maps a closed window sensor to a shut leaf', () => {
    expect(
      readOpening(statesOf(['binary_sensor.kitchen_window']), 'window')?.open,
    ).toBe(0);
  });

  it('prefers the sensor whose device class matches the object', () => {
    const reading = readOpening(
      [
        mockBinarySensor('binary_sensor.hall_motion', 'motion', true),
        mockBinarySensor('binary_sensor.hall_door', 'door', false),
      ],
      'door',
    );

    expect(reading?.entityId).toBe('binary_sensor.hall_door');
  });

  it('accepts a bound sensor whose device class does not match', () => {
    const reading = readOpening(
      [mockBinarySensor('binary_sensor.hall_motion', 'motion', true)],
      'door',
    );

    expect(reading?.open).toBe(1);
  });

  it('reads a cover position as a fraction', () => {
    expect(readOpening([mockCover('cover.garage', 60)], 'door')?.open).toBe(
      0.6,
    );
  });

  it('prefers a garage cover over another cover bound to the same door', () => {
    const reading = readOpening(
      [
        mockEntityState('cover.garage_blind', 'closed', {
          device_class: 'blind',
        }),
        mockCover('cover.garage', 60),
      ],
      'door',
    );

    expect(reading?.entityId).toBe('cover.garage');
  });

  it('prefers a gate cover over another cover bound to the same door', () => {
    const reading = readOpening(
      [
        mockEntityState('cover.drive_awning', 'closed', {
          device_class: 'awning',
        }),
        mockEntityState('cover.drive_gate', 'open', { device_class: 'gate' }),
      ],
      'door',
    );

    expect(reading?.entityId).toBe('cover.drive_gate');
  });

  it('falls back to the cover state when it reports no position', () => {
    const cover = mockEntityState('cover.side', 'open', {});

    expect(readOpening([cover], 'door')?.open).toBe(1);
  });
});

describe('readClimate', () => {
  it('reads current and target temperature from a climate entity', () => {
    const reading = readClimate(statesOf(['climate.living_room_ac']));

    expect(reading?.currentTemperature).toBe(24.5);
    expect(reading?.targetTemperature).toBe(21);
    expect(reading?.hvacMode).toBe('cool');
    expect(reading?.cooling).toBe(true);
    expect(reading?.heating).toBe(false);
  });

  it('trusts hvac action over hvac mode', () => {
    const reading = readClimate([
      mockClimate('climate.radiator', { mode: 'heat', hvacAction: 'idle' }),
    ]);

    expect(reading?.heating).toBe(false);
    expect(reading?.hvacAction).toBe('idle');
  });

  it('falls back to hvac mode when the device reports no action', () => {
    const reading = readClimate([
      mockEntityState('climate.plain', 'heat', { current_temperature: 20 }),
    ]);

    expect(reading?.heating).toBe(true);
  });

  it('reads a temperature sensor when no climate entity is bound', () => {
    const reading = readClimate(statesOf(['sensor.bedroom_thermometer']));

    expect(reading?.currentTemperature).toBe(18.9);
    expect(reading?.targetTemperature).toBeNull();
    expect(reading?.unit).toBe('°C');
  });

  it('prefers a climate entity over a temperature sensor', () => {
    const reading = readClimate(
      statesOf(['sensor.bedroom_thermometer', 'climate.bedroom_radiator']),
    );

    expect(reading?.entityId).toBe('climate.bedroom_radiator');
  });

  it('never reads a sensor that measures something other than temperature', () => {
    expect(readClimate(statesOf(['sensor.kitchen_power']))).toBeNull();
    expect(
      readClimate(
        statesOf(['sensor.kitchen_power', 'sensor.bedroom_thermometer']),
      )?.entityId,
    ).toBe('sensor.bedroom_thermometer');
  });
});

describe('readArea', () => {
  it('finds temperature and humidity by device class inside the area', () => {
    const reading = readArea(createHouseHass(), [
      { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
    ]);

    expect(reading.temperature).toBe(21.4);
    expect(reading.temperatureEntityId).toBe('sensor.kitchen_temperature');
    expect(reading.temperatureUnit).toBe('°C');
    expect(reading.humidity).toBe(47);
    expect(reading.areaName).toBe('Kitchen');
  });

  it('prefers the sensor the area registry names', () => {
    const hass = createHouseHass();

    hass.areas = {
      ...hass.areas,
      kitchen: {
        area_id: 'kitchen',
        name: 'Kitchen',
        temperature_entity_id: 'sensor.bedroom_thermometer',
      },
    };

    const reading = readArea(hass, [
      { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
    ]);

    expect(reading.temperature).toBe(18.9);
  });

  it('prefers a per sensor override on the binding', () => {
    const reading = readArea(createHouseHass(), [
      {
        scope: { type: 'room', id: 'kitchen' },
        area_id: 'kitchen',
        temperature_entity_id: 'sensor.bedroom_thermometer',
      },
    ]);

    expect(reading.temperatureEntityId).toBe('sensor.bedroom_thermometer');
  });

  it('falls back to the unit when no sensor declares a device class', () => {
    const hass = createMockHass({
      states: [
        mockEntityState('sensor.study_probe', '20.1', {
          unit_of_measurement: '°C',
        }),
      ],
      entities: [{ entity_id: 'sensor.study_probe', area_id: 'study' }],
      areas: [{ area_id: 'study', name: 'Study' }],
    });

    const reading = readArea(hass, [
      { scope: { type: 'room', id: 'study' }, area_id: 'study' },
    ]);

    expect(reading.temperatureEntityId).toBe('sensor.study_probe');
    expect(reading.temperature).toBe(20.1);
  });

  it('invents no value when the bound sensor is unavailable', () => {
    const hass = createHouseHass();

    hass.setState('sensor.kitchen_temperature', 'unavailable');

    const reading = readArea(hass, [
      { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
    ]);

    expect(reading.temperature).toBeNull();
    expect(reading.temperatureEntityId).toBe('sensor.kitchen_temperature');
  });

  it('reads the listed sensors of a room that has no area', () => {
    const hass = createMockHass({
      states: [
        mockLight('light.study_lamp', { on: true }),
        mockSensor('sensor.study_power', 'power', 40, 'W'),
        mockSensor('sensor.study_humidity', 'humidity', 55, '%'),
        mockSensor('sensor.study_temperature', 'temperature', 22.3, '°C'),
      ],
    });

    const reading = readArea(hass, [
      {
        scope: { type: 'room', id: 'study' },
        entity_ids: [
          'light.study_lamp',
          'sensor.study_power',
          'sensor.study_humidity',
          'sensor.study_temperature',
        ],
      },
    ]);

    expect(reading.temperatureEntityId).toBe('sensor.study_temperature');
    expect(reading.temperature).toBe(22.3);
    expect(reading.temperatureUnit).toBe('°C');
    expect(reading.humidityEntityId).toBe('sensor.study_humidity');
    expect(reading.humidity).toBe(55);
  });

  it('reads a single listed sensor given as entity_id', () => {
    const hass = createMockHass({
      states: [mockSensor('sensor.hall_temperature', 'temperature', 19, '°C')],
    });

    const reading = readArea(hass, [
      {
        scope: { type: 'room', id: 'hall' },
        entity_id: 'sensor.hall_temperature',
      },
    ]);

    expect(reading.temperature).toBe(19);
    expect(reading.humidity).toBeNull();
  });

  it('qualifies a listed sensor by its unit when it declares no device class', () => {
    const hass = createMockHass({
      states: [
        mockEntityState('sensor.study_probe', '20.1', {
          unit_of_measurement: '°C',
        }),
      ],
    });

    const reading = readArea(hass, [
      {
        scope: { type: 'room', id: 'study' },
        entity_ids: ['sensor.study_probe'],
      },
    ]);

    expect(reading.temperatureEntityId).toBe('sensor.study_probe');
  });

  it('never reads a listed battery level as the humidity', () => {
    const hass = createMockHass({
      states: [mockSensor('sensor.study_battery', 'battery', 80, '%')],
    });

    const reading = readArea(hass, [
      {
        scope: { type: 'room', id: 'study' },
        entity_id: 'sensor.study_battery',
      },
    ]);

    expect(reading.humidityEntityId).toBeNull();
  });

  it('prefers a listed sensor over the area registry and the area search', () => {
    const hass = createHouseHass();

    hass.areas = {
      ...hass.areas,
      kitchen: {
        area_id: 'kitchen',
        name: 'Kitchen',
        temperature_entity_id: 'sensor.kitchen_temperature',
      },
    };

    const reading = readArea(hass, [
      {
        scope: { type: 'room', id: 'kitchen' },
        area_id: 'kitchen',
        entity_ids: ['sensor.bedroom_thermometer'],
      },
    ]);

    expect(reading.temperatureEntityId).toBe('sensor.bedroom_thermometer');
    expect(reading.humidityEntityId).toBe('sensor.kitchen_humidity');
  });

  it('prefers the explicit sensor field over a listed sensor', () => {
    const reading = readArea(createHouseHass(), [
      {
        scope: { type: 'room', id: 'kitchen' },
        entity_ids: ['sensor.kitchen_temperature'],
        temperature_entity_id: 'sensor.bedroom_thermometer',
      },
    ]);

    expect(reading.temperatureEntityId).toBe('sensor.bedroom_thermometer');
  });

  it('reports nulls for an area that has no sensors', () => {
    const reading = readArea(createHouseHass(), [
      { scope: { type: 'room', id: 'garage' }, area_id: 'garage' },
    ]);

    expect(reading.temperature).toBeNull();
    expect(reading.humidity).toBeNull();
    expect(reading.areaName).toBe('Garage');
  });
});

describe('resolveBindingEntityIds', () => {
  it('merges explicit entities with the entities of the bound area', () => {
    const binding: SceneBinding = {
      scope: { type: 'room', id: 'kitchen' },
      entity_id: 'binary_sensor.front_door',
      area_id: 'kitchen',
    };

    const ids = resolveBindingEntityIds(createHouseHass(), binding);

    expect(ids[0]).toBe('binary_sensor.front_door');
    expect(ids).toContain('sensor.kitchen_humidity');
  });
});

describe('mapScopeStates', () => {
  it('produces a live light reading for a bound bulb', () => {
    const map = mapScopeStates(createHouseHass(), [
      {
        scope: { type: 'light', id: 'kitchen-1' },
        entity_id: 'light.kitchen_strip',
      },
    ]);

    const scopeState = map['light:kitchen-1'];

    expect(scopeState?.status).toBe('live');
    expect(scopeState?.reading).toMatchObject({ kind: 'light', on: true });
  });

  it('produces a door fraction the renderer can ease toward', () => {
    const map = mapScopeStates(createHouseHass(), [
      {
        scope: { type: 'door', id: 'door-3' },
        entity_id: 'binary_sensor.front_door',
      },
    ]);

    expect(map['door:door-3']?.reading).toMatchObject({
      kind: 'opening',
      open: 1,
    });
  });

  it('keeps a door shut that is linked to an unlocked lock and no contact', () => {
    const hass = createMockHass({
      states: [mockLock('lock.office_door', 'unlocked')],
    });
    const map = mapScopeStates(hass, [
      { scope: { type: 'door', id: 'office' }, entity_id: 'lock.office_door' },
    ]);

    expect(sceneOverlayOf(map).doors.office).toBe(0);
  });

  it('keeps a door shut while its contact is unavailable and its lock is unlocked', () => {
    const hass = createMockHass({
      states: [
        mockEntityState('binary_sensor.office_door', 'unavailable', {
          device_class: 'door',
        }),
        mockLock('lock.office_door', 'unlocked'),
      ],
    });
    const map = mapScopeStates(hass, [
      {
        scope: { type: 'door', id: 'office' },
        entity_ids: ['binary_sensor.office_door', 'lock.office_door'],
      },
    ]);

    expect(sceneOverlayOf(map).doors.office).toBe(0);
  });

  it('produces a climate reading for a radiator prop', () => {
    const map = mapScopeStates(createHouseHass(), [
      {
        scope: { type: 'prop', id: 'radiator-1' },
        entity_id: 'climate.bedroom_radiator',
      },
    ]);

    expect(map['prop:radiator-1']?.reading).toMatchObject({
      kind: 'climate',
      currentTemperature: 19,
      targetTemperature: 21.5,
    });
  });

  it('produces an area reading for a room bound to an area', () => {
    const map = mapScopeStates(createHouseHass(), [
      { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
    ]);

    expect(map['room:kitchen']?.reading).toMatchObject({
      kind: 'area',
      temperature: 21.4,
      humidity: 47,
    });
  });

  it('produces an area reading for a room linked by its listed sensors alone', () => {
    const hass = createMockHass({
      states: [
        mockSensor('sensor.study_temperature', 'temperature', 22.3, '°C'),
        mockSensor('sensor.study_humidity', 'humidity', 55, '%'),
      ],
    });

    const map = mapScopeStates(hass, [
      {
        scope: { type: 'room', id: 'study' },
        entity_ids: ['sensor.study_temperature', 'sensor.study_humidity'],
      },
    ]);

    expect(map['room:study']?.status).toBe('live');
    expect(map['room:study']?.reading).toMatchObject({
      kind: 'area',
      temperature: 22.3,
      humidity: 55,
    });
  });

  it('reports a missing entity as needing a re-link and invents no reading', () => {
    const map = mapScopeStates(createHouseHass(), [
      { scope: { type: 'light', id: 'ghost-1' }, entity_id: 'light.ghost' },
    ]);

    const scopeState = map['light:ghost-1'];

    expect(scopeState?.status).toBe('missing');
    expect(scopeState?.reading).toBeNull();
    expect(scopeState?.entityIds).toEqual(['light.ghost']);
  });

  it('reports a scope that names nothing as unbound', () => {
    const map = mapScopeStates(createHouseHass(), [
      { scope: { type: 'light', id: 'spare-1' } },
    ]);

    expect(map['light:spare-1']?.status).toBe('unbound');
    expect(map['light:spare-1']?.reading).toBeNull();
  });

  it('treats an entity id borrowed from the object prototype as missing', () => {
    const map = mapScopeStates(createHouseHass(), [
      { scope: { type: 'light', id: 'odd-1' }, entity_id: '__proto__' },
      { scope: { type: 'room', id: 'odd-2' }, area_id: '__proto__' },
    ]);

    expect(map['light:odd-1']?.status).toBe('missing');
    expect(map['room:odd-2']?.status).toBe('missing');
  });

  it('reports an unavailable entity separately from a missing one', () => {
    const map = mapScopeStates(createHouseHass(), [
      {
        scope: { type: 'light', id: 'hall-1' },
        entity_id: 'light.hall_ceiling',
      },
    ]);

    const scopeState = map['light:hall-1'];

    expect(scopeState?.status).toBe('unavailable');
    expect(scopeState?.unavailable).toBe(true);
    expect(scopeState?.reading).toBeNull();
  });

  it('reports a room bound to an area that no longer exists as missing', () => {
    const map = mapScopeStates(createHouseHass(), [
      { scope: { type: 'room', id: 'attic' }, area_id: 'attic' },
    ]);

    expect(map['room:attic']?.status).toBe('missing');
    expect(map['room:attic']?.reading).toBeNull();
  });

  it('keeps a room live when its area carries no sensors', () => {
    const map = mapScopeStates(createHouseHass(), [
      { scope: { type: 'room', id: 'garage' }, area_id: 'garage' },
    ]);

    const scopeState = map['room:garage'];

    expect(scopeState?.status).toBe('live');
    expect(scopeState?.reading).toMatchObject({
      kind: 'area',
      temperature: null,
    });
  });

  it('merges two bindings that share one scope', () => {
    const map = mapScopeStates(createHouseHass(), [
      {
        scope: { type: 'light', id: 'kitchen-1' },
        entity_id: 'light.kitchen_ceiling',
      },
      {
        scope: { type: 'light', id: 'kitchen-1' },
        entity_id: 'light.kitchen_strip',
      },
    ]);

    expect(map['light:kitchen-1']?.entityIds).toEqual([
      'light.kitchen_ceiling',
      'light.kitchen_strip',
    ]);
  });

  it('follows a state change made through the harness', () => {
    const hass = createHouseHass();
    const bindings: SceneBinding[] = [
      {
        scope: { type: 'light', id: 'kitchen-1' },
        entity_id: 'light.kitchen_ceiling',
      },
    ];

    hass.setState('light.kitchen_ceiling', 'off', {});

    expect(
      mapScopeStates(hass, bindings)['light:kitchen-1']?.reading,
    ).toMatchObject({ kind: 'light', on: false });
  });

  it('returns nothing for a scope with no bindings', () => {
    expect(mapScopeStates(createHouseHass(), [])).toEqual({});
  });
});

describe('isOccupied', () => {
  it('reads a room as occupied while its motion sensor is on', () => {
    expect(
      isOccupied([mockBinarySensor('binary_sensor.hall', 'motion', true)]),
    ).toBe(true);
  });

  it('reads an occupancy or presence sensor the same way', () => {
    expect(
      isOccupied([mockBinarySensor('binary_sensor.den', 'occupancy', true)]),
    ).toBe(true);
    expect(
      isOccupied([mockBinarySensor('binary_sensor.den', 'presence', true)]),
    ).toBe(true);
  });

  it('reads a room as empty once every sensor has cleared', () => {
    expect(
      isOccupied([mockBinarySensor('binary_sensor.hall', 'motion', false)]),
    ).toBe(false);
  });

  it('ignores an open door, which says nothing about who is in', () => {
    expect(
      isOccupied([mockBinarySensor('binary_sensor.door', 'door', true)]),
    ).toBe(false);
  });

  it('ignores a light that is on', () => {
    expect(isOccupied([mockLight('light.hall', { on: true })])).toBe(false);
  });

  it('finds the motion sensor of a room bound by its area', () => {
    const map = mapScopeStates(createHouseHass(), [
      { scope: { type: 'room', id: 'kitchen' }, area_id: 'kitchen' },
    ]);

    expect(isOccupied(map['room:kitchen']?.states ?? [])).toBe(true);
  });
});
