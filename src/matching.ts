import type { HomeDocument } from '@estanza/plan-engine';
import {
  type DerivedFloor,
  deriveFloors,
} from '@estanza/plan-engine/geometry/geometry.js';

import {
  bindingEntityIds,
  type SceneBinding,
  type SceneScope,
  scopeKey,
} from './bindings.js';
import { floorName } from './floors.js';
import {
  areaIdOfEntity,
  deviceClassOf,
  doorDeviceClasses,
  entityDomain,
  type HomeAssistant,
  isUnavailable,
  windowDeviceClasses,
} from './hass-state.js';

export const matchQualities = ['exact', 'similar', 'doubtful', 'none'] as const;

export type MatchQuality = (typeof matchQualities)[number];

export type MatchCandidate = {
  id: string;
  name: string;
  aliases?: string[];
};

export type Match = {
  quality: MatchQuality;
  choice: string | null;
  candidates: MatchCandidate[];
  fits: number;
};

export type NamedItem = {
  id: string;
  name: string;
};

export type ItemProposal = {
  scope: SceneScope;
  name: string;
  match: Match;
};

export type OpeningProposal = ItemProposal & {
  rooms: string[];
};

export type RoomProposal = ItemProposal & {
  linked: boolean;
  lights: ItemProposal[];
  doors: OpeningProposal[];
  windows: OpeningProposal[];
};

export type FloorProposal = {
  id: string;
  name: string;
  rooms: RoomProposal[];
};

export type SetupProposal = {
  floors: FloorProposal[];
  found: { rooms: number; lights: number; doors: number };
};

const entranceWords = ['main', 'entrance', 'front'];

const doorDomains = ['binary_sensor', 'cover'];

const windowSensorClasses: readonly string[] = [
  ...windowDeviceClasses,
  'opening',
];

