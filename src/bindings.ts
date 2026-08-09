import type { HomeDocument } from '@estanza/plan-engine';
import { homeDocumentSchema } from '@estanza/plan-engine/document';
import { QUALITY_TIERS, type QualityTier } from '@estanza/scene/quality.js';
import { spillQualities, type SpillQuality } from '@estanza/scene/spill.js';

import { parseClock } from './tablet.js';

export const cardTag = 'estanza-card';

export const cardType = `custom:${cardTag}`;

export const defaultApiOrigin = 'https://api.estanza.casa';

export const defaultModelsOrigin = 'https://app.estanza.casa';

export const estanzaHomesUrl = 'https://app.estanza.casa/projects';

export const sceneScopeTypes = [
  'light',
  'room',
  'prop',
  'door',
  'window',
] as const;

export type SceneScopeType = (typeof sceneScopeTypes)[number];

export const interactionModes = ['control', 'none'] as const;

export type InteractionMode = (typeof interactionModes)[number];

export const nightSources = ['auto', 'day', 'night'] as const;

export type NightSource = (typeof nightSources)[number];

export const DEFAULT_NIGHT: NightSource = 'auto';

export const otherFloorsModes = ['ghosted', 'hidden'] as const;

export type OtherFloors = (typeof otherFloorsModes)[number];

export const DEFAULT_OTHER_FLOORS: OtherFloors = 'ghosted';

export const tabletModes = ['auto', 'on', 'off'] as const;

export type TabletMode = (typeof tabletModes)[number];

export const views = ['3d', '2d'] as const;

export type View = (typeof views)[number];

export type RegistryIds = Record<string, string>;

export type GridOptions = { rows?: number; columns?: number | 'full' };

export type SceneScope = {
  type: SceneScopeType;
  id: string;
};

export const triggers = ['tap', 'hold'] as const;

export type Trigger = (typeof triggers)[number];

export const plainActions = ['toggle', 'more-info', 'none'] as const;

export const performActions = [
  'cover.open_cover',
  'cover.close_cover',
  'lock.lock',
  'lock.unlock',
] as const;

export type PerformAction = (typeof performActions)[number];

export type ThingAction =
  | { action: (typeof plainActions)[number] }
  | { action: 'perform-action'; perform_action: PerformAction };

export type ThingActions = Partial<Record<Trigger, ThingAction>>;

export type SceneBinding = {
  scope: SceneScope;
  entity_id?: string;
  entity_ids?: string[];
  area_id?: string;
  temperature_entity_id?: string;
  humidity_entity_id?: string;
  tap_action?: ThingAction;
  hold_action?: ThingAction;
};

export type EstanzaCardConfig = {
  type: string;
  share_url?: string;
  share_id?: string;
  home_document?: HomeDocument;
  api_origin?: string;
  models_origin?: string;
  title?: string;
  interaction?: InteractionMode;
  spill?: SpillQuality;
  night?: NightSource;
  quality?: QualityTier;
  other_floors?: OtherFloors;
  comfort_min?: number;
  comfort_max?: number;
  temperature_tint?: boolean;
  tablet?: TabletMode;
  default_view?: View;
  idle_seconds?: number;
  late_night?: string;
  open_alert_after?: number;
  navigation_path?: string;
  grid_options?: GridOptions;
  bindings: SceneBinding[];
  registry_ids?: RegistryIds;
};

export function scopeKey(scope: SceneScope): string {
  return `${scope.type}:${scope.id}`;
}

export function bindingEntityIds(binding: SceneBinding): string[] {
  const named = [
    binding.entity_id,
    ...(binding.entity_ids ?? []),
    binding.temperature_entity_id,
    binding.humidity_entity_id,
  ];

  return [...new Set(named.filter((id): id is string => Boolean(id)))];
}

export function findBindingsForScope(
  bindings: SceneBinding[],
  scope: SceneScope,
): SceneBinding[] {
  const key = scopeKey(scope);

  return bindings.filter((binding) => scopeKey(binding.scope) === key);
}

export function actionsFor(
  bindings: SceneBinding[],
  scope: SceneScope,
): ThingActions {
  const own = findBindingsForScope(bindings, scope);
  const actions: ThingActions = {};
  const tap = own.find((binding) => binding.tap_action)?.tap_action;
  const hold = own.find((binding) => binding.hold_action)?.hold_action;

  if (tap) actions.tap = tap;
  if (hold) actions.hold = hold;

  return actions;
}

export function groupBindingsByScope(
  bindings: SceneBinding[],
): Map<string, SceneBinding[]> {
  const groups = new Map<string, SceneBinding[]>();

  for (const binding of bindings) {
    const key = scopeKey(binding.scope);
    const group = groups.get(key);

    if (group) group.push(binding);
    else groups.set(key, [binding]);
  }

  return groups;
}

