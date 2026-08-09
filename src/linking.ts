import type { HomeDocument } from '@estanza/plan-engine';
import type { Light, Prop } from '@estanza/plan-engine/document';
import {
  catalogById,
  catalogName,
  pieceName,
} from '@estanza/plan-engine/geometry/catalog.js';
import {
  type DerivedFloor,
  floorOfItem,
  resolvePosition,
} from '@estanza/plan-engine/geometry/geometry.js';

import {
  bindingEntityIds,
  type SceneBinding,
  type SceneScope,
  type SceneScopeType,
  scopeKey,
  type ThingAction,
  type Trigger,
} from './bindings.js';
import {
  areaIdOfEntity,
  deviceClassOf,
  doorDeviceClasses,
  entityDomain,
  type HassEntityState,
  type HomeAssistant,
  humidityDeviceClass,
  humidityUnits,
  isUnavailable,
  measures,
  occupancyDeviceClasses,
  temperatureDeviceClass,
  temperatureUnits,
  windowDeviceClasses,
} from './hass-state.js';
import { formatHumidity, formatTemperature } from './living.js';
import {
  entityName,
  entranceDoorOf,
  isGood,
  matchName,
  nameKey,
  namesEntrance,
  nearMiss,
  qualityRank,
  type SetupProposal,
} from './matching.js';

export type SceneObjectOption = {
  key: string;
  scope: SceneScope;
  label: string;
  short: string;
};

export type Thing = {
  scope: SceneScope;
  key: string;
  name: string;
  shortName: string;
  room: string | null;
  roomName: string;
  floor: string | null;
  entrance: boolean;
};

export type Candidate = {
  entityId: string;
  name: string;
  label: string;
  device: string;
  area: string;
  linked: boolean;
  score: number;
  good: boolean;
  close: boolean;
  strong: boolean;
  unavailable: boolean;
  elsewhere: SceneScope | null;
};

export type Suggestion =
  | { kind: 'entity'; entityId: string; name: string; strong: boolean }
  | { kind: 'area'; areaId: string; name: string; strong: boolean };

export type PickDetail = { scope: SceneScope };

export type EntityFilter = { domain: string; device_class?: string[] };

type Place = { inRoomArea: boolean; named: boolean; words: Set<string> };

export const pickEvent = 'estanza-card-pick';

export const scopeLabels: Record<SceneScopeType, string> = {
  room: 'Room',
  light: 'Light',
  door: 'Door',
  window: 'Window',
  prop: 'Object',
};

const kindDomains: Record<SceneScopeType, readonly string[]> = {
  room: ['sensor', 'climate'],
  light: ['light', 'switch'],
  door: ['binary_sensor', 'cover', 'lock'],
  window: ['binary_sensor', 'cover'],
  prop: ['climate', 'sensor', 'switch', 'media_player', 'fan'],
};

const propKinds: { words: readonly string[]; domains: readonly string[] }[] = [
  {
    words: ['television', 'tv', 'monitor', 'speaker', 'console', 'computer'],
    domains: ['media_player', 'switch'],
  },
  { words: ['thermostat'], domains: ['climate'] },
  {
    words: ['radiator', 'heater', 'boiler', 'ac', 'conditioner'],
    domains: ['climate', 'switch'],
  },
  {
    words: ['fan', 'purifier', 'humidifier', 'dehumidifier'],
    domains: ['fan', 'switch'],
  },
  { words: ['lamp'], domains: ['light', 'switch'] },
  { words: ['plug', 'socket'], domains: ['switch'] },
  {
    words: [
      'dishwasher',
      'dryer',
      'freezer',
      'fridge',
      'machine',
      'microwave',
      'oven',
      'refrigerator',
      'washer',
      'washing',
    ],
    domains: ['switch', 'sensor'],
  },
];

const roomSensorClasses: readonly string[] = [
  temperatureDeviceClass,
  humidityDeviceClass,
  'carbon_dioxide',
  'carbon_monoxide',
  'aqi',
  'pm1',
  'pm25',
  'pm10',
  'nitrogen_dioxide',
  'volatile_organic_compounds',
  'volatile_organic_compounds_parts',
  'illuminance',
  'power',
];

const machineWords = new Set(['cpu', 'gpu', 'load', 'grid', 'ups', 'disk']);

const noiseCategories = ['config', 'diagnostic'];

const noiseDeviceClasses = [
  'battery',
  'signal_strength',
  'energy',
  'power',
  'current',
  'voltage',
  'power_factor',
  'frequency',
  'timestamp',
  'data_size',
  'duration',
  'enum',
];

const noiseSuffixes = ['_linkquality', '_count', '_update_state'];

const LONG_STATE_CHARS = 24;

const doorContactClasses: readonly string[] = doorDeviceClasses;

const windowContactClasses: readonly string[] = [
  ...windowDeviceClasses,
  'opening',
  'door',
];

const windowCoverClasses = [
  'window',
  'blind',
  'shade',
  'shutter',
  'curtain',
  'awning',
];

const linkableWords = new Set([
  'ac',
  'boiler',
  'computer',
  'conditioner',
  'console',
  'dehumidifier',
  'dishwasher',
  'dryer',
  'fan',
  'freezer',
  'fridge',
  'heater',
  'humidifier',
  'lamp',
  'machine',
  'microwave',
  'monitor',
  'oven',
  'plug',
  'purifier',
  'radiator',
  'refrigerator',
  'socket',
  'speaker',
  'television',
  'thermostat',
  'tv',
  'washer',
  'washing',
]);