const roomConcepts: string[][] = [
  [
    'living room',
    'living space',
    'living',
    'lounge',
    'sitting room',
    'family room',
    'salon',
    'sala de estar',
    'estar',
    'sejour',
    'salle de sejour',
    'wohnzimmer',
    'soggiorno',
    'salotto',
    'woonkamer',
    'huiskamer',
    'zitkamer',
    'pokoj dzienny',
  ],
  [
    'kitchen',
    'cocina',
    'cuisine',
    'kuche',
    'cucina',
    'cozinha',
    'keuken',
    'kuchnia',
  ],
  [
    'bedroom',
    'dormitorio',
    'habitacion',
    'chambre',
    'chambre a coucher',
    'schlafzimmer',
    'camera da letto',
    'quarto',
    'slaapkamer',
    'sypialnia',
  ],
  [
    'master bedroom',
    'suite',
    'dormitorio principal',
    'suite parentale',
    'chambre parentale',
    'elternschlafzimmer',
    'camera matrimoniale',
    'quarto principal',
    'ouderslaapkamer',
    'sypialnia glowna',
  ],
  [
    'bathroom',
    'bath',
    'bano',
    'cuarto de bano',
    'salle de bain',
    'salle de bains',
    'badezimmer',
    'bad',
    'bagno',
    'casa de banho',
    'banheiro',
    'badkamer',
    'lazienka',
  ],
  [
    'toilet',
    'wc',
    'restroom',
    'washroom',
    'powder room',
    'cloakroom',
    'aseo',
    'toilettes',
    'toilette',
    'gaste wc',
    'gastetoilette',
    'bagno di servizio',
    'lavabo',
    'toaleta',
  ],
  [
    'hall',
    'hallway',
    'entrance',
    'entrance hall',
    'entry',
    'foyer',
    'corridor',
    'recibidor',
    'entrada',
    'pasillo',
    'vestibulo',
    'hall d entree',
    'entree',
    'couloir',
    'flur',
    'diele',
    'eingang',
    'korridor',
    'ingresso',
    'corridoio',
    'hall de entrada',
    'corredor',
    'gang',
    'hal',
    'przedpokoj',
    'korytarz',
    'hol',
  ],
  [
    'landing',
    'upstairs hall',
    'rellano',
    'descansillo',
    'palier',
    'treppenabsatz',
    'pianerottolo',
    'patamar',
    'overloop',
    'podest',
  ],
  [
    'dining room',
    'dining',
    'comedor',
    'salle a manger',
    'esszimmer',
    'sala da pranzo',
    'sala de jantar',
    'eetkamer',
    'jadalnia',
  ],
  [
    'study',
    'office',
    'home office',
    'den',
    'despacho',
    'estudio',
    'oficina',
    'bureau',
    'arbeitszimmer',
    'buro',
    'studio',
    'ufficio',
    'escritorio',
    'werkkamer',
    'kantoor',
    'gabinet',
    'biuro',
  ],
  [
    'guest room',
    'guest bedroom',
    'habitacion de invitados',
    'cuarto de invitados',
    'chambre d amis',
    'gastezimmer',
    'camera degli ospiti',
    'camera ospiti',
    'quarto de hospedes',
    'logeerkamer',
    'gastenkamer',
  ],
  ['garage', 'garaje', 'garagem', 'garaz'],
  [
    'laundry',
    'laundry room',
    'utility',
    'utility room',
    'lavadero',
    'buanderie',
    'waschkuche',
    'hauswirtschaftsraum',
    'lavanderia',
    'bijkeuken',
    'washok',
    'wasruimte',
    'pralnia',
  ],
  [
    'basement',
    'cellar',
    'sotano',
    'sous sol',
    'keller',
    'seminterrato',
    'porao',
    'kelder',
    'piwnica',
  ],
  [
    'wine cellar',
    'bodega',
    'cava',
    'cave a vin',
    'cave',
    'weinkeller',
    'cantina',
    'adega',
    'wijnkelder',
    'piwniczka',
  ],
  [
    'workshop',
    'taller',
    'atelier',
    'werkstatt',
    'hobbyraum',
    'officina',
    'werkplaats',
    'warsztat',
  ],
  [
    'games room',
    'game room',
    'playroom',
    'rec room',
    'sala de juegos',
    'salle de jeux',
    'spielzimmer',
    'sala giochi',
    'sala de jogos',
    'speelkamer',
    'pokoj gier',
  ],
  [
    'kids room',
    'childrens room',
    'nursery',
    'habitacion infantil',
    'chambre d enfant',
    'kinderzimmer',
    'cameretta',
    'quarto das criancas',
    'kinderkamer',
    'pokoj dzieciecy',
  ],
  [
    'attic',
    'loft',
    'desvan',
    'atico',
    'buhardilla',
    'grenier',
    'combles',
    'dachboden',
    'soffitta',
    'sotao',
    'zolder',
    'strych',
  ],
  [
    'garden',
    'yard',
    'backyard',
    'jardin',
    'garten',
    'giardino',
    'jardim',
    'tuin',
    'ogrod',
  ],
  [
    'terrace',
    'patio',
    'deck',
    'terraza',
    'terrasse',
    'terrazza',
    'terraco',
    'terras',
    'taras',
  ],
  ['balcony', 'balcon', 'balkon', 'balcone', 'varanda'],
  [
    'pantry',
    'larder',
    'despensa',
    'garde manger',
    'cellier',
    'speisekammer',
    'vorratsraum',
    'dispensa',
    'voorraadkamer',
    'spizarnia',
  ],
  [
    'walk in closet',
    'dressing room',
    'dressing',
    'vestidor',
    'ankleide',
    'ankleidezimmer',
    'cabina armadio',
    'closet',
    'inloopkast',
    'garderoba',
  ],
];

const conceptIndex = buildConceptIndex(roomConcepts);

export const qualityRank: Record<MatchQuality, number> = {
  exact: 3,
  similar: 2,
  doubtful: 1,
  none: 0,
};

export function nameKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function isGood(match: Match): boolean {
  return match.quality === 'exact' || match.quality === 'similar';
}

export function nearMiss(a: string, b: string): boolean {
  const left = matchKey(a).split(' ');
  const right = matchKey(b).split(' ');

  return marksClash(left, right) || marksClash(right, left);
}

export function matchName(name: string, candidates: MatchCandidate[]): Match {
  const key = matchKey(name);

  if (!key) return noMatch();

  const same = candidates.filter((candidate) =>
    namesOf(candidate).some((alias) => matchKey(alias) === key),
  );

  if (same.length === 1) {
    const [only] = same;
    const identical =
      only.name.trim().toLowerCase() === name.trim().toLowerCase();

    return settled(identical ? 'exact' : 'similar', only, candidates);
  }

  if (same.length > 1) return undecided(same, candidates);

  const concept = candidates.filter((candidate) =>
    namesOf(candidate).some((alias) => sameConcept(key, matchKey(alias))),
  );

  if (concept.length === 1) return settled('similar', concept[0], candidates);
  if (concept.length > 1) return undecided(concept, candidates);

  return fuzzyMatch(key, candidates);
}

