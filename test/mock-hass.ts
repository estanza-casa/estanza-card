import type {
  HassAreaRegistryEntry,
  HassDeviceRegistryEntry,
  HassEntityRegistryEntry,
  HassEntityState,
  HomeAssistant,
} from '../src/hass-state.js';

export type ServiceCall = {
  domain: string;
  service: string;
  data?: Record<string, unknown>;
};

export type MockHass = HomeAssistant & {
  serviceCalls: ServiceCall[];
  setState: (
    entityId: string,
    state: string,
    attributes?: Record<string, unknown>,
  ) => void;
};

export type MockHassOptions = {
  states?: HassEntityState[];
  entities?: HassEntityRegistryEntry[];
  devices?: HassDeviceRegistryEntry[];
  areas?: HassAreaRegistryEntry[];
  language?: string;
  temperatureUnit?: string;
  location?: { latitude: number; longitude: number } | null;
};

export const MADRID = { latitude: 40.4168, longitude: -3.7038 };

export const NULL_ISLAND = { latitude: 0, longitude: 0 };

export type MockLightOptions = {
  on?: boolean;
  brightness?: number;
  rgb?: [number, number, number];
  kelvin?: number;
  unavailable?: boolean;
};

export type MockClimateOptions = {
  mode?: string;
  currentTemperature?: number;
  targetTemperature?: number;
  hvacAction?: string;
};

