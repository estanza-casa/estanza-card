import { LIGHT_COLORS, type LightColor } from '@estanza/plan-engine/document';

import {
  bindingEntityIds,
  groupBindingsByScope,
  type SceneBinding,
  type SceneScope,
  type SceneScopeType,
} from './bindings.js';
import type { SceneLightOverlay, SceneOverlay } from './scene-view.js';

export type HassEntityState = {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
};

export type HassEntityRegistryEntry = {
  entity_id: string;
  name?: string | null;
  device_id?: string | null;
  area_id?: string | null;
  platform?: string;
  hidden?: boolean;
  entity_category?: 'config' | 'diagnostic' | null;
};

export type HassDeviceRegistryEntry = {
  id: string;
  name?: string | null;
  name_by_user?: string | null;
  area_id?: string | null;
};

export type HassAreaRegistryEntry = {
  area_id: string;
  name: string;
  aliases?: string[];
  floor_id?: string | null;
  temperature_entity_id?: string | null;
  humidity_entity_id?: string | null;
};

export type HassUnitSystem = {
  temperature?: string;
};

export type HassConfig = {
  unit_system?: HassUnitSystem;
  latitude?: number;
  longitude?: number;
};

export type HassThemes = {
  darkMode?: boolean;
};

export type HomeAssistant = {
  config?: HassConfig;
  themes?: HassThemes;
  states: Record<string, HassEntityState>;
  entities: Record<string, HassEntityRegistryEntry>;
  devices: Record<string, HassDeviceRegistryEntry>;
  areas: Record<string, HassAreaRegistryEntry>;
  language: string;
  hassUrl?: (path?: string) => string;
  callWS?: (message: { type: string }) => Promise<unknown>;
  formatEntityState?: (state: HassEntityState) => string;
  callService: (
    domain: string,
    service: string,
    data?: Record<string, unknown>,
  ) => Promise<void>;
};

export const unavailableStateValues = ['unavailable', 'unknown'] as const;

export const doorDeviceClasses = [
  'door',
  'garage_door',
  'opening',
  'garage',
  'gate',
] as const;

export const windowDeviceClasses = ['window'] as const;

export const occupancyDeviceClasses = [
  'occupancy',
  'motion',
  'presence',
] as const;

export const temperatureDeviceClass = 'temperature';

export const humidityDeviceClass = 'humidity';

export const temperatureUnits = ['°C', '°F', 'K'] as const;

export const humidityUnits = ['%'] as const;

export type LightColorPreset = {
  name: string;
  hex: LightColor;
  kelvin: number;
};

export const lightColorPresets: LightColorPreset[] = LIGHT_COLORS.flatMap(
  ({ name, hex, kelvin }) =>
    kelvin === undefined ? [] : [{ name, hex, kelvin }],
);

export const bindingStatuses = [
  'live',
  'unavailable',
  'missing',
  'unbound',
] as const;

export type BindingStatus = (typeof bindingStatuses)[number];

export type LightReading = {
  kind: 'light';
  entityId: string;
  on: boolean;
  brightness: number | null;
  color: string | null;
  kelvin: number | null;
};

export type OpeningReading = {
  kind: 'opening';
  entityId: string;
  open: number;
};

export type ClimateReading = {
  kind: 'climate';
  entityId: string;
  currentTemperature: number | null;
  targetTemperature: number | null;
  hvacMode: string | null;
  hvacAction: string | null;
  heating: boolean;
  cooling: boolean;
  unit: string | null;
};

export type AreaReading = {
  kind: 'area';
  areaId: string | null;
  areaName: string | null;
  temperature: number | null;
  temperatureEntityId: string | null;
  temperatureUnit: string | null;
  humidity: number | null;
  humidityEntityId: string | null;
};

export type ScopeReading =
  LightReading | OpeningReading | ClimateReading | AreaReading;

export type ScopeState = {
  scope: SceneScope;
  entityIds: string[];
  states: HassEntityState[];
  status: BindingStatus;
  unavailable: boolean;
  reading: ScopeReading | null;
};

export type ScopeStateMap = Record<string, ScopeState>;

export function entityDomain(entityId: string): string {
  return entityId.split('.')[0] ?? '';
}