export function matchRooms(
  rooms: NamedItem[],
  areas: MatchCandidate[],
): Map<string, Match> {
  return matchUniquely(rooms, areas, (room, pool) =>
    matchName(room.name, pool),
  );
}

export function proposeSetup(
  home: HomeDocument,
  hass: HomeAssistant,
  bindings: SceneBinding[],
  picked: Record<string, string> = {},
): SetupProposal {
  const floors = deriveFloors(home);
  const bound = new Set(bindings.map((binding) => scopeKey(binding.scope)));
  const usedEntities = new Set(bindings.flatMap(bindingEntityIds));
  const linkedAreas = linkedAreasOf(bindings);
  const usedAreas = new Set(linkedAreas.values());
  const rooms = floors.flatMap((floor) => visibleRooms(home, floor));
  const roomNames = new Map(rooms.map((room) => [room.slug, room.label]));

  const areas = Object.values(hass.areas)
    .filter((area) => !usedAreas.has(area.area_id))
    .map((area) => ({
      id: area.area_id,
      name: area.name,
      aliases: area.aliases ?? [],
    }));

  const openRooms = rooms.filter((room) => !bound.has(roomScopeKey(room.slug)));
  const roomMatches = matchRooms(
    openRooms.map((room) => ({ id: room.slug, name: room.label })),
    areas,
  );

  const areaOf = (slug: string): string | null =>
    linkedAreas.get(slug) ??
    picked[slug] ??
    roomMatches.get(slug)?.choice ??
    null;
  const confident = (slug: string): boolean => {
    const match = roomMatches.get(slug);

    return (
      linkedAreas.has(slug) || slug in picked || (match ? isGood(match) : false)
    );
  };

  const lights = proposeLights(
    home,
    hass,
    bound,
    usedEntities,
    roomNames,
    areaOf,
    confident,
  );
  const doors = proposeOpenings(
    'door',
    floors,
    hass,
    bound,
    usedEntities,
    roomNames,
    areaOf,
    confident,
  );
  const windows = proposeOpenings(
    'window',
    floors,
    hass,
    bound,
    usedEntities,
    roomNames,
    areaOf,
    confident,
  );

  const proposed = floors.map((floor) => ({
    id: floor.id,
    name: floorName(floor.level),
    level: floor.level,
    rooms: visibleRooms(home, floor).flatMap((room): RoomProposal[] => {
      const linked = linkedAreas.has(room.slug);
      const roomLights = lights.get(room.slug) ?? [];
      const roomDoors = doors.get(room.slug) ?? [];
      const roomWindows = windows.get(room.slug) ?? [];
      const match = linked
        ? settled(
            'exact',
            areaCandidate(hass, linkedAreas.get(room.slug) ?? ''),
            [],
          )
        : (roomMatches.get(room.slug) ?? noMatch());

      if (bound.has(roomScopeKey(room.slug)) && !linked) return [];
      if (
        linked &&
        roomLights.length === 0 &&
        roomDoors.length === 0 &&
        roomWindows.length === 0
      )
        return [];

      return [
        {
          scope: { type: 'room', id: room.slug },
          name: room.label,
          match,
          linked,
          lights: roomLights,
          doors: roomDoors,
          windows: roomWindows,
        },
      ];
    }),
  }));

  return {
    floors: proposed
      .filter((floor) => floor.rooms.length > 0)
      .sort((a, b) => b.level - a.level)
      .map(({ id, name, rooms: floorRooms }) => ({
        id,
        name,
        rooms: floorRooms,
      })),
    found: {
      rooms: rooms.length,
      lights: home.additions.lights.length,
      doors: floors.reduce(
        (total, floor) => total + floor.floor.doors.length,
        0,
      ),
    },
  };
}

export function entityName(hass: HomeAssistant, entityId: string): string {
  const friendly = hass.states[entityId]?.attributes.friendly_name;

  if (typeof friendly === 'string' && friendly) return friendly;

  return hass.entities[entityId]?.name ?? entityId;
}