export function shareDocumentEndpoint(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '');

  return `${base}/v1/integrations/home-assistant/${encodeURIComponent(token)}`;
}

export function modelsBase(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/assets/props`;
}

export function shareIdFromConfig(config: EstanzaCardConfig): string | null {
  const pasted = (config.share_id ?? config.share_url)?.trim();
  if (!pasted) return null;

  const path = pasted.split(/[?#]/)[0];
  const withoutScheme = path.replace(/^[a-z][a-z\d+.-]*:\/\//i, '');
  const segments = withoutScheme.split('/').filter(Boolean);
  const host = withoutScheme !== path || segments[0]?.includes('.');

  if (host) segments.shift();

  return segments.at(-1) ?? null;
}

export function parseCardConfig(input: unknown): EstanzaCardConfig {
  const raw = asRecord(input);

  if (!raw) throw new Error('estanza-card: configuration must be an object');

  const type = typeof raw.type === 'string' ? raw.type : cardType;
  const shareUrl = optionalString(raw.share_url, 'share_url');
  const shareId = optionalString(raw.share_id, 'share_id');

  if (shareUrl && shareId) {
    throw new Error('estanza-card: set only one of share_url or share_id');
  }

  const comfortMin = optionalNumber(raw.comfort_min, 'comfort_min');
  const comfortMax = optionalNumber(raw.comfort_max, 'comfort_max');

  if (
    comfortMin !== undefined &&
    comfortMax !== undefined &&
    comfortMin > comfortMax
  ) {
    throw new Error('estanza-card: comfort_min must not be above comfort_max');
  }

  return {
    type,
    share_url: shareUrl,
    share_id: shareId,
    home_document: parseHomeDocument(raw.home_document),
    api_origin: optionalString(raw.api_origin, 'api_origin'),
    models_origin: optionalString(raw.models_origin, 'models_origin'),
    title: optionalString(raw.title, 'title'),
    interaction: optionalChoice(
      raw.interaction,
      interactionModes,
      'interaction',
    ),
    spill: optionalChoice(raw.spill, spillQualities, 'spill'),
    night: optionalChoice(raw.night, nightSources, 'night'),
    quality: optionalChoice(raw.quality, QUALITY_TIERS, 'quality'),
    other_floors: optionalChoice(
      raw.other_floors,
      otherFloorsModes,
      'other_floors',
    ),
    comfort_min: comfortMin,
    comfort_max: comfortMax,
    temperature_tint: optionalBoolean(raw.temperature_tint, 'temperature_tint'),
    tablet: optionalChoice(onOff(raw.tablet), tabletModes, 'tablet'),
    default_view: optionalChoice(raw.default_view, views, 'default_view'),
    idle_seconds: optionalSeconds(raw.idle_seconds, 'idle_seconds'),
    late_night: optionalClock(onOff(raw.late_night), 'late_night'),
    open_alert_after: optionalSeconds(raw.open_alert_after, 'open_alert_after'),
    navigation_path: optionalString(raw.navigation_path, 'navigation_path'),
    grid_options: parseGridOptions(raw.grid_options),
    bindings: parseBindings(raw.bindings),
    registry_ids: parseRegistryIds(raw.registry_ids),
  };
}

function optionalChoice<TChoice extends string>(
  value: unknown,
  choices: readonly TChoice[],
  field: string,
): TChoice | undefined {
  if (value === undefined || value === null) return undefined;

  if (!(choices as readonly unknown[]).includes(value)) {
    throw new Error(
      `estanza-card: ${field} must be one of ${choices.join(', ')}`,
    );
  }

  return value as TChoice;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`estanza-card: ${field} must be a number`);
  }

  return value;
}

function onOff(value: unknown): unknown {
  if (value === true) return 'on';
  if (value === false) return 'off';

  return value;
}

function optionalSeconds(value: unknown, field: string): number | undefined {
  const seconds = optionalNumber(value, field);

  if (seconds !== undefined && seconds <= 0) {
    throw new Error(`estanza-card: ${field} must be above zero`);
  }

  return seconds;
}

function optionalClock(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;

  if (
    typeof value !== 'string' ||
    (value !== 'off' && parseClock(value) === null)
  ) {
    throw new Error(
      `estanza-card: ${field} must be a time such as 23:00, or off`,
    );
  }

  return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== 'boolean') {
    throw new Error(`estanza-card: ${field} must be true or false`);
  }

  return value;
}

function parseGridOptions(input: unknown): GridOptions | undefined {
  const raw = asRecord(input);
  const options: GridOptions = {};

  if (typeof raw?.rows === 'number' && Number.isFinite(raw.rows)) {
    options.rows = raw.rows;
  }

  if (
    raw?.columns === 'full' ||
    (typeof raw?.columns === 'number' && Number.isFinite(raw.columns))
  ) {
    options.columns = raw.columns;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function parseRegistryIds(input: unknown): RegistryIds | undefined {
  if (input === undefined || input === null) return undefined;

  const raw = asRecord(input);

  if (!raw) {
    throw new Error(
      'estanza-card: registry_ids must map an entity to its registry id',
    );
  }

  const ids: RegistryIds = {};

  for (const [entityId, id] of Object.entries(raw)) {
    if (!entityId.includes('.')) {
      throw new Error(
        `estanza-card: registry_ids key ${entityId} is not an entity`,
      );
    }

    const registryId = optionalString(id, `registry_ids ${entityId}`);

    if (!registryId) {
      throw new Error(`estanza-card: registry_ids ${entityId} needs an id`);
    }

    ids[entityId] = registryId;
  }

  return ids;
}

function parseHomeDocument(input: unknown): HomeDocument | undefined {
  if (input === undefined || input === null) return undefined;

  const parsed = homeDocumentSchema.safeParse(input);

  if (!parsed.success) {
    throw new Error(
      'estanza-card: home_document is not an Estanza home export',
    );
  }

  return parsed.data;
}

function parseBindings(input: unknown): SceneBinding[] {
  if (input === undefined || input === null) return [];

  if (!Array.isArray(input)) {
    throw new Error('estanza-card: bindings must be a list');
  }

  return input.map((entry, index) => parseBinding(entry, index));
}

function parseBinding(input: unknown, index: number): SceneBinding {
  const raw = asRecord(input);

  if (!raw) throw new Error(`estanza-card: binding ${index} must be an object`);

  const binding: SceneBinding = {
    scope: parseScope(raw.scope, index),
    entity_id: optionalString(raw.entity_id, `binding ${index} entity_id`),
    entity_ids: parseEntityIds(raw.entity_ids, index),
    area_id: optionalString(raw.area_id, `binding ${index} area_id`),
    temperature_entity_id: optionalString(
      raw.temperature_entity_id,
      `binding ${index} temperature_entity_id`,
    ),
    humidity_entity_id: optionalString(
      raw.humidity_entity_id,
      `binding ${index} humidity_entity_id`,
    ),
    tap_action: parseAction(raw.tap_action, `binding ${index} tap_action`),
    hold_action: parseAction(raw.hold_action, `binding ${index} hold_action`),
  };

  if (bindingEntityIds(binding).length === 0 && !binding.area_id) {
    throw new Error(
      `estanza-card: binding ${index} needs entity_id, entity_ids or area_id`,
    );
  }

  return binding;
}

function parseAction(input: unknown, field: string): ThingAction | undefined {
  if (input === undefined || input === null) return undefined;

  const raw = asRecord(input);
  const action = raw?.action;

  if ((plainActions as readonly unknown[]).includes(action)) {
    return { action: action as (typeof plainActions)[number] };
  }

  const service = raw?.perform_action;

  if (
    action === 'perform-action' &&
    (performActions as readonly unknown[]).includes(service)
  ) {
    return { action, perform_action: service as PerformAction };
  }

  throw new Error(
    `estanza-card: ${field} must be ${plainActions.join(', ')}, or perform-action with one of ${performActions.join(', ')}`,
  );
}

function parseScope(input: unknown, index: number): SceneScope {
  const raw = asRecord(input);

  if (!raw) {
    throw new Error(`estanza-card: binding ${index} needs a scope object`);
  }

  const type = raw.type;
  const id = raw.id;

  if (!isSceneScopeType(type)) {
    throw new Error(
      `estanza-card: binding ${index} scope type must be one of ${sceneScopeTypes.join(', ')}`,
    );
  }

  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`estanza-card: binding ${index} scope needs an id`);
  }

  return { type, id };
}

function parseEntityIds(input: unknown, index: number): string[] | undefined {
  if (input === undefined || input === null) return undefined;

  if (!Array.isArray(input)) {
    throw new Error(`estanza-card: binding ${index} entity_ids must be a list`);
  }

  return input.map((entry, position) => {
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new Error(
        `estanza-card: binding ${index} entity_ids[${position}] must be an entity id`,
      );
    }

    return entry;
  });
}

function isSceneScopeType(value: unknown): value is SceneScopeType {
  return (
    typeof value === 'string' &&
    (sceneScopeTypes as readonly string[]).includes(value)
  );
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`estanza-card: ${field} must be a non-empty string`);
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