export function readEntityState(
  hass: HomeAssistant,
  entityId: string,
): HassEntityState | undefined {
  return lookup(hass.states, entityId);
}

export function isUnavailable(state: HassEntityState): boolean {
  return (unavailableStateValues as readonly string[]).includes(state.state);
}

export function deviceClassOf(state: HassEntityState): string | null {
  return stringAttribute(state, 'device_class');
}

export function measures(
  state: HassEntityState,
  deviceClass: string,
  units: readonly string[],
): boolean {
  const unit = stringAttribute(state, 'unit_of_measurement');

  return (
    entityDomain(state.entity_id) === 'sensor' &&
    (deviceClassOf(state) ?? deviceClass) === deviceClass &&
    unit !== null &&
    units.includes(unit)
  );
}

export function readsTemperatureOnly(scopeState: ScopeState): boolean {
  const { entityIds, states } = scopeState;

  return (
    entityIds.length > 0 &&
    states.length === entityIds.length &&
    states.every(
      (state) =>
        entityDomain(state.entity_id) === 'climate' ||
        measures(state, temperatureDeviceClass, temperatureUnits),
    )
  );
}

export function areaIdOfEntity(
  hass: HomeAssistant,
  entry: HassEntityRegistryEntry,
): string | null {
  if (entry.area_id) return entry.area_id;
  if (!entry.device_id) return null;

  return hass.devices[entry.device_id]?.area_id ?? null;
}

export function entityIdsInArea(hass: HomeAssistant, areaId: string): string[] {
  return Object.values(hass.entities)
    .filter((entry) => areaIdOfEntity(hass, entry) === areaId)
    .map((entry) => entry.entity_id);
}

export function resolveBindingEntityIds(
  hass: HomeAssistant,
  binding: SceneBinding,
): string[] {
  const direct = bindingEntityIds(binding);
  const fromArea = binding.area_id
    ? entityIdsInArea(hass, binding.area_id)
    : [];

  return [...new Set([...direct, ...fromArea])];
}

export function rgbToHex(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 3) return null;

  const channels: number[] = [];

  for (const raw of value.slice(0, 3)) {
    const channel = toChannel(raw);

    if (channel === null) return null;

    channels.push(channel);
  }

  return `#${channels.map(hexPair).join('')}`;
}

export function kelvinToPresetHex(kelvin: number): string | null {
  if (!Number.isFinite(kelvin)) return null;

  let closest = lightColorPresets[0];

  for (const preset of lightColorPresets) {
    if (Math.abs(preset.kelvin - kelvin) < Math.abs(closest.kelvin - kelvin)) {
      closest = preset;
    }
  }

  return closest.hex;
}

export function readLight(states: HassEntityState[]): LightReading | null {
  const state = pickState(states, ['light', 'switch']);

  if (!state) return null;

  const brightness = numberAttribute(state, 'brightness');
  const kelvin = numberAttribute(state, 'color_temp_kelvin');
  const rgb = rgbToHex(state.attributes.rgb_color);

  return {
    kind: 'light',
    entityId: state.entity_id,
    on: state.state === 'on',
    brightness: brightness === null ? null : clamp01(brightness / 255),
    color: rgb ?? (kelvin === null ? null : kelvinToPresetHex(kelvin)),
    kelvin,
  };
}

export function isOccupied(states: HassEntityState[]): boolean {
  return states.some(
    (state) =>
      entityDomain(state.entity_id) === 'binary_sensor' &&
      state.state === 'on' &&
      (occupancyDeviceClasses as readonly (string | null)[]).includes(
        deviceClassOf(state),
      ),
  );
}

export function readOpening(
  states: HassEntityState[],
  scopeType: 'door' | 'window',
): OpeningReading | null {
  const classes =
    scopeType === 'window' ? windowDeviceClasses : doorDeviceClasses;
  const state = pickState(states, ['binary_sensor', 'cover'], classes);

  if (!state) return null;

  return {
    kind: 'opening',
    entityId: state.entity_id,
    open:
      entityDomain(state.entity_id) === 'cover'
        ? coverOpenFraction(state)
        : Number(state.state === 'on'),
  };
}