function proposeLights(
  home: HomeDocument,
  hass: HomeAssistant,
  bound: Set<string>,
  usedEntities: Set<string>,
  roomNames: Map<string, string>,
  areaOf: (slug: string) => string | null,
  confident: (slug: string) => boolean,
): Map<string, ItemProposal[]> {
  const byRoom = new Map<string, ItemProposal[]>();
  const open = home.additions.lights.filter(
    (light) =>
      light.room && !bound.has(scopeKey({ type: 'light', id: light.slug })),
  );
  const isLight = (entityId: string) => entityDomain(entityId) === 'light';
  const loose = arealessEntities(hass, usedEntities, isLight);

  for (const room of new Set(open.map((light) => light.room ?? ''))) {
    const area = areaOf(room);
    const lights = open
      .filter((light) => light.room === room)
      .map((light) => ({
        id: light.slug,
        name: light.label?.trim() || humanizeSlug(light.slug),
      }));
    const named = loose.filter(
      (candidate) =>
        mentionedRooms(candidate.name, roomNames).has(room) ||
        lights.some((light) => isGood(matchName(light.name, [candidate]))),
    );
    const pool = [
      ...(area ? entitiesIn(hass, area, usedEntities, isLight) : []),
      ...named,
    ];
    const matches = matchUniquely(lights, pool, (light, candidates) =>
      matchEntity(light.name, candidates, lights.length),
    );
    const byName = new Set(named.map((candidate) => candidate.id));

    byRoom.set(
      room,
      lights.map((light) => {
        const match = matches.get(light.id) ?? noMatch();

        return {
          scope: { type: 'light', id: light.id },
          name: light.name,
          match: trusted(
            match,
            confident(room) || byName.has(match.choice ?? ''),
          ),
        };
      }),
    );
  }

  return byRoom;
}

export function entranceDoorOf(floors: DerivedFloor[]): string | null {
  const ground = floors.find((floor) => floor.level === 0);

  if (!ground) return null;

  const shell = ground.floor.doors.flatMap((door) => {
    const rooms = ground.rooms.filter((room) =>
      room.walls.includes(door.wallId),
    );

    return rooms.length === 1 ? [{ id: door.id, room: rooms[0].label }] : [];
  });
  const found =
    shell.length > 1
      ? shell.filter(({ room }) => sameConcept(nameKey(room), 'hall'))
      : shell;

  return found.length === 1 ? found[0].id : null;
}

export function namesEntrance(name: string): boolean {
  return nameKey(name)
    .split(' ')
    .some((word) => entranceWords.includes(word));
}