const fillerWords = new Set(['and', 'between', 'in', 'of', 'the']);

const edgeWords = new Set([...fillerWords, 'at', 'on']);

const joinWords = new Set(['and', 'between', 'from', 'to', 'with']);

const genericWords = new Set(['room']);

const storageWords = new Set([
  'wardrobe',
  'closet',
  'cupboard',
  'pantry',
  'larder',
  'storage',
  'storeroom',
  'utility',
  'armario',
  'trastero',
  'despensa',
  'vestidor',
  'roupeiro',
  'arrecadacao',
  'arrumos',
]);

const openWords = ['Open', 'Closed'] as const;

const detectedWords = ['Detected', 'Clear'] as const;

const binaryWords: Record<string, readonly [string, string]> = {
  door: openWords,
  window: openWords,
  opening: openWords,
  garage_door: openWords,
  garage: openWords,
  gate: openWords,
  lock: ['Unlocked', 'Locked'],
  motion: detectedWords,
  occupancy: detectedWords,
  presence: ['Home', 'Away'],
  moisture: ['Wet', 'Dry'],
  smoke: detectedWords,
  gas: detectedWords,
  carbon_monoxide: detectedWords,
  sound: detectedWords,
  vibration: detectedWords,
  tamper: detectedWords,
  battery: ['Low', 'Normal'],
  connectivity: ['Connected', 'Disconnected'],
  problem: ['Problem', 'OK'],
  safety: ['Unsafe', 'Safe'],
  plug: ['Plugged in', 'Unplugged'],
};

const ROOM_SUGGESTIONS = 2;

const roomReadingDomains = ['sensor', 'climate'];

export function sceneObjectsFromDocument(home: unknown): SceneObjectOption[] {
  const document = asRecord(home);

  if (!document) return [];

  const rooms = roomLabels(document.rooms);
  const roomNames = roomLabelsById(document.rooms);
  const additions = asRecord(document.additions);
  const floors = asRecord(document.plan)?.floors;

  const options = [
    ...roomOptions(rooms),
    ...pieceOptions(additions?.lights, 'light', rooms),
    ...openingOptions(floors, 'doors', 'door', roomNames),
    ...openingOptions(floors, 'windows', 'window', roomNames),
    ...pieceOptions(additions?.props, 'prop', rooms),
  ];

  return dedupeByKey(options);
}

export function thingsOf(
  home: HomeDocument,
  floors: DerivedFloor[],
  links: SceneBinding[],
): Thing[] {
  const linked = new Set(links.map((binding) => scopeKey(binding.scope)));
  const options = sceneObjectsFromDocument(home);
  const names = new Map(options.map((option) => [option.key, option.label]));
  const shorts = new Map(options.map((option) => [option.key, option.short]));
  const roomNames = new Map(
    floors.flatMap((floor) =>
      floor.rooms.map((room) => [room.slug, room.label] as const),
    ),
  );
  const ordered = [...floors].sort((a, b) => b.level - a.level);
  const entrance = entranceDoorOf(floors);

  return ordered.flatMap((floor) => {
    const rooms = floor.rooms.filter((room) => names.has(roomKey(room.slug)));
    const inFloor = (scope: SceneScope, room: string | null): Thing[] => {
      const key = scopeKey(scope);
      const name = names.get(key);

      if (!name) return [];

      return [
        {
          scope,
          key,
          name,
          shortName: shorts.get(key) ?? name,
          room,
          roomName: room ? (roomNames.get(room) ?? '') : '',
          floor: floor.id,
          entrance: scope.type === 'door' && scope.id === entrance,
        },
      ];
    };
    const onFloor = (items: (Light | Prop)[], type: SceneScopeType): Thing[] =>
      items
        .filter(
          (item) =>
            floorOfItem(item, floors).id === floor.id &&
            (type !== 'prop' ||
              linked.has(scopeKey({ type, id: item.slug })) ||
              isLinkableName(names.get(scopeKey({ type, id: item.slug })))),
        )
        .flatMap((item) =>
          inFloor({ type, id: item.slug }, roomOfPiece(floor, item)),
        );
    const openings = (
      list: { id: string; wallId: string }[],
      type: SceneScopeType,
    ): Thing[] =>
      list.flatMap((opening) =>
        inFloor(
          { type, id: opening.id },
          rooms.find((room) => room.walls.includes(opening.wallId))?.slug ??
            null,
        ),
      );

    return [
      ...rooms.flatMap((room) =>
        inFloor({ type: 'room', id: room.slug }, room.slug),
      ),
      ...onFloor(home.additions.lights, 'light'),
      ...openings(floor.floor.doors, 'door'),
      ...openings(floor.floor.windows, 'window'),
      ...onFloor(home.additions.props, 'prop'),
    ];
  });
}

export function isLinkableName(name: string | undefined): boolean {
  const head = name ? headWord(name) : undefined;

  return head !== undefined && linkableWords.has(head);
}

function headWord(name: string): string | undefined {
  return nameKey(name.replace(/\(.*\)/g, ''))
    .split(' ')
    .filter((word) => /[a-z]/.test(word))
    .at(-1);
}