export function readClimate(states: HassEntityState[]): ClimateReading | null {
  const state = pickState(
    states.filter(
      (candidate) =>
        entityDomain(candidate.entity_id) === 'climate' ||
        measures(candidate, temperatureDeviceClass, temperatureUnits),
    ),
    ['climate', 'sensor'],
    [temperatureDeviceClass],
  );

  if (!state) return null;

  const unit = stringAttribute(state, 'unit_of_measurement');

  if (entityDomain(state.entity_id) !== 'climate') {
    return {
      kind: 'climate',
      entityId: state.entity_id,
      currentTemperature: numberValue(state),
      targetTemperature: null,
      hvacMode: null,
      hvacAction: null,
      heating: false,
      cooling: false,
      unit,
    };
  }

  const hvacAction = stringAttribute(state, 'hvac_action');
  const hvacMode = state.state;

  return {
    kind: 'climate',
    entityId: state.entity_id,
    currentTemperature: numberAttribute(state, 'current_temperature'),
    targetTemperature:
      numberAttribute(state, 'temperature') ??
      numberAttribute(state, 'target_temperature'),
    hvacMode,
    hvacAction,
    heating: hvacAction ? hvacAction === 'heating' : hvacMode === 'heat',
    cooling: hvacAction ? hvacAction === 'cooling' : hvacMode === 'cool',
    unit,
  };
}

export function readArea(
  hass: HomeAssistant,
  bindings: SceneBinding[],
): AreaReading {
  const areaId = firstDefined(bindings.map((binding) => binding.area_id));
  const area = areaId ? (lookup(hass.areas, areaId) ?? null) : null;
  const listed = bindings.flatMap(bindingEntityIds);
  const inArea = areaId ? entityIdsInArea(hass, areaId) : [];

  const temperatureEntityId =
    firstDefined(bindings.map((binding) => binding.temperature_entity_id)) ??
    findSensor(hass, listed, temperatureDeviceClass, temperatureUnits) ??
    area?.temperature_entity_id ??
    findSensor(hass, inArea, temperatureDeviceClass, temperatureUnits);

  const humidityEntityId =
    firstDefined(bindings.map((binding) => binding.humidity_entity_id)) ??
    findSensor(hass, listed, humidityDeviceClass, humidityUnits) ??
    area?.humidity_entity_id ??
    findSensor(hass, inArea, humidityDeviceClass, humidityUnits);

  const temperature = temperatureEntityId
    ? readEntityState(hass, temperatureEntityId)
    : undefined;
  const humidity = humidityEntityId
    ? readEntityState(hass, humidityEntityId)
    : undefined;

  return {
    kind: 'area',
    areaId,
    areaName: area?.name ?? null,
    temperature: temperature ? numberValue(temperature) : null,
    temperatureEntityId,
    temperatureUnit: temperature
      ? stringAttribute(temperature, 'unit_of_measurement')
      : null,
    humidity: humidity ? numberValue(humidity) : null,
    humidityEntityId,
  };
}

export function mapScopeStates(
  hass: HomeAssistant,
  bindings: SceneBinding[],
): ScopeStateMap {
  const map: ScopeStateMap = {};

  for (const [key, group] of groupBindingsByScope(bindings)) {
    const scope = group[0].scope;
    const entityIds = [
      ...new Set(
        group.flatMap((binding) => resolveBindingEntityIds(hass, binding)),
      ),
    ];

    const states = entityIds
      .map((entityId) => readEntityState(hass, entityId))
      .filter((state): state is HassEntityState => state !== undefined);
    const usable = states.filter((state) => !isUnavailable(state));

    const status = scopeStatus(hass, group, entityIds, states, usable);

    map[key] = {
      scope,
      entityIds,
      states,
      status,
      unavailable: status === 'unavailable',
      reading:
        status === 'live' ? readScope(hass, scope.type, group, usable) : null,
    };
  }

  return map;
}

export function sceneOverlayOf(scopeStates: ScopeStateMap): SceneOverlay {
  const overlay: SceneOverlay = {
    lights: {},
    rooms: {},
    doors: {},
    windows: {},
  };

  for (const scopeState of Object.values(scopeStates)) {
    const { type, id } = scopeState.scope;

    if (type === 'light') overlay.lights[id] = lightOverlay(scopeState);
    if (type === 'room') overlay.rooms[id] = lightOverlay(scopeState);
    if (type === 'door') overlay.doors[id] = openFraction(scopeState);
    if (type === 'window') overlay.windows[id] = openFraction(scopeState);
  }

  return overlay;
}