function proposeOpenings(
  type: 'door' | 'window',
  floors: DerivedFloor[],
  hass: HomeAssistant,
  bound: Set<string>,
  usedEntities: Set<string>,
  roomNames: Map<string, string>,
  areaOf: (slug: string) => string | null,
  confident: (slug: string) => boolean,
): Map<string, OpeningProposal[]> {
  const entrance = type === 'door' ? entranceDoorOf(floors) : null;
  const fits = type === 'door' ? isDoorSensor(hass) : isWindowSensor(hass);
  const openings = floors.flatMap((floor) =>
    (type === 'door' ? floor.floor.doors : floor.floor.windows)
      .filter((opening) => !bound.has(scopeKey({ type, id: opening.id })))
      .map((opening) => ({
        id: opening.id,
        rooms: floor.rooms
          .filter((room) => room.walls.includes(opening.wallId))
          .map((room) => room.slug),
      }))
      .filter((opening) => opening.rooms.length > 0),
  );
  const roomsIn = (candidate: MatchCandidate): string[] => [
    ...mentionedRooms(candidate.name, roomNames),
  ];
  const within = (opening: { rooms: string[] }, rooms: string[]): boolean =>
    rooms.every((room) => opening.rooms.includes(room));
  const namesTheEntrance = (
    opening: { id: string; rooms: string[] },
    candidate: MatchCandidate,
  ): boolean =>
    opening.id === entrance &&
    namesEntrance(candidate.name) &&
    within(opening, roomsIn(candidate));

  const loose = arealessEntities(hass, usedEntities, fits);
  const byNameOnly = new Set<string>();
  const candidatesOf = new Map(
    openings.map((opening) => {
      const named = loose.filter((candidate) => {
        const rooms = roomsIn(candidate);

        return (
          (rooms.length > 0 && within(opening, rooms)) ||
          namesTheEntrance(opening, candidate)
        );
      });

      for (const candidate of named) byNameOnly.add(candidate.id);

      return [
        opening.id,
        uniqueById([
          ...opening.rooms.flatMap((room) => {
            const area = areaOf(room);

            return area ? entitiesIn(hass, area, usedEntities, fits) : [];
          }),
          ...named,
        ]),
      ];
    }),
  );

  const matches = new Map<string, Match>();
  const claimed = new Set<string>();
  const byName = new Map<string, MatchCandidate[]>();

  for (const opening of openings) {
    const wanted = [...opening.rooms].sort().join('|');
    const named = (candidatesOf.get(opening.id) ?? []).filter(
      (candidate) =>
        roomsIn(candidate).sort().join('|') === wanted ||
        (namesTheEntrance(opening, candidate) &&
          nameKey(candidate.name).split(' ').includes(type)),
    );

    byName.set(opening.id, named);
  }

  const namedOnce = countUses([...byName.values()].flat());

  for (const opening of openings) {
    const named = byName.get(opening.id) ?? [];

    if (named.length !== 1 || namedOnce.get(named[0].id) !== 1) continue;

    matches.set(
      opening.id,
      settled('exact', named[0], candidatesOf.get(opening.id) ?? []),
    );
    claimed.add(named[0].id);
  }

  const leftOf = (opening: { id: string }): MatchCandidate[] =>
    (candidatesOf.get(opening.id) ?? []).filter(
      (candidate) => !claimed.has(candidate.id),
    );
  const open = openings.filter((opening) => !matches.has(opening.id));
  const offered = countUses(open.flatMap(leftOf));

  for (const opening of open) {
    const left = leftOf(opening);
    const [only] = left;

    if (left.length === 1 && offered.get(only.id) === 1) {
      matches.set(opening.id, settled('similar', only, left));
    } else if (left.length > 0) {
      matches.set(opening.id, undecided(left, left));
    }
  }

  const byRoom = new Map<string, OpeningProposal[]>();

  for (const opening of openings) {
    const [first] = opening.rooms;
    const match = matches.get(opening.id) ?? noMatch();
    const proposal: OpeningProposal = {
      scope: { type, id: opening.id },
      name: opening.id,
      rooms: opening.rooms.map((room) => roomNames.get(room) ?? room),
      match: trusted(
        match,
        opening.rooms.every(confident) || byNameOnly.has(match.choice ?? ''),
      ),
    };

    byRoom.set(first, [...(byRoom.get(first) ?? []), proposal]);
  }

  return byRoom;
}

function matchEntity(
  name: string,
  candidates: MatchCandidate[],
  siblings: number,
): Match {
  const byName = matchName(name, candidates);

  if (isGood(byName)) return byName;

  if (siblings === 1 && candidates.length === 1) {
    return settled('similar', candidates[0], candidates);
  }

  if (byName.quality === 'doubtful' || candidates.length === 0) return byName;

  return undecided(candidates, candidates);
}

function matchUniquely(
  items: NamedItem[],
  pool: MatchCandidate[],
  match: (item: NamedItem, candidates: MatchCandidate[]) => Match,
): Map<string, Match> {
  const won = new Map<string, Match>();
  let open = items;
  let free = pool;
  let latest = new Map<string, Match>();

  while (open.length > 0) {
    latest = new Map(open.map((item) => [item.id, match(item, free)]));

    const winners = claimWinners(open, latest);

    if (winners.size === 0) break;

    for (const id of winners.keys()) won.set(id, latest.get(id) ?? noMatch());

    const claimed = new Set(winners.values());

    free = free.filter((candidate) => !claimed.has(candidate.id));
    open = open.filter((item) => !winners.has(item.id));
  }

  return new Map(
    items.map((item) => [
      item.id,
      won.get(item.id) ?? contested(latest.get(item.id) ?? noMatch()),
    ]),
  );
}