function domainsOf(type: SceneScopeType, name: string): readonly string[] {
  if (type !== 'prop') return kindDomains[type];

  const head = headWord(name);
  const kind = propKinds.find((entry) => head && entry.words.includes(head));

  return kind?.domains ?? kindDomains.prop;
}

export function isStorageRoom(name: string): boolean {
  return nameKey(name)
    .split(' ')
    .some((word) => storageWords.has(word));
}

export function linkedEntities(
  links: SceneBinding[],
  scope: SceneScope,
): string[] {
  const key = scopeKey(scope);

  return [
    ...new Set(
      links
        .filter((binding) => scopeKey(binding.scope) === key)
        .flatMap(bindingEntityIds),
    ),
  ];
}

export function linkedArea(
  links: SceneBinding[],
  scope: SceneScope,
): string | null {
  const key = scopeKey(scope);

  return (
    links.find((binding) => scopeKey(binding.scope) === key && binding.area_id)
      ?.area_id ?? null
  );
}

export function isLinked(links: SceneBinding[], scope: SceneScope): boolean {
  return (
    linkedEntities(links, scope).length > 0 || linkedArea(links, scope) !== null
  );
}

export function linkEntity(
  links: SceneBinding[],
  scope: SceneScope,
  entityId: string,
): SceneBinding[] {
  const key = scopeKey(scope);
  const index = links.findIndex((binding) => scopeKey(binding.scope) === key);

  if (linkedEntities(links, scope).includes(entityId)) return links;
  if (index === -1) return [...links, { scope, entity_id: entityId }];

  const binding = links[index];
  const next = withEntities(binding, [...ownEntities(binding), entityId]);

  return links.map((entry, position) => (position === index ? next : entry));
}

export function unlinkEntity(
  links: SceneBinding[],
  scope: SceneScope,
  entityId: string,
): SceneBinding[] {
  const key = scopeKey(scope);

  return links.flatMap((binding) => {
    if (scopeKey(binding.scope) !== key) return [binding];

    const next = withEntities(
      binding,
      ownEntities(binding).filter((id) => id !== entityId),
    );

    if (next.temperature_entity_id === entityId) {
      delete next.temperature_entity_id;
    }
    if (next.humidity_entity_id === entityId) delete next.humidity_entity_id;

    return isEmpty(next) ? [] : [next];
  });
}

export function holderOf(
  links: SceneBinding[],
  entityId: string,
  scope: SceneScope,
): SceneScope | null {
  const key = scopeKey(scope);

  return (
    links.find(
      (binding) =>
        scopeKey(binding.scope) !== key &&
        bindingEntityIds(binding).includes(entityId),
    )?.scope ?? null
  );
}

export function moveEntity(
  links: SceneBinding[],
  scope: SceneScope,
  entityId: string,
): SceneBinding[] {
  return linkEntity(freeEntity(links, scope, entityId), scope, entityId);
}

export function swapEntity(
  links: SceneBinding[],
  scope: SceneScope,
  oldId: string,
  newId: string,
): SceneBinding[] {
  if (!linkedEntities(links, scope).includes(oldId)) {
    return moveEntity(links, scope, newId);
  }

  const key = scopeKey(scope);
  const swap = (id: string | undefined): string | undefined =>
    id === oldId ? newId : id;

  return freeEntity(links, scope, newId).map((binding) => {
    if (scopeKey(binding.scope) !== key) return binding;

    const ids = [...new Set(ownEntities(binding).map((id) => swap(id) ?? id))];
    const next = withEntities(binding, ids);

    if (next.temperature_entity_id) {
      next.temperature_entity_id = swap(next.temperature_entity_id);
    }
    if (next.humidity_entity_id) {
      next.humidity_entity_id = swap(next.humidity_entity_id);
    }

    return next;
  });
}

export function entityFilter(type: SceneScopeType, name = ''): EntityFilter[] {
  return domainsOf(type, name).map((domain) => {
    const classes = filterClasses(type, domain);

    return classes ? { domain, device_class: [...classes] } : { domain };
  });
}

function filterClasses(
  type: SceneScopeType,
  domain: string,
): readonly string[] | null {
  if (type === 'room' && domain === 'sensor') return roomSensorClasses;
  if (domain !== 'binary_sensor') return null;
  if (type === 'door') return doorContactClasses;
  if (type === 'window') return windowContactClasses;

  return null;
}

function freeEntity(
  links: SceneBinding[],
  scope: SceneScope,
  entityId: string,
): SceneBinding[] {
  const key = scopeKey(scope);
  const others = links
    .filter(
      (binding) =>
        scopeKey(binding.scope) !== key &&
        bindingEntityIds(binding).includes(entityId),
    )
    .map((binding) => binding.scope);

  return others.reduce(
    (next, other) => unlinkEntity(next, other, entityId),
    links,
  );
}

export function unlinkThing(
  links: SceneBinding[],
  scope: SceneScope,
): SceneBinding[] {
  const key = scopeKey(scope);

  return links.filter((binding) => scopeKey(binding.scope) !== key);
}

