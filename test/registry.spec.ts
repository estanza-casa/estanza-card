import { describe, expect, it, vi } from 'vitest';

import { readAlerts } from '../src/alerts.js';
import {
  cardType,
  type EstanzaCardConfig,
  parseCardConfig,
} from '../src/bindings.js';
import { mapScopeStates } from '../src/hass-state.js';
import {
  applyChanges,
  emptyRegistry,
  entityChanges,
  type EntityRegistry,
  refreshRegistry,
  REGISTRY_GAP_MS,
  REGISTRY_RETRY_MS,
  registryDueIn,
  registryFromEntries,
  registryIdsFor,
  renamesOf,
  resolveEntityId,
  unresolvedOf,
  unsettledLinks,
} from '../src/registry.js';
import {
  createMockHass,
  mockBinarySensor,
  mockClimate,
  mockCover,
  type MockHass,
  mockLight,
  mockSensor,
} from './mock-hass.js';

const renames: Record<string, string> = {
  'light.kitchen': 'light.kitchen_ceiling',
  'binary_sensor.kitchen_motion': 'binary_sensor.kitchen_presence',
  'binary_sensor.kitchen_leak': 'binary_sensor.under_sink_leak',
  'sensor.kitchen_temp': 'sensor.kitchen_temperature',
  'sensor.kitchen_hum': 'sensor.kitchen_humidity',
  'binary_sensor.front_door': 'binary_sensor.entrance_door',
  'cover.garage': 'cover.garage_door',
  'binary_sensor.kitchen_window': 'binary_sensor.kitchen_sash',
  'climate.hall': 'climate.hall_thermostat',
};

function registryIdOf(entityId: string): string {
  return `reg-${entityId.replace(/\W/g, '-')}`;
}

function boundConfig(withIds = true): EstanzaCardConfig {
  return parseCardConfig({
    type: cardType,
    bindings: [
      {
        scope: { type: 'light', id: 'kitchen-light' },
        entity_id: 'light.kitchen',
      },
      {
        scope: { type: 'room', id: 'kitchen' },
        entity_ids: [
          'binary_sensor.kitchen_motion',
          'binary_sensor.kitchen_leak',
        ],
        temperature_entity_id: 'sensor.kitchen_temp',
        humidity_entity_id: 'sensor.kitchen_hum',
      },
      {
        scope: { type: 'door', id: 'd1' },
        entity_id: 'binary_sensor.front_door',
      },
      { scope: { type: 'door', id: 'd7' }, entity_id: 'cover.garage' },
      {
        scope: { type: 'window', id: 'w1' },
        entity_id: 'binary_sensor.kitchen_window',
      },
      {
        scope: { type: 'prop', id: 'hall-thermostat' },
        entity_id: 'climate.hall',
      },
    ],
    registry_ids: withIds
      ? Object.fromEntries(
          Object.keys(renames).map((entityId) => [
            entityId,
            registryIdOf(entityId),
          ]),
        )
      : undefined,
  });
}

function renamedHass(): MockHass {
  const hass = createMockHass({
    states: [
      mockLight('light.kitchen_ceiling', { on: true, brightness: 255 }),
      mockBinarySensor('binary_sensor.kitchen_presence', 'occupancy', true),
      mockBinarySensor('binary_sensor.under_sink_leak', 'moisture', true),
      mockSensor('sensor.kitchen_temperature', 'temperature', 22.5, '°C'),
      mockSensor('sensor.kitchen_humidity', 'humidity', 51, '%'),
      mockBinarySensor('binary_sensor.entrance_door', 'door', true),
      mockCover('cover.garage_door', 40),
      mockBinarySensor('binary_sensor.kitchen_sash', 'window', true),
      mockClimate('climate.hall_thermostat', { currentTemperature: 20 }),
    ],
  });

  hass.callWS = vi.fn().mockResolvedValue(registryEntries());

  return hass;
}

function registryEntries(): { id: string; entity_id: string }[] {
  return Object.entries(renames).map(([from, to]) => ({
    id: registryIdOf(from),
    entity_id: to,
  }));
}

function readyRegistry(
  entries = registryEntries(),
  fetchedAt = 0,
): EntityRegistry {
  const registry = registryFromEntries(entries, fetchedAt, new Set());

  if (!registry) throw new Error('registry entries did not parse');

  return registry;
}

async function fetched(
  hass: MockHass,
  config: EstanzaCardConfig,
  now = 0,
): Promise<EntityRegistry> {
  let next: EntityRegistry | null = null;
  const unsettled = unsettledLinks(config, hass.states, emptyRegistry());

  refreshRegistry(emptyRegistry(), hass, unsettled, now, (registry) => {
    next = registry;
  });

  await vi.waitFor(() => {
    expect(next).not.toBeNull();
  });

  return next as unknown as EntityRegistry;
}

