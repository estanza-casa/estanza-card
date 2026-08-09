import type {
  EstanzaCardConfig,
  RegistryIds,
  SceneBinding,
} from './bindings.js';
import type { HassEntityState, HomeAssistant } from './hass-state.js';

export const REGISTRY_GAP_MS = 5_000;

export const REGISTRY_RETRY_MS = 5 * 60_000;

export const registryListCall = 'config/entity_registry/list';

export const registryStatuses = ['idle', 'ready', 'failed'] as const;

export type RegistryStatus = (typeof registryStatuses)[number];

export type EntityRegistry = {
  status: RegistryStatus;
  loading: boolean;
  fetchedAt: number;
  askedFor: ReadonlySet<string>;
  entityIdOf: ReadonlyMap<string, string>;
  registryIdOf: ReadonlyMap<string, string>;
};

export type EntityChanges = ReadonlyMap<string, string | null>;

export type EntityRename = { from: string; to: string };

type EntityRewrite = (entityId: string) => string | null;

export function emptyRegistry(): EntityRegistry {
  return {
    status: 'idle',
    loading: false,
    fetchedAt: Number.NEGATIVE_INFINITY,
    askedFor: new Set(),
    entityIdOf: new Map(),
    registryIdOf: new Map(),
  };
}

export function registryFromEntries(
  entries: unknown,
  fetchedAt: number,
  askedFor: ReadonlySet<string>,
): EntityRegistry | null {
  if (!Array.isArray(entries)) return null;

  const entityIdOf = new Map<string, string>();
  const registryIdOf = new Map<string, string>();

  for (const entry of entries as unknown[]) {
    const id = readField(entry, 'id');
    const entityId = readField(entry, 'entity_id');

    if (!id || !entityId) continue;

    entityIdOf.set(id, entityId);
    registryIdOf.set(entityId, id);
  }

  return {
    status: 'ready',
    loading: false,
    fetchedAt,
    askedFor,
    entityIdOf,
    registryIdOf,
  };
}

export function configEntityIds(config: EstanzaCardConfig): string[] {
  const named = config.bindings.flatMap((binding) => [
    binding.entity_id,
    ...(binding.entity_ids ?? []),
    binding.temperature_entity_id,
    binding.humidity_entity_id,
  ]);

  return [...new Set(named.filter((id): id is string => Boolean(id)))];
}

export function resolveEntityId(
  entityId: string,
  config: EstanzaCardConfig,
  states: Record<string, HassEntityState>,
  registry: EntityRegistry,
): string | null {
  if (Object.hasOwn(states, entityId)) return entityId;
  if (registry.status !== 'ready') return entityId;

  const stored = config.registry_ids?.[entityId];
  const current = stored ? registry.entityIdOf.get(stored) : undefined;

  if (current) return current;
  if (stored) return null;

  return registry.registryIdOf.has(entityId) ? entityId : null;
}

export function entityChanges(
  config: EstanzaCardConfig,
  states: Record<string, HassEntityState>,
  registry: EntityRegistry,
): EntityChanges {
  const changes = new Map<string, string | null>();

  for (const entityId of configEntityIds(config)) {
    const resolved = resolveEntityId(entityId, config, states, registry);

    if (resolved !== entityId) changes.set(entityId, resolved);
  }

  return changes;
}

export function renamesOf(changes: EntityChanges): EntityRename[] {
  return [...changes].flatMap(([from, to]) => (to ? [{ from, to }] : []));
}

export function unresolvedOf(changes: EntityChanges): string[] {
  return [...changes].flatMap(([from, to]) => (to ? [] : [from]));
}

export function unsettledLinks(
  config: EstanzaCardConfig,
  states: Record<string, HassEntityState>,
  registry: EntityRegistry,
): string[] {
  return configEntityIds(config).flatMap((entityId) => {
    const resolved = resolveEntityId(entityId, config, states, registry);

    if (resolved && Object.hasOwn(states, resolved)) return [];

    return [`${entityId}>${resolved ?? ''}`];
  });
}