export function setArea(
  links: SceneBinding[],
  scope: SceneScope,
  areaId: string,
): SceneBinding[] {
  const key = scopeKey(scope);
  const index = links.findIndex((binding) => scopeKey(binding.scope) === key);

  if (index === -1)
    return areaId ? [...links, { scope, area_id: areaId }] : links;

  return links.flatMap((binding, position) => {
    if (position !== index) return [binding];

    const next: SceneBinding = { ...binding };

    if (areaId) next.area_id = areaId;
    else delete next.area_id;

    return isEmpty(next) ? [] : [next];
  });
}

export function setThingAction(
  links: SceneBinding[],
  scope: SceneScope,
  trigger: Trigger,
  action: ThingAction | undefined,
): SceneBinding[] {
  const key = scopeKey(scope);
  const field = trigger === 'tap' ? 'tap_action' : 'hold_action';
  const first = links.findIndex((binding) => scopeKey(binding.scope) === key);

  return links.map((binding, position) => {
    if (scopeKey(binding.scope) !== key) return binding;

    const { [field]: _old, ...rest } = binding;

    return position === first && action ? { ...rest, [field]: action } : rest;
  });
}

export function candidatesFor(
  thing: Thing,
  hass: HomeAssistant,
  links: SceneBinding[],
): Candidate[] {
  const own = new Set(linkedEntities(links, thing.scope));
  const roomArea = roomAreaOf(thing, hass, links);
  const bare = thing.name.replace(/\s*\([^)]*\)/g, '').trim();
  const roomWords = scoringWords(thing.roomName);
  const ownWords = scoringWords(bare);

  const found = Object.values(hass.states).flatMap((state): Candidate[] => {
    const entityId = state.entity_id;
    const entry = hass.entities[entityId];
    const areaId = entry ? areaIdOfEntity(hass, entry) : null;
    const inRoomArea = areaId !== null && areaId === roomArea;

    const name = entityName(hass, entityId);
    const words = new Set(
      [name, objectName(entityId)].flatMap((text) => nameKey(text).split(' ')),
    );
    const missed = nearMiss(bare, name) || nearMiss(thing.roomName, name);
    const thingShare = missed ? 0 : share(ownWords, words);
    const roomShare = missed ? 0 : share(roomWords, words);
    const entrance = thing.entrance && namesEntrance(name);
    const unavailable = isUnavailable(state);

    const linked = own.has(entityId);
    const offered =
      !entry?.hidden &&
      fitsKind(thing.scope.type, domainsOf(thing.scope.type, bare), state, {
        inRoomArea,
        named: thingShare === 1 || roomShare === 1,
        words,
      }) &&
      !isNoise(hass, state, thing.scope.type);

    if (!linked && !offered) return [];

    const pool = [{ id: entityId, name, aliases: [objectName(entityId)] }];
    const byThing = missed ? 'none' : matchName(bare, pool).quality;
    const byRoom =
      thing.roomName && !missed
        ? matchName(thing.roomName, pool).quality
        : 'none';
    const good =
      !unavailable &&
      (qualityRank[byThing] >= qualityRank.similar ||
        thingShare === 1 ||
        (thing.scope.type !== 'room' && roomShare === 1 && thingShare > 0));
    const nameScore =
      2 * qualityRank[byThing] +
      qualityRank[byRoom] +
      2 * thingShare +
      roomShare +
      2 * Number(entrance);

    return [
      {
        entityId,
        name,
        ...splitDevice(name),
        area: areaId ? (hass.areas[areaId]?.name ?? '') : '',
        linked,
        score:
          nameScore +
          areaBonus(areaId, roomArea) +
          classBonus(thing.scope.type, state),
        good,
        close:
          !unavailable && (good || inRoomArea || roomShare === 1 || entrance),
        strong:
          !unavailable &&
          (byThing === 'exact' ||
            (inRoomArea &&
              thingShare === 1 &&
              (thing.scope.type === 'room' || roomShare === 1))),
        unavailable,
        elsewhere: linked ? null : holderOf(links, entityId, thing.scope),
      },
    ];
  });

  return found.sort(
    (a, b) =>
      Number(b.linked) - Number(a.linked) ||
      Number(a.unavailable) - Number(b.unavailable) ||
      b.score - a.score ||
      a.name.localeCompare(b.name),
  );
}