function claimWinners(
  items: NamedItem[],
  matches: Map<string, Match>,
): Map<string, string> {
  const claims = new Map<string, NamedItem[]>();

  for (const item of items) {
    const found = matches.get(item.id);

    if (!found?.choice || !isGood(found)) continue;

    claims.set(found.choice, [...(claims.get(found.choice) ?? []), item]);
  }

  const winners = new Map<string, string>();

  for (const [candidate, claimants] of claims) {
    const best = Math.max(
      ...claimants.map((item) => rankOf(matches.get(item.id))),
    );
    const top = claimants.filter(
      (item) => rankOf(matches.get(item.id)) === best,
    );

    if (top.length === 1) winners.set(top[0].id, candidate);
  }

  return winners;
}

function contested(match: Match): Match {
  return isGood(match)
    ? { ...match, quality: 'doubtful', choice: null }
    : match;
}

function fuzzyMatch(key: string, candidates: MatchCandidate[]): Match {
  const near = candidates.filter((candidate) =>
    namesOf(candidate).some((alias) => isNear(key, matchKey(alias))),
  );

  if (near.length === 1) {
    return {
      quality: 'doubtful',
      choice: near[0].id,
      candidates: ordered(near, candidates),
      fits: 1,
    };
  }

  if (near.length > 1) return undecided(near, candidates);

  return { quality: 'none', choice: null, candidates, fits: 0 };
}

function isNear(a: string, b: string): boolean {
  if (!a || !b) return false;

  const left = a.split(' ');
  const right = b.split(' ');

  if (marksClash(left, right) || marksClash(right, left)) return false;

  const [short, long] =
    left.length <= right.length ? [left, right] : [right, left];

  if (short.every((word) => long.includes(word))) return true;
  if (conceptWithin(a, right) || conceptWithin(b, left)) return true;

  const shortest = Math.min(a.length, b.length);
  const allowed = shortest >= 8 ? 2 : shortest >= 4 ? 1 : 0;

  return allowed > 0 && editDistance(a, b) <= allowed;
}

function conceptWithin(whole: string, words: string[]): boolean {
  return words.some((_word, start) =>
    [1, 2, 3].some(
      (length) =>
        start + length <= words.length &&
        sameConcept(whole, words.slice(start, start + length).join(' ')),
    ),
  );
}

function marksClash(words: string[], other: string[]): boolean {
  return words.some((word, index) => {
    const before = words[index - 1];

    if (index === 0 || !isMark(word) || isMark(before)) return false;

    return other.some(
      (candidate, at) =>
        candidate === before &&
        isMark(other[at + 1] ?? '') &&
        other[at + 1] !== word,
    );
  });
}

function isMark(word: string): boolean {
  return /^(?:\p{L}|\d+)$/u.test(word);
}

function matchKey(text: string): string {
  return nameKey(text.replace(/['’]s\b/giu, ''));
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_value, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];

    for (let j = 1; j <= b.length; j += 1) {
      const swap = a[i - 1] === b[j - 1] ? 0 : 1;

      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + swap,
      );
    }

    previous = current;
  }

  return previous[b.length];
}

function sameConcept(a: string, b: string): boolean {
  const left = conceptIndex.get(a);
  const right = conceptIndex.get(b);

  if (!left || !right) return false;

  return [...left].some((concept) => right.has(concept));
}

function buildConceptIndex(concepts: string[][]): Map<string, Set<number>> {
  const index = new Map<string, Set<number>>();

  concepts.forEach((words, concept) => {
    for (const word of words) {
      index.set(word, new Set([...(index.get(word) ?? []), concept]));
    }
  });

  return index;
}

function mentionedRooms(
  text: string,
  roomNames: Map<string, string>,
): Set<string> {
  let rest = ` ${nameKey(text)} `;
  const found = new Set<string>();
  const longestFirst = [...roomNames].sort((a, b) => b[1].length - a[1].length);

  for (const [slug, label] of longestFirst) {
    const word = ` ${nameKey(label)} `;

    if (word.trim() === '' || !rest.includes(word)) continue;

    found.add(slug);
    rest = rest.replace(word, ' ');
  }

  return found;
}

function entitiesIn(
  hass: HomeAssistant,
  areaId: string,
  used: Set<string>,
  keep: (entityId: string) => boolean,
): MatchCandidate[] {
  return Object.values(hass.entities)
    .filter(
      (entry) =>
        !entry.hidden &&
        !used.has(entry.entity_id) &&
        isUsable(hass, entry.entity_id) &&
        areaIdOfEntity(hass, entry) === areaId &&
        keep(entry.entity_id),
    )
    .map((entry) => ({
      id: entry.entity_id,
      name: entityName(hass, entry.entity_id),
    }));
}