export function lightOverlay(scopeState: ScopeState): SceneLightOverlay {
  const usable = scopeState.states.filter((state) => !isUnavailable(state));
  const lit = usable.filter((state) => state.state === 'on');
  const reading = readLight(lit) ?? readLight(usable);

  if (!reading) return { on: false, brightness: null, color: null };

  return {
    on: reading.on,
    brightness: reading.brightness,
    color: reading.color,
  };
}

function openFraction(scopeState: ScopeState): number {
  const reading = scopeState.reading;

  return reading?.kind === 'opening' ? reading.open : 0;
}

function readScope(
  hass: HomeAssistant,
  scopeType: SceneScopeType,
  bindings: SceneBinding[],
  states: HassEntityState[],
): ScopeReading | null {
  if (scopeType === 'light') return readLight(states);
  if (scopeType === 'door' || scopeType === 'window') {
    return readOpening(states, scopeType);
  }
  if (scopeType === 'prop') return readClimate(states);

  return readArea(hass, bindings);
}

function scopeStatus(
  hass: HomeAssistant,
  bindings: SceneBinding[],
  entityIds: string[],
  states: HassEntityState[],
  usable: HassEntityState[],
): BindingStatus {
  const areaIds = bindings
    .map((binding) => binding.area_id)
    .filter((areaId): areaId is string => Boolean(areaId));

  if (entityIds.length === 0 && areaIds.length === 0) return 'unbound';

  const knownArea = areaIds.some(
    (areaId) => lookup(hass.areas, areaId) !== undefined,
  );

  if (states.length === 0) return knownArea ? 'live' : 'missing';
  if (usable.length === 0) return 'unavailable';

  return 'live';
}

function pickState(
  states: HassEntityState[],
  domains: readonly string[],
  deviceClasses: readonly string[] = [],
): HassEntityState | undefined {
  for (const domain of domains) {
    const inDomain = states.filter(
      (state) => entityDomain(state.entity_id) === domain,
    );
    const preferred = inDomain.find((state) => {
      const deviceClass = deviceClassOf(state);

      return deviceClass !== null && deviceClasses.includes(deviceClass);
    });

    if (preferred) return preferred;
    if (inDomain[0]) return inDomain[0];
  }

  return undefined;
}

function findSensor(
  hass: HomeAssistant,
  entityIds: string[],
  deviceClass: string,
  units: readonly string[],
): string | null {
  const qualified = entityIds
    .map((entityId) => readEntityState(hass, entityId))
    .filter(
      (state): state is HassEntityState =>
        state !== undefined && measures(state, deviceClass, units),
    );

  const declared = qualified.find(
    (state) => deviceClassOf(state) === deviceClass,
  );

  return (declared ?? qualified[0])?.entity_id ?? null;
}

function coverOpenFraction(state: HassEntityState): number {
  const position = numberAttribute(state, 'current_position');

  if (position !== null) return clamp01(position / 100);

  return Number(state.state === 'open' || state.state === 'opening');
}

function numberValue(state: HassEntityState): number | null {
  if (isUnavailable(state)) return null;

  const value = Number(state.state);

  return Number.isFinite(value) ? value : null;
}

function numberAttribute(
  state: HassEntityState,
  attribute: string,
): number | null {
  const value = state.attributes[attribute];

  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  return value;
}

function stringAttribute(
  state: HassEntityState,
  attribute: string,
): string | null {
  const value = state.attributes[attribute];

  return typeof value === 'string' && value.length > 0 ? value : null;
}

function lookup<TValue>(
  record: Record<string, TValue>,
  key: string,
): TValue | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function firstDefined(values: (string | undefined)[]): string | null {
  return values.find((value): value is string => Boolean(value)) ?? null;
}

function toChannel(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;

  return Math.min(255, Math.max(0, Math.round(value)));
}

function hexPair(channel: number): string {
  return channel.toString(16).padStart(2, '0');
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