export function suggestAll(
  proposal: SetupProposal,
  things: Thing[],
  hass: HomeAssistant,
  links: SceneBinding[],
): Map<string, Suggestion[]> {
  const suggestions = new Map<string, Suggestion[]>();
  const claimed = new Set<string>();
  const open = things.filter((thing) => !isLinked(links, thing.scope));
  const openKeys = new Set(open.map((thing) => thing.key));
  const areas = proposedAreas(proposal, hass);

  for (const room of proposal.floors.flatMap((floor) => floor.rooms)) {
    const key = scopeKey(room.scope);
    const offers = areas.get(key) ?? [];

    if (openKeys.has(key) && room.match.choice && offers.length > 0) {
      suggestions.set(key, offers);
    }

    for (const item of [...room.lights, ...room.doors, ...room.windows]) {
      const entityId = item.match.choice;
      const itemKey = scopeKey(item.scope);

      if (!entityId || !isGood(item.match) || !openKeys.has(itemKey)) continue;
      if (claimed.has(entityId)) continue;

      suggestions.set(itemKey, [
        entitySuggestion(hass, entityId, item.match.quality === 'exact'),
      ]);
      claimed.add(entityId);
    }
  }

  const offers = open
    .filter((thing) => !suggestions.has(thing.key))
    .flatMap((thing) =>
      bestOf(
        thing,
        candidatesFor(thing, hass, links).filter(
          (entry) => !entry.elsewhere && !entry.unavailable,
        ),
      ).map((candidate) => ({
        thing,
        candidate,
      })),
    );
  const bestScore = new Map<string, number>();
  const bestCount = new Map<string, number>();

  for (const { candidate } of offers) {
    const top = bestScore.get(candidate.entityId) ?? -Infinity;

    if (candidate.score > top) {
      bestScore.set(candidate.entityId, candidate.score);
      bestCount.set(candidate.entityId, 1);
    } else if (candidate.score === top) {
      bestCount.set(
        candidate.entityId,
        (bestCount.get(candidate.entityId) ?? 0) + 1,
      );
    }
  }

  for (const { thing, candidate } of offers) {
    const { entityId } = candidate;

    if (claimed.has(entityId)) continue;
    if (bestScore.get(entityId) !== candidate.score) continue;
    if ((bestCount.get(entityId) ?? 0) > 1) continue;

    suggestions.set(thing.key, [
      ...(suggestions.get(thing.key) ?? []),
      entitySuggestion(hass, entityId, candidate.strong),
    ]);
    claimed.add(entityId);
  }

  return suggestions;
}

export function proposedAreas(
  proposal: SetupProposal,
  hass: HomeAssistant,
): Map<string, Suggestion[]> {
  const offers = new Map<string, Suggestion[]>();

  for (const room of proposal.floors.flatMap((floor) => floor.rooms)) {
    const { match } = room;
    const areaIds = match.choice
      ? [match.choice]
      : match.candidates.slice(0, match.fits).map((candidate) => candidate.id);

    if (room.linked || areaIds.length === 0) continue;

    offers.set(
      scopeKey(room.scope),
      areaIds.map((areaId) => ({
        kind: 'area',
        areaId,
        name: hass.areas[areaId]?.name ?? areaId,
        strong: match.quality === 'exact',
      })),
    );
  }

  return offers;
}

export function applySuggestion(
  links: SceneBinding[],
  scope: SceneScope,
  suggestion: Suggestion,
): SceneBinding[] {
  return suggestion.kind === 'area'
    ? setArea(links, scope, suggestion.areaId)
    : linkEntity(links, scope, suggestion.entityId);
}

export function formatState(
  hass: HomeAssistant,
  state: HassEntityState | undefined,
): string {
  if (!state) return 'Not found';

  const unit = state.attributes.unit_of_measurement;
  const value = Number(state.state);
  const reading =
    typeof unit === 'string' && state.state !== '' && Number.isFinite(value);

  if (reading && measures(state, temperatureDeviceClass, temperatureUnits)) {
    return formatTemperature(
      value,
      unit,
      hass.config?.unit_system?.temperature ?? null,
    );
  }
  if (reading && measures(state, humidityDeviceClass, humidityUnits)) {
    return formatHumidity(value);
  }

  const formatted = hass.formatEntityState?.(state);

  if (formatted) return formatted;
  if (typeof unit === 'string' && unit) return `${state.state} ${unit}`;

  const words =
    entityDomain(state.entity_id) === 'binary_sensor'
      ? binaryWords[deviceClassOf(state) ?? '']
      : undefined;

  if (words && (state.state === 'on' || state.state === 'off')) {
    return words[state.state === 'on' ? 0 : 1];
  }

  return humanize(state.state);
}

export function areaNameOf(hass: HomeAssistant, entityId: string): string {
  const entry = hass.entities[entityId];
  const areaId = entry ? areaIdOfEntity(hass, entry) : null;

  return areaId ? (hass.areas[areaId]?.name ?? '') : '';
}

export function entityRole(
  entityId: string,
  state: HassEntityState | undefined,
  kind?: SceneScopeType,
): string {
  if (!state) return 'Not found';
  if (measures(state, temperatureDeviceClass, temperatureUnits)) {
    return 'Temperature';
  }
  if (measures(state, humidityDeviceClass, humidityUnits)) return 'Humidity';

  const domain = entityDomain(entityId);
  const deviceClass = deviceClassOf(state) ?? '';
  const contact =
    domain === 'binary_sensor' && windowContactClasses.includes(deviceClass);

  if (contact && (kind === 'door' || kind === 'window')) {
    return scopeLabels[kind];
  }
  if (domain === 'light') return 'Light';
  if (domain === 'switch') {
    if (kind === 'light') return 'Light';

    return deviceClass === 'switch' ? 'Switch' : 'Plug';
  }
  if (domain === 'climate') return 'Heating and cooling';
  if (domain === 'lock') return 'Lock';
  if (
    domain === 'binary_sensor' &&
    (occupancyDeviceClasses as readonly string[]).includes(deviceClass)
  ) {
    return 'Presence';
  }
  if ((windowDeviceClasses as readonly string[]).includes(deviceClass)) {
    return 'Window';
  }
  if ((doorDeviceClasses as readonly string[]).includes(deviceClass)) {
    return 'Door';
  }

  return humanize(deviceClass || domain);
}