describe('resolving a binding by its stable registry id', () => {
  it('follows a renamed entity to its current entity id', () => {
    const hass = renamedHass();

    expect(
      resolveEntityId(
        'light.kitchen',
        boundConfig(),
        hass.states,
        readyRegistry(),
      ),
    ).toBe('light.kitchen_ceiling');
  });

  it('keeps what a tap and a hold do when it rewrites a renamed entity', () => {
    const config = parseCardConfig({
      type: cardType,
      bindings: [
        {
          scope: { type: 'light', id: 'kitchen' },
          entity_id: 'light.kitchen',
          tap_action: { action: 'none' },
          hold_action: { action: 'more-info' },
        },
      ],
    });
    const [binding] = applyChanges(
      config,
      new Map([['light.kitchen', 'light.kitchen_ceiling']]),
    ).bindings;

    expect(binding).toEqual({
      scope: { type: 'light', id: 'kitchen' },
      entity_id: 'light.kitchen_ceiling',
      tap_action: { action: 'none' },
      hold_action: { action: 'more-info' },
    });
  });

  it('keeps an entity id that still exists without asking the registry', () => {
    const hass = createMockHass({ states: [mockLight('light.kitchen')] });

    expect(
      resolveEntityId(
        'light.kitchen',
        boundConfig(),
        hass.states,
        emptyRegistry(),
      ),
    ).toBe('light.kitchen');
  });

  it('keeps the stored id while the registry has not answered yet', () => {
    const hass = renamedHass();

    expect(
      resolveEntityId(
        'light.kitchen',
        boundConfig(),
        hass.states,
        emptyRegistry(),
      ),
    ).toBe('light.kitchen');
  });

  it('reports a binding whose stored registry id is gone as unresolved', () => {
    const hass = renamedHass();
    const registry = readyRegistry(
      registryEntries().filter(
        (entry) => entry.id !== registryIdOf('light.kitchen'),
      ),
    );
    const changes = entityChanges(boundConfig(), hass.states, registry);

    expect(unresolvedOf(changes)).toEqual(['light.kitchen']);
    expect(renamesOf(changes)).toContainEqual({
      from: 'binary_sensor.front_door',
      to: 'binary_sensor.entrance_door',
    });
  });

  it('skips a deleted entity without dropping the rest of its binding', () => {
    const hass = renamedHass();
    const registry = readyRegistry(
      registryEntries().filter(
        (entry) => entry.id !== registryIdOf('binary_sensor.kitchen_leak'),
      ),
    );
    const live = applyChanges(
      boundConfig(),
      entityChanges(boundConfig(), hass.states, registry),
    );
    const kitchen = live.bindings.find(
      (binding) => binding.scope.id === 'kitchen',
    );

    expect(kitchen?.entity_id).toBe('binary_sensor.kitchen_presence');
    expect(kitchen?.entity_ids).toBeUndefined();
    expect(() => mapScopeStates(hass, live.bindings)).not.toThrow();
  });

  it('drops a binding whose only entity was deleted', () => {
    const hass = renamedHass();
    const registry = readyRegistry(
      registryEntries().filter(
        (entry) => entry.id !== registryIdOf('light.kitchen'),
      ),
    );
    const live = applyChanges(
      boundConfig(),
      entityChanges(boundConfig(), hass.states, registry),
    );

    expect(live.bindings.map((binding) => binding.scope.id)).not.toContain(
      'kitchen-light',
    );
  });
});

describe('an old config without registry ids', () => {
  it('parses and binds exactly as before', () => {
    const hass = createMockHass({ states: [mockLight('light.kitchen')] });
    const config = boundConfig(false);
    const states = mapScopeStates(hass, config.bindings);

    expect(config.registry_ids).toBeUndefined();
    expect(states['light:kitchen-light'].status).toBe('live');
    expect(
      entityChanges(config, hass.states, readyRegistry()).has('light.kitchen'),
    ).toBe(false);
  });

  it('reads an entity that vanished from the registry as unresolved, not renamed', () => {
    const hass = renamedHass();
    const changes = entityChanges(
      boundConfig(false),
      hass.states,
      readyRegistry(),
    );

    expect(renamesOf(changes)).toEqual([]);
    expect(unresolvedOf(changes)).toContain('light.kitchen');
  });

  it('gains the registry ids of every entity it links', () => {
    const registry = readyRegistry([
      { id: 'abc123', entity_id: 'light.kitchen' },
      { id: 'def456', entity_id: 'cover.garage' },
    ]);

    expect(registryIdsFor(boundConfig(false), registry)).toEqual({
      'light.kitchen': 'abc123',
      'cover.garage': 'def456',
    });
  });

  it('keeps a stored id the registry no longer knows', () => {
    expect(registryIdsFor(boundConfig(), emptyRegistry())).toEqual(
      boundConfig().registry_ids,
    );
  });

  it('carries no registry ids when nothing is known', () => {
    expect(registryIdsFor(boundConfig(false), emptyRegistry())).toBeUndefined();
  });
});