export function registryDueIn(
  registry: EntityRegistry,
  unsettled: string[],
  now: number,
): number | null {
  if (registry.loading) return null;

  const gap = Math.max(0, registry.fetchedAt + REGISTRY_GAP_MS - now);

  if (registry.status === 'idle') return gap;
  if (unsettled.some((link) => !registry.askedFor.has(link))) {
    return gap;
  }
  if (unsettled.length === 0) return null;

  return Math.max(0, registry.fetchedAt + REGISTRY_RETRY_MS - now);
}

export function refreshRegistry(
  registry: EntityRegistry,
  hass: HomeAssistant,
  unsettled: string[],
  now: number,
  apply: (next: EntityRegistry) => void,
): EntityRegistry {
  const callWS = hass.callWS;

  if (!callWS || registryDueIn(registry, unsettled, now) !== 0) {
    return registry;
  }

  const asking: EntityRegistry = {
    ...registry,
    loading: true,
    fetchedAt: now,
    askedFor: new Set(unsettled),
  };
  const failed: EntityRegistry = {
    ...asking,
    loading: false,
    status: registry.status === 'ready' ? 'ready' : 'failed',
  };

  Promise.resolve()
    .then(() => callWS({ type: registryListCall }))
    .then(
      (entries) =>
        apply(registryFromEntries(entries, now, asking.askedFor) ?? failed),
      () => apply(failed),
    );

  return asking;
}

export function rewriteConfig(
  config: EstanzaCardConfig,
  rewrite: EntityRewrite,
): EstanzaCardConfig {
  return {
    ...config,
    bindings: config.bindings.flatMap((binding) => {
      const rewritten = rewriteBinding(binding, rewrite);

      return rewritten ? [rewritten] : [];
    }),
  };
}

export function applyChanges(
  config: EstanzaCardConfig,
  changes: EntityChanges,
): EstanzaCardConfig {
  if (changes.size === 0) return config;

  return rewriteConfig(config, (entityId) =>
    changes.has(entityId) ? (changes.get(entityId) ?? null) : entityId,
  );
}

export function registryIdsFor(
  config: EstanzaCardConfig,
  registry: EntityRegistry,
): RegistryIds | undefined {
  const ids: RegistryIds = {};

  for (const entityId of configEntityIds(config).sort()) {
    const id =
      registry.registryIdOf.get(entityId) ?? config.registry_ids?.[entityId];

    if (id) ids[entityId] = id;
  }

  return Object.keys(ids).length > 0 ? ids : undefined;
}

function rewriteBinding(
  binding: SceneBinding,
  rewrite: EntityRewrite,
): SceneBinding | null {
  const rewritten: SceneBinding = { scope: binding.scope };
  const entityIds = [
    ...new Set(
      [binding.entity_id, ...(binding.entity_ids ?? [])]
        .filter((id): id is string => Boolean(id))
        .map(rewrite)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const temperature = binding.temperature_entity_id
    ? rewrite(binding.temperature_entity_id)
    : null;
  const humidity = binding.humidity_entity_id
    ? rewrite(binding.humidity_entity_id)
    : null;

  if (binding.area_id) rewritten.area_id = binding.area_id;
  if (entityIds.length === 1) rewritten.entity_id = entityIds[0];
  if (entityIds.length > 1) rewritten.entity_ids = entityIds;
  if (temperature) rewritten.temperature_entity_id = temperature;
  if (humidity) rewritten.humidity_entity_id = humidity;
  if (binding.tap_action) rewritten.tap_action = binding.tap_action;
  if (binding.hold_action) rewritten.hold_action = binding.hold_action;

  const bound =
    rewritten.area_id ?? entityIds[0] ?? temperature ?? humidity ?? null;

  return bound ? rewritten : null;
}

function readField(entry: unknown, field: string): string | null {
  if (typeof entry !== 'object' || entry === null) return null;

  const value = (entry as Record<string, unknown>)[field];

  return typeof value === 'string' && value.length > 0 ? value : null;
}