export function shortName(name: string, context: string[]): string {
  const tokens = name.trim().split(/\s+/);
  const contexts = context
    .map((text) => thingWords(withoutPossessive(text)))
    .filter((words) => words.length > 0);
  const attempts = [contexts, ...contexts.map((words) => [words]).reverse()];

  for (const attempt of attempts) {
    const kept = withoutContext(tokens, attempt);

    if (kept.length < tokens.length && isMeaningful(kept)) {
      const text = kept.join(' ');

      return text.charAt(0).toUpperCase() + text.slice(1);
    }
  }

  return name;
}

export function splitDevice(name: string): { label: string; device: string } {
  const tokens = name.split(/\s+/);
  const mark = Math.max(
    ...tokens.map((token, index) => (nameKey(token) ? -1 : index)),
  );
  const tail = tokens.slice(mark + 1).join(' ');
  const head = trimEdges(tokens.slice(0, Math.max(mark, 0))).join(' ');

  if (!head || !/\p{L}{2}/u.test(tail)) return { label: name, device: '' };

  return {
    label: tail.charAt(0).toUpperCase() + tail.slice(1),
    device: head,
  };
}

export function openingName(kind: string, rooms: string[]): string | null {
  if (rooms.length > 1) return `${kind} between ${rooms[0]} and ${rooms[1]}`;

  return null;
}

export function isWordId(id: string): boolean {
  return /^[a-z]{2,}(?:[-_][a-z]{2,})*$/.test(id);
}

export function humanize(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim().split(/\s+/);

  if (!words[0]) return value;

  const [first, ...rest] = words;

  return [
    first.charAt(0).toUpperCase() + first.slice(1),
    ...rest.map(lowerUnlessAcronym),
  ].join(' ');
}

function bestOf(thing: Thing, candidates: Candidate[]): Candidate[] {
  const [top, second] = candidates;

  if (thing.scope.type === 'room') {
    const readings = candidates.filter((candidate) =>
      roomReadingDomains.includes(entityDomain(candidate.entityId)),
    );
    const [first] = readings;

    return readings
      .filter(
        (candidate) =>
          first?.good && candidate.good && candidate.score === first.score,
      )
      .slice(0, ROOM_SUGGESTIONS);
  }

  if (!top?.good) return [];

  return !second || second.score < top.score ? [top] : [];
}

function entitySuggestion(
  hass: HomeAssistant,
  entityId: string,
  strong: boolean,
): Suggestion {
  return { kind: 'entity', entityId, name: entityName(hass, entityId), strong };
}

function fitsKind(
  type: SceneScopeType,
  domains: readonly string[],
  state: HassEntityState,
  place: Place,
): boolean {
  const domain = entityDomain(state.entity_id);
  const deviceClass = deviceClassOf(state);

  if (!domains.includes(domain)) return false;
  if (type === 'room') return fitsRoom(state, domain, deviceClass, place);

  if (domain === 'binary_sensor') {
    const classes = type === 'door' ? doorContactClasses : windowContactClasses;

    return deviceClass !== null && classes.includes(deviceClass);
  }

  if (domain === 'cover') {
    const classes = type === 'door' ? doorContactClasses : windowCoverClasses;

    return deviceClass === null || classes.includes(deviceClass);
  }

  if (type === 'light' && domain === 'switch') {
    return place.inRoomArea || place.named;
  }

  return true;
}

function fitsRoom(
  state: HassEntityState,
  domain: string,
  deviceClass: string | null,
  place: Place,
): boolean {
  if (domain !== 'sensor') return true;
  if ([...place.words].some((word) => machineWords.has(word))) return false;
  if (deviceClass !== null) return roomSensorClasses.includes(deviceClass);

  return (
    place.named &&
    (measures(state, temperatureDeviceClass, temperatureUnits) ||
      measures(state, humidityDeviceClass, humidityUnits))
  );
}

function isNoise(
  hass: HomeAssistant,
  state: HassEntityState,
  type: SceneScopeType,
): boolean {
  const entityId = state.entity_id;
  const category = hass.entities[entityId]?.entity_category;
  const deviceClass = deviceClassOf(state);
  const wanted =
    type === 'room' && roomSensorClasses.includes(deviceClass ?? '');

  if (category && noiseCategories.includes(category)) return true;
  if (deviceClass && noiseDeviceClasses.includes(deviceClass) && !wanted) {
    return true;
  }
  if (noiseSuffixes.some((suffix) => entityId.endsWith(suffix))) return true;

  return (
    entityDomain(entityId) === 'sensor' &&
    deviceClass === null &&
    state.state.length > LONG_STATE_CHARS &&
    !Number.isFinite(Number(state.state))
  );
}

function classBonus(type: SceneScopeType, state: HassEntityState): number {
  if (type === 'room') {
    return roomReadingDomains.includes(entityDomain(state.entity_id)) ? 1 : 0;
  }

  if (entityDomain(state.entity_id) === type) return 1;

  return deviceClassOf(state) === type ? 0.5 : 0;
}

function areaBonus(areaId: string | null, roomArea: string | null): number {
  if (!areaId || !roomArea) return 0;

  return areaId === roomArea ? 2 : -1;
}