describe('registry_ids in the card config', () => {
  it('accepts a map of entity ids to registry ids', () => {
    const config = parseCardConfig({
      type: cardType,
      registry_ids: { 'light.kitchen': 'abc123' },
    });

    expect(config.registry_ids).toEqual({ 'light.kitchen': 'abc123' });
  });

  it('rejects a key that is not an entity id', () => {
    expect(() =>
      parseCardConfig({ type: cardType, registry_ids: { kitchen: 'abc123' } }),
    ).toThrow(/is not an entity/);
  });

  it('rejects an empty registry id', () => {
    expect(() =>
      parseCardConfig({
        type: cardType,
        registry_ids: { 'light.kitchen': '' },
      }),
    ).toThrow(/registry_ids light.kitchen/);
  });

  it('rejects a list', () => {
    expect(() =>
      parseCardConfig({ type: cardType, registry_ids: ['abc123'] }),
    ).toThrow(/registry_ids must map/);
  });
});

describe('a registry that will not answer', () => {
  it('falls back to entity ids alone when the call is refused', async () => {
    const hass = renamedHass();

    hass.callWS = vi.fn().mockRejectedValue(new Error('Unauthorized'));

    const registry = await fetched(hass, boundConfig());

    expect(registry.status).toBe('failed');
    expect(registry.loading).toBe(false);
    expect(entityChanges(boundConfig(), hass.states, registry).size).toBe(0);
    expect(() => mapScopeStates(hass, boundConfig().bindings)).not.toThrow();
  });

  it('falls back when the answer is not a list', async () => {
    const hass = renamedHass();

    hass.callWS = vi.fn().mockResolvedValue({ entities: [] });

    expect((await fetched(hass, boundConfig())).status).toBe('failed');
  });

  it('falls back when the call throws before it starts', async () => {
    const hass = renamedHass();

    hass.callWS = vi.fn(() => {
      throw new Error('socket closed');
    });

    expect((await fetched(hass, boundConfig())).status).toBe('failed');
  });

  it('never asks a hass that has no websocket call', () => {
    const hass = renamedHass();
    const registry = emptyRegistry();

    delete hass.callWS;

    expect(
      refreshRegistry(registry, hass, ['light.kitchen>'], 0, () => undefined),
    ).toBe(registry);
  });

  it('keeps what it already knew when a later refresh fails', async () => {
    const hass = renamedHass();
    let next: EntityRegistry | null = null;

    hass.callWS = vi.fn().mockRejectedValue(new Error('Unauthorized'));
    refreshRegistry(
      readyRegistry(),
      hass,
      ['x>'],
      REGISTRY_GAP_MS,
      (registry) => {
        next = registry;
      },
    );

    await vi.waitFor(() => {
      expect(next).not.toBeNull();
    });

    expect((next as unknown as EntityRegistry).status).toBe('ready');
  });
});