function arealessEntities(
  hass: HomeAssistant,
  used: Set<string>,
  keep: (entityId: string) => boolean,
): MatchCandidate[] {
  return Object.keys(hass.states)
    .filter((entityId) => {
      const entry = hass.entities[entityId];

      return (
        !entry?.hidden &&
        !used.has(entityId) &&
        isUsable(hass, entityId) &&
        (!entry || areaIdOfEntity(hass, entry) === null) &&
        keep(entityId)
      );
    })
    .map((entityId) => ({ id: entityId, name: entityName(hass, entityId) }));
}

function isUsable(hass: HomeAssistant, entityId: string): boolean {
  const state = hass.states[entityId];

  return state !== undefined && !isUnavailable(state);
}

function isDoorSensor(hass: HomeAssistant): (entityId: string) => boolean {
  return (entityId) => {
    const state = hass.states[entityId];
    const deviceClass = state ? deviceClassOf(state) : null;

    return (
      doorDomains.includes(entityDomain(entityId)) &&
      (doorDeviceClasses as readonly (string | null)[]).includes(deviceClass)
    );
  };
}

function isWindowSensor(hass: HomeAssistant): (entityId: string) => boolean {
  return (entityId) => {
    const state = hass.states[entityId];
    const deviceClass = state ? deviceClassOf(state) : null;

    return (
      entityDomain(entityId) === 'binary_sensor' &&
      windowSensorClasses.includes(deviceClass ?? '')
    );
  };
}

function linkedAreasOf(bindings: SceneBinding[]): Map<string, string> {
  const linked = new Map<string, string>();

  for (const binding of bindings) {
    if (binding.scope.type !== 'room' || !binding.area_id) continue;
    if (!linked.has(binding.scope.id))
      linked.set(binding.scope.id, binding.area_id);
  }

  return linked;
}

function visibleRooms(
  home: HomeDocument,
  floor: DerivedFloor,
): DerivedFloor['rooms'] {
  return floor.rooms.filter((room) => home.rooms[room.id]?.hidden !== true);
}

function areaCandidate(hass: HomeAssistant, areaId: string): MatchCandidate {
  return { id: areaId, name: hass.areas[areaId]?.name ?? areaId };
}

function trusted(match: Match, trust: boolean): Match {
  return trust || !isGood(match) ? match : { ...match, quality: 'doubtful' };
}

function settled(
  quality: MatchQuality,
  choice: MatchCandidate,
  candidates: MatchCandidate[],
): Match {
  return {
    quality,
    choice: choice.id,
    candidates: ordered([choice], candidates),
    fits: 1,
  };
}

function undecided(top: MatchCandidate[], candidates: MatchCandidate[]): Match {
  return {
    quality: 'doubtful',
    choice: null,
    candidates: ordered(top, candidates),
    fits: top.length,
  };
}

function noMatch(): Match {
  return { quality: 'none', choice: null, candidates: [], fits: 0 };
}

function ordered(
  top: MatchCandidate[],
  all: MatchCandidate[],
): MatchCandidate[] {
  return uniqueById([...top, ...all]);
}

function uniqueById(candidates: MatchCandidate[]): MatchCandidate[] {
  const seen = new Map<string, MatchCandidate>();

  for (const candidate of candidates) {
    if (!seen.has(candidate.id)) seen.set(candidate.id, candidate);
  }

  return [...seen.values()];
}

function countUses(candidates: MatchCandidate[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const candidate of candidates) {
    counts.set(candidate.id, (counts.get(candidate.id) ?? 0) + 1);
  }

  return counts;
}

function rankOf(match: Match | undefined): number {
  return match ? qualityRank[match.quality] : 0;
}

function namesOf(candidate: MatchCandidate): string[] {
  return [candidate.name, ...(candidate.aliases ?? [])];
}

function roomScopeKey(slug: string): string {
  return scopeKey({ type: 'room', id: slug });
}

function humanizeSlug(slug: string): string {
  const words = slug.replace(/[_-]+/g, ' ').trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
}