function roomAreaOf(
  thing: Thing,
  hass: HomeAssistant,
  links: SceneBinding[],
): string | null {
  if (!thing.room) return null;

  const linked = linkedArea(links, { type: 'room', id: thing.room });

  if (linked) return linked;

  const areas = Object.values(hass.areas).map((area) => ({
    id: area.area_id,
    name: area.name,
    aliases: area.aliases ?? [],
  }));
  const match = matchName(thing.roomName, areas);

  return isGood(match) ? match.choice : null;
}

function withoutPossessive(text: string): string {
  return text.replace(/['’]s\b/gi, '');
}

function withoutContext(tokens: string[], contexts: string[][]): string[] {
  let kept = tokens;

  for (const words of contexts) kept = withoutRun(kept, words);

  return trimEdges(kept.filter((token, index) => !isRepeatedMark(kept, index)));
}

function withoutRun(tokens: string[], words: string[]): string[] {
  const keys = tokens.map((token) => nameKey(withoutPossessive(token)));
  const bounded = (index: number): boolean =>
    index < 0 || index >= keys.length || keys[index] === '';

  for (let start = 0; start + words.length <= keys.length; start += 1) {
    const end = start + words.length;
    const matches = words.every(
      (word, offset) => keys[start + offset] === word,
    );
    const joined =
      joinWords.has(keys[start - 1] ?? '') || joinWords.has(keys[end] ?? '');

    if (matches && !joined && (bounded(start - 1) || bounded(end))) {
      return [...tokens.slice(0, start), ...tokens.slice(end)];
    }
  }

  return tokens;
}

function isRepeatedMark(tokens: string[], index: number): boolean {
  return index > 0 && !nameKey(tokens[index]) && !nameKey(tokens[index - 1]);
}

function trimEdges(tokens: string[]): string[] {
  const loose = (token: string | undefined): boolean =>
    token !== undefined && (!nameKey(token) || edgeWords.has(nameKey(token)));
  let start = 0;
  let end = tokens.length;

  while (start < end && loose(tokens[start])) start += 1;
  while (end > start && loose(tokens[end - 1])) end -= 1;

  return tokens.slice(start, end);
}

function isMeaningful(tokens: string[]): boolean {
  return tokens.some((token) => /\p{L}/u.test(token));
}

function thingWords(text: string): string[] {
  return nameKey(text)
    .split(' ')
    .filter((word) => word && !fillerWords.has(word));
}

function scoringWords(text: string): string[] {
  return thingWords(withoutPossessive(text)).filter(
    (word) => word.length > 1 && !/^\d+$/.test(word) && !genericWords.has(word),
  );
}

function share(wanted: string[], words: Set<string>): number {
  if (wanted.length === 0) return 0;

  return wanted.filter((word) => words.has(word)).length / wanted.length;
}

function objectName(entityId: string): string {
  return (entityId.split('.')[1] ?? entityId).replace(/_/g, ' ');
}

function ownEntities(binding: SceneBinding): string[] {
  const named = [binding.entity_id, ...(binding.entity_ids ?? [])];

  return [...new Set(named.filter((id): id is string => Boolean(id)))];
}

function withEntities(binding: SceneBinding, ids: string[]): SceneBinding {
  const {
    entity_id: _single,
    entity_ids: _many,
    ...rest
  }: SceneBinding = binding;
  const next: SceneBinding = { ...rest };

  if (ids.length === 1) next.entity_id = ids[0];
  if (ids.length > 1) next.entity_ids = ids;

  return next;
}

function isEmpty(binding: SceneBinding): boolean {
  return !binding.area_id && bindingEntityIds(binding).length === 0;
}

function roomKey(slug: string): string {
  return scopeKey({ type: 'room', id: slug });
}

function roomOfPiece(floor: DerivedFloor, item: Light | Prop): string | null {
  if (item.room && floor.roomsBySlug.has(item.room)) return item.room;

  const at = resolvePosition(item, floor.roomsBySlug, [floor]);

  return floor.roomAt(at)?.slug ?? null;
}

function namedOption(
  scope: SceneScope,
  label: string,
  short: string = label,
): SceneObjectOption {
  return { key: scopeKey(scope), scope, label, short };
}

function roomLabels(input: unknown): Map<string, string> {
  const rooms = asRecord(input);
  const labels = new Map<string, string>();

  if (!rooms) return labels;

  for (const [key, value] of Object.entries(rooms)) {
    const room = asRecord(value);

    if (!room || room.hidden === true) continue;

    const slug = readString(room.slug) || key;

    labels.set(slug, readString(room.label).trim() || wordName(slug, 'room'));
  }

  return labels;
}

function roomLabelsById(input: unknown): Map<string, string> {
  const rooms = asRecord(input);
  const labels = new Map<string, string>();

  if (!rooms) return labels;

  for (const [id, value] of Object.entries(rooms)) {
    const label = readString(asRecord(value)?.label).trim();

    if (label) labels.set(id, label);
  }

  return labels;
}

function roomOptions(rooms: Map<string, string>): SceneObjectOption[] {
  return [...rooms].map(([slug, label]) =>
    namedOption({ type: 'room', id: slug }, label),
  );
}

function pieceOptions(
  input: unknown,
  type: SceneScopeType,
  rooms: Map<string, string>,
): SceneObjectOption[] {
  if (!Array.isArray(input)) return [];

  const pieces = input.flatMap((entry: unknown) => {
    const piece = asRecord(entry);
    const slug = piece ? readString(piece.slug) : '';

    if (!piece || !slug) return [];

    return [
      {
        slug,
        name: pieceLabel(piece, type, slug, rooms),
        room: rooms.get(readString(piece.room)) ?? '',
      },
    ];
  });
  const repeats = countBy(pieces, (piece) => `${piece.name}|${piece.room}`);
  const seen = new Map<string, number>();

  return pieces.map(({ slug, name, room }) => {
    const group = `${name}|${room}`;
    const nth = (seen.get(group) ?? 0) + 1;
    const named = (repeats.get(group) ?? 0) > 1 ? `${name} ${nth}` : name;
    const shown = room && !mentions(named, room) ? `${named} (${room})` : named;

    seen.set(group, nth);

    return namedOption({ type, id: slug }, shown, named);
  });
}

function pieceLabel(
  piece: Record<string, unknown>,
  type: SceneScopeType,
  slug: string,
  rooms: Map<string, string>,
): string {
  const label = readString(piece.label).trim();
  const roomSlug = readString(piece.room);
  const roomLabel = rooms.get(roomSlug);

  if (label) return label;

  if (type !== 'prop') {
    const rest = roomLabel ? slug.slice(roomSlug.length + 1) : '';

    if (roomLabel && slug.startsWith(`${roomSlug}-`) && isWordId(rest)) {
      return `${roomLabel} ${rest.replace(/[-_]+/g, ' ')}`;
    }

    if (isWordId(slug)) return humanize(slug);

    return roomLabel ? `${roomLabel} light` : scopeLabels[type];
  }

  const kind = readString(piece.type);
  const catalogId = readString(piece.catalogId);

  if (kind === 'catalog' && catalogById.has(catalogId)) {
    return humanize(catalogName(catalogId));
  }

  if (kind && kind !== 'catalog') return humanize(pieceName(kind));

  return wordName(slug, type);
}

function wordName(id: string, type: SceneScopeType): string {
  return isWordId(id) ? humanize(id) : scopeLabels[type];
}

function openingOptions(
  input: unknown,
  key: 'doors' | 'windows',
  type: SceneScopeType,
  roomNames: Map<string, string>,
): SceneObjectOption[] {
  if (!Array.isArray(input)) return [];

  let ordinal = 0;

  return input.flatMap((entry: unknown) => {
    const floor = asRecord(entry);
    const openings = floor?.[key];

    if (!Array.isArray(openings)) return [];

    const rooms = roomsByWall(floor?.rooms, roomNames);

    const found = openings.flatMap((item: unknown) => {
      const opening = asRecord(item);
      const id = opening ? readString(opening.id) : '';

      ordinal += 1;

      if (!id) return [];

      const wallRooms = rooms.get(readString(opening?.wallId)) ?? [];

      return [{ id, rooms: wallRooms, ordinal }];
    });
    const repeats = countBy(found, (opening) => opening.rooms.join('|'));
    const seen = new Map<string, number>();

    return found.map((opening) => {
      const group = opening.rooms.join('|');
      const nth = (seen.get(group) ?? 0) + 1;
      const repeat = (repeats.get(group) ?? 0) > 1 ? nth : null;
      const name = openingLabel(opening, type, repeat);

      seen.set(group, nth);

      return namedOption({ type, id: opening.id }, name);
    });
  });
}

function openingLabel(
  opening: { id: string; rooms: string[]; ordinal: number },
  type: SceneScopeType,
  repeat: number | null,
): string {
  const kind = scopeLabels[type];
  const counted = repeat === null ? kind : `${kind} ${repeat}`;
  const number = repeat === null ? '' : ` ${repeat}`;

  if (/[-_]/.test(opening.id) && isWordId(opening.id)) {
    return humanize(opening.id);
  }

  if (opening.rooms.length === 1) {
    return `${opening.rooms[0]} ${kind.toLowerCase()}${number}`;
  }

  return openingName(counted, opening.rooms) ?? `${kind} ${opening.ordinal}`;
}

function countBy<TItem>(
  items: TItem[],
  key: (item: TItem) => string,
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  }

  return counts;
}

function roomsByWall(
  input: unknown,
  roomNames: Map<string, string>,
): Map<string, string[]> {
  const byWall = new Map<string, string[]>();

  if (!Array.isArray(input)) return byWall;

  for (const entry of input) {
    const room = asRecord(entry);
    const name = room
      ? (roomNames.get(readString(room.id)) ?? humanize(readString(room.name)))
      : '';

    if (!name || !Array.isArray(room?.walls)) continue;

    for (const wall of room.walls) {
      const id = readString(wall);

      if (!id) continue;

      byWall.set(id, [...(byWall.get(id) ?? []), name]);
    }
  }

  return byWall;
}

function dedupeByKey(options: SceneObjectOption[]): SceneObjectOption[] {
  const seen = new Map<string, SceneObjectOption>();

  for (const option of options) {
    if (!seen.has(option.key)) seen.set(option.key, option);
  }

  return [...seen.values()];
}

function mentions(text: string, part: string): boolean {
  return text.toLowerCase().includes(part.toLowerCase());
}

function lowerUnlessAcronym(word: string): string {
  return /^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word;
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}