describe('the registry refresh throttle', () => {
  it('asks straight away the first time', () => {
    expect(registryDueIn(emptyRegistry(), ['light.kitchen>'], 1000)).toBe(0);
  });

  it('does not ask while an answer is on its way', async () => {
    const hass = renamedHass();
    const asking = refreshRegistry(
      emptyRegistry(),
      hass,
      ['light.kitchen>'],
      0,
      () => undefined,
    );

    expect(asking.loading).toBe(true);
    expect(
      refreshRegistry(asking, hass, ['light.other>'], 60_000, () => undefined),
    ).toBe(asking);

    await vi.waitFor(() => {
      expect(hass.callWS).toHaveBeenCalled();
    });

    expect(hass.callWS).toHaveBeenCalledTimes(1);
    expect(hass.callWS).toHaveBeenCalledWith({
      type: 'config/entity_registry/list',
    });
  });

  it('waits out the gap before asking about a newly missing entity', () => {
    const registry = {
      ...readyRegistry(),
      fetchedAt: 10_000,
      askedFor: new Set(['light.kitchen>']),
    };

    expect(registryDueIn(registry, ['cover.garage>'], 12_000)).toBe(
      REGISTRY_GAP_MS - 2_000,
    );
    expect(
      registryDueIn(registry, ['cover.garage>'], 10_000 + REGISTRY_GAP_MS),
    ).toBe(0);
  });

  it('asks about the same missing entity again only after the retry interval', () => {
    const registry = {
      ...readyRegistry(),
      fetchedAt: 10_000,
      askedFor: new Set(['light.kitchen>']),
    };

    expect(registryDueIn(registry, ['light.kitchen>'], 20_000)).toBe(
      REGISTRY_RETRY_MS - 10_000,
    );
    expect(
      registryDueIn(registry, ['light.kitchen>'], 10_000 + REGISTRY_RETRY_MS),
    ).toBe(0);
  });

  it('asks again when a resolved entity is renamed a second time', () => {
    const hass = renamedHass();
    const registry = { ...readyRegistry(), fetchedAt: 0 };

    hass.states = {
      ...hass.states,
      'light.kitchen_island': mockLight('light.kitchen_island'),
    };
    delete hass.states['light.kitchen_ceiling'];

    const unsettled = unsettledLinks(boundConfig(), hass.states, {
      ...registry,
      askedFor: new Set(['light.kitchen>']),
    });

    expect(unsettled).toEqual(['light.kitchen>light.kitchen_ceiling']);
    expect(
      registryDueIn(
        { ...registry, askedFor: new Set(['light.kitchen>']) },
        unsettled,
        REGISTRY_GAP_MS,
      ),
    ).toBe(0);
  });

  it('has nothing to ask once every link is settled', () => {
    const hass = renamedHass();
    const registry = readyRegistry();

    expect(unsettledLinks(boundConfig(), hass.states, registry)).toEqual([]);
    expect(registryDueIn(registry, [], REGISTRY_RETRY_MS * 2)).toBeNull();
  });
});

describe('every binding kind after a rename', () => {
  async function renamedLive(): Promise<{
    hass: MockHass;
    config: EstanzaCardConfig;
  }> {
    const hass = renamedHass();
    const registry = await fetched(hass, boundConfig());

    return {
      hass,
      config: applyChanges(
        boundConfig(),
        entityChanges(boundConfig(), hass.states, registry),
      ),
    };
  }

  it('keeps a light lit', async () => {
    const { hass, config } = await renamedLive();
    const light = mapScopeStates(hass, config.bindings)['light:kitchen-light'];

    expect(light.status).toBe('live');
    expect(light.reading).toMatchObject({ kind: 'light', on: true });
    expect(light.entityIds).toEqual(['light.kitchen_ceiling']);
  });

  it('keeps a room occupied, with its temperature and humidity', async () => {
    const { hass, config } = await renamedLive();
    const room = mapScopeStates(hass, config.bindings)['room:kitchen'];

    expect(room.states.map((state) => state.entity_id)).toContain(
      'binary_sensor.kitchen_presence',
    );
    expect(room.reading).toMatchObject({
      kind: 'area',
      temperature: 22.5,
      temperatureEntityId: 'sensor.kitchen_temperature',
      humidity: 51,
      humidityEntityId: 'sensor.kitchen_humidity',
    });
  });

  it('keeps a door sensor and a cover opening their doors', async () => {
    const { hass, config } = await renamedLive();
    const states = mapScopeStates(hass, config.bindings);

    expect(states['door:d1'].reading).toMatchObject({
      kind: 'opening',
      open: 1,
    });
    expect(states['door:d7'].reading).toMatchObject({
      kind: 'opening',
      open: 0.4,
    });
  });

  it('keeps a window reading its sensor', async () => {
    const { hass, config } = await renamedLive();

    expect(
      mapScopeStates(hass, config.bindings)['window:w1'].reading,
    ).toMatchObject({
      kind: 'opening',
      entityId: 'binary_sensor.kitchen_sash',
    });
  });

  it('keeps a thermostat on its object', async () => {
    const { hass, config } = await renamedLive();

    expect(
      mapScopeStates(hass, config.bindings)['prop:hall-thermostat'].reading,
    ).toMatchObject({ kind: 'climate', currentTemperature: 20 });
  });

  it('keeps a bound leak sensor raising its alert on the room', async () => {
    const { hass, config } = await renamedLive();
    const reading = readAlerts(
      hass,
      mapScopeStates(hass, config.bindings),
      Date.parse('2026-08-18T09:30:00.000Z'),
      10 * 60 * 1000,
    );
    const leak = reading.alerts.find((alert) => alert.kind === 'leak');

    expect(leak).toMatchObject({
      entityId: 'binary_sensor.under_sink_leak',
      scope: { type: 'room', id: 'kitchen' },
      severity: 'critical',
    });
  });
  it('leaves the stored config untouched', async () => {
    const config = boundConfig();

    await renamedLive();

    expect(config.bindings[0].entity_id).toBe('light.kitchen');
  });
});