export function mockEntityState(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntityState {
  return {
    entity_id: entityId,
    state,
    attributes,
    last_changed: '2026-08-18T09:00:00.000Z',
    last_updated: '2026-08-18T09:00:00.000Z',
  };
}

export function mockLight(
  entityId: string,
  options: MockLightOptions = {},
): HassEntityState {
  if (options.unavailable) return mockEntityState(entityId, 'unavailable', {});

  const on = options.on ?? true;
  const attributes: Record<string, unknown> = {
    friendly_name: friendlyName(entityId),
    supported_color_modes: ['color_temp', 'hs'],
  };

  if (on) {
    attributes.brightness = options.brightness ?? 255;
    attributes.color_mode = options.rgb ? 'hs' : 'color_temp';

    if (options.rgb) attributes.rgb_color = options.rgb;
    if (options.kelvin) attributes.color_temp_kelvin = options.kelvin;
  }

  return mockEntityState(entityId, on ? 'on' : 'off', attributes);
}

export function mockBinarySensor(
  entityId: string,
  deviceClass: string,
  open: boolean,
): HassEntityState {
  return mockEntityState(entityId, open ? 'on' : 'off', {
    device_class: deviceClass,
    friendly_name: friendlyName(entityId),
  });
}

export function mockCover(entityId: string, position: number): HassEntityState {
  return mockEntityState(entityId, position > 0 ? 'open' : 'closed', {
    device_class: 'garage',
    current_position: position,
    friendly_name: friendlyName(entityId),
  });
}

export function mockSwitch(entityId: string, on: boolean): HassEntityState {
  return mockEntityState(entityId, on ? 'on' : 'off', {
    friendly_name: friendlyName(entityId),
  });
}

export function mockLock(entityId: string, state: string): HassEntityState {
  return mockEntityState(entityId, state, {
    friendly_name: friendlyName(entityId),
  });
}

export function mockClimate(
  entityId: string,
  options: MockClimateOptions = {},
): HassEntityState {
  return mockEntityState(entityId, options.mode ?? 'heat', {
    friendly_name: friendlyName(entityId),
    current_temperature: options.currentTemperature ?? 21.5,
    temperature: options.targetTemperature ?? 22,
    hvac_action: options.hvacAction ?? 'heating',
    hvac_modes: ['off', 'heat', 'cool'],
    min_temp: 7,
    max_temp: 35,
  });
}

export function mockSensor(
  entityId: string,
  deviceClass: string,
  value: number,
  unit: string,
): HassEntityState {
  return mockEntityState(entityId, String(value), {
    device_class: deviceClass,
    state_class: 'measurement',
    unit_of_measurement: unit,
    friendly_name: friendlyName(entityId),
  });
}

export function createMockHass(options: MockHassOptions = {}): MockHass {
  const serviceCalls: ServiceCall[] = [];

  const hass: MockHass = {
    config: {
      unit_system: { temperature: options.temperatureUnit ?? '°C' },
      ...(options.location === null ? {} : (options.location ?? MADRID)),
    },
    states: keyBy(options.states ?? [], (entry) => entry.entity_id),
    entities: keyBy(options.entities ?? [], (entry) => entry.entity_id),
    devices: keyBy(options.devices ?? [], (entry) => entry.id),
    areas: keyBy(options.areas ?? [], (entry) => entry.area_id),
    language: options.language ?? 'en',
    serviceCalls,
    callService: async (domain, service, data) => {
      serviceCalls.push({ domain, service, data });
    },
    setState: (entityId, state, attributes) => {
      const current = hass.states[entityId];

      hass.states = {
        ...hass.states,
        [entityId]: mockEntityState(
          entityId,
          state,
          attributes ?? current?.attributes ?? {},
        ),
      };
    },
  };

  return hass;
}

export function createHouseHass(): MockHass {
  return createMockHass({
    states: [
      mockEntityState('sun.sun', 'above_horizon', {
        elevation: 30,
        azimuth: 180,
      }),
      mockLight('light.kitchen_ceiling', { on: true, brightness: 178 }),
      mockLight('light.kitchen_strip', {
        on: true,
        brightness: 90,
        rgb: [255, 110, 168],
      }),
      mockLight('light.bedroom_ceiling', { on: false }),
      mockLight('light.hall_ceiling', { unavailable: true }),
      mockBinarySensor('binary_sensor.front_door', 'door', true),
      mockBinarySensor('binary_sensor.kitchen_window', 'window', false),
      mockBinarySensor('binary_sensor.kitchen_motion', 'motion', true),
      mockCover('cover.garage', 60),
      mockSwitch('switch.garden_fountain', false),
      mockLock('lock.front_door', 'locked'),
      mockClimate('climate.living_room_ac', {
        mode: 'cool',
        currentTemperature: 24.5,
        targetTemperature: 21,
        hvacAction: 'cooling',
      }),
      mockClimate('climate.bedroom_radiator', {
        mode: 'heat',
        currentTemperature: 19,
        targetTemperature: 21.5,
        hvacAction: 'idle',
      }),
      mockSensor('sensor.kitchen_temperature', 'temperature', 21.4, '°C'),
      mockSensor('sensor.kitchen_humidity', 'humidity', 47, '%'),
      mockSensor('sensor.bedroom_thermometer', 'temperature', 18.9, '°C'),
      mockSensor('sensor.kitchen_power', 'power', 120, 'W'),
    ],
    entities: [
      { entity_id: 'light.kitchen_ceiling', area_id: 'kitchen' },
      { entity_id: 'light.kitchen_strip', device_id: 'device-kitchen-strip' },
      { entity_id: 'light.bedroom_ceiling', area_id: 'bedroom' },
      { entity_id: 'light.hall_ceiling', area_id: 'hall' },
      { entity_id: 'binary_sensor.front_door', area_id: 'hall' },
      { entity_id: 'binary_sensor.kitchen_window', area_id: 'kitchen' },
      { entity_id: 'binary_sensor.kitchen_motion', area_id: 'kitchen' },
      { entity_id: 'cover.garage', area_id: 'garage' },
      { entity_id: 'climate.living_room_ac', area_id: 'living_room' },
      { entity_id: 'climate.bedroom_radiator', area_id: 'bedroom' },
      { entity_id: 'sensor.kitchen_temperature', area_id: 'kitchen' },
      { entity_id: 'sensor.kitchen_humidity', area_id: 'kitchen' },
      { entity_id: 'sensor.bedroom_thermometer', area_id: 'bedroom' },
      { entity_id: 'sensor.kitchen_power', area_id: 'kitchen' },
    ],
    devices: [{ id: 'device-kitchen-strip', area_id: 'kitchen' }],
    areas: [
      { area_id: 'kitchen', name: 'Kitchen', floor_id: 'ground' },
      { area_id: 'bedroom', name: 'Bedroom', floor_id: 'first' },
      { area_id: 'hall', name: 'Hall', floor_id: 'ground' },
      { area_id: 'garage', name: 'Garage', floor_id: 'ground' },
      { area_id: 'living_room', name: 'Living room', floor_id: 'ground' },
    ],
  });
}

function friendlyName(entityId: string): string {
  const object = entityId.split('.')[1] ?? entityId;
  const words = object.replace(/_/g, ' ');

  return words.charAt(0).toUpperCase() + words.slice(1);
}

function keyBy<TItem>(
  items: TItem[],
  key: (item: TItem) => string,
): Record<string, TItem> {
  return Object.fromEntries(items.map((item) => [key(item), item]));
}
